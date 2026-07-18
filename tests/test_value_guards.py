"""Pure-logic tests for the TArray reader hardening (deep-audit D3/D10):
a torn/garbage header must not surface a ~4-billion count, and a
boundary-straddling short read must not raise struct.error up an
unguarded caller. Driven with a tiny fake ProcessMemory."""
import struct

from sqreader.ue.value import read_tarray_header, iter_tarray_pointers


class FakePM:
    """Minimal stand-in: `mem` is a fn (addr, size) -> bytes | None."""
    def __init__(self, mem):
        self._mem = mem

    def try_read(self, addr, size):
        return self._mem(addr, size)


def test_header_rejects_huge_count():
    def mem(addr, size):
        return struct.pack("<QII", 0x1000, 0xF000_0000, 0xF000_0000)[:size]
    assert read_tarray_header(FakePM(mem), 0) is None


def test_header_rejects_count_gt_capacity():
    def mem(addr, size):
        return struct.pack("<QII", 0x1000, 100, 10)  # count > capacity = garbage
    assert read_tarray_header(FakePM(mem), 0) is None


def test_header_accepts_valid():
    def mem(addr, size):
        return struct.pack("<QII", 0x1000, 5, 8)
    h = read_tarray_header(FakePM(mem), 0)
    assert h is not None and h.count == 5 and h.capacity == 8


def test_iter_pointers_clamps_short_buffer():
    # Header claims 10 elements, but the bulk read straddles a mapping and
    # returns only 3 pointers' worth. Must yield 3, not raise struct.error.
    def mem(addr, size):
        if addr == 0:                       # header read
            return struct.pack("<QII", 0x2000, 10, 16)
        return struct.pack("<QQQ", 0xAA, 0xBB, 0xCC)  # short data (3 of 10)
    ptrs = list(iter_tarray_pointers(FakePM(mem), 0))
    assert ptrs == [0xAA, 0xBB, 0xCC]


def test_iter_pointers_full_buffer():
    def mem(addr, size):
        if addr == 0:
            return struct.pack("<QII", 0x2000, 3, 4)
        return struct.pack("<QQQ", 1, 2, 3)
    assert list(iter_tarray_pointers(FakePM(mem), 0)) == [1, 2, 3]
