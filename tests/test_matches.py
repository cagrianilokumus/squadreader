"""Match browser: list_matches + match_detail. Pure SQL over existing data."""
from __future__ import annotations

from datetime import datetime

from sqreader.stats import StatsStore, list_matches, match_detail


def _at(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


def _snap(match_id, ts, players, state="InProgress", t_tickets=(300, 100),
          map_name="Yehorivka"):
    return {
        "timestamp": ts, "tick": 1,
        "gameState": {"matchState": state, "matchId": match_id,
                      "mapName": map_name,
                      "layer": {"name": f"{map_name} AAS v1"},
                      "gameModeName": "AAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": t_tickets[0]},
                  {"id": 2, "factionId": "RUS", "tickets": t_tickets[1]}],
        "players": players, "damageEvents": [],
    }


def _p(eos, name, team, **stats):
    return {"eosId": eos, "name": name, "teamId": team, "soldier": None,
            "stats": stats}


def _play(store, mid, players, start, end, **kw):
    store.record_tick(_snap(mid, start, players, **kw))
    store.record_tick(_snap(mid, end, players, state="WaitingPostMatch", **kw))


# --------------------------------------------------------------------------
# list_matches
# --------------------------------------------------------------------------

def test_list_matches_newest_first_with_player_count(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    _play(store, "old", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1), _p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "B", 2)],
          "2026-07-11T10:00:00+00:00", "2026-07-11T11:00:00+00:00")
    _play(store, "new", [_p("cccccccc-cccc-cccc-cccc-cccccccccccc", "C", 1)],
          "2026-07-14T10:00:00+00:00", "2026-07-14T11:00:00+00:00")
    store.close()

    rows = list_matches(db)
    assert [r["match_id"] for r in rows] == ["new", "old"]   # newest first
    assert rows[0]["players"] == 1
    assert rows[1]["players"] == 2
    assert rows[1]["winner_team"] == 1     # 300 > 100 tickets


def test_list_matches_period_filter(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    _play(store, "june", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1)],
          "2026-06-01T10:00:00+00:00", "2026-06-01T11:00:00+00:00")
    _play(store, "today", [_p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "B", 1)],
          "2026-07-15T10:00:00+00:00", "2026-07-15T11:00:00+00:00")
    store.close()

    now = _at("2026-07-15T12:00:00+00:00")
    ids = [r["match_id"] for r in list_matches(db, 50, "daily", now)]
    assert ids == ["today"]      # June match out of the daily window


# --------------------------------------------------------------------------
# match_detail
# --------------------------------------------------------------------------

def test_match_detail_groups_players_by_team(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    _play(store, "m1", [
        _p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, kills=10),
        _p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 2, kills=3),
        _p("cccccccc-cccc-cccc-cccc-cccccccccccc", "Carol", 1, kills=5),
    ], "2026-07-15T10:00:00+00:00", "2026-07-15T11:00:00+00:00")
    store.close()

    md = match_detail(db, "m1")
    assert md is not None
    assert md["map_name"] == "Yehorivka"
    assert md["winner_team"] == 1
    assert len(md["players"]) == 3
    # Ordered by team, then score desc — team 1 first.
    teams = [p["team_id"] for p in md["players"]]
    assert teams == sorted(teams)


def test_match_detail_carries_collector_columns(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    _play(store, "m1", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, kills=5, captures=3,
                           fobsBuilt=2)],
          "2026-07-15T10:00:00+00:00", "2026-07-15T11:00:00+00:00")
    store.close()

    md = match_detail(db, "m1")
    row = md["players"][0]
    assert row["captures"] == 3
    assert row["fobs_built"] == 2


def test_match_detail_unknown_is_none(tmp_path):
    db = tmp_path / "s.db"
    StatsStore(db, server_id="t").close()
    assert match_detail(db, "nope") is None
