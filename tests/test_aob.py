"""Tests for the AOB pattern scanner. The scanner is a new drift-
recovery primitive that is not yet wired into any live discovery
path, so these tests cover the grammar, match helpers, RIP-relative
resolution, and one FakeProcessMemory-backed scan_region case that
exercises the chunk-boundary overlap logic."""
from __future__ import annotations

import struct

import pytest

from sqreader.aob import (
    Pattern,
    find_all,
    find_first,
    match_at,
    resolve_rip_relative,
    scan_region,
)
from sqreader.mem import MapRegion

from conftest import FakeProcessMemory


# -- Pattern.parse ------------------------------------------------------------

def test_parse_fixed_bytes_only():
    p = Pattern.parse("48 8B 1D")
    assert p.bytes_ == b"\x48\x8B\x1D"
    assert p.mask == (True, True, True)


def test_parse_wildcards_use_zero_placeholder_and_false_mask():
    p = Pattern.parse("48 ?? 8B ? 1D")
    assert p.bytes_ == b"\x48\x00\x8B\x00\x1D"
    assert p.mask == (True, False, True, False, True)


def test_parse_rejects_bad_token():
    with pytest.raises(ValueError):
        Pattern.parse("48 GG 8B")


def test_parse_rejects_empty_spec():
    """A typo can't silently produce a match-anything pattern."""
    with pytest.raises(ValueError):
        Pattern.parse("")


# -- match_at / find_all / find_first ----------------------------------------

def test_match_at_true_for_fixed_pattern():
    p = Pattern.parse("AB CD EF")
    assert match_at(b"\x00\xAB\xCD\xEF\x99", 1, p)


def test_match_at_false_when_mismatch():
    p = Pattern.parse("AB CD EF")
    assert not match_at(b"\xAB\xCD\x00", 0, p)


def test_match_at_accepts_any_byte_at_wildcard():
    p = Pattern.parse("AB ?? EF")
    assert match_at(b"\xAB\x00\xEF", 0, p)
    assert match_at(b"\xAB\xFF\xEF", 0, p)
    # But the fixed positions must still match.
    assert not match_at(b"\xAB\xFF\xF0", 0, p)


def test_match_at_false_when_pattern_runs_past_haystack_end():
    p = Pattern.parse("AB CD EF")
    assert not match_at(b"\xAB\xCD", 0, p)


def test_find_all_yields_every_match_in_order():
    p = Pattern.parse("AB CD")
    hay = b"\xAB\xCD_\xAB\xCD_\x00\xAB\xCD"
    assert list(find_all(hay, p)) == [0, 3, 7]


def test_find_first_returns_first_offset_or_none():
    p = Pattern.parse("AB CD")
    assert find_first(b"__\xAB\xCD__\xAB\xCD", p) == 2
    assert find_first(b"nope", p) is None


# -- resolve_rip_relative ----------------------------------------------------

def test_resolve_rip_relative_positive_displacement():
    disp = struct.pack("<i", 0x100)
    # target = instr_vma + instr_length + disp
    assert resolve_rip_relative(0x1000, 7, disp) == 0x1000 + 7 + 0x100


def test_resolve_rip_relative_negative_displacement():
    disp = struct.pack("<i", -0x50)
    assert resolve_rip_relative(0x2000, 7, disp) == 0x2000 + 7 - 0x50


def test_resolve_rip_relative_rejects_wrong_length():
    with pytest.raises(ValueError):
        resolve_rip_relative(0x1000, 7, b"\x00\x01\x02")


# -- scan_region -------------------------------------------------------------

def test_scan_region_finds_wildcarded_lea_across_chunk_boundary():
    """LEA pattern deliberately placed so a small chunk_size makes the
    match straddle two chunk reads — the overlap logic must still find
    it (and yield the hit exactly once)."""
    base = 0x1_000_000
    # 6 bytes of junk + LEA rax, [rip + 0x11223344] (7 bytes) + 2 nops.
    payload = (
        b"\xde\xad\xbe\xef\x00\x00"
        + b"\x48\x8D\x05\x44\x33\x22\x11"
        + b"\x90\x90"
    )
    pm = FakeProcessMemory({base: payload})
    region = MapRegion(
        start=base, end=base + len(payload),
        perms="r-xp", offset=0, dev="00:00", inode=0,
        pathname="SquadGameServer",
    )
    p = Pattern.parse("48 8D 05 ?? ?? ?? ??")
    hits = list(scan_region(pm, region, p, chunk_size=4))
    assert hits == [base + 6]
