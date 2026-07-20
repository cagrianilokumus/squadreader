"""FNameEntryAllocator comparison_index memoization: a repeat name resolves from
cache with ZERO memory reads (the per-tick win), and a failed lookup is never
cached (so it retries)."""
import struct

from sqreader.ue.fname import FNameEntryAllocator


class FakePM:
    """Serves a one-block FName pool with a single 'None' entry at (block 0,
    offset 0), and counts try_read calls so we can prove the cache short-circuit."""
    BLOCK_BASE = 0x50000

    def __init__(self, block_addr=BLOCK_BASE):
        self.try_reads = 0
        self._block_addr = block_addr
        # "None": header = Len(4) << 6, ANSI (wide=0, hash=0) → 0x0100
        self._entry = struct.pack("<H", 4 << 6) + b"None"

    def read_u32(self, addr):        # current_block query → block 0 is active
        return 1

    def read_u64(self, addr):        # block_addr(0)
        return self._block_addr

    def try_read(self, addr, size):
        self.try_reads += 1
        if self._block_addr and addr == self._block_addr:
            return (self._entry + b"\x00" * size)[:size]
        return None


def test_repeat_name_is_a_cache_hit_zero_reads():
    pm = FakePM()
    alloc = FNameEntryAllocator(pm, base_addr=0x1000)

    assert alloc.fname_to_str(0) == "None"
    after_first = pm.try_reads
    assert after_first >= 1                       # the cold path read the pool

    # Same comparison_index again → served from the memo, no new pool read.
    assert alloc.fname_to_str(0) == "None"
    assert pm.try_reads == after_first

    # The Number suffix is applied on top of the cached entry (still no read).
    assert alloc.fname_to_str(0, number=3) == "None_2"
    assert pm.try_reads == after_first


def test_failed_lookup_is_not_cached():
    # block_addr returns 0 → resolve returns None; must NOT be cached (retries).
    pm = FakePM(block_addr=0)
    alloc = FNameEntryAllocator(pm, base_addr=0x1000)
    assert alloc.resolve_entry_id(0) is None
    assert alloc.resolve_entry_id(0) is None      # still None, no poisoned cache
    assert 0 not in alloc._entry_cache


def test_clear_entry_cache_forces_reread():
    pm = FakePM()
    alloc = FNameEntryAllocator(pm, base_addr=0x1000)
    alloc.fname_to_str(0)
    n = pm.try_reads
    alloc.fname_to_str(0)
    assert pm.try_reads == n                       # cached
    alloc.clear_entry_cache()
    alloc.fname_to_str(0)
    assert pm.try_reads > n                         # re-read after clear
