"""Phase 0 agent telemetry: the run_doctor health classifier, the shared offset
tables, build detection, the restart counter, telemetry assembly, and that a
check-in seals correctly. No live process — reflection is faked/monkeypatched."""
from sqreader import __version__, fleet, health, squad_build


# ---- health.run_doctor classification ------------------------------------

class _OkAlloc:
    def fname_to_str(self, ci=0, num=0):
        return "None"


class _AbsentArr:
    num_elements = 1000

    def find_by_name(self, *a, **k):
        return []          # SQPlayerState unresolvable → "unknown", not drift


def test_run_doctor_unknown_when_core_class_absent():
    doc = health.run_doctor(pm=None, arr=_AbsentArr(), alloc=_OkAlloc())
    assert doc["state"] == "unknown" and doc["ok"] is True and doc["drift"] == []


def test_run_doctor_unknown_when_anchors_bad():
    class BadAlloc:
        def fname_to_str(self, *a):
            return "xxx"                 # index0 != "None"

    class BadArr:
        num_elements = 0                 # out of the sane range

        def find_by_name(self, *a, **k):
            return []

    assert health.run_doctor(None, BadArr(), BadAlloc())["state"] == "unknown"


def test_run_doctor_ok_and_drift(monkeypatch):
    class Arr:
        num_elements = 1000

        def find_by_name(self, name, **k):
            return [("addr", 0xDEAD)] if name == "SQPlayerState" else []

    monkeypatch.setattr(health, "check_offset_drift", lambda *a: [])
    assert health.run_doctor(None, Arr(), _OkAlloc())["state"] == "ok"

    monkeypatch.setattr(health, "check_offset_drift",
                        lambda *a: [{"class": "SQDeployable", "field": "Team",
                                     "problem": "offset drift"}])
    d = health.run_doctor(None, Arr(), _OkAlloc())
    assert d["state"] == "drift" and d["ok"] is False and len(d["drift"]) == 1


def test_hardcoded_offset_tables_shape():
    tables = health.hardcoded_offset_tables()
    names = {c for c, _ in tables}
    assert {"SQDeployable", "SQVehicleWeapon", "SQMapMarker"} <= names
    for _cls, tbl in tables:
        assert tbl and all(isinstance(v, int) for v in tbl.values())


# ---- build detection + restart counter -----------------------------------

def test_build_sha256_off_proc_is_none():
    # No readable /proc/<pid>/exe on the test host → None, never raises.
    assert squad_build.build_sha256(2**31 - 1) is None


def test_short_build():
    assert squad_build.short_build(None) is None
    assert squad_build.short_build("abcdef0123456789") == "abcdef012345"


def test_engine_version_is_none():
    assert squad_build.engine_version(None, None, None) is None


def test_bump_restarts_increments(tmp_path):
    assert fleet.bump_restarts(tmp_path) == 1
    assert fleet.bump_restarts(tmp_path) == 2
    assert fleet.bump_restarts(tmp_path) == 3


# ---- telemetry assembly + sealed check-in --------------------------------

def test_gather_telemetry(monkeypatch):
    monkeypatch.setattr(health, "run_doctor",
                        lambda *a: {"state": "drift", "ok": False,
                                    "drift": [{"class": "X", "field": "y"}]})
    t = fleet.gather(pm=None, arr=None, alloc=None, build_sha="abc123",
                     restarts=2, uptime_sec=99.9, channel="beta")
    assert t["schema"] == "sqr-checkin-1"
    assert t["agent_version"] == __version__
    assert t["squad_build"] == "abc123"
    assert t["health"] == "drift" and t["restarts"] == 2 and t["channel"] == "beta"
    assert t["uptime_sec"] == 99                    # int-coerced
    assert len(t["drift"]) == 1


def test_checkin_seals_and_posts(monkeypatch):
    import json

    from sqreader import ingest_client as ic
    from sqreader.crypto_envelope import open_envelope

    captured: dict = {}

    def fake_post(url, obj, *, timeout):
        captured["url"] = url
        captured["env"] = obj
        return {"ok": True}

    monkeypatch.setattr(ic, "_post_json", fake_post)
    secret = bytes(range(32))
    creds = {"SQREADER_AGENT_ID": "eu1",
             "SQREADER_AGENT_SECRET_HEX": secret.hex(),
             "SQREADER_PUSH_URL": "https://c.test"}
    ack = ic.checkin(creds, {"schema": "sqr-checkin-1", "health": "ok"}, seq=5)
    assert ack == {"ok": True}
    assert captured["url"] == "https://c.test/agent/checkin"
    payload = json.loads(open_envelope(captured["env"], secret=secret))
    assert payload["health"] == "ok" and payload["schema"] == "sqr-checkin-1"
