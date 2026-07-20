"""Behavioral tests for ProcessMemory's batched-read API surface
(read_many / try_read_many). Uses the shared FakeProcessMemory helper
so these run cross-platform — no /proc/pid/mem access required."""
from __future__ import annotations

import pytest

from conftest import FakeProcessMemory


def test_read_many_empty_returns_empty_list():
    pm = FakeProcessMemory()
    assert pm.read_many([]) == []
    assert pm.try_read_many([]) == []


def test_read_many_single_matches_read():
    pm = FakeProcessMemory({0x1000: b"hello"})
    assert pm.read_many([(0x1000, 5)]) == [b"hello"]
    assert pm.read_many([(0x1000, 5)]) == [pm.read(0x1000, 5)]


def test_read_many_mixed_sizes_preserves_order():
    pm = FakeProcessMemory({
        0x1000: b"abc",
        0x2000: b"xyzw",
        0x3000: b"1234567",
    })
    result = pm.read_many([
        (0x2000, 4),
        (0x1000, 3),
        (0x3000, 7),
    ])
    assert result == [b"xyzw", b"abc", b"1234567"]


def test_read_many_raises_on_first_bad_region():
    pm = FakeProcessMemory({0x1000: b"hello"})
    with pytest.raises(OSError):
        pm.read_many([(0x1000, 5), (0xdead, 4)])


def test_try_read_many_none_for_bad_region():
    pm = FakeProcessMemory({0x1000: b"hello", 0x3000: b"world"})
    result = pm.try_read_many([
        (0x1000, 5),
        (0xdead, 4),
        (0x3000, 5),
    ])
    assert result == [b"hello", None, b"world"]


def test_try_read_many_all_none_when_all_bad():
    pm = FakeProcessMemory()
    result = pm.try_read_many([(0xdead, 4), (0xbeef, 8), (0xcafe, 16)])
    assert result == [None, None, None]
