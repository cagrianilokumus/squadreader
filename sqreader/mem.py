"""
Read-only access to a running process's address space via /proc/<pid>/mem.

Why a class and not just a function:
- /proc/<pid>/maps must be parsed to know which addresses are even readable
  (reading a non-mapped page returns EIO, not zeros).
- We want to cache the maps but also re-read them on demand, because UE5
  allocates new heap regions throughout a match.

Why a persistent fd + pread (and not open/lseek/read/close per read):
- A snapshot tick issues tens of thousands of reads; at 4 syscalls per
  read the open/close pairs alone dominated the build time. pread on a
  long-lived fd is ONE syscall per read and has no seek state to race.
- The one hazard of holding the fd — the kernel revoking it when
  ptrace_scope / capabilities change mid-session — is handled in
  read(): on EBADF/EPERM the fd is reopened once and the read retried.

Read-only by design: this module never opens /proc/<pid>/mem with write
permission and exposes no write method. Writing would corrupt live matches
and clearly violate Squad's TOS.
"""
from __future__ import annotations

import errno
import os
import re
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence


@dataclass(frozen=True, slots=True)
class MapRegion:
    """One line from /proc/<pid>/maps."""
    start: int
    end: int
    perms: str          # e.g. "rw-p", "r-xp"
    offset: int         # file offset for file-backed regions, 0 otherwise
    dev: str
    inode: int
    pathname: str       # "", "[heap]", "[stack]", or a file path

    @property
    def size(self) -> int:
        return self.end - self.start

    @property
    def readable(self) -> bool:
        return self.perms[0] == "r"

    @property
    def writable(self) -> bool:
        return self.perms[1] == "w"

    @property
    def executable(self) -> bool:
        return self.perms[2] == "x"

    @property
    def is_anonymous(self) -> bool:
        return self.pathname == "" and self.inode == 0

    def __repr__(self) -> str:
        return (f"MapRegion({self.start:#x}-{self.end:#x} {self.perms}"
                f" off={self.offset:#x} {self.pathname or '[anon]'!s})")


_MAPS_RE = re.compile(
    r"^(?P<start>[0-9a-f]+)-(?P<end>[0-9a-f]+)\s+"
    r"(?P<perms>\S+)\s+"
    r"(?P<offset>[0-9a-f]+)\s+"
    r"(?P<dev>\S+)\s+"
    r"(?P<inode>\d+)"
    r"(?:\s+(?P<path>.*))?$"
)


def parse_maps(pid: int) -> list[MapRegion]:
    """Parse /proc/<pid>/maps. Raises FileNotFoundError if pid is gone."""
    out: list[MapRegion] = []
    with open(f"/proc/{pid}/maps", encoding="utf-8", errors="replace") as f:
        for line in f:
            m = _MAPS_RE.match(line.rstrip("\n"))
            if not m:
                continue
            path = (m.group("path") or "").strip()
            out.append(MapRegion(
                start=int(m.group("start"), 16),
                end=int(m.group("end"), 16),
                perms=m.group("perms"),
                offset=int(m.group("offset"), 16),
                dev=m.group("dev"),
                inode=int(m.group("inode")),
                pathname=path,
            ))
    return out


class ProcessMemory:
    """
    Read-only handle on a running process's address space.

    Example:
        pm = ProcessMemory(1234567)
        s = pm.read_cstring(0x13b08ae)              # 'GWorld'
        ptr = pm.read_u64(some_global_addr)
        chunk = pm.read(addr, 4096)
    """

    def __init__(self, pid: int):
        self.pid = pid
        self._mem_path = f"/proc/{pid}/mem"
        if not Path(f"/proc/{pid}").exists():
            raise FileNotFoundError(f"no such process: {pid}")
        self._maps: list[MapRegion] | None = None
        self._fd: int | None = None  # lazily-opened persistent mem fd

    # -- fd lifecycle -----------------------------------------------------------

    def close(self) -> None:
        """Close the persistent mem fd (reopened lazily on next read)."""
        if self._fd is not None:
            try:
                os.close(self._fd)
            except OSError:
                pass
            self._fd = None

    def __enter__(self) -> "ProcessMemory":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    # -- maps -----------------------------------------------------------------

    @property
    def maps(self) -> list[MapRegion]:
        if self._maps is None:
            self.refresh_maps()
        assert self._maps is not None
        return self._maps

    def refresh_maps(self) -> None:
        self._maps = parse_maps(self.pid)

    def region_for(self, addr: int) -> MapRegion | None:
        for r in self.maps:
            if r.start <= addr < r.end:
                return r
        return None

    def module_base(self, path_suffix: str) -> int | None:
        """Lowest-address mapping for the named module (substring match)."""
        candidates = [r for r in self.maps if path_suffix in r.pathname]
        if not candidates:
            return None
        return min(r.start for r in candidates)

    def writable_anon_regions(self) -> list[MapRegion]:
        """Anonymous writable regions — where UE allocators live."""
        return [r for r in self.maps if r.writable and r.is_anonymous]

    # -- raw read -------------------------------------------------------------

    def read(self, addr: int, size: int) -> bytes:
        """Read `size` bytes starting at `addr`. Raises OSError if unmapped.

        Single pread syscall on the persistent fd. If the kernel revoked
        the fd (ptrace_scope flip, capability change → EBADF/EPERM), it
        is reopened once and the read retried; a genuinely-gone process
        surfaces as FileNotFoundError from the reopen.
        """
        if size <= 0:
            return b""
        for attempt in (0, 1):
            fd = self._fd
            if fd is None:
                fd = self._fd = os.open(self._mem_path, os.O_RDONLY)
            try:
                data = os.pread(fd, size, addr)
            except OSError as e:
                if attempt == 0 and e.errno in (errno.EBADF, errno.EPERM):
                    self.close()
                    continue
                raise
            if not data:
                raise OSError(f"read(addr={addr:#x}, size={size}) returned 0 bytes")
            return data
        raise OSError(f"read(addr={addr:#x}, size={size}) failed after fd reopen")

    def try_read(self, addr: int, size: int) -> bytes | None:
        # Early-reject anything that obviously can't be a valid x86_64 user
        # address: <= 0, or above the 48-bit canonical range. Saves the
        # process_vm_readv syscall AND avoids os.lseek's c_long overflow
        # on junk pointers like 0xffff... that show up when the snapshot
        # reader catches a UObject mid-reallocation.
        if addr <= 0 or addr >= 0x800000000000 or size <= 0:
            return None
        try:
            return self.read(addr, size)
        except (OSError, OverflowError, ValueError):
            return None

    # -- typed reads ----------------------------------------------------------

    def read_u8(self, addr: int) -> int:
        return self.read(addr, 1)[0]

    def read_u16(self, addr: int) -> int:
        return struct.unpack_from("<H", self.read(addr, 2))[0]

    def read_u32(self, addr: int) -> int:
        return struct.unpack_from("<I", self.read(addr, 4))[0]

    def read_i32(self, addr: int) -> int:
        return struct.unpack_from("<i", self.read(addr, 4))[0]

    def read_u64(self, addr: int) -> int:
        return struct.unpack_from("<Q", self.read(addr, 8))[0]

    def read_ptr(self, addr: int) -> int:
        return self.read_u64(addr)

    def read_f32(self, addr: int) -> float:
        return struct.unpack_from("<f", self.read(addr, 4))[0]

    def read_f64(self, addr: int) -> float:
        return struct.unpack_from("<d", self.read(addr, 8))[0]

    def read_cstring(self, addr: int, max_len: int = 256) -> str:
        raw = self.read(addr, max_len)
        end = raw.find(b"\x00")
        if end >= 0:
            raw = raw[:end]
        return raw.decode("utf-8", errors="replace")

    # -- batched reads --------------------------------------------------------

    def read_many(
        self, requests: Sequence[tuple[int, int]],
    ) -> list[bytes]:
        """Read a list of (addr, size) regions and return their bytes in order.

        Currently a straight loop over ``read()`` — a subsequent commit
        will transparently fold multi-region reads into a single
        process_vm_readv syscall on Linux (with a per-region pread
        fallback), so this is the batching hook every caller should
        migrate to. Raises OSError on the first failed region, matching
        ``read()`` semantics exactly.
        """
        return [self.read(addr, size) for addr, size in requests]

    def try_read_many(
        self, requests: Sequence[tuple[int, int]],
    ) -> list[bytes | None]:
        """Non-raising batched read: failed regions become ``None`` at
        their slot in the returned list; the loop always completes.

        Same future-batching note as ``read_many``.
        """
        return [self.try_read(addr, size) for addr, size in requests]

    # -- region iteration -----------------------------------------------------

    def iter_region_bytes(
        self,
        region: MapRegion,
        *,
        chunk: int = 1 << 20,
    ) -> Iterator[tuple[int, bytes]]:
        """
        Yield (addr, bytes) tuples covering the region in `chunk`-sized pieces.
        Skips chunks that fail to read (guard pages, racing unmaps).
        """
        addr = region.start
        while addr < region.end:
            want = min(chunk, region.end - addr)
            try:
                data = self.read(addr, want)
            except OSError:
                data = b""
            if data:
                yield addr, data
                addr += len(data)
            else:
                addr += want


__all__ = ["MapRegion", "ProcessMemory", "parse_maps"]
