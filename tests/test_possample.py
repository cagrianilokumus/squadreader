"""Position sampler: correct pos/health extraction from a cached entity set, and
each staleness gate (no soldier / freed ClassPrivate / out-of-range health / no
position) silently OMITS exactly that entity and never raises."""
import struct
from types import SimpleNamespace

import pytest

from sqreader.squad import possample
from sqreader.squad.possample import SampledEntities, sample_positions
from sqreader.ue.uobject import UOBJ_CLASS_PRIVATE

PS = 0x1000
SOLDIER = 0x2000
CLASS = 0x9000        # a plausible heap class pointer
VH = 0x3000
SOLDIER_OFF = 0x10
HEALTH_OFF = 0x20
VH_HEALTH_OFF = 0x30
TEAM_OFF = 0x40


def _paths():
    return SimpleNamespace(
        ps_offsets={"Soldier": SOLDIER_OFF},
        soldier_offsets={"Health": HEALTH_OFF},
        vehicle_offsets={"Health": VH_HEALTH_OFF},
        sq_pawn_team_off=TEAM_OFF,
    )


class FakePM:
    def __init__(self, mem):
        self.mem = mem

    def try_read(self, addr, size):
        b = self.mem.get(addr)
        return b[:size] if b is not None and len(b) >= size else None


def _base_mem():
    return {
        PS + SOLDIER_OFF: struct.pack("<Q", SOLDIER),         # ps -> soldier
        SOLDIER + UOBJ_CLASS_PRIVATE: struct.pack("<Q", CLASS),
        SOLDIER + HEALTH_OFF: struct.pack("<f", 87.5),
        VH + UOBJ_CLASS_PRIVATE: struct.pack("<Q", CLASS),
        VH + VH_HEALTH_OFF: struct.pack("<f", 950.0),
        VH + TEAM_OFF: bytes([1]),
    }


@pytest.fixture(autouse=True)
def _fake_pos(monkeypatch):
    # Isolate the gate logic from the (separately-tested) position read path.
    monkeypatch.setattr(possample, "read_root_pos_yaw",
                        lambda pm, addr, paths: {"position": {"x": 100.0, "y": 200.0, "z": 5.0},
                                                 "yaw": 90.0})


def _ents():
    return SampledEntities(full_tick=7, players=((PS, "eos-bob"),), vehicles=((VH, "0x3000"),))


def test_healthy_player_and_vehicle_emitted():
    pm = FakePM(_base_mem())
    f = sample_positions(pm, _paths(), _ents(), tick=30, ts="2026-01-01T00:00:00Z")
    assert f["t"] == "pos" and f["tick"] == 30 and f["fullTick"] == 7
    assert f["players"] == [{"id": "eos-bob", "x": 100.0, "y": 200.0, "z": 5.0,
                             "h": 87.5, "yaw": 90.0}]
    assert f["vehicles"] == [{"id": "0x3000", "x": 100.0, "y": 200.0, "h": 950.0,
                              "yaw": 90.0, "team": 1}]


def test_no_soldier_pointer_omits_player():
    mem = _base_mem()
    mem[PS + SOLDIER_OFF] = struct.pack("<Q", 0)          # ps -> null
    f = sample_positions(FakePM(mem), _paths(), _ents(), 30, "t")
    assert f["players"] == []


def test_freed_classprivate_omits_player():
    mem = _base_mem()
    mem[SOLDIER + UOBJ_CLASS_PRIVATE] = struct.pack("<Q", 0)   # freed slot
    f = sample_positions(FakePM(mem), _paths(), _ents(), 30, "t")
    assert f["players"] == []


def test_out_of_range_health_omits_player():
    mem = _base_mem()
    mem[SOLDIER + HEALTH_OFF] = struct.pack("<f", 9999.0)     # impossible HP = stale
    f = sample_positions(FakePM(mem), _paths(), _ents(), 30, "t")
    assert f["players"] == []


def test_missing_position_omits(monkeypatch):
    monkeypatch.setattr(possample, "read_root_pos_yaw", lambda *a: {})   # root unreadable
    f = sample_positions(FakePM(_base_mem()), _paths(), _ents(), 30, "t")
    assert f["players"] == [] and f["vehicles"] == []


def test_insane_coord_omits(monkeypatch):
    monkeypatch.setattr(possample, "read_root_pos_yaw",
                        lambda *a: {"position": {"x": 9e9, "y": 1.0, "z": 0.0}})
    f = sample_positions(FakePM(_base_mem()), _paths(), _ents(), 30, "t")
    assert f["players"] == []


def test_from_snapshot_parses_addrs_and_keys():
    snap = {"tick": 42,
            "players": [{"_addr": "0x1000", "eosId": "eos-x", "name": "Bob"},
                        {"_addr": "0x2000", "name": "NoEos"},   # key falls back to name
                        {"name": "NoAddr"}],                     # dropped (no _addr)
            "vehicles": [{"id": "0x3000"}, {"foo": 1}]}          # 2nd dropped (no id)
    ent = SampledEntities.from_snapshot(snap)
    assert ent.full_tick == 42
    assert ent.players == ((0x1000, "eos-x"), (0x2000, "NoEos"))
    assert ent.vehicles == ((0x3000, "0x3000"),)
