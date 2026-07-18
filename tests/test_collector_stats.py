"""Squad stats-collector decoding + PlayerStatsIndex splice.

Pure-logic: a fake flat address space stands in for the live process, so the
struct offsets, the TArray sanity gates, and the PSI splice are all exercised
without a Squad server. The offset VALUES still need `sqreader doctor` against a
live process — this proves the decode logic given correct offsets, not the
offsets themselves.
"""
from __future__ import annotations

import struct

from sqreader.squad.snapshot import (
    COLLECTOR_OFFSETS,
    _read_collector_array,
    _read_collectors,
    _splice_collector_stats,
)


class FakeMem:
    """A sparse little-endian address space. `regions[addr] = bytes`."""

    def __init__(self):
        self.regions: dict[int, bytes] = {}

    def place(self, addr: int, data: bytes) -> None:
        self.regions[addr] = data

    def read(self, addr: int, size: int) -> bytes:
        for base, data in self.regions.items():
            if base <= addr < base + len(data):
                off = addr - base
                if off + size <= len(data):
                    return data[off:off + size]
        raise OSError(f"unmapped read at {addr:#x}")

    def try_read(self, addr, size):
        if addr <= 0 or addr >= 0x800000000000 or size <= 0:
            return None
        try:
            return self.read(addr, size)
        except OSError:
            return None

    def read_u64(self, addr):
        return struct.unpack_from("<Q", self.read(addr, 8))[0]

    def read_i32(self, addr):
        return struct.unpack_from("<i", self.read(addr, 4))[0]


# --------------------------------------------------------------------------
# helpers to lay out a collector instance
# --------------------------------------------------------------------------

def _place_collector(mem: FakeMem, inst_addr: int, data_ptr: int, spec: dict,
                     rows: list[dict]) -> None:
    """Lay out a TArray<struct> at inst_addr per `spec`, populated from rows."""
    stride = spec["stride"]
    buf = bytearray(len(rows) * stride)
    for i, row in enumerate(rows):
        base = i * stride
        for field_name, (kind, off) in spec["fields"].items():
            if field_name not in row:
                continue
            fmt = "<q" if kind == "i64" else "<i"
            struct.pack_into(fmt, buf, base + off, row[field_name])
    mem.place(data_ptr, bytes(buf))
    # TArray header: data ptr @ tarray, count @ tarray+8.
    hdr = struct.pack("<Qi", data_ptr, len(rows))
    mem.place(inst_addr + spec["tarray"], hdr)


# --------------------------------------------------------------------------
# _read_collector_array
# --------------------------------------------------------------------------

def test_objective_array_decodes_captures_and_defenses():
    mem = FakeMem()
    spec = COLLECTOR_OFFSETS["objective"]
    _place_collector(mem, 0x200010000, 0x300050000, spec, [
        {"captures": 3, "defenses": 1},
        {"captures": 0, "defenses": 7},
    ])
    arr = _read_collector_array(mem, 0x200010000, spec)
    assert arr == {0: {"captures": 3, "defenses": 1},
                   1: {"captures": 0, "defenses": 7}}


def test_combat_array_decodes_i64_vehicle_damage():
    mem = FakeMem()
    spec = COLLECTOR_OFFSETS["combat"]
    # A value that overflows i32 — proves the i64 field width.
    big = 5_000_000_000
    _place_collector(mem, 0x200020000, 0x300060000, spec, [
        {"vehicleDamage": big, "fobsDestroyed": 2},
    ])
    arr = _read_collector_array(mem, 0x200020000, spec)
    assert arr[0]["vehicleDamage"] == big
    assert arr[0]["fobsDestroyed"] == 2


def test_logistics_array_decodes_three_fields():
    mem = FakeMem()
    spec = COLLECTOR_OFFSETS["logistics"]
    _place_collector(mem, 0x200030000, 0x300070000, spec, [
        {"fobsBuilt": 4, "_ammoSupplied": 800, "_constructionSupplied": 1200},
    ])
    arr = _read_collector_array(mem, 0x200030000, spec)
    assert arr[0] == {"fobsBuilt": 4, "_ammoSupplied": 800,
                      "_constructionSupplied": 1200}


def test_empty_array_is_an_empty_dict_not_none():
    mem = FakeMem()
    spec = COLLECTOR_OFFSETS["objective"]
    mem.place(0x200010000 + spec["tarray"], struct.pack("<Qi", 0x300050000, 0))
    assert _read_collector_array(mem, 0x200010000, spec) == {}


def test_garbage_count_is_rejected():
    """A torn read must not send us reading megabytes."""
    mem = FakeMem()
    spec = COLLECTOR_OFFSETS["objective"]
    mem.place(0x200010000 + spec["tarray"], struct.pack("<Qi", 0x300050000, 999999))
    assert _read_collector_array(mem, 0x200010000, spec) is None


def test_bad_data_pointer_is_rejected():
    mem = FakeMem()
    spec = COLLECTOR_OFFSETS["objective"]
    mem.place(0x200010000 + spec["tarray"], struct.pack("<Qi", 0x123, 5))  # low ptr
    assert _read_collector_array(mem, 0x200010000, spec) is None


def test_unreadable_header_is_none():
    mem = FakeMem()
    assert _read_collector_array(mem, 0x200099999, COLLECTOR_OFFSETS["objective"]) is None


# --------------------------------------------------------------------------
# _read_collectors — skips missing instances
# --------------------------------------------------------------------------

def test_read_collectors_skips_zero_addrs_and_failed_reads():
    mem = FakeMem()
    _place_collector(mem, 0x200010000, 0x300050000, COLLECTOR_OFFSETS["objective"],
                     [{"captures": 1, "defenses": 2}])
    out = _read_collectors(mem, {
        "objective": 0x200010000,   # good
        "combat": 0,            # not found this tick
        "logistics": 0x200099999,   # unmapped -> read fails
    })
    assert set(out) == {"objective"}
    assert out["objective"][0] == {"captures": 1, "defenses": 2}


# --------------------------------------------------------------------------
# _splice_collector_stats
# --------------------------------------------------------------------------

def _player(psi, name="P"):
    return {"name": name, "_psi": psi, "stats": {"kills": 1}}


def test_splice_maps_each_collector_by_psi():
    players = [_player(0, "Alice"), _player(1, "Bob")]
    collectors = {
        "objective": {0: {"captures": 3, "defenses": 1},
                      1: {"captures": 0, "defenses": 5}},
        "combat":    {0: {"vehicleDamage": 900, "fobsDestroyed": 2}},
        "logistics": {1: {"fobsBuilt": 4, "_ammoSupplied": 800,
                          "_constructionSupplied": 200}},
    }
    _splice_collector_stats(players, collectors)

    assert players[0]["stats"]["captures"] == 3
    assert players[0]["stats"]["defenses"] == 1
    assert players[0]["stats"]["vehicleDamage"] == 900
    assert players[0]["stats"]["fobsDestroyed"] == 2
    assert "fobsBuilt" not in players[0]["stats"]     # logistics keyed psi=1

    assert players[1]["stats"]["fobsBuilt"] == 4
    assert players[1]["stats"]["suppliesDelivered"] == 1000   # ammo + cons
    assert players[1]["stats"]["captures"] == 0


def test_splice_skips_players_without_a_psi():
    """No live soldier this tick -> no PSI -> untouched. The counters are
    cumulative and MAX-upserted, so the next embodied tick carries them."""
    players = [{"name": "Ghost", "stats": {}}]
    _splice_collector_stats(players, {"objective": {0: {"captures": 9}}})
    assert players[0]["stats"] == {}


def test_splice_leaves_unknown_fields_absent_not_zero():
    """no-guess: a field the collector could not read is unknown, not 0."""
    players = [_player(0)]
    _splice_collector_stats(players, {
        "objective": {0: {"captures": 5, "defenses": None}}})
    assert players[0]["stats"]["captures"] == 5
    assert "defenses" not in players[0]["stats"]


def test_splice_folds_ammo_and_construction_into_supplies():
    players = [_player(0)]
    _splice_collector_stats(players, {
        "logistics": {0: {"fobsBuilt": 1, "_ammoSupplied": 300,
                         "_constructionSupplied": 0}}})
    assert players[0]["stats"]["suppliesDelivered"] == 300


def test_splice_creates_stats_dict_if_missing():
    players = [{"name": "P", "_psi": 0}]     # no stats key
    _splice_collector_stats(players, {"objective": {0: {"captures": 2}}})
    assert players[0]["stats"]["captures"] == 2
