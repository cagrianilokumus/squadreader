"""Invasion objectives reach captureZones[].

Invasion places its objectives as BP_CaptureZoneInvasion_C actors whose
component (SQCaptureZoneInvasionComponent, a subclass of
SQCaptureZoneComponent) hangs off a property of its own name. The reader only
matched BP_CaptureZone_C, so every Invasion layer had no capture zones and the
map drew the lane graph's bare cluster names instead.

The numbers here are a live read of altai on Yehorivka Invasion v2.
"""
from __future__ import annotations

import json
import struct
from pathlib import Path
from types import SimpleNamespace

from sqreader.squad.capzones import attach_static_capzones
from sqreader.squad.snapshot import CAPZONE_ACTOR_CLASSES, read_capture_zone

ROOT_OFF = 0x1A0          # actor -> RootComponent (any value; the fake only needs one)
TO_WORLD_OFF = 0x210      # SceneComponent -> ComponentToWorld.Translation
INVASION_COMP_OFF = 0x2C8  # BP_CaptureZoneInvasion_C.SQCaptureZoneInvasion, live
CZ_COMP_OFF = 0x2D0       # where SQCaptureZone sits on another actor class
COMP = {"OwningTeam": 0x100, "CapturePercent": 0x104, "bIsLocked": 0x108}


class FakeMem:
    def __init__(self) -> None:
        self.regions: dict[int, bytes] = {}

    def place(self, addr: int, data: bytes) -> None:
        self.regions[addr] = data

    def try_read(self, addr: int, size: int) -> bytes | None:
        for base, data in self.regions.items():
            if base <= addr and addr + size <= base + len(data):
                return data[addr - base:addr - base + size]
        return None

    def _read(self, addr: int, size: int) -> bytes:
        b = self.try_read(addr, size)
        if b is None:
            raise OSError(f"unmapped {addr:#x}")
        return b

    def read_u64(self, addr: int) -> int:
        return struct.unpack("<Q", self._read(addr, 8))[0]

    def read_u8(self, addr: int) -> int:
        return self._read(addr, 1)[0]


def lay_out_zone(mem: FakeMem, actor: int, comp_off: int, *, pos: tuple[float, float, float],
                 owner: int, pct: float, locked: bool) -> None:
    comp, root = actor + 0x10000, actor + 0x20000
    actor_buf = bytearray(0x400)
    struct.pack_into("<Q", actor_buf, ROOT_OFF, root)
    struct.pack_into("<Q", actor_buf, comp_off, comp)
    mem.place(actor, bytes(actor_buf))
    root_buf = bytearray(0x300)
    struct.pack_into("<ddd", root_buf, TO_WORLD_OFF, *pos)
    mem.place(root, bytes(root_buf))
    comp_buf = bytearray(0x200)
    comp_buf[COMP["OwningTeam"]] = owner
    struct.pack_into("<f", comp_buf, COMP["CapturePercent"], pct)
    comp_buf[COMP["bIsLocked"]] = 1 if locked else 0
    mem.place(comp, bytes(comp_buf))


def paths(**actor_offsets: int) -> SimpleNamespace:
    return SimpleNamespace(
        actor_root_component_off=ROOT_OFF,
        scene_component_to_world_translation_off=TO_WORLD_OFF,
        capzone_actor_offsets=actor_offsets,
        capzone_comp_offsets=COMP,
    )


def test_invasion_actor_class_is_a_capture_zone():
    assert CAPZONE_ACTOR_CLASSES["BP_CaptureZoneInvasion_C"] == "SQCaptureZoneInvasion"
    assert CAPZONE_ACTOR_CLASSES["BP_CaptureZone_C"] == "SQCaptureZone"


def test_reads_an_invasion_zone_through_its_own_component_property():
    mem = FakeMem()
    lay_out_zone(mem, 0x7000_0000, INVASION_COMP_OFF, pos=(58011.2, -189182.0, 8015.6),
                 owner=2, pct=1.0, locked=False)
    z = read_capture_zone(mem, None, paths(SQCaptureZoneInvasion=INVASION_COMP_OFF),
                          0x7000_0000, "B1-Ivanivka", "SQCaptureZoneInvasion")
    assert z["name"] == "B1-Ivanivka"
    assert z["position"]["x"] == 58011.2
    assert z["owningTeam"] == 2
    assert z["capturePercent"] == 1.0
    assert z["isLocked"] is False


def test_the_default_still_reads_a_plain_capture_zone():
    mem = FakeMem()
    lay_out_zone(mem, 0x7100_0000, CZ_COMP_OFF, pos=(1.0, 2.0, 3.0),
                 owner=1, pct=0.5, locked=True)
    z = read_capture_zone(mem, None, paths(SQCaptureZone=CZ_COMP_OFF),
                          0x7100_0000, "01-Warehouse")
    assert z["owningTeam"] == 1
    assert z["isLocked"] is True


def test_a_zone_whose_component_offset_is_unknown_has_no_component():
    mem = FakeMem()
    lay_out_zone(mem, 0x7200_0000, INVASION_COMP_OFF, pos=(0.0, 0.0, 0.0),
                 owner=2, pct=1.0, locked=True)
    z = read_capture_zone(mem, None, paths(SQCaptureZone=CZ_COMP_OFF),
                          0x7200_0000, "B1-Ivanivka", "SQCaptureZoneInvasion")
    assert z["component"] is None
    assert "owningTeam" not in z


def test_live_invasion_positions_match_squadcalc_one_to_one():
    static = json.loads((Path(__file__).resolve().parents[1] / "data" / "static"
                         / "capzones.json").read_text(encoding="utf-8"))["Yehorivka Invasion v2"]
    live = [  # name, the game's own FlagName, live position
        ("B1-Ivanivka", "Ivanivka", 58011.21875, -189182.015625),
        ("B2-PetrivkaOverpass", "Petrivka Overpass", 48880.21484375, -124618.9140625),
        ("B3-PetrivkaCo-Op", "Petrivka Co-Op", -8065.779296875, -48938.46484375),
        ("B4-WestMogilyovo", "West Mogilyovo", -87535.4453125, 2726.151123046875),
        ("B5-WestNovo", "West Novo", -3360.283203125, 61964.7421875),
    ]
    zones = [{"name": n, "flagName": f, "position": {"x": x, "y": y}} for n, f, x, y in live]
    assert attach_static_capzones(zones, static) == 5
    for z in zones:
        assert z["staticName"] == z["flagName"]
        assert z["geometry"]
