"""
GUObjectArray + UObject reader for UE 5.7 (Squad v10.4.1).

Verified layouts (Linux x86_64, WITH_CASE_PRESERVING_NAME=0):

    FUObjectArray:
      +0x00  int32 ObjFirstGCIndex
      +0x04  int32 ObjLastNonGCIndex
      +0x08  int32 MaxObjectsNotConsideredByGC
      +0x0c  uint32 OpenForDisregardForGC (bool, padded)
      +0x10  FChunkedFixedUObjectArray ObjObjects:
        +0x10  void*  Objects             (heap pointer → chunk-pointer array)
        +0x18  void*  PreAllocatedObjects (null on modern UE5)
        +0x20  int32  MaxElements
        +0x24  int32  NumElements
        +0x28  int32  MaxChunks
        +0x2c  int32  NumChunks
      ... (TArrays, FCriticalSections that we don't need)

    FUObjectItem (24 bytes — UE 5.5+ reorganised layout):
      +0x00  uint64   AtomicFlags        (high bits = EInternalObjectFlags;
                                          0x4000000000000000 = RootSet,
                                          0x4200000000000000 = RootSet|Native)
      +0x08  UObject* Object             (raw pointer)
      +0x10  int32    SerialNumber        (empirically == FWeakObjectPtr's
                                          SerialNumber for live objects)
      +0x14  int32    ClusterRootIndex    (reads 0 for non-clustered objects)
      (Pre-5.5 layout had Object at +0; we verified the new order
       empirically — see docs/findings.md. SerialNumber sits at +0x10, not
       the +0x14 the pre-5.5 field order would suggest — confirmed by
       matching it against held-weapon weak pointers on the live server.)

    UObject (with 8-byte FName, since WCPN=0):
      +0x00  void*    Vtable
      +0x08  uint32   ObjectFlags
      +0x0c  int32    InternalIndex
      +0x10  UClass*  ClassPrivate
      +0x18  FName    NamePrivate         (u32 ComparisonIndex, u32 Number)
      +0x20  UObject* OuterPrivate

Chunks hold 65 536 FUObjectItem each (UE constant NumElementsPerChunk).
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterator

from ..mem import ProcessMemory

# Hardcoded GUObjectArray base for Squad v10.4.1 (verified empirically).
# Self-discovery via `find_gobjects.py` rediscovers this each time.
KNOWN_GOBJECTS_ADDR_V10_4_1 = 0xeb29978

NUM_ELEMENTS_PER_CHUNK = 65_536
UOBJECT_ITEM_SIZE = 24

# When a whole-chunk read fails we retry in sub-blocks of this many
# items, so a single bad page costs ~4k objects for one tick instead
# of the whole 65k chunk (which showed up as entire teams vanishing
# from the live map for a tick). See _read_item_block.
_SUB_BLOCK_ITEMS = 4096

# Within FUObjectItem (UE 5.5+ layout):
FUOI_ATOMIC_FLAGS = 0x00     # uint64 — InternalObjectFlags in high bits
FUOI_OBJECT = 0x08           # UObject* — the actual pointer
FUOI_SERIAL_NUMBER = 0x10    # int32 — matches FWeakObjectPtr.SerialNumber

# One C-level unpack per 24-byte FUObjectItem (Object @0x08, Serial @0x10)
# instead of two struct.unpack_from calls per slot across the whole walk.
_ITEM_RECORD = struct.Struct("<8xQi4x")
FUOI_CLUSTER_ROOT_INDEX = 0x14  # int32 — 0 for non-clustered objects

# FUObjectArray offsets
FUOA_FIRST_GC_INDEX = 0x00
FUOA_LAST_NON_GC_INDEX = 0x04
FUOA_MAX_DISREGARD = 0x08
FUOA_OPEN_FOR_DISREGARD = 0x0C
FUOA_OBJOBJECTS = 0x10

# FChunkedFixedUObjectArray offsets (relative to its own base)
FCFA_OBJECTS = 0x00
FCFA_PREALLOCATED = 0x08
FCFA_MAX_ELEMENTS = 0x10
FCFA_NUM_ELEMENTS = 0x14
FCFA_MAX_CHUNKS = 0x18
FCFA_NUM_CHUNKS = 0x1C

# UObject offsets
UOBJ_VTABLE = 0x00
UOBJ_FLAGS = 0x08
UOBJ_INTERNAL_INDEX = 0x0C
UOBJ_CLASS_PRIVATE = 0x10
UOBJ_NAME_PRIVATE = 0x18
UOBJ_OUTER_PRIVATE = 0x20
UOBJ_HEADER_SIZE = 0x28


@dataclass(slots=True)
class UObject:
    """Snapshot of a UObject's fixed header (no class-specific fields)."""
    addr: int
    vtable: int
    flags: int
    internal_index: int
    class_addr: int
    name_cmp_idx: int
    name_number: int
    outer_addr: int


@dataclass(frozen=True, slots=True)
class _Topology:
    """One-shot snapshot of FChunkedFixedUObjectArray bookkeeping.

    Each iter_object_addrs / iter_object_records call refreshes this
    via a single bulk read of the chunks pointer table (NumChunks * 8
    bytes), instead of doing a pm.read_u64 per chunk inside the loop.
    A failed refresh clears the cache so the iterator transparently
    falls back to the original per-property path.
    """
    num_elements: int
    num_chunks: int
    chunks_array_addr: int
    chunk_ptrs: tuple[int, ...]


def _read_item_block(pm: ProcessMemory, base_addr: int, count: int) -> bytes | None:
    """
    Read `count` FUObjectItem records starting at `base_addr`.

    Fast path: one big read. On failure (EIO from a guard page mid-
    chunk, racing unmap) OR a short read, fall back to _SUB_BLOCK_ITEMS-
    sized pieces issued as a single batched try_read_many; unreadable
    pieces are zero-filled so the caller's "obj_addr == 0 → empty slot"
    handling skips exactly the objects that were genuinely unreadable —
    instead of dropping the whole chunk (worst case 65k objects = a
    whole team's soldiers gone from one snapshot, which the map renders
    as players blinking out). Returns None only when nothing at all
    could be read.
    """
    want = count * UOBJECT_ITEM_SIZE
    try:
        data = pm.read(base_addr, want)
        if len(data) == want:
            return data
    except (OSError, OverflowError, ValueError):
        pass
    requests: list[tuple[int, int]] = []
    for off_items in range(0, count, _SUB_BLOCK_ITEMS):
        n = min(_SUB_BLOCK_ITEMS, count - off_items)
        sub_want = n * UOBJECT_ITEM_SIZE
        requests.append(
            (base_addr + off_items * UOBJECT_ITEM_SIZE, sub_want))
    results = pm.try_read_many(requests)
    parts: list[bytes] = []
    got_any = False
    for (_, sub_want), sub in zip(requests, results, strict=True):
        if sub is not None and len(sub) == sub_want:
            parts.append(sub)
            got_any = True
        else:
            parts.append(b"\x00" * sub_want)
    return b"".join(parts) if got_any else None


def parse_uobject(data: bytes, addr: int) -> UObject:
    """Decode the first 0x28 bytes of a UObject."""
    vtable, flags, internal_index, class_addr, cmp_idx, number, outer_addr = \
        struct.unpack_from("<QIiQIIQ", data, 0)
    return UObject(
        addr=addr,
        vtable=vtable,
        flags=flags,
        internal_index=internal_index,
        class_addr=class_addr,
        name_cmp_idx=cmp_idx,
        name_number=number,
        outer_addr=outer_addr,
    )


class GUObjectArray:
    """Read-only view of FUObjectArray in target memory."""

    def __init__(self, pm: ProcessMemory, base_addr: int):
        self.pm = pm
        self.base = base_addr
        self.cfa_base = base_addr + FUOA_OBJOBJECTS
        self._topology: _Topology | None = None

    # topology cache --------------------------------------------------------

    def refresh_topology(self) -> _Topology | None:
        """Bulk-read bookkeeping + chunk pointer array; cache the result.

        Iterators call this at entry so the per-chunk chunk_ptr lookup
        is served from the cached tuple instead of a pm.read_u64 per
        chunk. On any read failure or an implausible NumChunks the
        cache is cleared and callers fall back to per-property reads —
        behavior identical to the pre-cache code path.
        """
        try:
            num_elements = self.pm.read_i32(self.cfa_base + FCFA_NUM_ELEMENTS)
            num_chunks = self.pm.read_i32(self.cfa_base + FCFA_NUM_CHUNKS)
            chunks_arr = self.pm.read_u64(self.cfa_base + FCFA_OBJECTS)
        except (OSError, OverflowError, ValueError):
            self._topology = None
            return None
        if num_chunks <= 0 or num_chunks > 4096 or chunks_arr <= 0:
            self._topology = None
            return None
        raw = self.pm.try_read(chunks_arr, num_chunks * 8)
        if raw is None or len(raw) != num_chunks * 8:
            self._topology = None
            return None
        topo = _Topology(
            num_elements=num_elements,
            num_chunks=num_chunks,
            chunks_array_addr=chunks_arr,
            chunk_ptrs=struct.unpack(f"<{num_chunks}Q", raw),
        )
        self._topology = topo
        return topo

    def invalidate_topology(self) -> None:
        """Drop cached topology; the next iterator call refreshes it."""
        self._topology = None

    # FUObjectArray header --------------------------------------------------

    @property
    def first_gc_index(self) -> int:
        return self.pm.read_i32(self.base + FUOA_FIRST_GC_INDEX)

    @property
    def last_non_gc_index(self) -> int:
        return self.pm.read_i32(self.base + FUOA_LAST_NON_GC_INDEX)

    @property
    def max_disregard(self) -> int:
        return self.pm.read_i32(self.base + FUOA_MAX_DISREGARD)

    # FChunkedFixedUObjectArray ---------------------------------------------

    @property
    def num_elements(self) -> int:
        topo = self._topology
        if topo is not None:
            return topo.num_elements
        return self.pm.read_i32(self.cfa_base + FCFA_NUM_ELEMENTS)

    @property
    def max_elements(self) -> int:
        return self.pm.read_i32(self.cfa_base + FCFA_MAX_ELEMENTS)

    @property
    def num_chunks(self) -> int:
        topo = self._topology
        if topo is not None:
            return topo.num_chunks
        return self.pm.read_i32(self.cfa_base + FCFA_NUM_CHUNKS)

    @property
    def max_chunks(self) -> int:
        return self.pm.read_i32(self.cfa_base + FCFA_MAX_CHUNKS)

    @property
    def chunks_array_addr(self) -> int:
        topo = self._topology
        if topo is not None:
            return topo.chunks_array_addr
        return self.pm.read_u64(self.cfa_base + FCFA_OBJECTS)

    # access ---------------------------------------------------------------

    def chunk_addr(self, chunk_idx: int) -> int:
        return self.pm.read_u64(self.chunks_array_addr + chunk_idx * 8)

    def item_addr(self, index: int) -> int:
        ch = index // NUM_ELEMENTS_PER_CHUNK
        within = index % NUM_ELEMENTS_PER_CHUNK
        return self.chunk_addr(ch) + within * UOBJECT_ITEM_SIZE

    def get_object_addr(self, index: int) -> int:
        """Return the UObject* at the given InternalIndex (0 if slot is empty)."""
        return self.pm.read_u64(self.item_addr(index) + FUOI_OBJECT)

    def get_item_flags(self, index: int) -> int:
        """Return the EInternalObjectFlags packed into the high bits of AtomicFlags."""
        return self.pm.read_u64(self.item_addr(index) + FUOI_ATOMIC_FLAGS) >> 32

    def get_serial_number(self, index: int) -> int:
        """Return the FUObjectItem.SerialNumber at the given InternalIndex.
        A recycled slot bumps this, so it's how a TWeakObjectPtr tells a
        live object from a since-freed one that reused the same index."""
        return self.pm.read_i32(self.item_addr(index) + FUOI_SERIAL_NUMBER)

    def iter_object_addrs(
        self, *, start: int = 0, end: int | None = None,
    ) -> Iterator[tuple[int, int]]:
        """
        Yield (index, uobject_addr) for every active slot in [start, end).
        Reads each chunk's FUObjectItem array in one shot for speed
        (~24 bytes × 65536 = 1.5 MiB per chunk).

        Refreshes the topology cache at entry so per-chunk chunk_ptr
        lookups come from a single bulk read of the pointer table
        instead of NumChunks individual pm.read_u64 calls. On refresh
        failure the loop falls back to the original per-property path.

        Per-chunk defense: an EIO / OverflowError on a single chunk
        pointer used to abort the entire iteration and starve the
        snapshot build (whole-snapshot dropout). Chunk contents go
        through _read_item_block, which degrades to 4k-item sub-reads
        with zero-fill on failure — a bad page costs its own objects
        only, never the whole chunk.
        """
        self.refresh_topology()
        topo = self._topology
        n = topo.num_elements if topo is not None else self.num_elements
        if end is None:
            end = n
        end = min(end, n)
        chunks_arr = topo.chunks_array_addr if topo is not None else self.chunks_array_addr
        chunk_ptrs = topo.chunk_ptrs if topo is not None else None
        i = start
        while i < end:
            ch = i // NUM_ELEMENTS_PER_CHUNK
            within = i % NUM_ELEMENTS_PER_CHUNK
            in_chunk_count = min(NUM_ELEMENTS_PER_CHUNK - within, end - i)
            if chunk_ptrs is not None and ch < len(chunk_ptrs):
                chunk_ptr = chunk_ptrs[ch]
            else:
                try:
                    chunk_ptr = self.pm.read_u64(chunks_arr + ch * 8)
                except (OSError, OverflowError, ValueError):
                    i += in_chunk_count
                    continue
            if chunk_ptr <= 0 or chunk_ptr > 0x0000_7fff_ffff_ffff:
                i += in_chunk_count
                continue
            block = _read_item_block(
                self.pm, chunk_ptr + within * UOBJECT_ITEM_SIZE,
                in_chunk_count)
            if block is None:
                i += in_chunk_count
                continue
            for j in range(in_chunk_count):
                obj_addr = struct.unpack_from(
                    "<Q", block, j * UOBJECT_ITEM_SIZE + FUOI_OBJECT)[0]
                yield i + j, obj_addr
            i += in_chunk_count

    def iter_object_records(
        self, *, start: int = 0, end: int | None = None,
    ) -> Iterator[tuple[int, int, int]]:
        """
        Like iter_object_addrs but also yields the per-slot SerialNumber.
        Used by build_snapshot to key a (slot_idx, serial) → class_addr
        cache: as long as the serial hasn't bumped, the object's
        ClassPrivate hasn't changed either (slot has the same UObject
        as last tick), so the class_addr read can be skipped entirely.
        Saves ~400 ms per snapshot on a 187k-object server.

        Refreshes the topology cache at entry (see iter_object_addrs)
        so per-chunk chunk_ptr lookups are served from a bulk read.
        """
        self.refresh_topology()
        topo = self._topology
        n = topo.num_elements if topo is not None else self.num_elements
        if end is None:
            end = n
        end = min(end, n)
        chunks_arr = topo.chunks_array_addr if topo is not None else self.chunks_array_addr
        chunk_ptrs = topo.chunk_ptrs if topo is not None else None
        i = start
        while i < end:
            ch = i // NUM_ELEMENTS_PER_CHUNK
            within = i % NUM_ELEMENTS_PER_CHUNK
            in_chunk_count = min(NUM_ELEMENTS_PER_CHUNK - within, end - i)
            if chunk_ptrs is not None and ch < len(chunk_ptrs):
                chunk_ptr = chunk_ptrs[ch]
            else:
                try:
                    chunk_ptr = self.pm.read_u64(chunks_arr + ch * 8)
                except (OSError, OverflowError, ValueError):
                    # Defensive: see iter_object_addrs — same hardening.
                    i += in_chunk_count
                    continue
            if chunk_ptr <= 0 or chunk_ptr > 0x0000_7fff_ffff_ffff:
                i += in_chunk_count
                continue
            block = _read_item_block(
                self.pm, chunk_ptr + within * UOBJECT_ITEM_SIZE,
                in_chunk_count)
            if block is None:
                i += in_chunk_count
                continue
            for j, (obj_addr, serial) in enumerate(_ITEM_RECORD.iter_unpack(block)):
                yield i + j, obj_addr, serial
            i += in_chunk_count

    def get(self, index: int) -> UObject | None:
        addr = self.get_object_addr(index)
        if addr == 0:
            return None
        data = self.pm.try_read(addr, UOBJ_HEADER_SIZE)
        if data is None or len(data) < UOBJ_HEADER_SIZE:
            return None
        return parse_uobject(data, addr)

    def find_by_name(
        self,
        name: str,
        *,
        class_name: str | None = None,
        alloc=None,
        limit: int | None = None,
    ) -> list[tuple[int, int]]:
        """
        Walk every UObject; return [(internal_index, uobject_addr), ...] for
        every match whose NamePrivate resolves to `name` (exact, including
        any "_N" suffix). If `class_name` is given, also restrict to objects
        whose ClassPrivate resolves to that name.

        `alloc` must be an FNameEntryAllocator; required to resolve names.
        """
        if alloc is None:
            raise ValueError("find_by_name needs alloc (FNameEntryAllocator)")
        hits: list[tuple[int, int]] = []
        class_cache: dict[int, str | None] = {}

        def resolve(addr: int) -> str | None:
            if addr == 0:
                return None
            nm = self.pm.try_read(addr + UOBJ_NAME_PRIVATE, 8)
            if nm is None or len(nm) < 8:
                return None
            cmp_idx, number = struct.unpack("<II", nm)
            return alloc.fname_to_str(cmp_idx, number)

        for idx, obj_addr in self.iter_object_addrs():
            if obj_addr == 0:
                continue
            n = resolve(obj_addr)
            if n != name:
                continue
            if class_name is not None:
                # read class_addr from this object's header in same read
                cp = self.pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
                if cp is None:
                    continue
                class_addr = struct.unpack("<Q", cp)[0]
                cn = class_cache.get(class_addr)
                if cn is None:
                    cn = resolve(class_addr)
                    class_cache[class_addr] = cn
                if cn != class_name:
                    continue
            hits.append((idx, obj_addr))
            if limit is not None and len(hits) >= limit:
                break
        return hits

    def find_all_by_names(
        self,
        targets: dict[str, str | None],
        *,
        alloc,
    ) -> dict[str, tuple[int, int]]:
        """
        Single-pass variant of find_by_name for many names at once.

        `targets` maps object name → required class name (None = accept
        any class). Returns {name: (internal_index, uobject_addr)} for
        the FIRST match of each name — the same pick as
        find_by_name(..., limit=1). Names with no match are simply
        absent from the result; the caller decides whether that's fatal.

        Why this exists: resolve_paths needs ~20 classes. One
        find_by_name call walks all ~187k objects and resolves every
        object's FName, so 20 calls did ~3.7M reads at startup (and
        again after every self-heal restart). One shared walk plus a
        local FName-text cache cuts that by ~20x.
        """
        if alloc is None:
            raise ValueError("find_all_by_names needs alloc (FNameEntryAllocator)")
        remaining = dict(targets)
        hits: dict[str, tuple[int, int]] = {}
        # cmp_idx → text for Number==0 names (the overwhelming majority;
        # suffixed "Foo_N" names bypass the cache). Object names repeat
        # heavily across the array, so this alone cuts FName-pool reads
        # by ~6x during the walk.
        text_cache: dict[int, str | None] = {}
        class_name_cache: dict[int, str | None] = {}

        def obj_name(addr: int) -> str | None:
            nm = self.pm.try_read(addr + UOBJ_NAME_PRIVATE, 8)
            if nm is None or len(nm) < 8:
                return None
            cmp_idx, number = struct.unpack("<II", nm)
            if number == 0:
                if cmp_idx in text_cache:
                    return text_cache[cmp_idx]
                s = alloc.fname_to_str(cmp_idx, 0)
                text_cache[cmp_idx] = s
                return s
            return alloc.fname_to_str(cmp_idx, number)

        for idx, obj_addr in self.iter_object_addrs():
            if obj_addr == 0:
                continue
            name = obj_name(obj_addr)
            if name is None or name not in remaining:
                continue
            want_cls = remaining[name]
            if want_cls is not None:
                cp = self.pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
                if cp is None or len(cp) < 8:
                    continue
                class_addr = struct.unpack("<Q", cp)[0]
                if class_addr in class_name_cache:
                    cn = class_name_cache[class_addr]
                else:
                    cn = obj_name(class_addr) if class_addr else None
                    class_name_cache[class_addr] = cn
                if cn != want_cls:
                    continue
            hits[name] = (idx, obj_addr)
            del remaining[name]
            if not remaining:
                break
        return hits


# ----- discovery -------------------------------------------------------------

def find_gobjects_base(pm: ProcessMemory) -> int:
    """
    Scan combined .bss + extended-bss for the FChunkedFixedUObjectArray
    signature; return the FUObjectArray base (16 bytes before).

    Discovery heuristic must match a 32-byte struct with:
        +0    Objects: heap pointer
        +8    PreAllocatedObjects: 0 OR heap pointer
        +16   MaxElements in [2^18, 2^26]
        +20   1 <= NumElements <= MaxElements
        +24   1 <= MaxChunks <= 4096
        +28   1 <= NumChunks <= MaxChunks
        AND   MaxChunks * 65536 ≈ MaxElements (±1 chunk)
    """
    from .module import load_module

    mod = load_module(pm, "SquadGameServer")
    bss = mod.rw_region
    pm.refresh_maps()
    ext = pm.region_for(bss.end + 4)
    if ext is None or not (ext.is_anonymous and ext.writable):
        raise RuntimeError("extended-bss region not found")

    def is_heap(p: int) -> bool:
        if p < 0x10000 or p > (1 << 47):
            return False
        r = pm.region_for(p)
        return r is not None and r.is_anonymous and r.writable

    found: list[int] = []
    for region_start, region_size in [
        (bss.start, bss.size),
        (ext.start, ext.size),
    ]:
        raw = pm.read(region_start, region_size)
        n = len(raw) // 8
        # The body reads a 32-byte (4-slot) struct at off=i*8, so the last
        # window that still fits is i = n-4; range must reach it (n-3), not
        # stop at n-5.
        for i in range(n - 3):
            off = i * 8
            # One unpack call rather than six: cheaper and dodges a
            # mysterious 'int not subscriptable' TypeError that appeared
            # on Python 3.10.12 + this exact split (interpreter quirk
            # we never pinned down). Same semantics either way.
            objects, prealloc, max_elem, num_elem, max_ch, num_ch = \
                struct.unpack_from("<QQiiii", raw, off)
            if not is_heap(objects):
                continue
            if prealloc != 0 and not is_heap(prealloc):
                continue
            if not (2**18 <= max_elem <= 2**26):
                continue
            if not (1 <= num_elem <= max_elem):
                continue
            if not (1 <= max_ch <= 4096):
                continue
            if not (1 <= num_ch <= max_ch):
                continue
            if not (max_elem - NUM_ELEMENTS_PER_CHUNK <=
                    max_ch * NUM_ELEMENTS_PER_CHUNK <=
                    max_elem + NUM_ELEMENTS_PER_CHUNK):
                continue
            found.append(region_start + off - FUOA_OBJOBJECTS)

    if not found:
        raise RuntimeError("no GUObjectArray candidate found")
    if len(found) > 1:
        # Multiple candidates is unexpected — pick the one with the largest
        # NumElements as the main one and warn.
        scored = [(addr, pm.read_i32(addr + FUOA_OBJOBJECTS + FCFA_NUM_ELEMENTS))
                  for addr in found]
        scored.sort(key=lambda t: -t[1])
        return scored[0][0]
    return found[0]


__all__ = [
    "GUObjectArray",
    "UObject",
    "find_gobjects_base",
    "parse_uobject",
    "KNOWN_GOBJECTS_ADDR_V10_4_1",
    "NUM_ELEMENTS_PER_CHUNK",
    "UOBJECT_ITEM_SIZE",
    "UOBJ_NAME_PRIVATE",
    "UOBJ_CLASS_PRIVATE",
    "UOBJ_OUTER_PRIVATE",
]
