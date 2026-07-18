"""Memory-verified cheat detection. Alert-only — this never touches the game.

Ported from the Squad-Replay project's `plugins/cheat_detect.py`. Its thresholds
carry real tuning history and are kept, with their reasoning, because that
history is the expensive part; what changed is the tick rate they are scaled to
and which detectors sqreader has the data to run at all.

Tick-rate scaling
-----------------
Every "sustained for N ticks" constant is in TICKS, so it only means what you
think it means at one tick rate. The source ran at 1 s and wrote down the table:

    5 s tick -> 3 ticks | 3 s tick -> 5 | 2 s tick -> 8 | 1 s tick -> 15

sqreader runs production at 0.5 Hz, i.e. a 2 s tick, so the streaks here are 8 —
straight off that table, holding the effective window at ~16 s. If you change
`serve --hz`, re-scale them or the detector silently changes meaning.

What is NOT here, and exactly why
---------------------------------
The no-guess rule applies to detection as hard as it applies to display: a
detector that infers a signal sqreader cannot read would be an accusation built
on a guess. These four are dropped until the reader exposes what they need:

  stamina_hack        needs the sprint-stamina float on SQSoldier. The snapshot
                      only carries `breathHoldStamina` (scope steadiness), which
                      is a different field and does not move when you sprint.
                      Prerequisite: probe SQSoldier for the sprint stamina
                      FloatProperty, add it to `soldier_offsets` + `_read_soldier`.

  no_reload_sustained needs bFiring / bReloading. Both are FBoolProperty bitfield
                      bools; `bool_property_mask` in ue/reflection.py already
                      knows how to resolve those masks — the fields just are not
                      read yet.

  remote_shovel       needs SQSoldier.ShovelAction (a replicated enum). We can
                      see who holds a shovel from the weapon className, but not
                      whether they are *using* it, and "holding a shovel near a
                      damaged FOB" is exactly the kind of proximity guess this
                      project refuses to make.

  remote_mine         needs the mine's placer. `read_deployable` emits OwningFob
                      but no OwnerPlayerState, so there is nobody to accuse.
"""
from __future__ import annotations

import math
from typing import Any, Optional

from . import register
from .base import Plugin, TickContext

# causerWeapon substrings that mean somebody swung something.
_MELEE_KEYWORDS: tuple[str, ...] = ("knife", "bayonet", "baton", "machete")

_CM_PER_M = 100.0


def _angle_diff_deg(yaw_deg: float, dx: float, dy: float) -> float:
    """Smallest angle (0..180) between a yaw and the direction (dx, dy).

    UE yaw convention: 0 = +X, 90 = +Y, increasing counter-clockwise.
    """
    target = math.degrees(math.atan2(dy, dx))
    return abs((yaw_deg - target + 540.0) % 360.0 - 180.0)


def _xy(p: dict) -> Optional[tuple[float, float]]:
    """A player's (x, y) in cm — only when it is a real, current reading."""
    sol = p.get("soldier")
    if not isinstance(sol, dict) or sol.get("stale"):
        return None
    pos = sol.get("position")
    if not isinstance(pos, dict):
        return None
    x, y = pos.get("x"), pos.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    if not (math.isfinite(x) and math.isfinite(y)):
        return None
    return (float(x), float(y))


def _dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1]) / _CM_PER_M


def _occupied_eos(snapshot: dict) -> set[str]:
    """Everyone sitting in a vehicle seat this tick.

    A passenger's body position is replicated from the vehicle and lags it, so a
    helicopter passenger routinely "moves" at 40 m/s. Foot checks must exclude
    them, and `soldier.attached` alone does not always catch it.
    """
    out: set[str] = set()
    for v in (snapshot.get("vehicles") or []):
        for s in (v.get("seats") or []):
            eos = s.get("occupantEosId")
            if eos:
                out.add(eos)
    return out


class _PlayerState:
    """Per-player rolling state. Lives as long as the plugin does."""

    __slots__ = ("last_xy", "last_elapsed", "last_soldier_addr", "speed_streak",
                 "ammo", "magic_streak", "last_report")

    def __init__(self) -> None:
        self.last_xy: Optional[tuple[float, float]] = None
        self.last_elapsed: Optional[float] = None
        self.last_soldier_addr: Optional[str] = None
        self.speed_streak: int = 0
        # weapon class -> {"events": n, "first_ts": t, "last_ts": t, "ammo": n}
        self.ammo: dict[str, dict] = {}
        self.magic_streak: int = 0
        # (alert_type) -> last emit ts
        self.last_report: dict[str, float] = {}


@register
class CheatDetect(Plugin):
    PLUGIN_ID = "cheat_detect"
    LABEL = "Cheat detection"
    DESCRIPTION = ("Memory-verified anomaly detection. Alert-only; every "
                   "threshold is anchored to a physical or mechanical limit.")

    DEFAULT_CONFIG: dict[str, Any] = {
        # Same (player, alert_type) is silenced for this long after it fires.
        "report_cooldown_minutes": 5.0,

        # ---- speedhack (foot only) ----
        # Squad's sprint cap is ~7.8 m/s (MaxWalkSpeed ~400 uu/s ×
        # SprintSpeedMultiplier 1.94). The source walked this threshold 12 -> 15
        # -> 18 as review turned up legitimate players crossing it: parachute
        # landings, fall momentum after bailing from a moving vehicle, and the
        # helicopter-passenger position leak that puts a body where the heli was
        # seconds ago. 18 m/s is ~2.3x the sprint cap and still far under real
        # offenders, who cluster at 22-30 m/s. Do not lower it.
        "detect_speedhack": True,
        "speed_max_foot_mps": 18.0,
        # 8 ticks x 2 s = ~16 s sustained. See the scaling table up top.
        "speed_sustained_ticks": 8,

        # ---- infinite ammo ----
        # Same player, same weapon, N damage events, and their carried ammo
        # never went down.
        "detect_infinite_ammo": True,
        "inf_ammo_min_damage_events": 3,
        # Give reload windows room to land before calling it.
        "inf_ammo_min_window_seconds": 30.0,
        # If the last event we counted is older than this, the suspicion is
        # stale: a player who fired a burst and then resupplied in main looks
        # identical to a cheater until you notice they stopped shooting. A real
        # one keeps firing, so their last event is always fresh.
        #
        # These two interact, and the interaction is the detector's blind spot:
        # to reach the 30 s window you need events no more than 15 s apart, so
        # somebody who fires only every 20 s never accumulates and is never
        # flagged. That is the accepted price of near-zero false positives.
        # Widening the staleness window closes the gap and re-opens the burst-
        # then-resupply false positive — do not do it without a way to tell
        # those two apart.
        "inf_ammo_stale_seconds": 15.0,

        # ---- remote melee ----
        # Squad melee reach is ~1 m. At a 2 s tick a sprinting attacker drifts
        # up to 7.8 x 2 = ~16 m between the shot and the sample, so 25 m clears
        # the drift ceiling while staying far below real cheat ranges (50-200 m).
        # That drift budget was written for a 2 s tick — which is exactly ours.
        "detect_remote_melee": True,
        "remote_melee_max_dist_m": 25.0,

        # ---- magic bullet (EXPERIMENTAL, off) ----
        # Off by default, and it should stay off until it has been checked
        # against recorded matches. The reasoning: yaw is sampled at the tick,
        # not at the shot. At 2 s a player can turn 180 degrees between pulling
        # the trigger and being looked at, so "was facing away" is not a fact we
        # actually have. Left in, wired up, and disabled — with the evidence in
        # the alert so a human can open the replay and judge.
        "detect_magic_bullet": False,
        "magic_bullet_min_angle_deg": 90.0,
        "magic_bullet_consecutive": 4,
        # Only score events sampled close enough to the shot to mean anything.
        "magic_bullet_max_event_age_sec": 2.5,
    }

    def __init__(self, config: Optional[dict] = None) -> None:
        super().__init__(config)
        self._players: dict[str, _PlayerState] = {}
        self._seen_events: set[tuple] = set()
        self._last_cache_resets: Optional[int] = None

    # -- helpers -----------------------------------------------------------
    def _state(self, eos: str) -> _PlayerState:
        st = self._players.get(eos)
        if st is None:
            st = _PlayerState()
            self._players[eos] = st
        return st

    def _cooled_down(self, st: _PlayerState, kind: str, now: float) -> bool:
        window = float(self.config["report_cooldown_minutes"]) * 60.0
        last = st.last_report.get(kind)
        if last is not None and (now - last) < window:
            return False
        st.last_report[kind] = now
        return True

    # -- entry point -------------------------------------------------------
    def on_tick(self, ctx: TickContext) -> None:
        if ctx.match_state != "InProgress":
            # Between matches everything teleports (respawn, map load). Reset
            # rather than reason about it.
            self._players.clear()
            self._seen_events.clear()
            return

        # A cache reset makes the reader re-read every object, and positions can
        # legitimately jump on the tick it lands. Break every streak instead of
        # explaining away the spike afterwards.
        counts = ctx.snapshot.get("counts") or {}
        resets = counts.get("cacheResets")
        cache_reset = (isinstance(resets, int)
                       and self._last_cache_resets is not None
                       and resets != self._last_cache_resets)
        if isinstance(resets, int):
            self._last_cache_resets = resets

        gs = ctx.game_state()
        elapsed = gs.get("elapsedSec")
        elapsed_f = float(elapsed) if isinstance(elapsed, (int, float)) else None

        by_eos: dict[str, dict] = {}
        by_name: dict[str, dict] = {}
        for p in ctx.players():
            eos, name = p.get("eosId"), p.get("name")
            if eos:
                by_eos[eos] = p
            if name:
                by_name.setdefault(name, p)

        in_vehicle = _occupied_eos(ctx.snapshot)

        if self.config.get("detect_speedhack"):
            self._speedhack(ctx, by_eos, in_vehicle, elapsed_f, cache_reset)

        events = self._fresh_events(ctx)
        if events:
            if self.config.get("detect_infinite_ammo"):
                self._infinite_ammo(ctx, events, by_eos, by_name, in_vehicle)
            if self.config.get("detect_remote_melee"):
                self._remote_melee(ctx, events, by_eos, by_name)
            if self.config.get("detect_magic_bullet"):
                self._magic_bullet(ctx, events, by_eos, by_name)

        # Forget players who left, so state cannot grow without bound across a
        # long-running server.
        live = set(by_eos)
        for eos in [e for e in self._players if e not in live]:
            del self._players[eos]

    def _fresh_events(self, ctx: TickContext) -> list[dict]:
        """Damage events not already counted.

        Log events can be re-delivered across ticks, and every detector here
        counts events, so a duplicate is a false positive waiting to happen. The
        key is deliberately coarse-grained on ts (0.1 s) because the log's
        timestamps are not exact.
        """
        out = []
        for ev in ctx.damage_events():
            ts = ev.get("ts")
            key = (round(float(ts), 1) if isinstance(ts, (int, float)) else None,
                   ev.get("attacker"), ev.get("victim"), ev.get("causerWeapon"))
            if key in self._seen_events:
                continue
            self._seen_events.add(key)
            out.append(ev)
        if len(self._seen_events) > 4000:
            self._seen_events.clear()   # bounded; a match is over long before this
        return out

    # -- detectors ---------------------------------------------------------
    def _speedhack(self, ctx: TickContext, by_eos: dict, in_vehicle: set,
                   elapsed: Optional[float], cache_reset: bool) -> None:
        limit = float(self.config["speed_max_foot_mps"])
        need = int(self.config["speed_sustained_ticks"])

        for eos, p in by_eos.items():
            st = self._state(eos)
            sol = p.get("soldier") or {}
            xy = _xy(p)
            addr = sol.get("addr")

            on_foot = (
                xy is not None
                and not sol.get("attached")
                and eos not in in_vehicle
                and isinstance(sol.get("health"), (int, float))
                and sol["health"] > 0)

            # Any of these means the previous sample is not comparable to this
            # one: a new pawn (respawn), a context change, a cache reset. Drop
            # the streak and re-anchor rather than measure across the gap.
            if not on_foot or cache_reset or addr != st.last_soldier_addr:
                st.speed_streak = 0
                st.last_xy = xy
                st.last_elapsed = elapsed
                st.last_soldier_addr = addr
                continue

            dt = None
            if elapsed is not None and st.last_elapsed is not None:
                dt = elapsed - st.last_elapsed
            if dt is None or dt <= 0.0 or st.last_xy is None or xy is None:
                st.last_xy = xy
                st.last_elapsed = elapsed
                continue

            speed = _dist_m(st.last_xy, xy) / dt
            st.last_xy = xy
            st.last_elapsed = elapsed

            if speed > limit:
                st.speed_streak += 1
            else:
                st.speed_streak = 0
                continue

            if st.speed_streak >= need and self._cooled_down(
                    st, "speedhack", ctx.now):
                self.alert(
                    ctx, alert_type="speedhack", eos_id=eos,
                    player_name=p.get("name"),
                    confidence=min(1.0, speed / (limit * 2.0)),
                    details={
                        "speedMps": round(speed, 1),
                        "limitMps": limit,
                        "sustainedTicks": st.speed_streak,
                        "sprintCapMps": 7.8,
                    })

    def _infinite_ammo(self, ctx: TickContext, events: list[dict],
                       by_eos: dict, by_name: dict, in_vehicle: set) -> None:
        min_events = int(self.config["inf_ammo_min_damage_events"])
        min_window = float(self.config["inf_ammo_min_window_seconds"])
        stale_after = float(self.config["inf_ammo_stale_seconds"])

        for ev in events:
            eos = ev.get("attackerEosId")
            attacker = by_eos.get(eos) if eos else by_name.get(ev.get("attacker"))
            if attacker is None:
                continue
            eos = attacker.get("eosId")
            if not eos or eos in in_vehicle:
                continue  # vehicle ammo has its own resupply path — not our call
            weapon = ev.get("causerWeapon")
            sol = attacker.get("soldier") or {}
            wep = sol.get("weapon") or {}
            held = wep.get("className")
            mags = wep.get("magazines")
            if not weapon or not held or not isinstance(mags, list) or not mags:
                continue
            # The event must be about the gun they are actually holding — after a
            # weapon swap the ammo we can see is a different gun's.
            if weapon not in held and held not in weapon:
                continue

            ammo = sum(int(m) for m in mags if isinstance(m, int))
            st = self._state(eos)
            slot = st.ammo.get(weapon)
            ts = float(ev.get("ts") or ctx.now)

            if slot is None or (ts - slot["last_ts"]) > stale_after:
                st.ammo[weapon] = {"events": 1, "first_ts": ts, "last_ts": ts,
                                   "ammo": ammo}
                continue

            # Ammo went down: they reloaded/spent rounds like everyone else.
            if ammo < slot["ammo"]:
                st.ammo[weapon] = {"events": 1, "first_ts": ts, "last_ts": ts,
                                   "ammo": ammo}
                continue

            slot["events"] += 1
            slot["last_ts"] = ts
            slot["ammo"] = max(slot["ammo"], ammo)

            window = ts - slot["first_ts"]
            if (slot["events"] >= min_events and window >= min_window
                    and self._cooled_down(st, "infinite_ammo", ctx.now)):
                self.alert(
                    ctx, alert_type="infinite_ammo", eos_id=eos,
                    player_name=attacker.get("name"), confidence=0.8,
                    details={
                        "weapon": weapon,
                        "damageEvents": slot["events"],
                        "windowSec": round(window, 1),
                        "ammoUnchangedAt": slot["ammo"],
                    })
                st.ammo.pop(weapon, None)

    def _remote_melee(self, ctx: TickContext, events: list[dict],
                      by_eos: dict, by_name: dict) -> None:
        max_d = float(self.config["remote_melee_max_dist_m"])
        for ev in events:
            if not ev.get("killed") or ev.get("teamKill"):
                continue
            weapon = (ev.get("causerWeapon") or "").lower()
            if not any(k in weapon for k in _MELEE_KEYWORDS):
                continue
            eos = ev.get("attackerEosId")
            attacker = by_eos.get(eos) if eos else by_name.get(ev.get("attacker"))
            victim = by_name.get(ev.get("victim"))
            if attacker is None or victim is None:
                continue          # cannot place one of them — no accusation
            a_xy, v_xy = _xy(attacker), _xy(victim)
            if a_xy is None or v_xy is None:
                continue

            dist = _dist_m(a_xy, v_xy)
            if dist <= max_d:
                continue
            eos = attacker.get("eosId")
            if not eos:
                continue
            st = self._state(eos)
            if self._cooled_down(st, "remote_melee", ctx.now):
                self.alert(
                    ctx, alert_type="remote_melee", eos_id=eos,
                    player_name=attacker.get("name"), confidence=0.9,
                    details={
                        "weapon": ev.get("causerWeapon"),
                        "victim": ev.get("victim"),
                        "distanceM": round(dist, 1),
                        "meleeRangeM": 1.0,
                        "driftBudgetM": max_d,
                    })

    def _magic_bullet(self, ctx: TickContext, events: list[dict],
                      by_eos: dict, by_name: dict) -> None:
        min_angle = float(self.config["magic_bullet_min_angle_deg"])
        need = int(self.config["magic_bullet_consecutive"])
        max_age = float(self.config["magic_bullet_max_event_age_sec"])

        for ev in events:
            eos = ev.get("attackerEosId")
            attacker = by_eos.get(eos) if eos else by_name.get(ev.get("attacker"))
            victim = by_name.get(ev.get("victim"))
            if attacker is None or victim is None:
                continue
            eos = attacker.get("eosId")
            if not eos:
                continue
            ts = ev.get("ts")
            if isinstance(ts, (int, float)) and abs(ctx.now - float(ts)) > max_age:
                continue   # sampled too long after the shot to mean anything
            a_xy, v_xy = _xy(attacker), _xy(victim)
            yaw = (attacker.get("soldier") or {}).get("yaw")
            if a_xy is None or v_xy is None or not isinstance(yaw, (int, float)):
                continue

            angle = _angle_diff_deg(float(yaw), v_xy[0] - a_xy[0], v_xy[1] - a_xy[1])
            st = self._state(eos)
            if angle < min_angle:
                st.magic_streak = 0
                continue
            st.magic_streak += 1
            if st.magic_streak >= need and self._cooled_down(
                    st, "magic_bullet", ctx.now):
                self.alert(
                    ctx, alert_type="magic_bullet", eos_id=eos,
                    player_name=attacker.get("name"),
                    # Deliberately low: yaw is tick-sampled, not shot-sampled.
                    confidence=0.4,
                    details={
                        "angleDeg": round(angle, 1),
                        "consecutive": st.magic_streak,
                        "victim": ev.get("victim"),
                        "caveat": ("yaw is sampled at the tick, not at the shot "
                                   "— confirm in the replay before acting"),
                    })


__all__ = ["CheatDetect"]
