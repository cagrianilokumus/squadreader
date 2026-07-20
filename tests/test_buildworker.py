"""ProcessBuildWorker: parse NDJSON frames from the build subprocess into
immutable FullFrames (latest wins, generations advance, entities derived), a
torn line is skipped, and a dead subprocess latches target_gone only when the
target game is also gone (else it respawns)."""
import json

from sqreader.squad.buildworker import FullFrame, ProcessBuildWorker
from sqreader.squad.possample import SampledEntities


def _snap(tick=1, build_ms=850.0):
    return {"tick": tick, "perf": {"buildMs": build_ms, "tier": "full"},
            "players": [{"_addr": "0x1000", "eosId": "eos-a", "name": "A"}],
            "vehicles": [{"id": "0x3000"}]}


def _w(target_alive=None):
    return ProcessBuildWorker(["python", "-m", "sqreader.cli", "build-worker"],
                              target_alive=target_alive)


def test_ingest_publishes_frame_and_entities():
    w = _w()
    assert w.latest() is None
    f = w._ingest_line(json.dumps(_snap(tick=7, build_ms=812.5)) + "\n")
    assert isinstance(f, FullFrame) and f.gen == 1
    assert f.build_ms == 812.5 and f.snap["tick"] == 7
    assert f.entities == SampledEntities(
        full_tick=7, players=((0x1000, "eos-a"),), vehicles=((0x3000, "0x3000"),))
    assert w.latest() is f


def test_latest_wins_generations_advance():
    w = _w()
    w._ingest_line(json.dumps(_snap(tick=1)) + "\n")
    w._ingest_line(json.dumps(_snap(tick=2)) + "\n")
    assert w.latest().gen == 2 and w.latest().snap["tick"] == 2


def test_blank_and_torn_lines_skipped():
    w = _w()
    assert w._ingest_line("\n") is None
    assert w._ingest_line("   ") is None
    assert w._ingest_line('{"tick": 1, "perf"') is None   # truncated JSON
    assert w.latest() is None
    assert w.last_error and "frame parse" in w.last_error


def test_missing_build_ms_defaults_zero():
    w = _w()
    f = w._ingest_line(json.dumps({"tick": 1, "players": [], "vehicles": []}) + "\n")
    assert f.build_ms == 0.0


def test_update_paths_is_noop():
    w = _w()
    w.update_paths(object())          # must not raise; subprocess owns its paths


class _FakeStdout:
    """Yields the given lines once, then acts 'closed' (EOF)."""
    def __init__(self, lines):
        self._lines = list(lines)

    def __iter__(self):
        return iter(self._lines)


class _FakeProc:
    def __init__(self, lines):
        self.stdout = _FakeStdout(lines)
        self.terminated = False

    def terminate(self):
        self.terminated = True


def test_read_loop_latches_target_gone_when_game_dead(monkeypatch):
    w = _w(target_alive=lambda: False)
    spawns = {"n": 0}

    def fake_spawn():
        spawns["n"] += 1
        w._proc = _FakeProc([json.dumps(_snap(tick=spawns["n"])) + "\n"])
    monkeypatch.setattr(w, "_spawn", fake_spawn)
    fake_spawn()                      # seed the first proc
    w._read_loop()                    # consumes 1 frame, hits EOF, game dead
    assert w.target_gone is True
    assert w.latest().snap["tick"] == 1
    assert spawns["n"] == 1           # did NOT respawn (game gone)


def test_read_loop_respawns_when_worker_dies_but_game_alive(monkeypatch):
    w = _w(target_alive=lambda: True)
    spawns = {"n": 0}

    def fake_spawn():
        spawns["n"] += 1
        if spawns["n"] >= 3:          # stop the test after two respawns
            w._stop.set()
        w._proc = _FakeProc([json.dumps(_snap(tick=spawns["n"])) + "\n"])
    monkeypatch.setattr(w, "_spawn", fake_spawn)
    fake_spawn()
    w._read_loop()
    assert w.target_gone is False
    assert spawns["n"] >= 2           # respawned at least once
    assert w.last_error == "build-worker exited; respawning"
