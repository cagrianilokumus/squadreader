"""GUObjectArray / FNamePool discovery against both platforms' address layouts.

The two discovery scans look for the same structures in different places:

* Linux: the binary is non-PIE ELF, and the globals sit in the anonymous
  "extended BSS" mapping right after its rw-p segment.
* Windows: the .exe is a PE image, ASLR-relocated per launch, and the globals
  are statics inside its own writable section (file-backed, so NOT anonymous).

These tests build each layout as MapRegions over byte buffers and drive the
real ProcessMemory logic (region_for, writable_anon_regions, iter_region_bytes,
try_read) through it, so the platform decisions are what is under test. The
platform each scan believes it is on is pinned per test, which lets both
layouts run on either OS.
"""
from __future__ import annotations

import struct
import sys
from types import SimpleNamespace

import pytest

from sqreader import addrcache, cli
from sqreader import config as config_mod
from sqreader.mem import MapRegion, ProcessMemory
from sqreader.ue import fname, module, uobject
from sqreader.ue.fname import (
    FNEA_BLOCKS_OFFSET, FNEA_CURRENT_BLOCK_OFFSET, FNameEntryAllocator,
    find_fname_pool_base,
)
from sqreader.ue.module import load_module
from sqreader.ue.uobject import find_gobjects_base

# ----------------------------------------------------------------- the fake


class MapPM(ProcessMemory):
    """ProcessMemory over in-memory regions. Only the OS read is replaced;
    everything above it is the production code."""

    def __init__(self, regions: list[tuple[MapRegion, bytes]]):
        self.pid = 0
        self._fd = None
        self._readv_fn = None
        self._segs = [(r, bytes(d).ljust(r.size, b"\0")) for r, d in regions]
        self._maps = [r for r, _ in regions]

    def refresh_maps(self) -> None:
        pass

    def read(self, addr: int, size: int) -> bytes:
        for r, data in self._segs:
            if r.start <= addr < r.end:
                off = addr - r.start
                return data[off:off + size]     # short at region end, like pread
        raise OSError(f"unmapped {addr:#x}")


def _put(buf: bytearray, off: int, data: bytes) -> None:
    buf[off:off + len(data)] = data


def _uobject_array(objects_ptr: int, num_elements: int) -> bytes:
    """FUObjectArray header + FChunkedFixedUObjectArray, as discovery expects."""
    return (struct.pack("<iiii", 0, 0, 0, 0)
            + struct.pack("<QQiiii", objects_ptr, 0, 1 << 21, num_elements,
                          32, 4))


# "None" then "ByteProperty" — the canonical opening of FName Block 0.
_BLOCK0 = b"\x00\x01None\x00\x03ByteProperty"


def _allocator(block0: int) -> bytes:
    buf = bytearray(FNEA_BLOCKS_OFFSET + 8)
    _put(buf, FNEA_CURRENT_BLOCK_OFFSET, struct.pack("<I", 0))
    _put(buf, FNEA_BLOCKS_OFFSET, struct.pack("<Q", block0))
    return bytes(buf)


def _reg(start, size, perms, inode, path):
    return MapRegion(start, start + size, perms, 0, "00:00", inode, path)


# ----------------------------------------------------------- Windows layout

# Install root named after the binary: the trap a substring match falls into.
WIN_ROOT = r"C:\SquadGameServer\SquadGame\Binaries\Win64"
WIN_EXE = WIN_ROOT + r"\SquadGameServer.exe"
WIN_DLL = WIN_ROOT + r"\steam_api64.dll"
WIN_HEAP = 0x0000_0200_0000_0000
GOBJ_OFF = 0x2000            # within .data
FNP_OFF = 0x4000             # within .data
BLOCK0_OFF = 0x8000          # within the heap
GOBJ_NUM = 200_000


def windows_layout(img: int) -> MapPM:
    data = bytearray(0x10000)
    _put(data, GOBJ_OFF, _uobject_array(WIN_HEAP + 0x100, GOBJ_NUM))
    _put(data, FNP_OFF, _allocator(WIN_HEAP + BLOCK0_OFF))
    heap = bytearray(0x20000)
    _put(heap, BLOCK0_OFF, _BLOCK0)
    # A DLL whose data happens to hold a BIGGER look-alike: if the game module
    # ever swallowed the DLL, discovery would pick this one.
    dll = 0x7FFA_0000_0000
    dll_data = bytearray(0x1000)
    _put(dll_data, 0x100, _uobject_array(WIN_HEAP + 0x200, GOBJ_NUM + 1000))
    return MapPM([
        (_reg(img, 0x1000, "r--p", 1, WIN_EXE), b""),            # PE headers
        (_reg(img + 0x1000, 0x8000, "r-xp", 1, WIN_EXE), b""),   # .text
        (_reg(img + 0x9000, 0x2000, "r--p", 1, WIN_EXE), b""),   # .rdata
        (_reg(img + 0xB000, 0x10000, "rw-p", 1, WIN_EXE), data),  # .data + bss
        (_reg(dll, 0x1000, "r-xp", 1, WIN_DLL), b""),
        (_reg(dll + 0x1000, 0x1000, "rw-p", 1, WIN_DLL), dll_data),
        (_reg(WIN_HEAP, 0x20000, "rw-p", 0, ""), heap),
    ])


def _pin_platform(monkeypatch, platform: str) -> None:
    """Make the discovery modules (and only them) believe they run on
    ``platform``. cli also prints to sys.stderr, so that is passed through."""
    fake = SimpleNamespace(platform=platform, stderr=sys.stderr)
    for mod in (fname, uobject, module, cli):
        monkeypatch.setattr(mod, "sys", fake)


@pytest.fixture
def on_windows(monkeypatch):
    _pin_platform(monkeypatch, "win32")


@pytest.fixture
def on_linux(monkeypatch):
    _pin_platform(monkeypatch, "linux")


IMG = 0x7FF6_1000_0000


def test_windows_game_module_is_matched_by_file_name(on_windows):
    mod = load_module(windows_layout(IMG), "SquadGameServer")
    assert mod.path == WIN_EXE
    assert mod.base == IMG
    assert all(r.pathname == WIN_EXE for r in mod.regions)


def test_windows_gobjects_found_in_the_exe_data_section(on_windows):
    assert find_gobjects_base(windows_layout(IMG)) == IMG + 0xB000 + GOBJ_OFF


def test_windows_fname_pool_found_in_the_exe_data_section(on_windows):
    pm = windows_layout(IMG)
    base = find_fname_pool_base(pm)
    assert base == IMG + 0xB000 + FNP_OFF
    assert FNameEntryAllocator(pm, base).fname_to_str(0) == "None"


def test_heap_only_search_cannot_see_a_pe_static(on_linux):
    """Why the Windows branch exists: with the Linux region set, Block 0 is
    found in the heap but nothing anonymous points at it."""
    with pytest.raises(RuntimeError, match="no matching FNameEntryAllocator"):
        find_fname_pool_base(windows_layout(IMG))


# ------------------------------------------------------------- Linux layout

LNX_EXE = "/home/sq/serverfiles/SquadGame/Binaries/Linux/SquadGameServer"
LNX_RW = 0x0E9A5000
LNX_EXT = LNX_RW + 0x1000
LNX_HEAP = 0x7F00_0000_0000


def linux_layout() -> MapPM:
    ext = bytearray(0x10000)
    _put(ext, GOBJ_OFF, _uobject_array(LNX_HEAP + 0x100, GOBJ_NUM))
    _put(ext, FNP_OFF, _allocator(LNX_HEAP + BLOCK0_OFF))
    heap = bytearray(0x20000)
    _put(heap, BLOCK0_OFF, _BLOCK0)
    return MapPM([
        (_reg(0x200000, 0x1000, "r--p", 42, LNX_EXE), b""),
        (_reg(0x4B39000, 0x1000, "r-xp", 42, LNX_EXE), b""),
        (_reg(LNX_RW, 0x1000, "rw-p", 42, LNX_EXE), b""),       # .data + .bss
        (_reg(LNX_EXT, 0x10000, "rw-p", 0, ""), ext),            # extended BSS
        (_reg(LNX_HEAP, 0x20000, "rw-p", 0, ""), heap),
    ])


def test_linux_gobjects_found_in_extended_bss(on_linux):
    assert find_gobjects_base(linux_layout()) == LNX_EXT + GOBJ_OFF


def test_linux_fname_pool_found_in_extended_bss(on_linux):
    pm = linux_layout()
    base = find_fname_pool_base(pm)
    assert base == LNX_EXT + FNP_OFF
    assert FNameEntryAllocator(pm, base).fname_to_str(0) == "None"


def test_linux_module_lookup_is_still_a_substring_match(on_linux):
    assert load_module(linux_layout(), "SquadGameServer").path == LNX_EXE


def test_allocator_layout_follows_the_platform_lock():
    """pthread_rwlock_t is 56 bytes, SRWLOCK is 8; the fields follow it."""
    lock = 8 if sys.platform == "win32" else 56
    assert (fname.FNEA_CURRENT_BLOCK_OFFSET, fname.FNEA_CURRENT_CURSOR_OFFSET,
            fname.FNEA_BLOCKS_OFFSET) == (lock, lock + 4, lock + 8)


# ------------------------------------------------------- the address cache


@pytest.fixture
def cache(tmp_path, monkeypatch):
    path = tmp_path / "addresses.json"
    real_get, real_put = addrcache.get, addrcache.put
    monkeypatch.setattr(addrcache, "get",
                        lambda b, k, **kw: real_get(b, k, path=path))
    monkeypatch.setattr(addrcache, "put",
                        lambda b, k, a, **kw: real_put(b, k, a, path=path))
    monkeypatch.setattr(config_mod, "get",
                        lambda k: "SquadGameServer"
                        if k == "squad_process_name" else None)
    return path


def test_windows_cache_survives_aslr(on_windows, cache, monkeypatch):
    """Discovery on one launch, a different load address on the next: the
    cached entry must be an offset from the module, not an address."""
    first = cli._resolve_gobjects(windows_layout(IMG), "build-1")
    assert first.base == IMG + 0xB000 + GOBJ_OFF
    assert addrcache.get("build-1", "gobjects") == 0xB000 + GOBJ_OFF

    monkeypatch.setattr(uobject, "find_gobjects_base",
                        lambda pm: pytest.fail("rediscovered despite cache"))
    moved = 0x7FF7_2000_0000
    second = cli._resolve_gobjects(windows_layout(moved), "build-1")
    assert second.base == moved + 0xB000 + GOBJ_OFF


def test_windows_fname_cache_survives_aslr(on_windows, cache, monkeypatch):
    cli._resolve_fname_pool(windows_layout(IMG), "build-1")
    monkeypatch.setattr(fname, "find_fname_pool_base",
                        lambda pm: pytest.fail("rediscovered despite cache"))
    moved = 0x7FF7_2000_0000
    alloc = cli._resolve_fname_pool(windows_layout(moved), "build-1")
    assert alloc.base == moved + 0xB000 + FNP_OFF


def test_windows_never_trusts_the_linux_hardcoded_address(on_windows, cache,
                                                          monkeypatch):
    """0xeb29978 is a Linux VA. On Windows it may well be mapped (to anything);
    a lucky-looking read there must not short-circuit discovery."""
    pm = windows_layout(IMG)
    data = bytearray(0x1000)
    _put(data, 0x978, _uobject_array(WIN_HEAP, 5))
    pm._segs.append((_reg(0x0EB29000, 0x1000, "rw-p", 0, ""), bytes(data)))
    pm._maps.append(pm._segs[-1][0])
    arr = cli._resolve_gobjects(pm, "build-1")
    assert arr.base == IMG + 0xB000 + GOBJ_OFF


def test_linux_cache_keeps_absolute_addresses(on_linux, cache):
    pm = linux_layout()
    assert cli._addr_cache_base(pm) == 0
    arr = cli._resolve_gobjects(pm, "build-1")
    assert arr.base == LNX_EXT + GOBJ_OFF
    assert addrcache.get("build-1", "gobjects") == LNX_EXT + GOBJ_OFF
