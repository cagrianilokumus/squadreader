"""Phase-9 derived analytics: role normalization, squadmates, per-faction,
per-map records, activity grid. Pure SQL over existing columns."""
from __future__ import annotations

import sqlite3

from sqreader.stats import (
    StatsStore,
    _longest_infantry_kill,
    normalize_role,
    player_profile,
)


# --------------------------------------------------------------------------
# role normalization (pure)
# --------------------------------------------------------------------------

def test_role_strips_faction_prefix_and_variant():
    assert normalize_role("AFU_SLCrewman_01") == "SLCrewman"
    assert normalize_role("USA_SLCrewman_01") == "SLCrewman"
    assert normalize_role("RGF_Medic_02") == "Medic"


def test_role_without_prefix_or_suffix_survives():
    assert normalize_role("Rifleman") == "Rifleman"


def test_role_empty_is_none():
    assert normalize_role(None) is None
    assert normalize_role("") is None


def test_two_factions_same_kit_collapse():
    assert normalize_role("USA_Rifleman_01") == normalize_role("RGF_Rifleman_03")


# --------------------------------------------------------------------------
# profile analytics, driven through a real StatsStore
# --------------------------------------------------------------------------

def _snap(match_id, ts, players, winner_tickets=(300, 100), state="InProgress",
          map_name="Yehorivka"):
    return {
        "timestamp": ts, "tick": 1,
        "gameState": {"matchState": state, "matchId": match_id,
                      "mapName": map_name,
                      "layer": {"name": f"{map_name} AAS v1"},
                      "gameModeName": "AAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": winner_tickets[0]},
                  {"id": 2, "factionId": "RUS", "tickets": winner_tickets[1]}],
        "players": players, "damageEvents": [],
    }


def _p(eos, name, team, *, role=None, squad=None, faction=None, kills=0, deaths=0):
    return {"eosId": eos, "name": name, "teamId": team, "soldier": None,
            "roleId": role, "squadName": squad,
            "stats": {"kills": kills, "deaths": deaths}}


def _play(store, mid, players, start, end, **kw):
    store.record_tick(_snap(mid, start, players, **kw))
    store.record_tick(_snap(mid, end, players, state="WaitingPostMatch", **kw))


def test_most_played_role_normalizes_across_factions(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Same kit, two factions, three matches → should collapse to SLCrewman.
    _play(store, "m1", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, role="USA_SLCrewman_01")],
          "2026-07-11T10:00:00+00:00", "2026-07-11T11:00:00+00:00")
    _play(store, "m2", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, role="RGF_SLCrewman_01")],
          "2026-07-12T10:00:00+00:00", "2026-07-12T11:00:00+00:00")
    _play(store, "m3", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, role="USA_Medic_01")],
          "2026-07-13T10:00:00+00:00", "2026-07-13T11:00:00+00:00")
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    assert prof["mostPlayedRole"] == {"role": "SLCrewman", "matches": 2}


def test_squadmates_counts_shared_squad(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Alice + Bob share squad "Able" twice; Carol is on the enemy team's "Able".
    for i, (start, end) in enumerate([
            ("2026-07-11T10:00:00+00:00", "2026-07-11T11:00:00+00:00"),
            ("2026-07-12T10:00:00+00:00", "2026-07-12T11:00:00+00:00")]):
        _play(store, f"m{i}", [
            _p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, squad="Able"),
            _p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 1, squad="Able"),
            _p("cccccccc-cccc-cccc-cccc-cccccccccccc", "Carol", 2, squad="Able"),   # same name, other team
        ], start, end)
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    mates = {m["eos"]: m["c"] for m in prof["squadmates"]}
    assert mates == {"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb": 2}         # Carol excluded by the team join


def test_per_faction_record(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Team 1 (USA) wins on tickets both times.
    _play(store, "m1", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, faction="USA", kills=10, deaths=2)],
          "2026-07-11T10:00:00+00:00", "2026-07-11T11:00:00+00:00")
    _play(store, "m2", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 2, faction="RUS", kills=3, deaths=8)],
          "2026-07-12T10:00:00+00:00", "2026-07-12T11:00:00+00:00")
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    byf = {f["faction"]: f for f in prof["factions"]}
    assert byf["USA"]["wins"] == 1 and byf["USA"]["matches"] == 1
    assert byf["RUS"]["wins"] == 0        # played the losing side
    assert byf["USA"]["kills"] == 10


def test_map_records_need_two_matches(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    _play(store, "m1", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, kills=5)],
          "2026-07-11T10:00:00+00:00", "2026-07-11T11:00:00+00:00",
          map_name="Yehorivka")
    _play(store, "m2", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, kills=5)],
          "2026-07-12T10:00:00+00:00", "2026-07-12T11:00:00+00:00",
          map_name="Yehorivka")
    _play(store, "m3", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, kills=5)],
          "2026-07-13T10:00:00+00:00", "2026-07-13T11:00:00+00:00",
          map_name="Narva")   # only one → excluded by HAVING >= 2
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    maps = {m["map_name"]: m for m in prof["mapRecords"]}
    assert set(maps) == {"Yehorivka"}
    assert maps["Yehorivka"]["matches"] == 2
    assert maps["Yehorivka"]["wins"] == 2


# --------------------------------------------------------------------------
# profile extras (Phase 12)
# --------------------------------------------------------------------------

def _kill_snap(match_id, ts, attacker, victim, weapon, ax, vx):
    """One positioned kill: attacker at (ax,0), victim at (vx,0)."""
    def pl(eos, name, x):
        return {"eosId": eos, "name": name, "teamId": 1 if eos == "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" else 2,
                "soldier": {"addr": "0x1", "position": {"x": x, "y": 0.0, "z": 0.0}},
                "stats": {"kills": 0}}
    return {
        "timestamp": ts, "tick": 1,
        "gameState": {"matchState": "InProgress", "matchId": match_id,
                      "mapName": "Yehorivka",
                      "layer": {"name": "Yehorivka AAS v1"}, "gameModeName": "AAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                  {"id": 2, "factionId": "RUS", "tickets": 100}],
        "players": [pl("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", attacker, ax), pl("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", victim, vx)],
        "damageEvents": [{"attacker": attacker, "victim": victim,
                          "causerWeapon": weapon, "killed": 1, "ts": 1.0,
                          "attackerEosId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}],
    }


def test_longest_infantry_kill_excludes_vehicle_weapons(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # A 200 m rifle kill and a 500 m tank-coax kill. Infantry-longest = 200.
    store.record_tick(_kill_snap("m1", "2026-07-15T10:00:00+00:00",
                                 "Alice", "Bob", "BP_M4A1", 0.0, 20000.0))
    store.record_tick(_kill_snap("m1", "2026-07-15T10:00:02+00:00",
                                 "Alice", "Bob", "BP_T72_Coax", 0.0, 50000.0))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    import sqlite3
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        assert _longest_infantry_kill(conn, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") == 200.0
    finally:
        conn.close()


def test_longest_infantry_kill_keeps_40mm_underbarrel(tmp_path):
    """40mm is the infantry grenade launcher (M203), not a vehicle calibre."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_kill_snap("m1", "2026-07-15T10:00:00+00:00",
                                 "Alice", "Bob", "BP_M203_40mm", 0.0, 15000.0))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()
    import sqlite3
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        assert _longest_infantry_kill(conn, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa") == 150.0
    finally:
        conn.close()


def test_best_match_and_period_breakdown(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # A big recent match and a small old one.
    _play(store, "big", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, kills=30, deaths=2)],
          "2026-07-15T10:00:00+00:00", "2026-07-15T11:00:00+00:00")
    _play(store, "small", [_p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "A", 1, kills=4, deaths=9)],
          "2026-06-01T10:00:00+00:00", "2026-06-01T11:00:00+00:00")
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    assert prof["bestMatch"]["byKills"]["value"] == 30
    assert prof["bestMatch"]["byKills"]["map_name"] == "Yehorivka"
    pb = prof["periodBreakdown"]
    # All-time counts both; the specific windows depend on the real clock, so
    # assert the structure + the all-time totals rather than a wall-clock bucket.
    assert pb["alltime"]["kills"] == 34
    assert pb["alltime"]["matches"] == 2
    assert set(pb) == {"weekly", "monthly", "alltime"}


# --------------------------------------------------------------------------
# vehicle sessions
# --------------------------------------------------------------------------

def _vsnap(match_id, ts, vehicles, state="InProgress"):
    return {
        "timestamp": ts, "tick": 1,
        "gameState": {"matchState": state, "matchId": match_id,
                      "mapName": "Yehorivka",
                      "layer": {"name": "Yehorivka AAS v1"},
                      "gameModeName": "AAS"},
        "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                  {"id": 2, "factionId": "RUS", "tickets": 100}],
        # A player must exist for the match to open; the driver is one.
        "players": [{"eosId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "name": "Driver", "teamId": 1,
                     "soldier": None, "stats": {"kills": 0}}],
        "vehicles": vehicles, "damageEvents": [],
    }


def _veh(vid, cls, x, seat_eos):
    return {"id": vid, "classShort": cls, "position": {"x": x, "y": 0.0, "z": 0.0},
            "seats": [{"idx": 0, "occupantEosId": seat_eos}]}


def _vrows(db):
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM vehicle_session ORDER BY id")]
    finally:
        conn.close()


def test_a_vehicle_stint_records_time_and_distance(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Enter at x=0 (t=0), move to x=10000cm (t=60) = 100 m, then leave.
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:01:00+00:00",
                             [_veh("v1", "BP_T72", 10000.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:02:00+00:00",
                             [_veh("v1", "BP_T72", 10000.0, None)]))  # left seat
    store.close()

    rows = _vrows(db)
    assert len(rows) == 1
    assert rows[0]["vehicle_class"] == "BP_T72"
    assert rows[0]["distance_m"] == 100.0
    assert rows[0]["exited_at"] - rows[0]["entered_at"] == 60


def test_switching_vehicles_closes_and_reopens(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:01:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    # Now in a different vehicle.
    store.record_tick(_vsnap("m1", "2026-07-15T10:02:00+00:00",
                             [_veh("v2", "BP_BMP2", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:03:00+00:00",
                             [_veh("v2", "BP_BMP2", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    # Production contract: the serve loop calls finalize_open_match on shutdown
    # (cli.py) before close(); that is what flushes the still-open BMP2 session.
    store.finalize_open_match(reason="test")
    store.close()

    classes = [r["vehicle_class"] for r in _vrows(db)]
    assert classes == ["BP_T72", "BP_BMP2"]


def test_teleport_distance_is_not_banked(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    # A 5 km jump in one tick — a respawn/teleport, must not count as travel.
    store.record_tick(_vsnap("m1", "2026-07-15T10:01:00+00:00",
                             [_veh("v1", "BP_T72", 500000.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:02:00+00:00",
                             [_veh("v1", "BP_T72", 500000.0, None)]))
    store.close()

    assert _vrows(db)[0]["distance_m"] == 0.0


def test_match_end_flushes_open_sessions(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:05:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    # Match ends with the player still seated — the session must still be written.
    store.record_tick(_vsnap("m1", "2026-07-15T10:06:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")],
                             state="WaitingPostMatch"))
    store.close()

    rows = _vrows(db)
    assert len(rows) == 1
    assert rows[0]["exited_at"] - rows[0]["entered_at"] == 300


def test_a_one_tick_tap_is_not_recorded(tmp_path):
    """Sitting for a single tick (0 duration) is noise, not a stint."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:30+00:00",
                             [_veh("v1", "BP_T72", 0.0, None)]))  # left same tick span
    store.close()
    # entered==exited (both stamped at the first tick's epoch) → 0 duration.
    assert _vrows(db) == []


def test_vehicles_used_aggregates_in_profile(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_vsnap("m1", "2026-07-15T10:00:00+00:00",
                             [_veh("v1", "BP_T72", 0.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.record_tick(_vsnap("m1", "2026-07-15T10:10:00+00:00",
                             [_veh("v1", "BP_T72", 30000.0, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")]))
    store.finalize_open_match(reason="test")   # flush the open session
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    vu = {v["vehicle_class"]: v for v in prof["vehiclesUsed"]}
    assert vu["BP_T72"]["sessions"] == 1
    assert vu["BP_T72"]["time_s"] == 600
    assert vu["BP_T72"]["distance_m"] == 300.0


def test_activity_grid_buckets_by_dow_and_hour(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Two kills at a known UTC time. 2026-07-15 is a Wednesday (dow=3), 14:00 UTC.
    snap = _snap("m1", "2026-07-15T14:30:00+00:00", [
        _p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1), _p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 2)])
    snap["damageEvents"] = [
        {"attacker": "Alice", "victim": "Bob", "causerWeapon": "W",
         "killed": 1, "ts": 1.0},
        {"attacker": "Alice", "victim": "Bob", "causerWeapon": "W",
         "killed": 1, "ts": 2.0},
    ]
    store.record_tick(snap)
    store.finalize_open_match(reason="test")  # profile reads finished matches only
    store.close()

    prof = player_profile(db, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    # ts 1.0/2.0 are 1970-01-01 00:00 UTC → dow=4 (Thursday), hour=0.
    cells = {(a["dow"], a["hour"]): a["n"] for a in prof["activity"]}
    assert cells == {(4, 0): 2}
