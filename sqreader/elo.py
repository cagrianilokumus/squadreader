"""Per-match ELO rating, on top of the SQLite stats store.

Adapted from the Squad-Replay project's `db/elo.py`. The tier table and the
delta maths are kept as-is (including the widened opponent divisor and the
per-match cap — see the comments on each, they encode real tuning history). The
performance score is NOT: it was written against a different schema, and it is
re-derived here from the columns sqreader actually records.

Where the rating comes from
---------------------------
1. Every player in a finished match gets a `performance_score` — one number
   summarising how well they played.
2. `calc_match_elo_changes` turns those into a *percentile within that match*,
   mixes it 50/50 with the win/loss result, and compares that against the ELO
   the player was expected to score against the other team's average rating.

Step 2 is why the absolute scale of `performance_score` does not matter: only
the ORDER it puts players in does. Doubling every weight changes nothing. That
makes the weights the one genuinely tunable thing here, and `sqreader
stats-elo-recalc` is how you re-derive history after changing them.

Gating: a match must be big enough and long enough to say anything about skill
(40 players, 15 minutes by default), and a player must actually have played it
(10 minutes). Below those, the match is simply not rated — no partial credit.
"""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Tier table — (min_rating, tier_num, label, hex_color)
# ---------------------------------------------------------------------------

ELO_TIERS: list[tuple[int, int, str, str]] = [
    (0,    1,  "Iron",     "#9e9e9e"),
    (800,  2,  "Bronze",   "#1db954"),
    (950,  3,  "Silver",   "#4caf50"),
    (1050, 4,  "Gold I",   "#8bc34a"),
    (1150, 5,  "Gold II",  "#cddc39"),
    (1300, 6,  "Platinum", "#ffc107"),
    (1450, 7,  "Diamond",  "#ff9800"),
    (1600, 8,  "Master",   "#ff5722"),
    (1800, 9,  "Legend",   "#f44336"),
    (2000, 10, "Elite",    "#b71c1c"),
]

STARTING_ELO = 1000


def elo_tier_for(rating: int) -> tuple[int, str, str, Optional[int], float]:
    """(tier_num, label, color, next_tier_at, progress) for a rating.

    `next_tier_at` is None at the top tier; `progress` is 0.0–1.0 within the
    current band.
    """
    idx = 0
    for i, (min_r, _num, _label, _color) in enumerate(ELO_TIERS):
        if rating >= min_r:
            idx = i
        else:
            break

    min_r, tier_num, label, color = ELO_TIERS[idx]
    if idx + 1 >= len(ELO_TIERS):
        return tier_num, label, color, None, 1.0   # top tier — nowhere left to go
    next_at = ELO_TIERS[idx + 1][0]
    band = next_at - min_r
    progress = min(max((rating - min_r) / band, 0.0), 1.0) if band > 0 else 1.0
    return tier_num, label, color, next_at, progress


# ---------------------------------------------------------------------------
# Performance score — pure, no DB
# ---------------------------------------------------------------------------
#
# Scale factors, not opinions: Squad's own score fields (objective/teamwork)
# run in the hundreds-to-thousands over a match, while kills run 0–40. Left
# unscaled, the score terms would swamp everything else and the ranking would
# just be "who has the most objective points". The 0.04/0.05/0.02 factors pull
# each term into roughly the same per-minute range so the weights below actually
# do the deciding.
#
# `is_commander` is a latched flag, not a duration — sqreader has no
# time-as-commander signal, so it contributes a flat bonus rather than a
# per-minute one. Squad-Replay used time_as_sl_s/time_as_commander_s here; we do
# not have those, and the no-guess rule says do not invent them.
_W_KILL = 1.8
_W_VEHICLE_KILL = 1.5
_W_REVIVE_PTS = 0.05
_W_HEAL_PTS = 0.02
_W_FOB_BUILT = 5.0        # placing a FOB radio is high-value support
_W_SUPPLIES = 0.005       # per supply point delivered (Squad-Replay's weight)
_W_OBJECTIVE = 0.04
_W_TEAMWORK = 0.04
_W_CAPTURE = 2.0          # capturing a flag
_W_DEFENSE = 1.5         # defending a flag
_W_FOB_DESTROYED = 3.0    # destroying an enemy FOB
_W_VEHICLE_DAMAGE = 0.001  # per point of cumulative vehicle damage
_COMMANDER_BONUS = 0.15

_DEATH_PENALTY = 0.04
_TEAMKILL_PENALTY = 0.25

# How the five components are mixed.
_MIX_COMBAT = 0.30
_MIX_SUPPORT = 0.20
_MIX_OBJECTIVE = 0.20
_MIX_TEAMWORK = 0.15
_MIX_LEADERSHIP = 0.05
_MIX_PARTICIPATION = 0.10

# A full match is ~30+ minutes; past that, showing up stops earning more.
_FULL_PARTICIPATION_MIN = 30.0


def _n(row: dict, key: str) -> float:
    v = row.get(key)
    try:
        return float(v) if v is not None else 0.0
    except (TypeError, ValueError):
        return 0.0


def performance_score(row: dict) -> float:
    """How well one player played one match. Non-negative; 0.0 means "nothing".

    Only the ranking this induces within a single match is used — see the module
    docstring. Missing/NULL columns count as zero.
    """
    mins = max(_n(row, "playtime_sec") / 60.0, 1.0)

    combat = (_n(row, "kills") * _W_KILL
              + _n(row, "vehicle_kills") * _W_VEHICLE_KILL
              + _n(row, "vehicle_damage") * _W_VEHICLE_DAMAGE) / mins
    support = (_n(row, "revived_points") * _W_REVIVE_PTS
               + _n(row, "heal_points") * _W_HEAL_PTS
               + _n(row, "fobs_built") * _W_FOB_BUILT
               + _n(row, "supplies_delivered") * _W_SUPPLIES) / mins
    objective = (_n(row, "objective_score") * _W_OBJECTIVE
                 + _n(row, "captures") * _W_CAPTURE
                 + _n(row, "defenses") * _W_DEFENSE
                 + _n(row, "fobs_destroyed") * _W_FOB_DESTROYED) / mins
    teamwork = (_n(row, "team_work_score") * _W_TEAMWORK) / mins
    leadership = _COMMANDER_BONUS if row.get("is_commander") else 0.0
    participation = min(mins / _FULL_PARTICIPATION_MIN, 1.0)

    raw = (combat * _MIX_COMBAT
           + support * _MIX_SUPPORT
           + objective * _MIX_OBJECTIVE
           + teamwork * _MIX_TEAMWORK
           + leadership * _MIX_LEADERSHIP
           + participation * _MIX_PARTICIPATION)

    penalties = (_n(row, "deaths") * _DEATH_PENALTY
                 + _n(row, "team_kills") * _TEAMKILL_PENALTY)
    return max(raw - penalties, 0.0)


# ---------------------------------------------------------------------------
# Delta calculation — pure, no DB
# ---------------------------------------------------------------------------

K_INITIAL = 32   # first 100 matches — a new player's rating should move fast
K_STABLE = 16    # after that

# Standard ELO uses 400, which is tuned for skill-matched 1v1 ladders. Squad
# teams are ~50 players thrown together by auto-balance, so at 400 the
# opponent-average term drowns out the win/performance term: a player durably
# above their lobby's average gets hammered on losses and barely rewarded on
# wins. Widened to 1000 — the term still pulls ratings toward the population
# mean over many matches, but it stops deciding any single one.
ELO_OPPONENT_DIVISOR = 1000.0

# Hard bound on one match's swing, whatever the rating gap or percentile.
ELO_MATCH_CAP = 15

# How much of the "actual score" is the result vs. how you played. Winning a
# match you carried and losing one you carried should not be the same thing.
_WIN_WEIGHT = 0.5
_PERF_WEIGHT = 0.5


def _percentiles(players: list[dict]) -> dict[str, float]:
    """Each player's performance percentile within the match, 0.0–1.0.

    Ties share the midpoint of the ranks they span. Ranking them by their
    position in the input list instead — which is what a plain enumerate() over
    the sorted list does — is not a tie-break, it is a coin flip: two players who
    did *identically* nothing would be handed 0.0 and 1.0. That is not
    hypothetical. `performance_score` floors at 0.0, so every player who idled,
    or whose stats never read, lands on exactly the same score.

    A lone player is 0.5: with nobody to compare against, "how did they do
    relative to the lobby" has no answer, and 0.5 moves their rating least.
    """
    n = len(players)
    if n == 1:
        return {players[0]["eos_id"]: 0.5}

    ranked = sorted(players, key=lambda p: p["perf_score"])
    pct: dict[str, float] = {}
    i = 0
    while i < n:
        j = i
        while j + 1 < n and ranked[j + 1]["perf_score"] == ranked[i]["perf_score"]:
            j += 1
        shared = ((i + j) / 2.0) / (n - 1)     # midrank of the tied block
        for k in range(i, j + 1):
            pct[ranked[k]["eos_id"]] = shared
        i = j + 1
    return pct


def calc_match_elo_changes(players: list[dict]) -> dict[str, int]:
    """ELO deltas for every player in one match: {eos_id: delta}.

    Each player dict needs: eos_id, team_id, perf_score, was_winner
    (True/False/None — None is a draw), elo, matches_played.
    """
    if not players:
        return {}

    perf_pct = _percentiles(players)

    team1 = [p for p in players if p.get("team_id") == 1]
    team2 = [p for p in players if p.get("team_id") == 2]
    avg1 = (sum(p["elo"] for p in team1) / len(team1)) if team1 else float(STARTING_ELO)
    avg2 = (sum(p["elo"] for p in team2) / len(team2)) if team2 else float(STARTING_ELO)

    changes: dict[str, int] = {}
    for p in players:
        opp_avg = avg2 if p.get("team_id") == 1 else avg1
        expected = 1.0 / (1.0 + 10.0 ** ((opp_avg - p["elo"]) / ELO_OPPONENT_DIVISOR))
        won = p.get("was_winner")
        win_score = 0.5 if won is None else (1.0 if won else 0.0)
        actual = _WIN_WEIGHT * win_score + _PERF_WEIGHT * perf_pct[p["eos_id"]]
        k = K_INITIAL if (p.get("matches_played") or 0) < 100 else K_STABLE
        delta = round(k * (actual - expected))
        changes[p["eos_id"]] = int(max(-ELO_MATCH_CAP, min(ELO_MATCH_CAP, delta)))
    return changes


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

# Below these, a match says nothing useful about skill: a 20-player seed round or
# a 3-minute restart is noise, and a player who joined for the last two minutes
# did not play it.
MIN_PLAYERS = 40
MIN_DURATION_SEC = 900
MIN_PLAYTIME_SEC = 600

# Column list shared by the live-apply and recalc paths, so performance_score
# sees the same fields both ways.
_PERF_COLS = (
    "pm.eos_id, pm.team_id, pm.playtime_sec, pm.kills, pm.vehicle_kills, "
    "pm.deaths, pm.team_kills, pm.revived_points, pm.heal_points, "
    "pm.objective_score, pm.team_work_score, pm.is_commander, "
    "pm.supplies_delivered, pm.fobs_built, pm.fobs_destroyed, "
    "pm.captures, pm.defenses, pm.vehicle_damage")

_PLAYER_SQL = f"""
SELECT {_PERF_COLS},
       COALESCE(pe.elo_rating, ?)   AS elo,
       COALESCE(pe.matches_played, 0) AS matches_played
FROM player_matches pm
LEFT JOIN player_elo pe ON pe.eos_id = pm.eos_id
WHERE pm.match_id = ? AND COALESCE(pm.playtime_sec, 0) >= ?
"""


def _was_winner(team_id: Any, winner_team: Any) -> Optional[bool]:
    """True/False/None(draw or unknown).

    `winner_team` is 0 for a real draw and NULL when the tickets could not be
    read. Both become None: an unknown result must not be scored as a loss.
    """
    if winner_team is None or winner_team == 0 or team_id is None:
        return None
    return bool(team_id == winner_team)


def apply_match_elo(cur: sqlite3.Cursor, match_id: str, *,
                    min_players: int = MIN_PLAYERS,
                    min_duration: int = MIN_DURATION_SEC,
                    min_playtime: int = MIN_PLAYTIME_SEC,
                    now: Optional[int] = None) -> int:
    """Rate one finished match. Returns how many players were rated (0 = skipped).

    Runs on the caller's cursor, inside the caller's transaction — `_finalize_match`
    stamps `winner_team` and then calls this, and the two must commit or roll back
    together. A half-applied match would leave ratings that no `elo_change` row
    explains, and the idempotency guard below would then refuse to fix it.
    """
    m = cur.execute(
        "SELECT duration_sec, winner_team, "
        "  (SELECT COUNT(*) FROM player_matches WHERE match_id = ?) AS n "
        "FROM matches WHERE match_id = ?", (match_id, match_id)).fetchone()
    if m is None:
        return 0
    duration, winner_team, n_players = m[0], m[1], m[2]
    if (n_players or 0) < min_players or (duration or 0) < min_duration:
        return 0

    # Idempotency. ELO is not reversible: it moves a shared running total and
    # increments matches_played, so applying a match twice double-counts it. Any
    # non-NULL elo_change for this match means it has already been rated.
    # `recalc_all_elo` clears elo_change before replaying, so it is not blocked.
    if cur.execute(
            "SELECT 1 FROM player_matches "
            "WHERE match_id = ? AND elo_change IS NOT NULL LIMIT 1",
            (match_id,)).fetchone():
        return 0

    rows = cur.execute(
        _PLAYER_SQL, (STARTING_ELO, match_id, min_playtime)).fetchall()
    if not rows:
        return 0

    players = []
    for r in rows:
        d = dict(r)
        d["was_winner"] = _was_winner(d.get("team_id"), winner_team)
        d["perf_score"] = performance_score(d)
        players.append(d)

    deltas = calc_match_elo_changes(players)
    ts = int(now if now is not None else time.time())
    for p in players:
        eos = p["eos_id"]
        delta = deltas.get(eos, 0)
        new_elo = max(1, int(p["elo"]) + delta)   # floor at 1, never zero/negative
        cur.execute(
            "INSERT INTO player_elo (eos_id, elo_rating, matches_played, updated_at) "
            "VALUES (?,?,1,?) "
            "ON CONFLICT(eos_id) DO UPDATE SET "
            "  elo_rating=excluded.elo_rating, "
            "  matches_played=player_elo.matches_played+1, "
            "  updated_at=excluded.updated_at",
            (eos, new_elo, ts))
        cur.execute(
            "UPDATE player_matches SET elo_change=? WHERE match_id=? AND eos_id=?",
            (delta, match_id, eos))
    return len(players)


def recalc_all_elo(db_path: Path, *,
                   min_players: int = MIN_PLAYERS,
                   min_duration: int = MIN_DURATION_SEC,
                   min_playtime: int = MIN_PLAYTIME_SEC,
                   progress=None) -> dict:
    """Rebuild every rating from scratch, oldest match first.

    This is the canonical repair, and it is needed more often than it sounds:
    `player_matches` counters are MAX-upserted, so backfilling an archive can
    RAISE the stats of a match whose ELO was already applied. Live ELO cannot
    retroactively fix that; a chronological replay can.

    Ratings are carried in memory across the whole run, so a player's second
    match sees the rating their first one earned.
    """
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        with conn:
            conn.execute("UPDATE player_matches SET elo_change=NULL")
            conn.execute("DELETE FROM player_elo")

        matches = conn.execute(
            "SELECT m.match_id, m.winner_team FROM matches m "
            "WHERE COALESCE(m.duration_sec,0) >= ? "
            "  AND (SELECT COUNT(*) FROM player_matches pm "
            "       WHERE pm.match_id = m.match_id) >= ? "
            "ORDER BY m.started_at ASC", (min_duration, min_players)).fetchall()

        # {eos_id: [elo, matches_played]} — the running state.
        state: dict[str, list[int]] = {}
        rated = skipped = 0
        ts = int(time.time())

        for mi, m in enumerate(matches):
            match_id = m["match_id"]
            rows = conn.execute(
                # Same columns performance_score consumes on the live path.
                # _PERF_COLS is pm-qualified; here the FROM has no alias, so
                # drop the "pm." prefix.
                "SELECT " + _PERF_COLS.replace("pm.", "") + " "
                "FROM player_matches "
                "WHERE match_id=? AND COALESCE(playtime_sec,0) >= ?",
                (match_id, min_playtime)).fetchall()
            if len(rows) < min_players:
                skipped += 1
                continue

            players = []
            for r in rows:
                d = dict(r)
                st = state.setdefault(d["eos_id"], [STARTING_ELO, 0])
                d["elo"], d["matches_played"] = st[0], st[1]
                d["was_winner"] = _was_winner(d["team_id"], m["winner_team"])
                d["perf_score"] = performance_score(d)
                players.append(d)

            deltas = calc_match_elo_changes(players)
            with conn:
                for p in players:
                    eos = p["eos_id"]
                    delta = deltas.get(eos, 0)
                    st = state[eos]
                    st[0] = max(1, st[0] + delta)
                    st[1] += 1
                    conn.execute(
                        "INSERT INTO player_elo "
                        "  (eos_id, elo_rating, matches_played, updated_at) "
                        "VALUES (?,?,?,?) "
                        "ON CONFLICT(eos_id) DO UPDATE SET "
                        "  elo_rating=excluded.elo_rating, "
                        "  matches_played=excluded.matches_played, "
                        "  updated_at=excluded.updated_at",
                        (eos, st[0], st[1], ts))
                    conn.execute(
                        "UPDATE player_matches SET elo_change=? "
                        "WHERE match_id=? AND eos_id=?", (delta, match_id, eos))
            rated += 1
            if progress and (mi + 1) % 100 == 0:
                progress(mi + 1, len(matches))

        ratings = [v[0] for v in state.values()]
        ratings.sort()
        return {
            "matchesRated": rated,
            "matchesSkipped": skipped,
            "playersRated": len(state),
            "medianElo": ratings[len(ratings) // 2] if ratings else None,
            "minElo": ratings[0] if ratings else None,
            "maxElo": ratings[-1] if ratings else None,
        }
    finally:
        conn.close()


__all__ = [
    "ELO_TIERS", "STARTING_ELO", "elo_tier_for", "performance_score",
    "calc_match_elo_changes", "apply_match_elo", "recalc_all_elo",
    "MIN_PLAYERS", "MIN_DURATION_SEC", "MIN_PLAYTIME_SEC",
]
