"""ELO: tier bands, delta maths, idempotency, and the chronological recalc."""
from __future__ import annotations

import sqlite3

import pytest

from sqreader.elo import (
    ELO_MATCH_CAP,
    ELO_TIERS,
    STARTING_ELO,
    calc_match_elo_changes,
    elo_tier_for,
    performance_score,
    recalc_all_elo,
)
from sqreader.stats import StatsStore


# --------------------------------------------------------------------------
# tiers
# --------------------------------------------------------------------------

def test_bottom_and_top_tiers():
    assert elo_tier_for(0)[1] == "Iron"
    assert elo_tier_for(-50)[1] == "Iron"        # below the table, still Iron
    assert elo_tier_for(2500)[1] == "Elite"


def test_top_tier_has_no_next_and_is_full_progress():
    _tier, _label, _color, next_at, progress = elo_tier_for(2400)
    assert next_at is None
    assert progress == 1.0


def test_band_edges_land_on_the_new_tier():
    for min_rating, _num, label, _color in ELO_TIERS:
        assert elo_tier_for(min_rating)[1] == label
        if min_rating > 0:
            # One below the floor must still be the tier underneath.
            assert elo_tier_for(min_rating - 1)[1] != label


def test_progress_is_a_fraction_of_the_current_band():
    # Silver starts at 950, Gold I at 1050 → 1000 is halfway.
    _t, label, _c, next_at, progress = elo_tier_for(1000)
    assert label == "Silver"
    assert next_at == 1050
    assert progress == pytest.approx(0.5)


# --------------------------------------------------------------------------
# performance score
# --------------------------------------------------------------------------

def test_performance_score_is_never_negative():
    # Nothing but deaths and teamkills — the penalties would take it below zero.
    assert performance_score(
        {"playtime_sec": 1800, "deaths": 50, "team_kills": 10}) == 0.0


def test_performance_score_missing_columns_are_zero_not_errors():
    assert performance_score({}) >= 0.0
    assert performance_score({"kills": None, "playtime_sec": None}) >= 0.0


def test_more_kills_scores_higher_all_else_equal():
    base = {"playtime_sec": 1800, "deaths": 5}
    assert (performance_score(dict(base, kills=20))
            > performance_score(dict(base, kills=5)))


def test_teamkills_hurt_more_than_deaths():
    base = {"playtime_sec": 1800, "kills": 20}
    assert (performance_score(dict(base, team_kills=1))
            < performance_score(dict(base, deaths=1)))


# --------------------------------------------------------------------------
# delta maths
# --------------------------------------------------------------------------

def _p(eos, team, perf, won, elo=STARTING_ELO, played=0):
    return {"eos_id": eos, "team_id": team, "perf_score": perf,
            "was_winner": won, "elo": elo, "matches_played": played}


def test_no_players_no_changes():
    assert calc_match_elo_changes([]) == {}


def test_winner_gains_and_loser_loses_at_equal_ratings():
    players = [_p("w", 1, 10.0, True), _p("l", 2, 5.0, False)]
    d = calc_match_elo_changes(players)
    assert d["w"] > 0
    assert d["l"] < 0


def test_a_draw_between_equals_moves_nobody_much():
    players = [_p("a", 1, 5.0, None), _p("b", 2, 5.0, None)]
    d = calc_match_elo_changes(players)
    # Equal ratings, equal teams, draw: any movement comes from the performance
    # percentile alone, which is symmetric here.
    assert abs(d["a"]) <= 1 and abs(d["b"]) <= 1


def test_identical_performances_get_identical_deltas():
    """Tied players must not be split by their position in the list.

    performance_score floors at 0.0, so everyone who idled shares that exact
    score. Ranking them by list order would hand one of them the top percentile
    and another the bottom, for doing the same nothing.
    """
    players = [_p(f"idle{i}", 1, 0.0, False) for i in range(4)]
    players += [_p(f"idle{i}", 2, 0.0, False) for i in range(4, 8)]
    d = calc_match_elo_changes(players)
    team1 = {d[f"idle{i}"] for i in range(4)}
    assert len(team1) == 1, f"tied players got different deltas: {d}"


def test_delta_is_capped_both_ways():
    # A 2000-rated player beating a lobby of 1s, and vice versa.
    strong = [_p("s", 1, 100.0, True, elo=2000)]
    strong += [_p(f"w{i}", 2, 0.0, False, elo=1) for i in range(5)]
    d = calc_match_elo_changes(strong)
    assert all(abs(v) <= ELO_MATCH_CAP for v in d.values())


def test_carrying_a_loss_beats_coasting_to_one():
    """The result is only half the score — how you played is the other half."""
    players = [
        _p("carry", 2, 100.0, False),      # top performer, still lost
        _p("coast", 2, 0.0, False),        # bottom performer, also lost
        _p("winner", 1, 50.0, True),
    ]
    d = calc_match_elo_changes(players)
    assert d["carry"] > d["coast"]


def test_new_players_move_faster_than_veterans():
    """K is 32 for the first 100 matches, 16 after."""
    rookie = calc_match_elo_changes([
        _p("r", 1, 100.0, True, played=0),
        _p("x", 2, 0.0, False, played=0)])["r"]
    veteran = calc_match_elo_changes([
        _p("v", 1, 100.0, True, played=500),
        _p("x", 2, 0.0, False, played=500)])["v"]
    assert rookie > veteran


# --------------------------------------------------------------------------
# persistence, via StatsStore
# --------------------------------------------------------------------------

def _match_snap(match_id, ts, players, *, state="InProgress",
                t1_tickets=300, t2_tickets=100):
    return {
        "timestamp": ts, "tick": 1,
        "gameState": {"matchState": state, "matchId": match_id,
                      "mapName": "Yehorivka",
                      "layer": {"name": "Yehorivka_RAAS_v1"},
                      "gameModeName": "RAAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": t1_tickets},
                  {"id": 2, "factionId": "RUS", "tickets": t2_tickets}],
        "players": players, "damageEvents": [],
    }


def _roster(n=8, kills_team1=10, kills_team2=1):
    """n players, split evenly across two teams."""
    out = []
    for i in range(n):
        team = 1 if i < n // 2 else 2
        out.append({
            "eosId": f"{i:08d}-0000-0000-0000-000000000000", "name": f"P{i}", "teamId": team,
            "soldier": None,
            "stats": {"kills": kills_team1 if team == 1 else kills_team2,
                      "deaths": 2},
        })
    return out


def _store(db, **kw):
    """Thresholds lowered so a test match is ratable without 40 real players."""
    return StatsStore(db, server_id="t", elo_min_players=4,
                      elo_min_duration=0, elo_min_playtime=0, **kw)


def _rows(db, sql, params=()):
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params)]
    finally:
        conn.close()


def _play_match(store, match_id, roster, start="2026-07-15T10:00:00+00:00",
                end="2026-07-15T11:00:00+00:00"):
    store.record_tick(_match_snap(match_id, start, roster))
    store.record_tick(_match_snap(match_id, end, roster, state="WaitingPostMatch"))


def test_finished_match_rates_its_players(tmp_path):
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    store.close()

    elos = _rows(db, "SELECT * FROM player_elo ORDER BY eos_id")
    assert len(elos) == 8
    assert all(r["matches_played"] == 1 for r in elos)
    # Team 1 won on tickets (300 v 100) and out-fragged team 2.
    t1 = [r for r in elos if int(r["eos_id"].split("-")[0]) < 4]
    t2 = [r for r in elos if int(r["eos_id"].split("-")[0]) >= 4]
    assert all(r["elo_rating"] > STARTING_ELO for r in t1)
    assert all(r["elo_rating"] < STARTING_ELO for r in t2)


def test_every_rated_player_gets_an_elo_change_row(tmp_path):
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    store.close()

    pm = _rows(db, "SELECT eos_id, elo_change FROM player_matches")
    assert len(pm) == 8
    assert all(r["elo_change"] is not None for r in pm)


def test_a_match_below_the_thresholds_is_not_rated(tmp_path):
    db = tmp_path / "s.db"
    # Default-ish gate: 40 players required, this match has 8.
    store = StatsStore(db, server_id="t", elo_min_players=40,
                       elo_min_duration=0, elo_min_playtime=0)
    _play_match(store, "m1", _roster())
    store.close()

    assert _rows(db, "SELECT COUNT(*) c FROM player_elo")[0]["c"] == 0
    pm = _rows(db, "SELECT elo_change FROM player_matches")
    assert all(r["elo_change"] is None for r in pm)   # NULL = "not rated"


def test_elo_disabled_writes_nothing(tmp_path):
    db = tmp_path / "s.db"
    store = _store(db, elo=False)
    _play_match(store, "m1", _roster())
    store.close()
    assert _rows(db, "SELECT COUNT(*) c FROM player_elo")[0]["c"] == 0


def test_finalizing_the_same_match_twice_does_not_double_count(tmp_path):
    """ELO is not reversible — applying a match twice would inflate it."""
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    after_first = _rows(db, "SELECT eos_id, elo_rating, matches_played "
                            "FROM player_elo ORDER BY eos_id")

    # Drive the finalize path again on the same, already-final match.
    store.finalize_open_match(reason="test re-finalize")
    store.record_tick(_match_snap("m1", "2026-07-15T11:05:00+00:00",
                                  _roster(), state="WaitingPostMatch"))
    store.close()

    after_second = _rows(db, "SELECT eos_id, elo_rating, matches_played "
                             "FROM player_elo ORDER BY eos_id")
    assert after_first == after_second


def test_a_players_second_match_starts_from_the_rating_they_earned(tmp_path):
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    first = _rows(db, "SELECT elo_rating FROM player_elo WHERE eos_id='00000000-0000-0000-0000-000000000000'"
                  )[0]["elo_rating"]
    _play_match(store, "m2", _roster(),
                start="2026-07-15T12:00:00+00:00",
                end="2026-07-15T13:00:00+00:00")
    store.close()

    row = _rows(db, "SELECT elo_rating, matches_played FROM player_elo "
                    "WHERE eos_id='00000000-0000-0000-0000-000000000000'")[0]
    assert row["matches_played"] == 2
    assert row["elo_rating"] != first     # it moved again, from the new base


# --------------------------------------------------------------------------
# recalc
# --------------------------------------------------------------------------

def test_recalc_reproduces_the_live_result(tmp_path):
    """The chronological replay and the live path must agree — otherwise every
    recalc would silently rewrite everyone's rating."""
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    _play_match(store, "m2", _roster(),
                start="2026-07-15T12:00:00+00:00",
                end="2026-07-15T13:00:00+00:00")
    store.close()

    live = _rows(db, "SELECT eos_id, elo_rating, matches_played "
                     "FROM player_elo ORDER BY eos_id")

    out = recalc_all_elo(db, min_players=4, min_duration=0, min_playtime=0)
    assert out["matchesRated"] == 2
    assert out["playersRated"] == 8

    replayed = _rows(db, "SELECT eos_id, elo_rating, matches_played "
                         "FROM player_elo ORDER BY eos_id")
    assert replayed == live


def test_recalc_is_stable_when_run_twice(tmp_path):
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    store.close()

    recalc_all_elo(db, min_players=4, min_duration=0, min_playtime=0)
    once = _rows(db, "SELECT eos_id, elo_rating FROM player_elo ORDER BY eos_id")
    recalc_all_elo(db, min_players=4, min_duration=0, min_playtime=0)
    twice = _rows(db, "SELECT eos_id, elo_rating FROM player_elo ORDER BY eos_id")
    assert once == twice


def test_recalc_reports_the_distribution(tmp_path):
    db = tmp_path / "s.db"
    store = _store(db)
    _play_match(store, "m1", _roster())
    store.close()

    out = recalc_all_elo(db, min_players=4, min_duration=0, min_playtime=0)
    assert out["minElo"] <= out["medianElo"] <= out["maxElo"]
    # A single balanced match should not fling anyone across the map.
    assert abs(out["maxElo"] - STARTING_ELO) <= ELO_MATCH_CAP
