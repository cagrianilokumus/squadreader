"""Tests for the outbound push client: bundle building, .sqrx resolution, and
the durable backlog queue. No real network — push fns are monkeypatched."""
import json

import pytest

from sqreader import ingest_client as ic
from sqreader.crypto_envelope import open_envelope, seal_json
from sqreader.stats import StatsStore

MID = "MATCH-FULL-0011223344556677-abcdef01"


def _make_db(tmp_path):
    db = tmp_path / "stats" / "s.db"
    store = StatsStore(db, server_id="eu1")
    with store.conn:
        store.conn.execute(
            "INSERT INTO matches (match_id, server_id, map_name, layer_name, "
            "status, winner_team, team1_tickets, team2_tickets, started_at, "
            "ended_at, duration_sec, peak_players) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (MID, "eu1", "Chora", "Chora AAS v3", "final", 1, 196, 0,
             1000, 2800, 1800, 80))
        for eos, name, team, kills in [
            ("eos-aaaa1111222233334444555566667777", "Alice", 1, 20),
            ("eos-bbbb1111222233334444555566667777", "Bob", 2, 8),
        ]:
            store.conn.execute(
                "INSERT INTO player_matches (match_id, eos_id, name, team_id, "
                "kills, first_seen_at, last_seen_at) VALUES (?,?,?,?,?,?,?)",
                (MID, eos, name, team, kills, 1000, 2800))
        store.conn.execute(
            "INSERT INTO kill_events (match_id, attacker_eos, victim_eos, "
            "weapon, killed) VALUES (?,?,?,?,?)",
            (MID, "eos-aaaa1111222233334444555566667777",
             "eos-bbbb1111222233334444555566667777", "BP_AKM_C", 1))
    store.conn.close()
    return db


def test_build_match_bundle_shape(tmp_path):
    db = _make_db(tmp_path)
    b = ic.build_match_bundle(db, MID)
    assert b is not None
    assert b["schema"] == "sqr-match-1"
    assert b["server_id"] == "eu1"
    assert b["match"]["match_id"] == MID
    assert b["match"]["team1_tickets"] == 196
    assert len(b["players"]) == 2
    assert {p["name"] for p in b["players"]} == {"Alice", "Bob"}
    assert len(b["kills"]) == 1
    assert isinstance(b["vehicles"], list) and isinstance(b["elo"], list)


def test_build_match_bundle_unknown_match(tmp_path):
    db = _make_db(tmp_path)
    assert ic.build_match_bundle(db, "no-such-match") is None


def test_bundle_seals_and_opens(tmp_path):
    # The bundle survives a full seal → open round trip (JSON-safe).
    db = _make_db(tmp_path)
    b = ic.build_match_bundle(db, MID)
    secret = bytes(range(32))
    env = seal_json(b, secret=secret, agent_id="eu1", seq=1)
    assert json.loads(open_envelope(env, secret=secret)) == b


def _write_replay(recordings, name, match_id, in_progress):
    recordings.mkdir(parents=True, exist_ok=True)
    (recordings / f"{name}.sqrx").write_bytes(b"\x00fake zstd\x00")
    (recordings / f"{name}.meta.json").write_text(
        json.dumps({"matchId": match_id, "inProgress": in_progress}),
        encoding="utf-8")


def test_find_replay_requires_finalized(tmp_path):
    rec = tmp_path / "recordings"
    _write_replay(rec, "77aabbcc", MID, in_progress=True)
    assert ic._find_replay(rec, MID) is None          # still open
    _write_replay(rec, "77aabbcc", MID, in_progress=False)
    assert ic._find_replay(rec, MID).name == "77aabbcc.sqrx"
    assert ic._find_replay(rec, "other-id") is None    # no sidecar match


def test_flush_backlog_pushes_stats_and_replay(tmp_path, monkeypatch):
    db = _make_db(tmp_path)
    rec = tmp_path / "recordings"
    _write_replay(rec, "aa", MID, in_progress=False)
    backlog = tmp_path / "queue"
    creds = {"SQREADER_AGENT_ID": "eu1",
             "SQREADER_AGENT_SECRET_HEX": "ab" * 32,
             "SQREADER_PUSH_URL": "https://c.example"}
    calls = {"match": [], "replay": []}
    monkeypatch.setattr(ic, "push_match",
                        lambda c, b, **k: calls["match"].append(b["match"]["match_id"]))
    monkeypatch.setattr(ic, "push_replay",
                        lambda c, mid, sid, path, **k: calls["replay"].append((mid, sid)))

    ic.enqueue(backlog, MID)
    res = ic.flush_backlog(backlog, db, rec, creds)

    assert res == {"sent": 1, "pending": 0, "errors": 0}
    assert calls["match"] == [MID]
    assert calls["replay"] == [(MID, "eu1")]
    assert list(backlog.glob("*.json")) == []          # marker consumed


def test_flush_backlog_waits_for_replay_close(tmp_path, monkeypatch):
    db = _make_db(tmp_path)
    rec = tmp_path / "recordings"
    _write_replay(rec, "aa", MID, in_progress=True)     # still recording
    backlog = tmp_path / "queue"
    creds = {"SQREADER_AGENT_ID": "eu1",
             "SQREADER_AGENT_SECRET_HEX": "ab" * 32,
             "SQREADER_PUSH_URL": "https://c.example"}
    monkeypatch.setattr(ic, "push_match", lambda *a, **k: None)
    monkeypatch.setattr(ic, "push_replay",
                        lambda *a, **k: pytest.fail("replay pushed too early"))

    ic.enqueue(backlog, MID)
    res = ic.flush_backlog(backlog, db, rec, creds)

    assert res["pending"] == 1                          # replay deferred
    state = json.loads(next(backlog.glob("*.json")).read_text())
    assert state["stats_done"] is True and state["replay_done"] is False


def test_flush_backlog_keeps_marker_when_central_down(tmp_path, monkeypatch):
    db = _make_db(tmp_path)
    backlog = tmp_path / "queue"
    creds = {"SQREADER_AGENT_ID": "eu1", "SQREADER_AGENT_SECRET_HEX": "ab" * 32,
             "SQREADER_PUSH_URL": "https://c.example"}

    def boom(*a, **k):
        raise ic.PushError("central unreachable")
    monkeypatch.setattr(ic, "push_match", boom)

    ic.enqueue(backlog, MID)
    res = ic.flush_backlog(backlog, db, None, creds, push_replay_files=False)

    assert res["errors"] == 1
    state = json.loads(next(backlog.glob("*.json")).read_text())
    assert state["stats_done"] is False                 # not lost — retried later


def test_stats_only_flush_ignores_replay(tmp_path, monkeypatch):
    db = _make_db(tmp_path)
    backlog = tmp_path / "queue"
    creds = {"SQREADER_AGENT_ID": "eu1", "SQREADER_AGENT_SECRET_HEX": "ab" * 32,
             "SQREADER_PUSH_URL": "https://c.example"}
    monkeypatch.setattr(ic, "push_match", lambda *a, **k: None)
    ic.enqueue(backlog, MID)
    res = ic.flush_backlog(backlog, db, None, creds, push_replay_files=False)
    assert res == {"sent": 1, "pending": 0, "errors": 0}


def test_next_seq_is_monotonic_and_persistent(tmp_path):
    d = tmp_path
    assert ic._next_seq(d) == 1
    assert ic._next_seq(d) == 2
    assert ic._next_seq(d) == 3
