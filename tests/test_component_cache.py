"""Vehicle-component name caching: with a SnapshotCaches, a component's class +
instance names are resolved once and served from cache on the next tick (the
per-vehicle name-read saver). Without caches, every call re-resolves."""
import struct

from sqreader.squad import snapshot as sn


class _PM:
    """Fake ProcessMemory: health=1.0 for any 4-byte read, state byte 0."""
    def try_read(self, addr, size):
        return struct.pack("<f", 1.0) if size == 4 else None

    def read_u8(self, addr):
        return 0


def _patch_names(monkeypatch, calls):
    def fake_cls(pm, addr, alloc):
        calls["cls"] += 1
        return "BP_Wheel_C"

    def fake_name(pm, addr, alloc):
        calls["name"] += 1
        return "wheel_L1"

    monkeypatch.setattr(sn, "_uobject_class_name", fake_cls)
    monkeypatch.setattr(sn, "_uobject_name", fake_name)


def test_component_names_cached_across_ticks(monkeypatch):
    calls = {"cls": 0, "name": 0}
    _patch_names(monkeypatch, calls)
    caches = sn.SnapshotCaches()
    pm = _PM()

    r1 = sn.read_vehicle_component(pm, None, 0x1000, caches)
    r2 = sn.read_vehicle_component(pm, None, 0x1000, caches)   # same addr, next tick

    assert r1["className"] == "BP_Wheel_C" and r1["name"] == "wheel_L1"
    assert r2["className"] == "BP_Wheel_C" and r2["name"] == "wheel_L1"
    assert calls == {"cls": 1, "name": 1}                     # resolved once, then cached
    assert caches.component_class_names[0x1000] == "BP_Wheel_C"


def test_component_no_cache_reresolves(monkeypatch):
    calls = {"cls": 0, "name": 0}
    _patch_names(monkeypatch, calls)
    pm = _PM()
    sn.read_vehicle_component(pm, None, 0x2000, None)
    sn.read_vehicle_component(pm, None, 0x2000, None)
    assert calls == {"cls": 2, "name": 2}                     # no cache → re-read each time


def test_component_cache_cleared_on_reset(monkeypatch):
    calls = {"cls": 0, "name": 0}
    _patch_names(monkeypatch, calls)
    caches = sn.SnapshotCaches()
    pm = _PM()
    sn.read_vehicle_component(pm, None, 0x3000, caches)
    caches.reset()                                            # match transition
    sn.read_vehicle_component(pm, None, 0x3000, caches)
    assert calls == {"cls": 2, "name": 2}                     # cleared → re-resolved
