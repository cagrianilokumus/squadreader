"""Anti-cheat detectors, driven with synthetic snapshots.

Every test here is a claim about when the detector must NOT fire as much as when
it must: a false accusation is the expensive failure, not a missed one.
"""
from __future__ import annotations

import math

from sqreader.plugins import PluginManager
from sqreader.plugins.cheat_detect import CheatDetect, _angle_diff_deg

# 2 s per tick — the production rate these thresholds are scaled to.
TICK_SEC = 2.0
SPRINT_MPS = 7.8


def _player(eos="eos-1", name="Alice", *, x=0.0, y=0.0, addr="0xA",
            health=100.0, attached=False, yaw=None, weapon=None, mags=None,
            stale=False):
    sol = {
        "addr": addr, "health": health, "attached": attached,
        "position": {"x": x, "y": y, "z": 0.0},
    }
    if stale:
        sol["stale"] = True
    if yaw is not None:
        sol["yaw"] = yaw
    if weapon is not None:
        w = {"className": weapon}
        if mags is not None:
            w["magazines"] = list(mags)
        sol["weapon"] = w
    return {"eosId": eos, "name": name, "teamId": 1, "soldier": sol}


def _snap(players, *, tick=1, elapsed=0.0, events=(), vehicles=(),
          state="InProgress", cache_resets=0):
    return {
        "tick": tick,
        "gameState": {"matchState": state, "matchId": "m1",
                      "elapsedSec": elapsed},
        "players": list(players),
        "vehicles": list(vehicles),
        "damageEvents": list(events),
        "counts": {"cacheResets": cache_resets},
    }


class _Sink:
    def __init__(self):
        self.rows = []

    def __call__(self, row):
        self.rows.append(row)

    def types(self):
        return [r["alert_type"] for r in self.rows]


def _run(cfg=None):
    sink = _Sink()
    mgr = PluginManager(
        {"cheat_detect": {"enabled": True, "config": cfg or {}}},
        server_id="t", emit_alert=sink)
    return mgr, sink


def _walk(mgr, *, speed_mps, ticks, eos="eos-1", start_tick=1, addr="0xA"):
    """Move a player in a straight line at a fixed speed for N ticks."""
    step_cm = speed_mps * TICK_SEC * 100.0
    for i in range(ticks):
        mgr.run_tick(
            _snap([_player(eos=eos, x=step_cm * i, addr=addr)],
                  tick=start_tick + i, elapsed=TICK_SEC * i),
            tick=start_tick + i, now=1000.0 + TICK_SEC * i)


# --------------------------------------------------------------------------
# speedhack
# --------------------------------------------------------------------------

def test_sprinting_never_flags():
    mgr, sink = _run()
    _walk(mgr, speed_mps=SPRINT_MPS, ticks=20)
    assert sink.rows == []


def test_speedhack_needs_the_full_streak():
    """8 ticks at 2 s = ~16 s sustained. One tick short must stay quiet."""
    need = CheatDetect.DEFAULT_CONFIG["speed_sustained_ticks"]
    mgr, sink = _run()
    # The first tick only anchors the position, so N+1 samples give N speeds.
    _walk(mgr, speed_mps=30.0, ticks=need)     # -> need-1 over-speed samples
    assert sink.rows == [], "fired before the streak was complete"

    mgr, sink = _run()
    _walk(mgr, speed_mps=30.0, ticks=need + 1)
    assert sink.types() == ["speedhack"]


def test_speedhack_reports_the_speed_it_saw():
    mgr, sink = _run()
    _walk(mgr, speed_mps=30.0, ticks=12)
    d = sink.rows[0]["details"]
    assert abs(d["speedMps"] - 30.0) < 0.5
    assert d["limitMps"] == 18.0


def test_a_single_teleport_spike_does_not_flag():
    """One bad sample is a read glitch, not a cheat. The streak is the point."""
    mgr, sink = _run()
    mgr.run_tick(_snap([_player(x=0.0)], tick=1, elapsed=0.0), tick=1)
    mgr.run_tick(_snap([_player(x=500_000.0)], tick=2, elapsed=TICK_SEC), tick=2)
    mgr.run_tick(_snap([_player(x=500_100.0)], tick=3, elapsed=TICK_SEC * 2), tick=3)
    assert sink.rows == []


def test_respawn_breaks_the_streak():
    """A new pawn means the two positions are not the same body. The soldier
    addr changing is how we know."""
    mgr, sink = _run()
    _walk(mgr, speed_mps=30.0, ticks=6, addr="0xA")
    _walk(mgr, speed_mps=30.0, ticks=6, addr="0xB", start_tick=7)
    assert sink.rows == [], "streak survived a respawn"


def test_a_vehicle_occupant_is_never_flagged():
    """A passenger's body position is replicated from the vehicle and lags it —
    a helicopter passenger routinely 'moves' far past any foot threshold."""
    mgr, sink = _run()
    veh = [{"seats": [{"occupantEosId": "eos-1"}]}]
    for i in range(20):
        mgr.run_tick(
            _snap([_player(x=60_000.0 * i)], tick=i, elapsed=TICK_SEC * i,
                  vehicles=veh),
            tick=i)
    assert sink.rows == []


def test_an_attached_soldier_is_never_flagged():
    mgr, sink = _run()
    for i in range(20):
        mgr.run_tick(
            _snap([_player(x=60_000.0 * i, attached=True)],
                  tick=i, elapsed=TICK_SEC * i),
            tick=i)
    assert sink.rows == []


def test_a_cache_reset_breaks_the_streak():
    """Positions can legitimately jump on the tick a cache reset lands."""
    mgr, sink = _run()
    step = 30.0 * TICK_SEC * 100.0
    for i in range(20):
        mgr.run_tick(
            _snap([_player(x=step * i)], tick=i, elapsed=TICK_SEC * i,
                  cache_resets=i),          # a reset every tick
            tick=i)
    assert sink.rows == []


def test_a_stale_soldier_is_not_measured():
    mgr, sink = _run()
    step = 30.0 * TICK_SEC * 100.0
    for i in range(20):
        mgr.run_tick(
            _snap([_player(x=step * i, stale=True)],
                  tick=i, elapsed=TICK_SEC * i),
            tick=i)
    assert sink.rows == []


def test_cooldown_suppresses_a_repeat():
    mgr, sink = _run()
    _walk(mgr, speed_mps=30.0, ticks=30)   # long enough to fire many times over
    assert sink.types().count("speedhack") == 1


# --------------------------------------------------------------------------
# remote melee
# --------------------------------------------------------------------------

def _melee(attacker="Alice", victim="Bob", weapon="BP_Knife_C", ts=100.0):
    return {"attacker": attacker, "victim": victim, "causerWeapon": weapon,
            "killed": 1, "wounded": 0, "ts": ts, "attackerEosId": "eos-1"}


def test_a_knife_kill_across_the_map_flags():
    mgr, sink = _run()
    mgr.run_tick(_snap(
        [_player(eos="eos-1", name="Alice", x=0.0),
         _player(eos="eos-2", name="Bob", x=20_000.0, addr="0xB")],   # 200 m
        events=[_melee()]), tick=1)
    assert sink.types() == ["remote_melee"]
    assert sink.rows[0]["details"]["distanceM"] == 200.0


def test_a_normal_knife_kill_does_not_flag():
    mgr, sink = _run()
    mgr.run_tick(_snap(
        [_player(eos="eos-1", name="Alice", x=0.0),
         _player(eos="eos-2", name="Bob", x=200.0, addr="0xB")],      # 2 m
        events=[_melee()]), tick=1)
    assert sink.rows == []


def test_a_knife_kill_inside_the_drift_budget_does_not_flag():
    """25 m is the position drift a sprinting player can accumulate inside one
    2 s tick. Anything under it is not evidence."""
    mgr, sink = _run()
    mgr.run_tick(_snap(
        [_player(eos="eos-1", name="Alice", x=0.0),
         _player(eos="eos-2", name="Bob", x=2_400.0, addr="0xB")],    # 24 m
        events=[_melee()]), tick=1)
    assert sink.rows == []


def test_a_rifle_kill_at_range_is_not_a_remote_melee():
    mgr, sink = _run()
    mgr.run_tick(_snap(
        [_player(eos="eos-1", name="Alice", x=0.0),
         _player(eos="eos-2", name="Bob", x=30_000.0, addr="0xB")],
        events=[_melee(weapon="BP_M4A1_C")]), tick=1)
    assert sink.rows == []


def test_an_unplaceable_victim_is_not_accused():
    """No position for one side means no distance. No distance, no accusation."""
    mgr, sink = _run()
    bob = _player(eos="eos-2", name="Bob", x=30_000.0, addr="0xB")
    bob["soldier"] = None                     # dead, pawn already gone
    mgr.run_tick(_snap([_player(eos="eos-1", name="Alice"), bob],
                       events=[_melee()]), tick=1)
    assert sink.rows == []


def test_the_same_event_seen_twice_only_counts_once():
    mgr, sink = _run()
    players = [_player(eos="eos-1", name="Alice", x=0.0),
               _player(eos="eos-2", name="Bob", x=20_000.0, addr="0xB")]
    mgr.run_tick(_snap(players, tick=1, events=[_melee()]), tick=1)
    mgr.run_tick(_snap(players, tick=2, events=[_melee()]), tick=2)  # redelivered
    assert len(sink.rows) == 1


# --------------------------------------------------------------------------
# infinite ammo
# --------------------------------------------------------------------------

def _hit(ts, weapon="BP_M4A1_C"):
    return {"attacker": "Alice", "victim": "Bob", "causerWeapon": weapon,
            "killed": 0, "wounded": 1, "ts": ts, "attackerEosId": "eos-1"}


def _fire(mgr, *, mags, times, weapon="BP_M4A1_C"):
    for i, ts in enumerate(times):
        mgr.run_tick(_snap(
            [_player(eos="eos-1", name="Alice", weapon=weapon,
                     mags=mags[i] if isinstance(mags[0], list) else mags),
             _player(eos="eos-2", name="Bob", x=5000.0, addr="0xB")],
            tick=i + 1, events=[_hit(ts, weapon)]),
            tick=i + 1, now=ts)


def test_ammo_that_never_drops_under_sustained_fire_flags():
    """Sustained fire: 10 s apart, so each event lands inside the 15 s staleness
    window and the suspicion accumulates past the 30 s minimum."""
    mgr, sink = _run()
    _fire(mgr, mags=[30] * 5, times=[0.0, 10.0, 20.0, 30.0, 40.0])
    assert sink.types() == ["infinite_ammo"]
    d = sink.rows[0]["details"]
    assert d["damageEvents"] >= 3
    assert d["windowSec"] >= 30.0


def test_fire_slower_than_the_staleness_window_never_accumulates():
    """A documented blind spot, not an accident.

    Events further apart than `inf_ammo_stale_seconds` (15 s) reset the window
    every time, so a cheater who fires only every 20 s is never caught. That is
    the deliberate price of the staleness gate, which exists because "fired a
    burst, then resupplied in main" is indistinguishable from infinite ammo
    until you notice they stopped shooting. Tighten at your peril: this is the
    trade that keeps the false-positive rate near zero.
    """
    mgr, sink = _run()
    _fire(mgr, mags=[30] * 5, times=[0.0, 20.0, 40.0, 60.0, 80.0])
    assert sink.rows == []


def test_reloading_resets_the_suspicion():
    mgr, sink = _run()
    _fire(mgr, mags=[[30, 30, 30], [30, 30, 20], [30, 30, 10], [30, 20, 10]],
          times=[0.0, 10.0, 20.0, 30.0])
    assert sink.rows == []


def test_three_shots_inside_the_minimum_window_do_not_flag():
    """The window exists so a reload has room to land before we call it."""
    mgr, sink = _run()
    _fire(mgr, mags=[30, 30, 30], times=[0.0, 2.0, 4.0])   # 4 s < 30 s
    assert sink.rows == []


def test_a_stale_burst_then_a_pause_does_not_flag():
    """Fire a burst, resupply in main, come back. Looks identical to a cheater
    until you notice the gap — which is what the staleness window is for."""
    mgr, sink = _run()
    _fire(mgr, mags=[30, 30, 30], times=[0.0, 5.0, 100.0])
    assert sink.rows == []


def test_a_weapon_swap_is_not_evidence():
    """The ammo we can see belongs to the gun they hold NOW, not the one the
    event was about."""
    mgr, sink = _run()
    for i, ts in enumerate([0.0, 20.0, 40.0]):
        mgr.run_tick(_snap(
            [_player(eos="eos-1", name="Alice", weapon="BP_Pistol_C", mags=[8]),
             _player(eos="eos-2", name="Bob", x=5000.0, addr="0xB")],
            tick=i + 1, events=[_hit(ts, "BP_M4A1_C")]),   # rifle event
            tick=i + 1, now=ts)
    assert sink.rows == []


# --------------------------------------------------------------------------
# magic bullet (experimental, off by default)
# --------------------------------------------------------------------------

def test_magic_bullet_is_off_by_default():
    assert CheatDetect.DEFAULT_CONFIG["detect_magic_bullet"] is False


def test_magic_bullet_fires_only_when_explicitly_enabled():
    cfg = {"detect_magic_bullet": True, "magic_bullet_consecutive": 2,
           "detect_speedhack": False}
    mgr, sink = _run(cfg)
    for i in range(3):
        ts = 100.0 + i
        mgr.run_tick(_snap(
            # Alice faces +X (yaw 0); Bob is behind her at -X.
            [_player(eos="eos-1", name="Alice", x=0.0, yaw=0.0),
             _player(eos="eos-2", name="Bob", x=-10_000.0, addr="0xB")],
            tick=i + 1, events=[_hit(ts)]),
            tick=i + 1, now=ts)
    assert sink.types() == ["magic_bullet"]
    assert sink.rows[0]["confidence"] < 0.5      # yaw is tick-sampled — say so
    assert "caveat" in sink.rows[0]["details"]


# --------------------------------------------------------------------------
# angle maths
# --------------------------------------------------------------------------

def test_angle_zero_when_facing_the_target():
    assert _angle_diff_deg(0.0, 1.0, 0.0) == 0.0


def test_angle_180_when_facing_away():
    assert _angle_diff_deg(0.0, -1.0, 0.0) == 180.0


def test_angle_90_when_perpendicular():
    assert math.isclose(_angle_diff_deg(0.0, 0.0, 1.0), 90.0)


def test_angle_wraps_the_short_way_around():
    # Facing 350 degrees, target at 10 degrees: 20 apart, not 340.
    assert math.isclose(_angle_diff_deg(350.0, math.cos(math.radians(10)),
                                        math.sin(math.radians(10))), 20.0,
                        abs_tol=1e-6)


# --------------------------------------------------------------------------
# lifecycle
# --------------------------------------------------------------------------

def test_state_is_dropped_between_matches():
    """Everything teleports on a map change. Reset rather than reason about it."""
    mgr, sink = _run()
    _walk(mgr, speed_mps=30.0, ticks=6)
    mgr.run_tick(_snap([], tick=99, state="WaitingPostMatch"), tick=99)
    _walk(mgr, speed_mps=30.0, ticks=6, start_tick=100)
    assert sink.rows == []
