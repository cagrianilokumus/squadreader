"""Period cutoffs and the map-heatmap grid — pure logic, no DB where possible."""
from __future__ import annotations

from datetime import datetime

import pytest

from sqreader.stats import StatsStore, map_heatmap, leaderboard, period_cutoff


def _at(iso: str) -> float:
    return datetime.fromisoformat(iso).timestamp()


# --------------------------------------------------------------------------
# period_cutoff
# --------------------------------------------------------------------------

def test_alltime_has_no_cutoff():
    assert period_cutoff("alltime", _at("2026-07-15T12:00:00+00:00")) is None


def test_unknown_period_falls_back_to_alltime():
    # This feeds a query string: a typo should hand back everything, not a 500.
    assert period_cutoff("yesterday", _at("2026-07-15T12:00:00+00:00")) is None
    assert period_cutoff("", _at("2026-07-15T12:00:00+00:00")) is None


def test_daily_rolls_at_utc_midnight():
    now = _at("2026-07-15T23:59:59+00:00")
    assert period_cutoff("daily", now) == int(_at("2026-07-15T00:00:00+00:00"))


def test_daily_just_after_midnight_uses_the_new_day():
    now = _at("2026-07-16T00:00:01+00:00")
    assert period_cutoff("daily", now) == int(_at("2026-07-16T00:00:00+00:00"))


def test_weekly_starts_on_monday():
    # 2026-07-15 is a Wednesday; the week began Monday the 13th.
    now = _at("2026-07-15T12:00:00+00:00")
    assert period_cutoff("weekly", now) == int(_at("2026-07-13T00:00:00+00:00"))


def test_weekly_on_monday_itself_starts_that_morning():
    now = _at("2026-07-13T00:00:30+00:00")
    assert period_cutoff("weekly", now) == int(_at("2026-07-13T00:00:00+00:00"))


def test_weekly_on_sunday_still_points_back_to_that_monday():
    now = _at("2026-07-19T23:00:00+00:00")   # Sunday
    assert period_cutoff("weekly", now) == int(_at("2026-07-13T00:00:00+00:00"))


def test_monthly_starts_on_the_first():
    now = _at("2026-07-15T12:00:00+00:00")
    assert period_cutoff("monthly", now) == int(_at("2026-07-01T00:00:00+00:00"))


def test_monthly_on_the_first_does_not_reach_into_last_month():
    now = _at("2026-07-01T00:00:10+00:00")
    assert period_cutoff("monthly", now) == int(_at("2026-07-01T00:00:00+00:00"))


def test_cutoffs_are_ordered_daily_weekly_monthly():
    now = _at("2026-07-15T12:00:00+00:00")
    d = period_cutoff("daily", now)
    w = period_cutoff("weekly", now)
    m = period_cutoff("monthly", now)
    assert m <= w <= d <= now


# --------------------------------------------------------------------------
# period filtering end-to-end (leaderboard)
# --------------------------------------------------------------------------

def _snap(match_id, ts, players, events=()):
    return {
        "timestamp": ts, "tick": 1,
        "gameState": {"matchState": "InProgress", "matchId": match_id,
                      "mapName": "Yehorivka",
                      "layer": {"name": "Yehorivka_RAAS_v1"},
                      "gameModeName": "RAAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                  {"id": 2, "factionId": "RUS", "tickets": 280}],
        "players": players, "damageEvents": list(events),
    }


def _p(eos, name, team, kills, x=None, y=None):
    sol = ({"addr": "0x1", "position": {"x": x, "y": y, "z": 0.0}}
           if x is not None else None)
    return {"eosId": eos, "name": name, "teamId": team, "soldier": sol,
            "stats": {"kills": kills}}


def test_leaderboard_period_excludes_older_matches(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # An old match (June) and a recent one (today).
    store.record_tick(_snap("old", "2026-06-01T10:00:00+00:00",
                            [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, kills=50)]))
    store.record_tick(_snap("new", "2026-07-15T10:00:00+00:00",
                            [_p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 2, kills=5)]))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    now = _at("2026-07-15T12:00:00+00:00")

    alltime = {r["last_name"]: r["value"] for r in
               leaderboard(db, "kills", 50, "alltime", now)}
    assert alltime == {"Alice": 50, "Bob": 5}

    daily = {r["last_name"]: r["value"] for r in
             leaderboard(db, "kills", 50, "daily", now)}
    assert daily == {"Bob": 5}          # Alice's June match is out of the window


# --------------------------------------------------------------------------
# map_heatmap grid
# --------------------------------------------------------------------------

def test_grid_buckets_negative_and_positive_coords_symmetrically(tmp_path):
    """CAST-to-INTEGER truncates toward zero, so a naive bucketing would fold
    the two cells either side of an axis into one. These must stay apart."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Two deaths, one either side of x=0, well inside the same cell width.
    store.record_tick(_snap("m1", "2026-07-15T10:00:00+00:00",
                            [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0, x=0.0, y=0.0),
                             _p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 2, 0, x=-2000.0, y=0.0)],
                            [{"attacker": "Alice", "victim": "Bob",
                              "causerWeapon": "W", "killed": 1, "ts": 1.0}]))
    store.record_tick(_snap("m1", "2026-07-15T10:00:02+00:00",
                            [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0, x=0.0, y=0.0),
                             _p("cccccccc-cccc-cccc-cccc-cccccccccccc", "Carol", 2, 0, x=2000.0, y=0.0)],
                            [{"attacker": "Alice", "victim": "Carol",
                              "causerWeapon": "W", "killed": 1, "ts": 2.0}]))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    hm = map_heatmap(db, "Yehorivka_RAAS_v1", "alltime", cell_cm=5000)
    xs = sorted(c["cell_x"] for c in hm["cells"])
    assert len(hm["cells"]) == 2, "the two sides of x=0 collapsed into one cell"
    assert xs == [-5000.0, 0.0]      # floor(-2000/5000)=-1 ; floor(2000/5000)=0
    assert hm["maxCount"] == 1


def test_grid_cell_corner_is_exact_for_any_cell_size(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap("m1", "2026-07-15T10:00:00+00:00",
                            [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0, x=0.0, y=0.0),
                             _p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 2, 0, x=7100.0, y=-100.0)],
                            [{"attacker": "Alice", "victim": "Bob",
                              "causerWeapon": "W", "killed": 1, "ts": 1.0}]))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    # 3000 does not divide the internal shift evenly — the corner must still land
    # on a multiple of the cell size.
    hm = map_heatmap(db, "Yehorivka_RAAS_v1", "alltime", cell_cm=3000)
    cell = hm["cells"][0]
    assert cell["cell_x"] == pytest.approx(6000.0)    # floor(7100/3000)*3000
    assert cell["cell_y"] == pytest.approx(-3000.0)   # floor(-100/3000)*3000


def test_grid_counts_stack_in_one_cell(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    for i, ts in enumerate((1.0, 2.0, 3.0)):
        store.record_tick(_snap("m1", f"2026-07-15T10:00:0{i}+00:00",
                                [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0, x=0.0, y=0.0),
                                 _p(f"{i:08d}-0000-0000-0000-000000000000", f"V{i}", 2, 0,
                                    x=1000.0 + i * 100, y=1000.0)],
                                [{"attacker": "Alice", "victim": f"V{i}",
                                  "causerWeapon": "W", "killed": 1, "ts": ts}]))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    hm = map_heatmap(db, "Yehorivka_RAAS_v1", "alltime", cell_cm=5000)
    assert len(hm["cells"]) == 1
    assert hm["cells"][0]["n"] == 3
    assert hm["maxCount"] == 3


def test_unknown_layer_yields_an_empty_grid_not_an_error(tmp_path):
    db = tmp_path / "s.db"
    StatsStore(db, server_id="t").close()
    hm = map_heatmap(db, "NoSuchLayer_v9")
    assert hm["cells"] == []
    assert hm["maxCount"] == 0
