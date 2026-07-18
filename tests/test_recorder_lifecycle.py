"""Security lifecycle tests for per-match .sqrx metadata."""
import json

from sqreader.recorder import (
    _MATCH_END_CONFIRM_TICKS,
    _handle_snap,
    finalize_recording,
)


def _snap(state: str, match_id: str = "match-a", tick=None) -> dict:
    snap = {
        "timestamp": "2026-07-14T12:00:00+00:00",
        "gameState": {
            "matchState": state,
            "matchId": match_id,
            "mapName": "Fallujah",
            "gameModeName": "RAAS",
            "layer": {"name": "Fallujah_RAAS_v1"},
        },
        "players": [],
    }
    if tick is not None:
        snap["tick"] = tick
    return snap


def _state_box():
    return {
        "current": None,
        "last_state": None,
        "inactive_ticks": 0,
        "pending_match_id": None,
        "pending_match_buffer": [],
        "last_tick": None,
        "tick_sequence_required": False,
        "missing_tick_warned": False,
    }


def _step(tmp_path, state_box, filename_buffer, snap):
    _handle_snap(
        snap=snap,
        raw_line=json.dumps(snap),
        state_box=state_box,
        out_dir=tmp_path,
        server_id="test-server",
        min_ticks=0,
        filename_buffer=filename_buffer,
    )


def test_recording_sidecar_is_active_until_writer_is_finalized(tmp_path):
    state_box = _state_box()
    filename_buffer = []
    active = _snap("InProgress")

    for _ in range(_MATCH_END_CONFIRM_TICKS):
        _step(tmp_path, state_box, filename_buffer, active)

    current = state_box["current"]
    assert current is not None
    sidecar = current.path.with_suffix(".meta.json")
    live_meta = json.loads(sidecar.read_text(encoding="utf-8"))
    assert live_meta["matchId"] == "match-a"
    assert live_meta["recordingState"] == "active"
    assert live_meta["inProgress"] is True

    # Neither one post-match frame nor ambiguous/unknown state proves an end.
    ended = _snap("WaitingPostMatch")
    _step(tmp_path, state_box, filename_buffer, ended)
    assert state_box["current"] is current

    missing_id = _snap("InProgress", match_id=None)
    _step(tmp_path, state_box, filename_buffer, missing_id)
    assert state_box["current"] is current

    _step(tmp_path, state_box, filename_buffer, _snap("FutureUnknownState"))
    assert state_box["current"] is current

    for _ in range(_MATCH_END_CONFIRM_TICKS):
        _step(tmp_path, state_box, filename_buffer, ended)

    assert state_box["current"] is None
    final_meta = json.loads(sidecar.read_text(encoding="utf-8"))
    assert final_meta["recordingState"] == "finalized"
    assert final_meta["inProgress"] is False
    assert final_meta["ticks"] == _MATCH_END_CONFIRM_TICKS


def test_one_spurious_match_id_does_not_split_or_expose_recording(tmp_path):
    state_box = _state_box()
    filename_buffer = []
    active_a = _snap("InProgress", "match-a")
    for _ in range(_MATCH_END_CONFIRM_TICKS):
        _step(tmp_path, state_box, filename_buffer, active_a)

    current = state_box["current"]
    assert current is not None
    _step(tmp_path, state_box, filename_buffer,
          _snap("InProgress", "match-b"))
    assert state_box["current"] is current
    assert len(list(tmp_path.glob("*.sqrx"))) == 1

    # A malformed frame breaks the B candidate; returning A continues the
    # original writer and never creates an orphan B file.
    _step(tmp_path, state_box, filename_buffer,
          _snap("InProgress", match_id=None))
    _step(tmp_path, state_box, filename_buffer, active_a)
    assert state_box["current"] is current
    assert current.tick_count == _MATCH_END_CONFIRM_TICKS + 1
    assert len(list(tmp_path.glob("*.sqrx"))) == 1

    finalize_recording(current, reason="test cleanup")


def test_uncertain_shutdown_close_stays_unverified(tmp_path):
    state_box = _state_box()
    filename_buffer = []
    active = _snap("InProgress")
    for _ in range(_MATCH_END_CONFIRM_TICKS):
        _step(tmp_path, state_box, filename_buffer, active)

    current = state_box["current"]
    sidecar = current.path.with_suffix(".meta.json")
    finalize_recording(current, reason="serve shutdown")

    meta = json.loads(sidecar.read_text(encoding="utf-8"))
    assert meta["recordingState"] == "unverified"
    assert meta["inProgress"] is True


def test_dropped_sse_frames_cannot_fake_consecutive_match_ids(tmp_path):
    state_box = _state_box()
    filename_buffer = []
    for tick in (1, 2, 3):
        _step(tmp_path, state_box, filename_buffer,
              _snap("InProgress", "match-a", tick=tick))

    current = state_box["current"]
    assert current is not None

    # Model a slow SSE subscriber receiving B at 5/7/9 while the A reset
    # frames at 4/6/8 were dropped by its bounded queue. Tick gaps must reset
    # the B candidate each time instead of falsely confirming a transition.
    for tick in (5, 7, 9):
        _step(tmp_path, state_box, filename_buffer,
              _snap("InProgress", "match-b", tick=tick))
    assert state_box["current"] is current
    assert len(list(tmp_path.glob("*.sqrx"))) == 1

    _step(tmp_path, state_box, filename_buffer,
          _snap("InProgress", "match-a", tick=10))
    assert state_box["current"] is current
    assert current.tick_count == 4

    finalize_recording(current, reason="test cleanup")
