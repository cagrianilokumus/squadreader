"""StatsStore schema-v2 tests: migrations, kill-event positions, distance.

All pure-logic — a StatsStore on a tmp file, fed synthetic snapshots. No live
process, no Squad server.
"""
from __future__ import annotations

import sqlite3

import pytest

from sqreader.stats import (
    SCHEMA_VERSION,
    StatsStore,
    _DDL,
    apply_migrations,
    match_heatmap,
    weapon_meta,
)


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _player(eos: str, name: str, team: int, *, x=None, y=None, stale=False,
            kills=0, deaths=0, stats=None):
    soldier = None
    if x is not None:
        soldier = {"addr": "0x1", "position": {"x": x, "y": y, "z": 0.0}}
        if stale:
            soldier["stale"] = True
    st = {"kills": kills, "deaths": deaths}
    if stats:
        st.update(stats)
    return {
        "eosId": eos, "name": name, "teamId": team, "soldier": soldier,
        "stats": st,
    }


def _snap(players, events=(), *, match_id="m1", tick=1,
          ts="2026-07-15T12:00:00+00:00", state="InProgress"):
    return {
        "timestamp": ts,
        "tick": tick,
        "gameState": {
            "matchState": state, "matchId": match_id,
            "mapName": "Yehorivka", "layer": {"name": "Yehorivka_RAAS_v1"},
            "gameModeName": "RAAS",
        },
        "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                  {"id": 2, "factionId": "RUS", "tickets": 280}],
        "players": players,
        "damageEvents": list(events),
    }


def _kill(attacker, victim, *, weapon="BP_M4A1", killed=1, wounded=0,
          ts=1000.0, attacker_eos=None):
    return {
        "attacker": attacker, "victim": victim, "causerWeapon": weapon,
        "killed": killed, "wounded": wounded, "ts": ts,
        "attackerEosId": attacker_eos,
    }


def _rows(db, sql, params=()):
    conn = sqlite3.connect(str(db))
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params)]
    finally:
        conn.close()


# --------------------------------------------------------------------------
# migrations
# --------------------------------------------------------------------------

def test_fresh_db_lands_on_current_schema_version(tmp_path):
    db = tmp_path / "s.db"
    StatsStore(db, server_id="t").close()
    v = _rows(db, "PRAGMA user_version")[0]["user_version"]
    assert v == SCHEMA_VERSION


def test_legacy_unversioned_db_migrates_without_losing_data(tmp_path):
    """A DB created by a pre-migration sqreader: baseline tables, user_version 0."""
    db = tmp_path / "legacy.db"
    conn = sqlite3.connect(str(db))
    conn.executescript(_DDL)
    conn.execute(
        "INSERT INTO matches (match_id, server_id, started_at, status) "
        "VALUES ('old-match', 'srv', 1000, 'final')")
    conn.execute(
        "INSERT INTO kill_events (match_id, ts, victim_name, attacker_name, "
        " killed, wounded) VALUES ('old-match', 5.0, 'v', 'a', 1, 0)")
    conn.commit()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    conn.close()

    StatsStore(db, server_id="t").close()

    assert _rows(db, "PRAGMA user_version")[0]["user_version"] == SCHEMA_VERSION
    # The pre-existing rows survived, and gained the new columns as NULL.
    old = _rows(db, "SELECT * FROM kill_events WHERE match_id='old-match'")
    assert len(old) == 1
    assert old[0]["victim_x"] is None
    assert old[0]["distance_m"] is None
    assert _rows(db, "SELECT COUNT(*) c FROM matches")[0]["c"] == 1


def test_collector_stats_flow_into_player_matches(tmp_path):
    """The Squad stats-collector counters spliced onto player.stats must land in
    their columns, cumulative-total ones (supplies/vehicle_damage) uncapped."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap([
        _player("11111111-1111-1111-1111-111111111111", "Alice", 1, kills=5, stats={
            "captures": 3, "defenses": 2, "fobsBuilt": 4, "fobsDestroyed": 1,
            "suppliesDelivered": 42000,   # well past the tight _count cap
            "vehicleDamage": 250000.0,    # well past the _score cap
        })]))
    store.close()

    r = _rows(db, "SELECT * FROM player_matches WHERE eos_id='11111111-1111-1111-1111-111111111111'")[0]
    assert r["captures"] == 3
    assert r["defenses"] == 2
    assert r["fobs_built"] == 4
    assert r["fobs_destroyed"] == 1
    assert r["supplies_delivered"] == 42000     # not clipped to 5000
    assert r["vehicle_damage"] == 250000.0      # not clipped to 100000


def test_missing_collector_stats_default_to_zero(tmp_path):
    """A tick with no collector data (early match / Jensen) leaves the columns
    at their 0 default, never NULL-crashing the upsert."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap([_player("11111111-1111-1111-1111-111111111111", "Alice", 1, kills=1)]))
    store.close()
    r = _rows(db, "SELECT * FROM player_matches WHERE eos_id='11111111-1111-1111-1111-111111111111'")[0]
    assert r["captures"] == 0
    assert r["supplies_delivered"] == 0
    assert r["vehicle_damage"] == 0


def test_apply_migrations_is_idempotent(tmp_path):
    """Re-running must not explode on 'duplicate column name'."""
    db = tmp_path / "i.db"
    conn = sqlite3.connect(str(db))
    conn.executescript(_DDL)
    apply_migrations(conn)
    apply_migrations(conn)          # version stamp says done — no-op
    conn.execute("PRAGMA user_version = 0")   # pretend the stamp was lost
    conn.commit()
    apply_migrations(conn)          # must re-check the live schema, not blow up
    assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
    conn.close()


# --------------------------------------------------------------------------
# kill-event positions
# --------------------------------------------------------------------------

def test_kill_event_stores_both_positions_and_distance(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # 30000 cm apart on x => 300 m
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=0.0, y=0.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=30_000.0, y=0.0)],
        [_kill("Alice", "Bob")]))
    store.close()

    ev = _rows(db, "SELECT * FROM kill_events")[0]
    assert ev["attacker_x"] == 0.0
    assert ev["victim_x"] == 30_000.0
    assert ev["distance_m"] == pytest.approx(300.0)
    assert ev["attacker_name"] == "Alice"


def test_missing_victim_position_leaves_nulls_not_guesses(tmp_path):
    """A bleed-out whose pawn already despawned: no victim soldier at all."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=100.0, y=200.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2)],          # no soldier block
        [_kill("Alice", "Bob")]))
    store.close()

    ev = _rows(db, "SELECT * FROM kill_events")[0]
    assert ev["attacker_x"] == 100.0
    assert ev["victim_x"] is None
    assert ev["distance_m"] is None       # never fabricated from one end


def test_stale_soldier_position_is_ignored(tmp_path):
    """A stale block points at freed memory — its coords are not an observation."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=1.0, y=2.0, stale=True),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=500.0, y=0.0)],
        [_kill("Alice", "Bob")]))
    store.close()

    ev = _rows(db, "SELECT * FROM kill_events")[0]
    assert ev["attacker_x"] is None
    assert ev["victim_x"] == 500.0
    assert ev["distance_m"] is None


def test_attacker_resolved_by_eos_id_when_name_is_absent(tmp_path):
    """Log lines carry clan tags; the EOS id is the reliable key."""
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=0.0, y=0.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=0.0, y=40_000.0)],
        [_kill("[CLAN] Alice", "Bob", attacker_eos="11111111-1111-1111-1111-111111111111")]))
    store.close()

    ev = _rows(db, "SELECT * FROM kill_events")[0]
    assert ev["attacker_x"] == 0.0          # joined via eos, not the tagged name
    assert ev["distance_m"] == pytest.approx(400.0)


def test_reingesting_the_same_event_is_idempotent(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    snap = _snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=0.0, y=0.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=100.0, y=0.0)],
        [_kill("Alice", "Bob")])
    store.record_tick(snap)
    store.record_tick(dict(snap, tick=2))    # same event, next tick
    store.close()

    assert _rows(db, "SELECT COUNT(*) c FROM kill_events")[0]["c"] == 1


# --------------------------------------------------------------------------
# read helpers
# --------------------------------------------------------------------------

def test_match_heatmap_returns_only_positioned_points(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=0.0, y=0.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=100.0, y=0.0),
         _player("33333333-3333-3333-3333-333333333333", "Carol", 2)],       # no position
        [_kill("Alice", "Bob", ts=1.0),
         _kill("Alice", "Carol", ts=2.0)]))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    hm = match_heatmap(db, "m1")
    assert hm is not None
    assert hm["layerName"] == "Yehorivka_RAAS_v1"
    assert len(hm["points"]) == 1            # Carol had no victim_x
    assert hm["points"][0]["victim_x"] == 100.0


def test_match_heatmap_unknown_match_is_none(tmp_path):
    db = tmp_path / "s.db"
    StatsStore(db, server_id="t").close()
    assert match_heatmap(db, "nope") is None


def test_weapon_meta_counts_kills_and_reports_null_range_when_unpositioned(tmp_path):
    db = tmp_path / "s.db"
    store = StatsStore(db, server_id="t")
    # Two M4 kills, positioned; one knife kill with no positions at all.
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=0.0, y=0.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=10_000.0, y=0.0)],
        [_kill("Alice", "Bob", weapon="BP_M4A1", ts=1.0)]))
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1, x=0.0, y=0.0),
         _player("22222222-2222-2222-2222-222222222222", "Bob", 2, x=20_000.0, y=0.0)],
        [_kill("Alice", "Bob", weapon="BP_M4A1", ts=2.0)], tick=2))
    store.record_tick(_snap(
        [_player("11111111-1111-1111-1111-111111111111", "Alice", 1), _player("33333333-3333-3333-3333-333333333333", "Carol", 2)],
        [_kill("Alice", "Carol", weapon="BP_Knife", ts=3.0)], tick=3))
    store.finalize_open_match(reason="test")  # reads serve only finished matches
    store.close()

    rows = {r["weapon"]: r for r in weapon_meta(db, "alltime", min_kills=1)}
    assert rows["BP_M4A1"]["kills"] == 2
    assert rows["BP_M4A1"]["avg_distance_m"] == pytest.approx(150.0)  # 100 + 200
    assert rows["BP_M4A1"]["max_distance_m"] == pytest.approx(200.0)
    assert rows["BP_Knife"]["kills"] == 1
    assert rows["BP_Knife"]["avg_distance_m"] is None   # null, not 0
