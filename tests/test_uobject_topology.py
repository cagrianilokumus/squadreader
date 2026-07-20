"""Tests for GUObjectArray.refresh_topology and the topology-cached iterator
path: verify a single bulk read of the chunk pointer table replaces
per-chunk pm.read_u64 calls, and that any failure falls back to the
original per-property path with identical behavior."""
from __future__ import annotations

import struct

from sqreader.ue.uobject import (
    FCFA_NUM_CHUNKS,
    FCFA_NUM_ELEMENTS,
    FCFA_OBJECTS,
    FUOA_OBJOBJECTS,
    FUOI_OBJECT,
    GUObjectArray,
    UOBJECT_ITEM_SIZE,
)


class RecordingPM:
    """Minimal ProcessMemory stand-in: dict-backed segments + call counters.

    Segments are (addr, bytes); read_i32 / read_u64 / read / try_read all
    walk the segments and count invocations so tests can assert that the
    topology cache actually replaces per-chunk pointer reads.
    """
    def __init__(self, segments: dict[int, bytes] | None = None) -> None:
        self._segments: list[tuple[int, bytes]] = []
        if segments:
            for addr, data in segments.items():
                self._segments.append((addr, data))
        self.calls: dict[str, int] = {
            "read": 0, "try_read": 0,
            "read_i32": 0, "read_u32": 0, "read_u64": 0,
        }

    def add(self, addr: int, data: bytes) -> None:
        self._segments.append((addr, data))

    def _lookup(self, addr: int, size: int) -> bytes | None:
        for base, data in self._segments:
            if base <= addr and addr + size <= base + len(data):
                off = addr - base
                return data[off:off + size]
        return None

    def read(self, addr: int, size: int) -> bytes:
        self.calls["read"] += 1
        buf = self._lookup(addr, size)
        if buf is None:
            raise OSError(f"unmapped read at 0x{addr:x}+{size}")
        return buf

    def try_read(self, addr: int, size: int) -> bytes | None:
        self.calls["try_read"] += 1
        return self._lookup(addr, size)

    def read_i32(self, addr: int) -> int:
        self.calls["read_i32"] += 1
        buf = self._lookup(addr, 4)
        if buf is None:
            raise OSError(f"unmapped read_i32 at 0x{addr:x}")
        return struct.unpack("<i", buf)[0]

    def read_u32(self, addr: int) -> int:
        self.calls["read_u32"] += 1
        buf = self._lookup(addr, 4)
        if buf is None:
            raise OSError(f"unmapped read_u32 at 0x{addr:x}")
        return struct.unpack("<I", buf)[0]

    def read_u64(self, addr: int) -> int:
        self.calls["read_u64"] += 1
        buf = self._lookup(addr, 8)
        if buf is None:
            raise OSError(f"unmapped read_u64 at 0x{addr:x}")
        return struct.unpack("<Q", buf)[0]


# Fixed test layout — small so tests stay fast and readable.
_GOBJECTS_BASE = 0x1_000_000
_CFA_BASE = _GOBJECTS_BASE + FUOA_OBJOBJECTS
_CHUNK_PTRS_ADDR = 0x2_000_000
_CHUNK0_ADDR = 0x3_000_000
_CHUNK1_ADDR = 0x3_100_000
_NUM_CHUNKS = 2
_NUM_ELEMENTS = 5  # 5 items across 2 chunks — first chunk holds them all


def _build_pm_with_topology() -> RecordingPM:
    pm = RecordingPM()
    # NumElements @ +0x14, NumChunks @ +0x1C, Objects (chunk ptr array) @ +0x00
    # All relative to cfa_base.
    pm.add(_CFA_BASE + FCFA_OBJECTS, struct.pack("<Q", _CHUNK_PTRS_ADDR))
    pm.add(_CFA_BASE + FCFA_NUM_ELEMENTS, struct.pack("<i", _NUM_ELEMENTS))
    pm.add(_CFA_BASE + FCFA_NUM_CHUNKS, struct.pack("<i", _NUM_CHUNKS))
    # Chunk pointer table
    pm.add(_CHUNK_PTRS_ADDR, struct.pack("<QQ", _CHUNK0_ADDR, _CHUNK1_ADDR))
    # Chunk 0: NUM_ELEMENTS FUObjectItem records at (item.Object = addr+idx)
    items = bytearray()
    for i in range(_NUM_ELEMENTS):
        rec = bytearray(UOBJECT_ITEM_SIZE)
        struct.pack_into("<Q", rec, FUOI_OBJECT, 0xdead_0000 + i)
        items.extend(rec)
    pm.add(_CHUNK0_ADDR, bytes(items))
    return pm


def test_refresh_topology_populates_cache_from_single_bulk_read():
    pm = _build_pm_with_topology()
    gobj = GUObjectArray(pm, _GOBJECTS_BASE)
    topo = gobj.refresh_topology()
    assert topo is not None
    assert topo.num_elements == _NUM_ELEMENTS
    assert topo.num_chunks == _NUM_CHUNKS
    assert topo.chunks_array_addr == _CHUNK_PTRS_ADDR
    assert topo.chunk_ptrs == (_CHUNK0_ADDR, _CHUNK1_ADDR)
    # After refresh: 2 read_i32 (num_elements, num_chunks), 1 read_u64
    # (chunks_arr), 1 try_read (bulk chunk pointer table). NOT
    # num_chunks separate read_u64s.
    assert pm.calls["read_i32"] == 2
    assert pm.calls["read_u64"] == 1
    assert pm.calls["try_read"] == 1


def test_refresh_topology_returns_none_when_bulk_read_fails():
    pm = RecordingPM()
    pm.add(_CFA_BASE + FCFA_OBJECTS, struct.pack("<Q", _CHUNK_PTRS_ADDR))
    pm.add(_CFA_BASE + FCFA_NUM_ELEMENTS, struct.pack("<i", _NUM_ELEMENTS))
    pm.add(_CFA_BASE + FCFA_NUM_CHUNKS, struct.pack("<i", _NUM_CHUNKS))
    # Deliberately DON'T register the chunk pointer table — bulk read fails.
    gobj = GUObjectArray(pm, _GOBJECTS_BASE)
    assert gobj.refresh_topology() is None
    assert gobj._topology is None


def test_refresh_topology_rejects_implausible_num_chunks():
    pm = RecordingPM()
    pm.add(_CFA_BASE + FCFA_OBJECTS, struct.pack("<Q", _CHUNK_PTRS_ADDR))
    pm.add(_CFA_BASE + FCFA_NUM_ELEMENTS, struct.pack("<i", 10))
    # Garbage NumChunks — must be rejected before we allocate a huge read.
    pm.add(_CFA_BASE + FCFA_NUM_CHUNKS, struct.pack("<i", 999_999))
    gobj = GUObjectArray(pm, _GOBJECTS_BASE)
    assert gobj.refresh_topology() is None


def test_iter_uses_cached_chunk_ptrs_and_skips_extra_read_u64():
    pm = _build_pm_with_topology()
    gobj = GUObjectArray(pm, _GOBJECTS_BASE)
    results = list(gobj.iter_object_addrs())
    assert len(results) == _NUM_ELEMENTS
    for idx, (i, obj_addr) in enumerate(results):
        assert i == idx
        assert obj_addr == 0xdead_0000 + idx
    # Iterator's refresh_topology() does exactly 1 read_u64 (chunks_arr).
    # The per-chunk chunk_ptr lookup is served from topology.chunk_ptrs
    # — a plain iter with NO topology cache would do NUM_CHUNKS extra
    # read_u64 calls on top.
    assert pm.calls["read_u64"] == 1


def test_iter_falls_back_to_per_property_reads_when_topology_unavailable():
    # No chunk pointer table registered — bulk read fails, but per-chunk
    # pm.read_u64 fallback still works.
    pm = RecordingPM()
    pm.add(_CFA_BASE + FCFA_OBJECTS, struct.pack("<Q", _CHUNK_PTRS_ADDR))
    pm.add(_CFA_BASE + FCFA_NUM_ELEMENTS, struct.pack("<i", _NUM_ELEMENTS))
    pm.add(_CFA_BASE + FCFA_NUM_CHUNKS, struct.pack("<i", _NUM_CHUNKS))
    # Register the pointer table addresses ONE-BY-ONE (individual
    # pm.read_u64 succeed) but not as a single contiguous try_read
    # segment large enough for the bulk read to succeed.
    pm.add(_CHUNK_PTRS_ADDR, struct.pack("<Q", _CHUNK0_ADDR))
    pm.add(_CHUNK_PTRS_ADDR + 8, struct.pack("<Q", _CHUNK1_ADDR))
    items = bytearray()
    for i in range(_NUM_ELEMENTS):
        rec = bytearray(UOBJECT_ITEM_SIZE)
        struct.pack_into("<Q", rec, FUOI_OBJECT, 0xbeef_0000 + i)
        items.extend(rec)
    pm.add(_CHUNK0_ADDR, bytes(items))

    gobj = GUObjectArray(pm, _GOBJECTS_BASE)
    results = list(gobj.iter_object_addrs())
    assert len(results) == _NUM_ELEMENTS
    for idx, (i, obj_addr) in enumerate(results):
        assert i == idx
        assert obj_addr == 0xbeef_0000 + idx
    # Bulk read failed → cache empty; per-chunk fallback ran, so we saw
    # more than one read_u64 call (the chunks_arr root + at least one
    # per-chunk pointer).
    assert pm.calls["read_u64"] >= 2


def test_invalidate_topology_forces_next_iter_to_re_refresh():
    pm = _build_pm_with_topology()
    gobj = GUObjectArray(pm, _GOBJECTS_BASE)
    gobj.refresh_topology()
    assert gobj._topology is not None
    gobj.invalidate_topology()
    assert gobj._topology is None
    # Iter must repopulate the cache (does its own refresh_topology()).
    list(gobj.iter_object_addrs())
    assert gobj._topology is not None
