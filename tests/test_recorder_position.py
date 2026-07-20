"""Two-tier recorder: position frames append to the open writer without touching
full-frame counts, are dropped when no recording is open, and are excluded from
`ticks`/`peakPlayers` on a disk re-scan (backward-compatible with full-only .sqrx)."""
import json
from datetime import datetime, timezone

from sqreader.recorder import (
    RecordingState, _write_line, extract_metadata, write_position_frame,
)
from sqreader.sqrx import SqrxWriter


def _full(tick, players, ts, mapname="Yehorivka"):
    return json.dumps({"tick": tick, "timestamp": ts,
                       "players": [{"name": f"p{i}"} for i in range(players)],
                       "gameState": {"mapName": mapname, "matchId": "m1",
                                     "matchState": "InProgress"}}) + "\n"


def _pos(tick, ts, n=3):
    return json.dumps({"t": "pos", "tick": tick, "timestamp": ts,
                       "players": [{"id": f"p{i}", "x": 1.0, "y": 2.0}
                                   for i in range(n)]}) + "\n"


def _state(tmp_path):
    path = tmp_path / "rec.sqrx"
    w = SqrxWriter(str(path), "sq")
    st = RecordingState(match_id="m1", writer=w, path=path,
                        started_at=datetime.now(timezone.utc))
    return st, path


def test_position_frame_dropped_without_recording():
    assert write_position_frame({"current": None}, _pos(1, "t")) == 0


def test_position_frame_appends_but_not_tick_count(tmp_path):
    st, _ = _state(tmp_path)
    _write_line(st, json.loads(_full(1, 50, "2026-01-01T00:00:00+00:00")),
                _full(1, 50, "2026-01-01T00:00:00+00:00"))
    n = write_position_frame({"current": st}, _pos(2, "2026-01-01T00:00:00.25+00:00"))
    assert n > 0
    assert st.tick_count == 1                # full frames only
    assert st.position_count == 1            # pos counted separately
    assert st.peak_players == 50             # untouched by pos frame
    st.writer.close()


def test_extract_metadata_skips_position_frames(tmp_path):
    st, path = _state(tmp_path)
    st.writer.write_line(_full(1, 50, "2026-01-01T00:00:00+00:00"))
    st.writer.write_line(_pos(2, "2026-01-01T00:00:00.25+00:00"))
    st.writer.write_line(_pos(3, "2026-01-01T00:00:00.50+00:00"))
    st.writer.write_line(_pos(4, "2026-01-01T00:00:00.75+00:00"))
    st.writer.write_line(_full(5, 62, "2026-01-01T00:00:01+00:00"))
    st.writer.close()
    meta = extract_metadata(path)
    assert meta["ticks"] == 2                # full frames
    assert meta["positionFrames"] == 3
    assert meta["totalFrames"] == 5
    assert meta["peakPlayers"] == 62         # pos frames' rosters ignored
    assert meta["mapName"] == "Yehorivka"


def test_extract_metadata_old_sqrx_has_no_position_frames(tmp_path):
    st, path = _state(tmp_path)
    st.writer.write_line(_full(1, 40, "2026-01-01T00:00:00+00:00"))
    st.writer.write_line(_full(2, 44, "2026-01-01T00:00:01+00:00"))
    st.writer.close()
    meta = extract_metadata(path)
    assert meta["ticks"] == 2
    assert meta["positionFrames"] == 0
    assert meta["totalFrames"] == 2
