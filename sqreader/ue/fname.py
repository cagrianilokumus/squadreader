"""
FNamePool / FNameEntryAllocator reader for UE 5.7 (Squad v10.4.1).

WHAT WE BUILT
-------------
Empirically reverse-engineered the FNameEntryAllocator layout on the live
SquadGameServer process. The layout matches the public UE 5.x source's
NameTypes.h, with these confirmed offsets on Linux x86_64:

    FNameEntryAllocator (size ~65 KiB):
        +0x00   FRWLock Lock                  (pthread_rwlock_t, 56 bytes)
        +0x38   uint32  CurrentBlock          (number of fully-used blocks)
        +0x3C   uint32  CurrentByteCursor     (byte offset into Blocks[Current])
        +0x40   uint8*  Blocks[FNAME_POOL_MAX_BLOCKS]
                        (inline array of block base addresses; null after
                         CurrentBlock entries)

    Each block is a packed sequence of FNameEntry records:
        struct FNameEntry {
            uint16 Header;       // (Len << 6) | (Hash << 1) | bIsWide
            char   Name[Len];    // 1 byte/char for ANSI, 2 for WIDE
        };
        // 2-byte aligned; zero-byte padding between entries when needed.

THE KEY DISCOVERY
-----------------
The binary is non-PIE EXEC, and the FNameEntryAllocator lives in an
**extended BSS** region at a deterministic address (verified `0xea74980`
in Squad v10.4.1). The runtime address is hardcoded as a 32-bit immediate
in 30+ places in .text, so it's stable across restarts.

We provide TWO discovery paths so the reader survives Squad updates:

1. `KNOWN_ALLOCATOR_ADDR_V10_4_1` — hardcoded; instant, version-locked.
2. `find_fname_pool_base(pm)` — scans anon RW heap for the canonical
   reserved-name sequence ("None" → "ByteProperty" → "IntProperty"); then
   searches for the corresponding `Blocks[0]` pointer and subtracts the
   structural offset to recover the allocator base. Slower (~2 s) but
   self-healing.

THE TWO POOLS
-------------
We found two `Block 0` allocations with identical reserved-name contents,
one at `0x7f86d12a0000` (the main "comparison" pool — 97 blocks active)
and one at `0x7f86d19a0000` (a smaller pool — 1 block, possibly the
display-pool or the savegame name table). For FName→string resolution we
use the larger one; if a name isn't found, we should fall back to the
other pool.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Iterator

from ..mem import ProcessMemory


# ----- structural constants --------------------------------------------------

FNEA_LOCK_SIZE = 56                  # pthread_rwlock_t on Linux x86_64
FNEA_CURRENT_BLOCK_OFFSET = 0x38     # uint32 — index of newest active block
FNEA_CURRENT_CURSOR_OFFSET = 0x3C    # uint32 — write cursor into Blocks[CurrentBlock]
FNEA_BLOCKS_OFFSET = 0x40            # uint8*[FNamePoolMaxBlocks] inline array
FNAME_POOL_MAX_BLOCKS = 8192         # UE 5.x default

# Squad v10.4.1 (UE 5.7.4 build 604352, BuildID 96be21a2…) — verified stable
# across the live server process. Compiler hardcoded this in 33+ places in
# .text. Will need re-verification after any Squad binary update.
KNOWN_ALLOCATOR_ADDR_V10_4_1 = 0xea74980


# ----- FNameEntry parsing ----------------------------------------------------

@dataclass(frozen=True, slots=True)
class FNameEntry:
    header: int
    wide: bool
    length: int
    hash: int          # 5-bit LowercaseProbeHash
    text: str

    @property
    def entry_byte_size(self) -> int:
        """Total bytes consumed by this entry, including 2-byte alignment."""
        char_bytes = (2 if self.wide else 1) * self.length
        total = 2 + char_bytes
        # Each entry is 2-byte aligned.
        return total + (total & 1)


def parse_fname_entry_header(header: int) -> tuple[bool, int, int]:
    """Decode an FNameEntry header into (wide, length, hash)."""
    wide = bool(header & 1)
    hash_bits = (header >> 1) & 0x1F
    length = header >> 6
    return wide, length, hash_bits


def parse_fname_entry(data: bytes, offset: int = 0) -> FNameEntry | None:
    """
    Parse one FNameEntry beginning at `data[offset]`. Returns None if the
    header is zero (end of valid entries in this block) or malformed.
    """
    if offset + 2 > len(data):
        return None
    header = struct.unpack_from("<H", data, offset)[0]
    if header == 0:
        return None
    wide, length, hash_bits = parse_fname_entry_header(header)
    if length == 0:
        return None
    name_start = offset + 2
    if wide:
        name_end = name_start + length * 2
        if name_end > len(data):
            return None
        text = data[name_start:name_end].decode("utf-16-le", errors="replace")
    else:
        name_end = name_start + length
        if name_end > len(data):
            return None
        text = data[name_start:name_end].decode("utf-8", errors="replace")
    return FNameEntry(header=header, wide=wide, length=length,
                      hash=hash_bits, text=text)


# ----- live-process reader ---------------------------------------------------

class FNameEntryAllocator:
    """Read-only view of an FNameEntryAllocator instance in target memory."""

    def __init__(self, pm: ProcessMemory, base_addr: int):
        self.pm = pm
        self.base = base_addr
        # comparison_index -> FNameEntry memo. The FName pool is append-only for
        # the process lifetime: an entry, once written at (block, offset), never
        # moves or changes, and comparison_index fully determines that location.
        # So a resolved entry is cacheable forever — this turns every repeat name
        # (class names, weapon classes, damage types resolved every tick) from an
        # 8-byte block-ptr read + a 1024-byte pool read + parse into a dict hit.
        # Only SUCCESSFUL resolutions are cached; a None (transient bad read or an
        # index not yet populated) is left uncached so it retries next tick.
        self._entry_cache: dict[int, FNameEntry] = {}

    def clear_entry_cache(self) -> None:
        """Drop the comparison_index memo (e.g. on a full cache reset). Rarely
        needed — the pool is immutable for the process, so this is only for
        symmetry with the snapshot caches."""
        self._entry_cache.clear()

    # struct fields ----------------------------------------------------------

    def _safe_u32(self, off: int) -> int:
        """Read u32 at base+off, returning 0 on any /proc read failure.
        Used in the FNamePool hot path so a single EIO landing on the
        pool header byte doesn't crash the whole snapshot build (fname
        resolution is called for ~200 unique classes per tick + every
        player name + weapon class + …)."""
        try:
            return self.pm.read_u32(self.base + off)
        except (OSError, OverflowError, ValueError):
            return 0

    def _safe_u64(self, off: int) -> int:
        try:
            return self.pm.read_u64(self.base + off)
        except (OSError, OverflowError, ValueError):
            return 0

    @property
    def current_block(self) -> int:
        return self._safe_u32(FNEA_CURRENT_BLOCK_OFFSET)

    @property
    def current_cursor(self) -> int:
        return self._safe_u32(FNEA_CURRENT_CURSOR_OFFSET)

    def block_addr(self, index: int) -> int:
        """Return the heap base of Blocks[index] (0 if unused). Returns
        0 on any read failure — callers already treat 0 as 'block
        unavailable'."""
        return self._safe_u64(FNEA_BLOCKS_OFFSET + index * 8)

    def block_addrs(self, n: int | None = None) -> list[int]:
        """Return the first n block addresses (or up to current_block+1)."""
        if n is None:
            n = self.current_block + 1
        raw = self.pm.read(self.base + FNEA_BLOCKS_OFFSET, n * 8)
        return list(struct.unpack_from(f"<{n}Q", raw))

    # entry iteration --------------------------------------------------------

    def iter_block_entries(
        self, block_idx: int, *, max_bytes: int = 2 << 20,
    ) -> Iterator[tuple[int, FNameEntry]]:
        """
        Yield (offset_in_block, entry) tuples for all entries in Blocks[idx].

        `max_bytes` caps how much of the block we read up front. UE's
        FNamePoolBlockSize defaults to 64 KiB but can be 2 MiB in some
        builds; we use 2 MiB as a safe upper bound.
        """
        block = self.block_addr(block_idx)
        if block == 0:
            return
        data = self.pm.read(block, max_bytes)
        off = 0
        while off + 2 <= len(data):
            entry = parse_fname_entry(data, off)
            if entry is None:
                break
            yield off, entry
            off += entry.entry_byte_size

    def iter_all_entries(
        self, max_blocks: int | None = None,
    ) -> Iterator[tuple[int, int, FNameEntry]]:
        """Yield (block_idx, offset_in_block, entry) for every populated entry."""
        cur = self.current_block
        if max_blocks is not None:
            cur = min(cur, max_blocks - 1)
        for b in range(cur + 1):
            for off, entry in self.iter_block_entries(b):
                yield b, off, entry

    # FName index resolution ---------------------------------------------------
    #
    # An FNameEntryId is a packed uint32 that splits into:
    #   block_idx     = high 16 bits
    #   offset_units  = low  16 bits  (multiplied by Stride=2 for byte offset)
    #
    # This is the UE 5.x default packing (FNamePool::Pages bit-width = 16,
    # FNamePoolBlockSizeBytes ≤ 64 KiB so offset/2 fits in 16 bits).
    # The packing is verified empirically by resolving "None" → (0,0) ✓ and
    # other reserved ENames.

    def resolve_entry_id(self, comparison_index: int) -> FNameEntry | None:
        """Look up an FNameEntry by its packed FNameEntryId (uint32)."""
        cached = self._entry_cache.get(comparison_index)
        if cached is not None:
            return cached                        # zero syscalls on a repeat name
        block = (comparison_index >> 16) & 0xFFFF
        offset = (comparison_index & 0xFFFF) * 2
        if block > self.current_block:
            return None
        block_addr = self.block_addr(block)
        if block_addr == 0:
            return None
        data = self.pm.try_read(block_addr + offset, 1024)
        if data is None or len(data) < 2:
            return None
        entry = parse_fname_entry(data, 0)
        if entry is not None:
            self._entry_cache[comparison_index] = entry
        return entry

    def fname_to_str(self, comparison_index: int, number: int = 0) -> str | None:
        """Render an FName (ComparisonIndex + Number) to its display string."""
        entry = self.resolve_entry_id(comparison_index)
        if entry is None:
            return None
        if number > 0:
            # UE convention: Number is 1-based; "Foo_0" stores Number=1.
            return f"{entry.text}_{number - 1}"
        return entry.text


# ----- discovery -------------------------------------------------------------

# 5-byte tail of the canonical Block 0 prefix:
#   [hdr_lo, 0x01, 'N','o','n','e']  (header high byte 0x01 = Len=4)
#
# We require the next entry to be "ByteProperty" (12 chars, ANSI):
#   [hdr_lo2, 0x03, 'B','y','t','e','P','r','o','p','e','r','t','y']
#   where 0x03 is the high byte of header (Len=12 → 12<<6 = 0x300)
_NONE_THEN_BYTEPROPERTY = b"\x01None"  # the 5 fixed bytes after the low header
_BYTEPROPERTY = b"\x03ByteProperty"     # 13 fixed bytes (high header + name)


def _block0_addrs(pm: ProcessMemory) -> list[int]:
    """Find anon-RW heap addresses where the canonical Block 0 prefix sits."""
    regions = pm.writable_anon_regions()
    out: list[int] = []
    for region in regions:
        for chunk_addr, chunk in pm.iter_region_bytes(region, chunk=1 << 20):
            pos = 0
            while True:
                i = chunk.find(_NONE_THEN_BYTEPROPERTY, pos)
                if i < 0:
                    break
                pos = i + 1
                if i < 1:
                    continue
                low = chunk[i - 1]
                # entry-header constraint for "None" (Len=4 ANSI):
                #   low byte = (hash<<1) | wide=0  →  bit 0 = 0, bits 6-7 = 0
                if (low & 0xC1) != 0:
                    continue
                # require the *next* entry to be ByteProperty
                # "None" entry occupies bytes [i-1 .. i-1+6] = 6 bytes; next entry begins at i+5
                next_off = i + 5
                if next_off + len(_BYTEPROPERTY) > len(chunk):
                    continue
                if chunk[next_off + 1:next_off + 1 + len(_BYTEPROPERTY)] != _BYTEPROPERTY:
                    continue
                out.append(chunk_addr + i - 1)
    return out


def find_fname_pool_base(pm: ProcessMemory) -> int:
    """
    Locate an FNameEntryAllocator by:
      1. Scanning anon RW for `[hdr][None][hdr][ByteProperty]` block prefix.
      2. Searching heap for the 8-byte pointer to that block address.
      3. The pointer's storage location minus FNEA_BLOCKS_OFFSET is the
         allocator base. We pick the candidate whose
         CurrentBlock value is largest (most active = main pool).

    Returns the runtime address of the FNameEntryAllocator.
    """
    block0_candidates = _block0_addrs(pm)
    if not block0_candidates:
        raise RuntimeError("no Block 0 candidates found (FNamePool absent or layout differs)")

    needle_to_alloc_base: dict[int, int] = {}
    for b0 in block0_candidates:
        needle = struct.pack("<Q", b0)
        # search every anon RW region for this pointer
        for region in pm.writable_anon_regions():
            for chunk_addr, chunk in pm.iter_region_bytes(region, chunk=1 << 20):
                pos = 0
                while True:
                    i = chunk.find(needle, pos)
                    if i < 0:
                        break
                    pos = i + 1
                    ptr_addr = chunk_addr + i
                    candidate_base = ptr_addr - FNEA_BLOCKS_OFFSET
                    # The candidate base must be readable and the
                    # CurrentBlock field must be plausible (< 8192).
                    cb_bytes = pm.try_read(candidate_base + FNEA_CURRENT_BLOCK_OFFSET, 4)
                    if cb_bytes is None or len(cb_bytes) < 4:
                        continue
                    cb = struct.unpack_from("<I", cb_bytes)[0]
                    if 0 <= cb < FNAME_POOL_MAX_BLOCKS:
                        # also check that Blocks[0] indeed equals b0
                        b0_check = pm.try_read(candidate_base + FNEA_BLOCKS_OFFSET, 8)
                        if b0_check and struct.unpack_from("<Q", b0_check)[0] == b0:
                            needle_to_alloc_base[candidate_base] = cb

    if not needle_to_alloc_base:
        raise RuntimeError("found Block 0 but no matching FNameEntryAllocator")

    # Pick the candidate with the largest CurrentBlock (= the main pool).
    best = max(needle_to_alloc_base.items(), key=lambda kv: kv[1])
    return best[0]


# ----- canonical reserved-EName order for verification -----------------------

CANONICAL_RESERVED_NAMES = [
    "None",
    "ByteProperty",
    "IntProperty",
    "BoolProperty",
    "FloatProperty",
    "ObjectProperty",
    "NameProperty",
    "DelegateProperty",
    "DoubleProperty",
    "ArrayProperty",
    "StructProperty",
    "VectorProperty",
    "RotatorProperty",
    "StrProperty",
    "TextProperty",
    "InterfaceProperty",
]


__all__ = [
    "FNameEntry",
    "FNameEntryAllocator",
    "parse_fname_entry",
    "parse_fname_entry_header",
    "find_fname_pool_base",
    "CANONICAL_RESERVED_NAMES",
    "KNOWN_ALLOCATOR_ADDR_V10_4_1",
    "FNEA_BLOCKS_OFFSET",
    "FNEA_CURRENT_BLOCK_OFFSET",
    "FNEA_CURRENT_CURSOR_OFFSET",
    "FNAME_POOL_MAX_BLOCKS",
]
