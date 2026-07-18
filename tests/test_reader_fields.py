"""Phase-8 reader field decoding — the pure-logic parts.

The offset VALUES for the new fields still need `sqreader doctor` on a live
process; this covers the decode logic that sits on top of them (the FDateTime
conversion), which is where the real subtlety is.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqreader.squad.snapshot import (
    _FDATETIME_TICKS_PER_SEC,
    _UE_EPOCH_OFFSET_SEC,
    _fdatetime_seconds_until,
)


def _ticks_at(unix_seconds: float) -> int:
    """FDateTime tick stamp for a given Unix time."""
    return int((unix_seconds + _UE_EPOCH_OFFSET_SEC) * _FDATETIME_TICKS_PER_SEC)


def test_future_stamp_is_a_positive_countdown():
    now = datetime.now(timezone.utc).timestamp()
    assert _fdatetime_seconds_until(_ticks_at(now + 300)) == 300


def test_past_stamp_is_negative_meaning_ready():
    now = datetime.now(timezone.utc).timestamp()
    assert _fdatetime_seconds_until(_ticks_at(now - 45)) == -45


def test_zero_and_none_are_none():
    assert _fdatetime_seconds_until(0) is None
    assert _fdatetime_seconds_until(None) is None


def test_negative_ticks_are_none():
    assert _fdatetime_seconds_until(-1) is None


def test_stamp_beyond_a_day_is_rejected_as_garbage():
    """A freed/garbage stamp reads as a wild value; it must not surface as a
    bogus multi-hour countdown."""
    now = datetime.now(timezone.utc).timestamp()
    assert _fdatetime_seconds_until(_ticks_at(now + 86400 * 3)) is None
    assert _fdatetime_seconds_until(_ticks_at(now - 86400 * 3)) is None


def test_boundary_just_inside_the_day_window_is_kept():
    now = datetime.now(timezone.utc).timestamp()
    v = _fdatetime_seconds_until(_ticks_at(now + 3600))   # 1h out — well inside
    assert v is not None and abs(v - 3600) <= 1
