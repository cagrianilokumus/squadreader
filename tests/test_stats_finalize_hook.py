"""The post-commit `on_finalize` hook that drives the central push. Verifies it
fires with the right match_id, only after a match actually finalizes, and never
breaks stats recording when the hook raises."""
import sqlite3

from sqreader.stats import StatsStore

EOS = "11111111-1111-1111-1111-111111111111"


def _player(eos, name, team, kills=0):
    return {"eosId": eos, "name": name, "teamId": team, "soldier": None,
            "stats": {"kills": kills, "deaths": 0}}


def _snap(players, *, match_id="m1", tick=1, state="InProgress"):
    return {
        "timestamp": "2026-07-15T12:00:00+00:00",
        "tick": tick,
        "gameState": {"matchState": state, "matchId": match_id,
                      "mapName": "Yehorivka", "layer": {"name": "Yeho_RAAS_v1"},
                      "gameModeName": "RAAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                  {"id": 2, "factionId": "RUS", "tickets": 280}],
        "players": players,
        "damageEvents": [],
    }


def _status(db, match_id):
    conn = sqlite3.connect(str(db))
    try:
        row = conn.execute("SELECT status FROM matches WHERE match_id=?",
                           (match_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def test_hook_fires_when_match_ends(tmp_path):
    fired: list[str] = []
    store = StatsStore(tmp_path / "s.db", server_id="eu1",
                       on_finalize=fired.append)
    store.record_tick(_snap([_player(EOS, "A", 1, kills=3)], match_id="M1"))
    assert fired == []                                   # still in progress
    store.record_tick(_snap([], match_id="M1", state="WaitingPostMatch"))
    assert fired == ["M1"]                               # finalized → fired


def test_hook_fires_on_matchid_change(tmp_path):
    fired: list[str] = []
    store = StatsStore(tmp_path / "s.db", server_id="eu1",
                       on_finalize=fired.append)
    store.record_tick(_snap([_player(EOS, "A", 1)], match_id="M1"))
    store.record_tick(_snap([_player(EOS, "A", 1)], match_id="M2"))
    assert fired == ["M1"]                               # old match finalized


def test_finalize_open_match_fires_hook(tmp_path):
    fired: list[str] = []
    store = StatsStore(tmp_path / "s.db", server_id="eu1",
                       on_finalize=fired.append)
    store.record_tick(_snap([_player(EOS, "A", 1)], match_id="M9"))
    store.finalize_open_match(reason="shutdown")
    assert fired == ["M9"]


def test_no_hook_is_a_noop(tmp_path):
    store = StatsStore(tmp_path / "s.db", server_id="eu1")  # on_finalize=None
    store.record_tick(_snap([_player(EOS, "A", 1)], match_id="M1"))
    store.record_tick(_snap([], match_id="M1", state="WaitingPostMatch"))
    assert _status(tmp_path / "s.db", "M1") == "final"


def test_raising_hook_never_breaks_recording(tmp_path):
    def boom(_mid):
        raise RuntimeError("hook down")
    store = StatsStore(tmp_path / "s.db", server_id="eu1", on_finalize=boom)
    store.record_tick(_snap([_player(EOS, "A", 1)], match_id="M1"))
    store.record_tick(_snap([], match_id="M1", state="WaitingPostMatch"))
    assert _status(tmp_path / "s.db", "M1") == "final"   # match still recorded
