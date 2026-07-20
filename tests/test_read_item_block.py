"""Regression tests for _read_item_block's fallback path after the
migration to try_read_many. Verifies both that the sub-block re-reads
are now issued as a single batched call (not one try_read per sub-
block) and that the zero-fill / all-fail semantics are preserved
byte-for-byte with the pre-migration code."""
from __future__ import annotations

from sqreader.ue.uobject import (
    UOBJECT_ITEM_SIZE,
    _SUB_BLOCK_ITEMS,
    _read_item_block,
)

from conftest import FakeProcessMemory


class _SpyPM(FakeProcessMemory):
    """FakeProcessMemory that records try_read_many invocations so
    tests can prove the loop is now batched, not per-sub-block."""

    def __init__(self, segments: dict[int, bytes] | None = None) -> None:
        super().__init__(segments)
        self.try_read_many_calls: list[list[tuple[int, int]]] = []

    def try_read_many(self, requests):
        self.try_read_many_calls.append(list(requests))
        return super().try_read_many(requests)


_BASE = 0x1_000_000
# Two sub-blocks: one full, one partial. Small enough that tests stay
# fast, big enough to exercise the multi-sub-block iteration.
_COUNT = _SUB_BLOCK_ITEMS * 2 - 100
_SUB0_SIZE = _SUB_BLOCK_ITEMS * UOBJECT_ITEM_SIZE
_SUB1_ITEMS = _COUNT - _SUB_BLOCK_ITEMS
_SUB1_SIZE = _SUB1_ITEMS * UOBJECT_ITEM_SIZE


def test_fast_path_bulk_read_never_touches_try_read_many():
    """When the whole-chunk bulk read succeeds, the fallback batch
    path is skipped entirely."""
    payload = b"\xff" * (_COUNT * UOBJECT_ITEM_SIZE)
    pm = _SpyPM({_BASE: payload})
    assert _read_item_block(pm, _BASE, _COUNT) == payload
    assert pm.try_read_many_calls == []


def test_fallback_issues_a_single_batched_try_read_many_call():
    """The pre-migration code issued one try_read per sub-block; the
    batched version must fold those into one try_read_many call so a
    future fast path can accelerate them together."""
    sub0 = b"\xab" * _SUB0_SIZE
    sub1 = b"\xcd" * _SUB1_SIZE
    # Two separate segments — the bulk read spans both and fails
    # (FakeProcessMemory._lookup can't span segments), triggering the
    # fallback.
    pm = _SpyPM({_BASE: sub0, _BASE + _SUB0_SIZE: sub1})
    got = _read_item_block(pm, _BASE, _COUNT)
    assert got == sub0 + sub1
    assert len(pm.try_read_many_calls) == 1
    # Two sub-block requests in one call.
    assert len(pm.try_read_many_calls[0]) == 2


def test_fallback_zero_fills_only_the_unreadable_sub_blocks():
    """A single unreadable sub-block must be replaced with zeros while
    readable sub-blocks are preserved — the invariant the whole
    fallback path exists to protect."""
    sub0 = b"\xab" * _SUB0_SIZE
    # sub1 intentionally NOT registered → try_read_many returns None
    # for that slot → zero-filled.
    pm = _SpyPM({_BASE: sub0})
    got = _read_item_block(pm, _BASE, _COUNT)
    assert got is not None
    assert got[:_SUB0_SIZE] == sub0
    assert got[_SUB0_SIZE:] == b"\x00" * _SUB1_SIZE


def test_fallback_returns_none_when_no_sub_block_is_readable():
    """If every sub-block also fails, the whole read is discarded."""
    pm = _SpyPM()
    assert _read_item_block(pm, _BASE, _COUNT) is None
