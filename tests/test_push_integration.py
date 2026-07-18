"""End-to-end (offline) push path: a match recorded through StatsStore →
finalize hook → backlog → flush → sealed envelope. Proves the agent's output is
exactly what a central, decrypting with the shared secret, will store. No
network — the HTTP send is captured."""
import json

from sqreader import ingest_client as ic
from sqreader.crypto_envelope import open_envelope
from sqreader.stats import StatsStore

SECRET_HEX = "ab" * 32
EOS = "11111111-1111-1111-1111-111111111111"


def _player(kills):
    return {"eosId": EOS, "name": "Alice", "teamId": 1, "soldier": None,
            "stats": {"kills": kills, "deaths": 0}}


def _snap(match_id, state, players):
    return {
        "timestamp": "2026-07-15T12:00:00+00:00", "tick": 1,
        "gameState": {"matchState": state, "matchId": match_id,
                      "mapName": "Chora", "layer": {"name": "Chora_AAS_v3"},
                      "gameModeName": "AAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": 196},
                  {"id": 2, "factionId": "RUS", "tickets": 0}],
        "players": players, "damageEvents": [],
    }


def test_recorded_match_pushes_a_bundle_the_central_can_open(tmp_path, monkeypatch):
    db = tmp_path / "stats" / "s.db"
    backlog = tmp_path / "queue"
    creds = {"SQREADER_AGENT_ID": "eu1",
             "SQREADER_AGENT_SECRET_HEX": SECRET_HEX,
             "SQREADER_PUSH_URL": "https://central.example"}

    # Capture the HTTP POST instead of sending it.
    captured: dict = {}

    def fake_send(req, *, timeout):
        captured["url"] = req.full_url
        captured["body"] = req.data
        return b"{}"
    monkeypatch.setattr(ic, "_send", fake_send)

    # A full match, recorded exactly as the live serve loop would, with the
    # finalize hook wired to the backlog.
    store = StatsStore(db, server_id="eu1",
                       on_finalize=lambda mid: ic.enqueue(backlog, mid))
    store.record_tick(_snap("M1", "InProgress", [_player(20)]))
    store.record_tick(_snap("M1", "WaitingPostMatch", []))   # → finalize → enqueue
    store.close()
    assert list(backlog.glob("*.json"))                      # queued

    # Flush → builds the bundle, seals it, "sends" it (captured). Stats-only.
    res = ic.flush_backlog(backlog, db, None, creds, push_replay_files=False)
    assert res == {"sent": 1, "pending": 0, "errors": 0}
    assert not list(backlog.glob("*.json"))                  # marker consumed
    assert captured["url"] == "https://central.example/ingest/match"

    # The central side: decrypt the captured envelope with the shared secret.
    env = json.loads(captured["body"])
    payload = json.loads(open_envelope(env, secret=bytes.fromhex(SECRET_HEX)))
    assert payload["schema"] == "sqr-match-1"
    assert payload["server_id"] == "eu1"
    assert payload["match"]["match_id"] == "M1"
    assert payload["match"]["team1_tickets"] == 196
    assert payload["match"]["status"] == "final"
    assert any(p["name"] == "Alice" and p["kills"] == 20
               for p in payload["players"])


def test_wrong_secret_cannot_open_the_push(tmp_path, monkeypatch):
    # A central that isn't the enrolled one (wrong secret) can't read the match.
    db = tmp_path / "stats" / "s.db"
    backlog = tmp_path / "queue"
    creds = {"SQREADER_AGENT_ID": "eu1",
             "SQREADER_AGENT_SECRET_HEX": SECRET_HEX,
             "SQREADER_PUSH_URL": "https://central.example"}
    captured: dict = {}
    monkeypatch.setattr(ic, "_send",
                        lambda req, *, timeout: captured.update(body=req.data) or b"{}")
    store = StatsStore(db, server_id="eu1",
                       on_finalize=lambda mid: ic.enqueue(backlog, mid))
    store.record_tick(_snap("M1", "InProgress", [_player(5)]))
    store.record_tick(_snap("M1", "WaitingPostMatch", []))
    store.close()
    ic.flush_backlog(backlog, db, None, creds, push_replay_files=False)

    import pytest
    from sqreader.crypto_envelope import EnvelopeError
    env = json.loads(captured["body"])
    with pytest.raises(EnvelopeError):
        open_envelope(env, secret=b"\x00" * 32)
