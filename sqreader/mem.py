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

import ctypes
import ctypes.util
import errno
import os
import re
import struct
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

from . import profiling

_PROFILE = profiling.ENABLED
_perf = time.perf_counter_ns


# -- process_vm_readv fast-path bindings --------------------------------------
#
# read_many() folds up to IOV_MAX regions into a single process_vm_readv(2)
# syscall on Linux; on non-Linux or if the binding fails to load the code
# path degrades transparently to a per-region pread loop (byte-for-byte
# identical result). IOV_MAX has been Linux's UIO_MAXIOV constant for 15+
# years — using the literal is standard practice (glibc exposes it the
# same way).
_IOV_MAX = 1024


class _LinuxIOVec(ctypes.Structure):
    _fields_ = [
        ("iov_base", ctypes.c_void_p),
        ("iov_len", ctypes.c_size_t),
    ]


def _load_process_vm_readv():
    """Bind libc process_vm_readv on Linux; return None everywhere else.

    Called once at module import. Wrapped in try/except so an unusual
    libc (e.g. musl without the symbol) also degrades quietly to the
    loop path — the caller never sees a NameError from a broken bind.
    """
    if sys.platform != "linux":
        return None
    try:
        libc_path = ctypes.util.find_library("c") or "libc.so.6"
        libc = ctypes.CDLL(libc_path, use_errno=True)
        fn = libc.process_vm_readv
        fn.argtypes = [
            ctypes.c_int,
            ctypes.POINTER(_LinuxIOVec), ctypes.c_ulong,
            ctypes.POINTER(_LinuxIOVec), ctypes.c_ulong,
            ctypes.c_ulong,
        ]
        fn.restype = ctypes.c_ssize_t
        return fn
    except (OSError, AttributeError):
        return None


_libc_process_vm_readv = _load_process_vm_readv()


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
        # Instance-level binding reference so tests can swap it (and so a
        # future patch can support per-process disable via config).
        self._readv_fn = _libc_process_vm_readv

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
                if _PROFILE:
                    _t = _perf()
                    data = os.pread(fd, size, addr)
                    profiling.add_read(_t, len(data))
                else:
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

    def _readv_batch(
        self, batch: Sequence[tuple[int, int]],
    ) -> list[bytes] | None:
        """One process_vm_readv syscall for a batch of at most IOV_MAX regions.

        Returns bytes in request order on success. Returns None on any
        errno, on a short read (n != total), or when the ctypes binding
        is unavailable — callers fall back to a per-region pread loop
        that preserves the pre-fast-path behavior exactly.
        """
        fn = self._readv_fn
        if fn is None:
            return None
        n_iov = len(batch)
        if n_iov == 0:
            return []
        sizes = [sz for _, sz in batch]
        total = sum(sizes)
        if total <= 0:
            return [b""] * n_iov

        local_buf = (ctypes.c_ubyte * total)()
        local_base = ctypes.addressof(local_buf)

        IovArray = _LinuxIOVec * n_iov
        local_iovs = IovArray()
        remote_iovs = IovArray()
        cursor = 0
        for j, (addr, size) in enumerate(batch):
            local_iovs[j].iov_base = local_base + cursor
            local_iovs[j].iov_len = size
            remote_iovs[j].iov_base = addr
            remote_iovs[j].iov_len = size
            cursor += size

        try:
            if _PROFILE:
                _t = _perf()
                n = fn(self.pid, local_iovs, n_iov, remote_iovs, n_iov, 0)
                profiling.add_read(_t, total, regions=n_iov)
            else:
                n = fn(self.pid, local_iovs, n_iov, remote_iovs, n_iov, 0)
        except OSError:
            return None
        if n < 0 or n != total:
            return None

        raw = bytes(local_buf)
        out: list[bytes] = []
        cursor = 0
        for size in sizes:
            out.append(raw[cursor:cursor + size])
            cursor += size
        return out

    def read_many(
        self, requests: Sequence[tuple[int, int]],
    ) -> list[bytes]:
        """Read a list of (addr, size) regions and return their bytes in order.

        Fast path (Linux): folds up to IOV_MAX (1024) regions into a
        single process_vm_readv syscall. On a short-read / errno the
        chunk falls back to a per-region pread loop that raises OSError
        on the first failed region — identical semantics to ``read()``.
        On non-Linux or if the binding failed to load the loop path is
        used unconditionally.
        """
        if not requests:
            return []
        if self._readv_fn is None or len(requests) < 2:
            return [self.read(addr, size) for addr, size in requests]
        reqs = list(requests)
        out: list[bytes] = []
        for off in range(0, len(reqs), _IOV_MAX):
            chunk = reqs[off:off + _IOV_MAX]
            result = self._readv_batch(chunk)
            if result is None:
                out.extend(self.read(a, s) for a, s in chunk)
            else:
                out.extend(result)
        return out

    def try_read_many(
        self, requests: Sequence[tuple[int, int]],
    ) -> list[bytes | None]:
        """Non-raising batched read: failed regions become ``None`` at
        their slot in the returned list; the loop always completes.

        Kept on the loop path in this commit — try_read's per-address
        validation and None-on-failure semantics interact with the
        batch's all-or-nothing short-read behavior in a way that
        deserves its own commit + tests before flipping.
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
