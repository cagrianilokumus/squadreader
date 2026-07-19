"""Persistent player-statistics store (SQLite, WAL).

One `StatsStore` instance lives on the serve thread and is fed one snapshot
per tick via `record_tick()`. It buckets by match exactly like recorder.py
(matchState=="InProgress" + matchId edges) and UPSERTs each player's running
stats into `player_matches`, plus per-kill rows into `kill_events`. Lifetime
totals are computed on read (SUM/GROUP BY over player_matches), never
denormalised — single source of truth.

Read helpers (search_players / player_profile / leaderboard) are module-level
and open their own short-lived `mode=ro` connections, so HTTP handler threads
never touch the writer's connection. WAL lets readers run without blocking the
0.5 Hz writer.

Stability contract: this module must NEVER be able to crash the live reader.
The caller (cli.py serve loop) wraps every call in try/except; here we keep the
writes cheap, idempotent (UPSERT / INSERT OR IGNORE on stable keys), and in one
transaction per tick that rolls back cleanly on error.
"""
from __future__ import annotations

import json
import math
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, NamedTuple, Optional

from . import elo as elo_mod

# --------------------------------------------------------------------------
# Schema
# --------------------------------------------------------------------------

_DDL = """
CREATE TABLE IF NOT EXISTS matches (
  match_id      TEXT PRIMARY KEY,
  server_id     TEXT NOT NULL,
  map_name      TEXT,
  layer_name    TEXT,
  game_mode     TEXT,
  game_mode_id  TEXT,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  duration_sec  INTEGER,
  status        TEXT NOT NULL DEFAULT 'open',
  winner_team   INTEGER,
  team1_faction TEXT, team2_faction TEXT,
  team1_tickets INTEGER, team2_tickets INTEGER,
  peak_players  INTEGER DEFAULT 0,
  tick_count    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_status  ON matches(status);

CREATE TABLE IF NOT EXISTS player_matches (
  match_id        TEXT NOT NULL,
  eos_id          TEXT NOT NULL,
  name            TEXT, clan_tag TEXT,
  team_id         INTEGER, role_id TEXT, squad_name TEXT, faction TEXT,
  kills           INTEGER DEFAULT 0, vehicle_kills INTEGER DEFAULT 0,
  deaths          INTEGER DEFAULT 0, woundeds INTEGER DEFAULT 0,
  wounds          INTEGER DEFAULT 0, team_kills INTEGER DEFAULT 0,
  heal_points     REAL DEFAULT 0, revived_points REAL DEFAULT 0,
  team_work_score REAL DEFAULT 0, objective_score REAL DEFAULT 0,
  combat_score    REAL DEFAULT 0, score REAL DEFAULT 0, lives INTEGER,
  is_commander    INTEGER DEFAULT 0, is_admin INTEGER DEFAULT 0,
  first_seen_at   INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  playtime_sec    INTEGER DEFAULT 0, tick_count INTEGER DEFAULT 0,
  PRIMARY KEY (match_id, eos_id)
);
CREATE INDEX IF NOT EXISTS idx_pm_eos  ON player_matches(eos_id);
CREATE INDEX IF NOT EXISTS idx_pm_name ON player_matches(name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS players (
  eos_id        TEXT PRIMARY KEY,
  last_name     TEXT, last_clan_tag TEXT,
  first_seen_at INTEGER, last_seen_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_players_name ON players(last_name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS kill_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id       TEXT NOT NULL,
  ts             REAL, tick INTEGER,
  attacker_eos   TEXT, attacker_name TEXT, attacker_team INTEGER,
  victim_eos     TEXT, victim_name TEXT, victim_team INTEGER,
  weapon         TEXT, damage_type TEXT, hit_distance REAL,
  headshot       INTEGER, killed INTEGER, wounded INTEGER,
  self_inflicted INTEGER, team_kill INTEGER, source TEXT
);
CREATE INDEX IF NOT EXISTS idx_ke_match    ON kill_events(match_id);
CREATE INDEX IF NOT EXISTS idx_ke_attacker ON kill_events(attacker_eos);
CREATE INDEX IF NOT EXISTS idx_ke_victim   ON kill_events(victim_eos);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ke_dedupe
  ON kill_events(match_id, victim_name, attacker_name, ts, killed, wounded);
"""

# --------------------------------------------------------------------------
# Migrations
#
# `_DDL` above is the baseline (user_version 0) and is frozen: it is what every
# existing production DB already has. Everything after it is an additive
# migration, applied in order and stamped into `PRAGMA user_version`.
#
# Rules for anything added here:
#   - Additive only (ADD COLUMN / CREATE ... IF NOT EXISTS). An older sqreader
#     binary must keep working against a newer DB, because rollback is "deploy
#     the previous version" and the DB does not roll back with it.
#   - Idempotent. Each migration re-checks the live schema rather than trusting
#     the version stamp, so a DB that got a column some other way still lands in
#     the same place instead of dying on "duplicate column name".
# --------------------------------------------------------------------------


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def _m001_kill_event_positions(conn: sqlite3.Connection) -> None:
    """Where the kill happened, and how far apart the two players were.

    Log-sourced kill events carry no coordinates, so these are joined from the
    same tick's memory read at insert time (see `_insert_kill_events`). Columns
    are nullable on purpose: a bleed-out death whose pawn has already despawned
    has no victim position, and the no-guess policy says NULL, not a guess.

    Units: x/y are raw UE centimetres, exactly as the snapshot reports them, so
    the frontend can reuse the same layer-bounds transform as the live map.
    `distance_m` is METRES — it is the one value a human reads directly.
    """
    have = _columns(conn, "kill_events")
    for col in ("attacker_x", "attacker_y", "victim_x", "victim_y", "distance_m"):
        if col not in have:
            conn.execute(f"ALTER TABLE kill_events ADD COLUMN {col} REAL")
    # Partial index: heatmaps only ever ask for the positioned rows, and on a
    # historical DB those are the minority (positions are forward-only — see
    # the note in `_insert_kill_events`).
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ke_match_pos ON kill_events(match_id) "
        "WHERE victim_x IS NOT NULL")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ke_ts ON kill_events(ts)")


def _m002_player_elo(conn: sqlite3.Connection) -> None:
    """Per-player rating, plus the per-match delta that produced it.

    `elo_change` doubles as the "this match has been rated" marker — see the
    idempotency guard in elo.apply_match_elo. That is why it is nullable and has
    no default: NULL means "not rated", 0 means "rated, and the delta was zero".
    """
    conn.execute(
        "CREATE TABLE IF NOT EXISTS player_elo ("
        "  eos_id         TEXT PRIMARY KEY,"
        "  elo_rating     INTEGER NOT NULL DEFAULT 1000,"
        "  matches_played INTEGER NOT NULL DEFAULT 0,"
        "  updated_at     INTEGER)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_elo_rating "
        "ON player_elo(elo_rating DESC)")
    if "elo_change" not in _columns(conn, "player_matches"):
        conn.execute("ALTER TABLE player_matches ADD COLUMN elo_change INTEGER")


def _m003_plugin_alerts(conn: sqlite3.Connection) -> None:
    """What the plugins found. `details` is JSON — the evidence behind the call.

    Deliberately not foreign-keyed to matches: an alert about a player is still
    worth keeping if the match row is later swept, and a FK would make the
    plugin's write depend on the stats writer having got there first.
    """
    conn.execute(
        "CREATE TABLE IF NOT EXISTS plugin_alerts ("
        "  id          INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  ts          REAL NOT NULL,"
        "  tick        INTEGER,"
        "  plugin_id   TEXT NOT NULL,"
        "  alert_type  TEXT NOT NULL,"
        "  eos_id      TEXT,"
        "  player_name TEXT,"
        "  match_id    TEXT,"
        "  confidence  REAL,"
        "  details     TEXT)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pa_type_ts "
        "ON plugin_alerts(alert_type, ts DESC)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pa_eos ON plugin_alerts(eos_id)")


def _m004_collector_stats(conn: sqlite3.Connection) -> None:
    """Squad's own per-player counters, read from the stats-collector arrays
    (snapshot.py). Memory-only — these are not in RCON/ListPlayers. Same
    MAX-upsert treatment as the other counters, so a reconnect (which resets the
    live value) can never lower a match total."""
    have = _columns(conn, "player_matches")
    cols = {
        "supplies_delivered": "INTEGER DEFAULT 0",
        "fobs_built":         "INTEGER DEFAULT 0",
        "fobs_destroyed":     "INTEGER DEFAULT 0",
        "vehicle_damage":     "REAL DEFAULT 0",
        "captures":           "INTEGER DEFAULT 0",
        "defenses":           "INTEGER DEFAULT 0",
    }
    for col, decl in cols.items():
        if col not in have:
            conn.execute(f"ALTER TABLE player_matches ADD COLUMN {col} {decl}")


def _m005_vehicle_sessions(conn: sqlite3.Connection) -> None:
    """One row per (player, vehicle, seat) stint: how long they were in it and
    how far the vehicle travelled while they were. Powers "most-used vehicles"
    and ground-distance-driven stats. kills_in_seat is intentionally absent —
    attributing a kill to a seat needs the kill-attribution coupling that
    sqreader's log-sourced events don't yet carry (documented follow-up)."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS vehicle_session ("
        "  id            INTEGER PRIMARY KEY AUTOINCREMENT,"
        "  match_id      TEXT NOT NULL,"
        "  eos_id        TEXT NOT NULL,"
        "  vehicle_class TEXT,"
        "  seat          INTEGER,"
        "  entered_at    INTEGER NOT NULL,"
        "  exited_at     INTEGER NOT NULL,"
        "  distance_m    REAL DEFAULT 0)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vs_eos ON vehicle_session(eos_id)")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vs_match ON vehicle_session(match_id)")


# Index i migrates user_version i -> i+1.
_MIGRATIONS = [
    _m001_kill_event_positions,
    _m002_player_elo,
    _m003_plugin_alerts,
    _m004_collector_stats,
    _m005_vehicle_sessions,
]

SCHEMA_VERSION = len(_MIGRATIONS)


def apply_migrations(conn: sqlite3.Connection) -> int:
    """Bring `conn` up to SCHEMA_VERSION. Returns the version it ends on.

    Safe to call on a brand-new DB (straight after the baseline `_DDL`) and on
    a long-lived production one — both start at user_version 0 and converge.
    """
    have = int(conn.execute("PRAGMA user_version").fetchone()[0] or 0)
    for i in range(have, len(_MIGRATIONS)):
        with conn:
            _MIGRATIONS[i](conn)
            # PRAGMA does not take bound parameters; i is ours, not user input.
            conn.execute(f"PRAGMA user_version = {i + 1}")
    return SCHEMA_VERSION

# player_matches counter columns → aggregated with MAX(existing, new) so a
# null read or a disconnect/reconnect (which resets NumKills to 0) can never
# lower the match total. Counters only ever rise within a match.
_PM_COUNTERS_INT = ("kills", "vehicle_kills", "deaths", "woundeds", "wounds",
                    "team_kills", "is_commander", "is_admin",
                    # Squad stats-collector counters (memory-only). Monotonic
                    # within a match, so MAX-upsert like the rest.
                    "supplies_delivered", "fobs_built", "fobs_destroyed",
                    "captures", "defenses")
_PM_COUNTERS_REAL = ("heal_points", "revived_points", "team_work_score",
                     "objective_score", "combat_score", "score",
                     "vehicle_damage")
# descriptive columns → COALESCE(new, existing): keep last non-null value.
# ('score' is APlayerState.Score, a monotonic per-match total that resets to 0
#  on reconnect, so it belongs with the MAX counters above, not here.)
_PM_DESC = ("name", "clan_tag", "team_id", "role_id", "squad_name", "faction",
            "lives")


def _i(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _f(v: Any) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# Hard sanity bounds on per-tick stat reads. A memory read can occasionally
# return junk — a pointer's low bits, an unrelated float reinterpreted, a
# negative from a torn read, or a fixed ~31950 sentinel a transient/ghost
# player yields on its first tick. With the MAX-upsert a SINGLE junk tick would
# latch a match total forever, so we reject implausible values right here: a
# rejected read returns None → becomes 0 (counters) / stays NULL (descriptive),
# and MAX()/COALESCE() keep the last sane value.
#
# Bounds come from the observed distribution over ~50k real player-matches:
#   counts — real max ~459 (6h seed matches), then a clean EMPTY gap up to a
#     ~31950 junk cluster. 5000 sits in that gap: keeps every real value,
#     rejects the sentinel with a 6x margin.
#   scores — legit into the thousands (objectiveScore/score routinely 500-5000,
#     combatScore tops out ~5900), while junk is in the millions (5e7+) or 1e35.
#     100k keeps all real scores and rejects the millions cleanly.
_COUNT_MAX = 5_000
_SCORE_MIN, _SCORE_MAX = -100_000.0, 100_000.0


def _count(v: Any) -> Optional[int]:
    """Non-negative integer stat within sane bounds, else None (junk read)."""
    n = _i(v)
    if n is None or n < 0 or n > _COUNT_MAX:
        return None
    return n


# vehicle_kills has a FAR lower real ceiling than infantry kills — even a
# dominant armor match tops out a few dozen (live max ~57). The shared
# _count(5000) admits a ~460-535 torn-read junk band (adjacent int32 stat
# fields — kills/deaths/vehicleKills — read from a garbage region as a
# ~459/460/461 sequence) that MAX-upsert then latches into a match total
# forever, floating a low-match player to rank 1 on the Vehicle board. Give it
# its own ceiling in the clean empty gap between real (<~60) and junk (>=460).
_VEHICLE_KILL_MAX = 150


def _vk(v: Any) -> Optional[int]:
    """Vehicle-kill count within a sane per-match ceiling, else None."""
    n = _i(v)
    if n is None or n < 0 or n > _VEHICLE_KILL_MAX:
        return None
    return n


def _score(v: Any) -> Optional[float]:
    """Float score within sane bounds, else None (junk read)."""
    x = _f(v)
    if x is None or x < _SCORE_MIN or x > _SCORE_MAX:
        return None
    return x


# RevivedPoints increments by exactly 1 per revive — verified against the live
# distribution: the values are integers (mode 1, 9525 of them; real per-match
# max ~30), so this IS the revive COUNT, not a weighted score. A torn read
# instead yields a NON-INTEGER float (16001.3, 6028.9, 482.2 seen live) that
# slips past the wide _score bound. Reject non-integers and anything past a
# generous per-match ceiling (30 observed → 500 leaves 16x headroom, and the
# real/garbage gap is clean from 30 to 482).
_REVIVE_MAX = 500


def _revive(v: Any) -> Optional[float]:
    """Revive count (RevivedPoints, 1/revive): a non-negative integer within a
    sane per-match ceiling, else None. Non-integer → torn read, not a count."""
    x = _f(v)
    if x is None or x < 0 or x > _REVIVE_MAX:
        return None
    if abs(x - round(x)) > 0.01:
        return None
    return float(round(x))


# The collector counters are CUMULATIVE totals, not per-tick counts, so their
# real ceilings are far higher than the PSD stats above: a dedicated logi runner
# delivers tens of thousands of supply points a match, and a tank crew's
# cumulative vehicle-damage runs into the hundreds of thousands. The tight
# _count/_score sentinel-rejection would clip legitimate values here — and it is
# less needed, because the collector arrays are read behind their own pointer +
# count sanity gates (snapshot._read_collector_array), so a freed-struct junk
# read is already unlikely. Reject only the impossible (negative, or the
# millions-and-up cluster that a torn pointer produces).
_COLLECTOR_INT_MAX = 10_000_000
_COLLECTOR_REAL_MAX = 100_000_000.0


def _wide_count(v: Any) -> Optional[int]:
    n = _i(v)
    if n is None or n < 0 or n > _COLLECTOR_INT_MAX:
        return None
    return n


def _wide_score(v: Any) -> Optional[float]:
    x = _f(v)
    if x is None or x < 0 or x > _COLLECTOR_REAL_MAX:
        return None
    return x


# EOS/account ids the real server emits are 32-hex (EOS ProductUserId) or 36-char
# UUIDs (hex + dashes). A torn OnlineUserId read instead yields a short fragment
# (0-16 chars) or junk. Those can't identify a player and badly pollute the
# leaderboard — e.g. an empty-name "ghost" under a 1-char key aggregating
# unrelated ticks across dozens of matches. Require a full-length hex/dash id:
# everything the live server produces passes, torn reads don't.
_EOS_CHARS = frozenset("0123456789abcdefABCDEF-")


def _valid_eos(eos: Any) -> bool:
    return (isinstance(eos, str) and len(eos) >= 30
            and all(c in _EOS_CHARS for c in eos))


# A player name is a short display string. A torn PlayerNamePrivate read can
# return control bytes or a runaway length that renders as a mojibake blob;
# reject those rather than latching them via COALESCE. Real names — including
# non-ASCII (Turkish, Cyrillic, CJK) — pass; only control chars / absurd length
# are rejected, leaving the last good name in place.
def _clean_name(name: Any) -> Optional[str]:
    if not isinstance(name, str) or not name or len(name) > 48:
        return None
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in name):
        return None
    return name


# A codepoint that a torn/stale PlayerNamePrefix read produces but a real clan
# tag never uses. Genuine stylized tags use symbols, brackets ("『GM』", "〖GM〗"),
# fullwidth forms and Latin/Greek/Cyrillic — NONE of which are in these ranges,
# so keeping them is safe. What lands here is misread-UTF-16 garbage: random CJK
# / Hangul / Kana ideographs, box "block elements" (▇▆), and zalgo combining
# marks. NOTE: this rejects a genuinely CJK/Hangul clan tag too — an accepted
# tradeoff, since torn-read ideograph garbage is far more common than a real
# short all-ideograph tag, and it is the "Chinese-looking mojibake" complaint.
# Keep in sync with the inline gate in squad/snapshot.py and central's
# clean_clan_tag().
def _tag_char_is_junk(o: int) -> bool:
    return (
        o < 0x20 or o == 0x7F                 # control chars
        or 0x0300 <= o <= 0x036F              # combining diacritics (zalgo)
        or 0x1100 <= o <= 0x11FF              # Hangul Jamo
        or 0x2580 <= o <= 0x259F              # block elements (▇ ▆ ▙ …)
        or 0x3040 <= o <= 0x30FF              # Hiragana + Katakana
        or 0x3130 <= o <= 0x318F              # Hangul Compatibility Jamo
        or 0x3400 <= o <= 0x4DBF              # CJK Extension A
        or 0x4E00 <= o <= 0x9FFF              # CJK Unified Ideographs
        or 0xA960 <= o <= 0xA97F              # Hangul Jamo Extended-A
        or 0xAC00 <= o <= 0xD7FF              # Hangul Syllables (+ Jamo Ext-B)
        or 0xE000 <= o <= 0xF8FF              # private-use area (torn-read)
        or 0xF900 <= o <= 0xFAFF              # CJK Compatibility Ideographs
        or o == 0xFFFD                        # UTF-16 replacement char
        or 0x20000 <= o <= 0x3FFFF            # CJK Extension B+ (astral)
    )


# The clan tag (PlayerNamePrefix) is a very short in-game field read from an
# embedded FString. Unlike the name it was never validated: torn/stale reads
# decode as CJK mojibake, land on private-use/control bytes, or alias onto the
# player's OnlineUserId buffer (the "eos-id-as-tag" rows) — then COALESCE
# latches them forever. Keep legit short stylized-Unicode tags ("BΛDGΞR♦",
# "『GM』", "✦ AC ✦"); reject the torn-read mojibake (see _tag_char_is_junk),
# the leaked eos id, empties, and runaway lengths.
def _clean_tag(tag: Any) -> Optional[str]:
    if not isinstance(tag, str):
        return None
    t = tag.strip()
    if not t or len(t) > 16:
        return None
    if any(_tag_char_is_junk(ord(c)) for c in t):
        return None
    if _valid_eos(t):                  # leaked OnlineUserId, never a tag
        return None
    return t


def _xy(p: dict) -> Optional[tuple[float, float]]:
    """A player's world (x, y) in UE centimetres, or None if we don't know it.

    A `stale` soldier block means the pawn pointer was already freed, so its
    coordinates are whatever happens to sit in that memory now — worse than no
    answer. Same for a non-finite read. Both become None, and a kill event with
    no position simply stores NULL.
    """
    sol = p.get("soldier")
    if not isinstance(sol, dict) or sol.get("stale"):
        return None
    pos = sol.get("position")
    if not isinstance(pos, dict):
        return None
    x, y = _f(pos.get("x")), _f(pos.get("y"))
    if x is None or y is None or not (math.isfinite(x) and math.isfinite(y)):
        return None
    return (x, y)


class _TickIndex(NamedTuple):
    """Lookups built while upserting players, consumed by the kill-event writer.

    Kill events come from the server log (see squad/logtail.py), which knows
    names, sometimes an attacker EOS id, and nothing else. Team and position are
    joined here from the same tick's memory read — a real observation, at most
    one tick (~2 s at the production rate) older than the event itself.
    """
    name_to_eos: dict[str, str]
    name_to_team: dict[str, int]
    pos_by_eos: dict[str, tuple[float, float]]
    pos_by_name: dict[str, tuple[float, float]]


def _epoch(snap: dict) -> int:
    """Snapshot 'timestamp' (ISO 8601) -> epoch seconds, robust to junk."""
    ts = snap.get("timestamp")
    if isinstance(ts, str):
        try:
            return int(datetime.fromisoformat(
                ts.replace("Z", "+00:00")).timestamp())
        except Exception:
            pass
    return int(time.time())


# --------------------------------------------------------------------------
# Writer
# --------------------------------------------------------------------------

class StatsStore:
    def __init__(self, db_path: Path, *, server_id: str,
                 elo: bool = True,
                 elo_min_players: int = elo_mod.MIN_PLAYERS,
                 elo_min_duration: int = elo_mod.MIN_DURATION_SEC,
                 elo_min_playtime: int = elo_mod.MIN_PLAYTIME_SEC,
                 on_finalize: Optional[Callable[[str], None]] = None) -> None:
        self.server_id = server_id
        # Fired (post-commit) with each match_id the moment it finalizes. The
        # serve loop uses it to enqueue a central push; kept as an injected
        # callback so stats.py never imports the push client (clean layering).
        self._on_finalize = on_finalize
        # Thresholds are constructor args, not constants, because what counts as
        # "a real match" is a property of the server, not of the algorithm — a
        # community that runs 30-player rounds should be able to rate them.
        self.elo = elo
        self.elo_min_players = elo_min_players
        self.elo_min_duration = elo_min_duration
        self.elo_min_playtime = elo_min_playtime
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=True (default): writer is only ever touched from the
        # serve thread. Readers use their own connections (module fns below).
        self.conn = sqlite3.connect(str(db_path), timeout=5.0)
        # Row (not tuple) so the ELO pass can read columns by name. Row still
        # indexes positionally, so the existing `fetchone()[0]` reads are fine.
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA synchronous=NORMAL")
        self.conn.execute("PRAGMA busy_timeout=2000")
        self.conn.executescript(_DDL)
        apply_migrations(self.conn)
        # Startup sweep: any match left 'open' by a hard kill is finalized so
        # it never lingers. A genuinely-live match is re-armed to 'open' by
        # _open_match's ON CONFLICT on the next tick.
        with self.conn:
            self.conn.execute(
                "UPDATE matches SET status='final', "
                "ended_at=COALESCE(ended_at, started_at), "
                "duration_sec=MAX(0, COALESCE(ended_at, started_at) - started_at) "
                "WHERE status='open'")
        self._open_match_id: Optional[str] = None
        self._last_snap: Optional[dict] = None
        # Open vehicle sessions, keyed by eos_id (a player is in at most one
        # seat at a time). Value: dict(vehicle_id, vehicle_class, seat,
        # entered_at, exited_at, last_xy, distance_cm).
        self._veh_sessions: dict[str, dict] = {}

    # -- per-tick entry point ------------------------------------------------
    def record_tick(self, snap: dict) -> None:
        gs = snap.get("gameState") or {}
        match_state = gs.get("matchState")
        # A tick only counts as an active match when the state says InProgress
        # AND an id came with it. Binding the narrowed id here — rather than a
        # separate `active` bool — is what lets the branch below hand match_id
        # straight to the writers: inside `else`, it is a plain str.
        match_id: Optional[str] = (
            gs.get("matchId") if match_state == "InProgress" else None) or None
        now = _epoch(snap)
        # Drive the transaction off a LOCAL copy of the open-match id and only
        # advance the instance attributes AFTER the `with` block commits.
        # Otherwise a rollback (e.g. a commit-time SQLITE_FULL/BUSY) would undo
        # the matches-row INSERT while `self._open_match_id` stayed set — the
        # guard below would then never re-open the row, orphaning the rest of
        # the match. On a rolled-back tick the attributes stay put and the next
        # tick simply retries the same open/finalize logic.
        open_id = self._open_match_id
        # Match ids finalized in THIS transaction — the hook fires only after
        # commit, so a rolled-back tick never signals a false finalize.
        finalized: list[str] = []

        with self.conn:
            cur = self.conn.cursor()
            if match_id is None:
                if open_id is not None:
                    self._finalize_match(cur, open_id, self._last_snap,
                                         f"matchState={match_state!r}")
                    finalized.append(open_id)
                self._flush_vehicle_sessions(cur)
                new_open = None
            else:
                if open_id is not None and open_id != match_id:
                    self._finalize_match(cur, open_id, self._last_snap,
                                         "matchId changed")
                    finalized.append(open_id)
                    self._flush_vehicle_sessions(cur)   # belong to the old match
                    open_id = None
                if open_id is None:
                    self._open_match(cur, gs, now)
                self._update_match_running(cur, match_id, snap, gs, now)
                idx = self._upsert_players(cur, snap, match_id, now)
                self._insert_kill_events(cur, snap, match_id, snap.get("tick"),
                                         idx)
                self._track_vehicle_sessions(cur, snap, match_id, now)
                new_open = match_id

        # Commit succeeded — advance in-memory state atomically with the DB.
        self._open_match_id = new_open
        self._last_snap = snap if match_id is not None else None
        self._fire_finalize(finalized)

    def finalize_open_match(self, *, reason: str) -> None:
        if self._open_match_id is None:
            return
        mid = self._open_match_id
        with self.conn:
            cur = self.conn.cursor()
            self._finalize_match(cur, mid, self._last_snap, reason)
            self._flush_vehicle_sessions(cur)
        self._open_match_id = None
        self._last_snap = None
        self._fire_finalize([mid])

    def _fire_finalize(self, match_ids: list[str]) -> None:
        """Notify the (optional) finalize hook post-commit. A hook that raises
        must never corrupt stats recording, so failures are swallowed here."""
        if not self._on_finalize:
            return
        for mid in match_ids:
            try:
                self._on_finalize(mid)
            except Exception:  # noqa: BLE001 - hook is best-effort, never fatal
                pass

    def insert_alert(self, row: dict) -> None:
        """Persist one plugin alert. Serve-thread only, same connection.

        Its own transaction, not the tick's: an alert is an independent
        observation, and a failure to store one must not roll back the tick's
        stats. The caller (PluginManager) already treats a raise here as "lost
        alert", not "lost tick".
        """
        details = row.get("details")
        with self.conn:
            self.conn.execute(
                "INSERT INTO plugin_alerts "
                "(ts, tick, plugin_id, alert_type, eos_id, player_name, "
                " match_id, confidence, details) VALUES (?,?,?,?,?,?,?,?,?)",
                (_f(row.get("ts")) or time.time(), _i(row.get("tick")),
                 str(row.get("plugin_id") or "?"),
                 str(row.get("alert_type") or "?"),
                 row.get("eos_id"), row.get("player_name"), row.get("match_id"),
                 _f(row.get("confidence")),
                 json.dumps(details, ensure_ascii=False)
                 if isinstance(details, (dict, list)) else None))

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass

    # -- internals -----------------------------------------------------------
    def _open_match(self, cur: sqlite3.Cursor, gs: dict, now: int) -> None:
        match_id = gs.get("matchId")
        # Before opening a genuinely new id, finalize any OTHER row still
        # marked 'open' for this server (defensive against a lost edge).
        cur.execute(
            "UPDATE matches SET status='final', "
            "ended_at=COALESCE(ended_at, started_at), "
            "duration_sec=MAX(0, COALESCE(ended_at, started_at) - started_at) "
            "WHERE status='open' AND server_id=? AND match_id<>?",
            (self.server_id, match_id))
        cur.execute(
            "INSERT INTO matches "
            "(match_id, server_id, map_name, layer_name, game_mode, "
            " game_mode_id, started_at, ended_at, status, peak_players, "
            " tick_count) "
            "VALUES (?,?,?,?,?,?,?,?, 'open', 0, 0) "
            "ON CONFLICT(match_id) DO UPDATE SET "
            "  status='open', "
            "  map_name=COALESCE(excluded.map_name, matches.map_name), "
            "  layer_name=COALESCE(excluded.layer_name, matches.layer_name), "
            "  game_mode=COALESCE(excluded.game_mode, matches.game_mode), "
            "  game_mode_id=COALESCE(excluded.game_mode_id, matches.game_mode_id)",
            (match_id, self.server_id, gs.get("mapName"),
             (gs.get("layer") or {}).get("name") or gs.get("mapName"),
             gs.get("gameModeName") or gs.get("gameModeId"),
             gs.get("gameModeId"), now, now))

    def _update_match_running(self, cur: sqlite3.Cursor, match_id: str,
                              snap: dict, gs: dict, now: int) -> None:
        players = snap.get("players") or []
        t1, t2 = self._teams(snap)
        cur.execute(
            "UPDATE matches SET "
            "  ended_at=?, peak_players=MAX(peak_players, ?), "
            "  tick_count=tick_count+1, "
            "  map_name=COALESCE(map_name, ?), "
            "  layer_name=COALESCE(layer_name, ?), "
            "  game_mode=COALESCE(game_mode, ?), "
            "  team1_tickets=COALESCE(?, team1_tickets), "
            "  team2_tickets=COALESCE(?, team2_tickets), "
            "  team1_faction=COALESCE(?, team1_faction), "
            "  team2_faction=COALESCE(?, team2_faction) "
            "WHERE match_id=?",
            (now, len(players),
             gs.get("mapName"),
             (gs.get("layer") or {}).get("name") or gs.get("mapName"),
             gs.get("gameModeName") or gs.get("gameModeId"),
             _count((t1 or {}).get("tickets")), _count((t2 or {}).get("tickets")),
             (t1 or {}).get("factionId"), (t2 or {}).get("factionId"),
             match_id))

    def _upsert_players(self, cur: sqlite3.Cursor, snap: dict, match_id: str,
                        now: int) -> _TickIndex:
        name_to_eos: dict[str, str] = {}
        name_to_team: dict[str, int] = {}
        pos_by_eos: dict[str, tuple[float, float]] = {}
        pos_by_name: dict[str, tuple[float, float]] = {}
        # team -> faction, for the per-player faction column.
        t1, t2 = self._teams(snap)
        fac = {}
        if t1 is not None:
            fac[_i(t1.get("id"))] = t1.get("factionId")
        if t2 is not None:
            fac[_i(t2.get("id"))] = t2.get("factionId")

        for p in (snap.get("players") or []):
            eos = p.get("eosId")
            if not _valid_eos(eos):
                continue  # no stable/valid key → torn read or bot, don't persist
            name = _clean_name(p.get("name"))
            team = _i(p.get("teamId"))
            if name:
                name_to_eos.setdefault(name, eos)
                if team is not None:
                    name_to_team.setdefault(name, team)
            xy = _xy(p)
            if xy is not None:
                pos_by_eos.setdefault(eos, xy)
                if name:
                    pos_by_name.setdefault(name, xy)
            st = p.get("stats") or {}
            vals = {
                "name": name, "clan_tag": _clean_tag(p.get("clanTag")),
                "team_id": team, "role_id": p.get("roleId"),
                "squad_name": p.get("squadName"),
                "faction": fac.get(team),
                "kills": _count(st.get("kills")) or 0,
                "vehicle_kills": _vk(st.get("vehicleKills")) or 0,
                "deaths": _count(st.get("deaths")) or 0,
                "woundeds": _count(st.get("woundeds")) or 0,
                "wounds": _count(st.get("wounds")) or 0,
                "team_kills": _count(st.get("teamKills")) or 0,
                "heal_points": _score(st.get("healPoints")) or 0.0,
                "revived_points": _revive(st.get("revivedPoints")) or 0.0,
                "team_work_score": _score(st.get("teamWorkScore")) or 0.0,
                "objective_score": _score(st.get("objectiveScore")) or 0.0,
                "combat_score": _score(st.get("combatScore")) or 0.0,
                "score": _score(p.get("score")),
                "lives": _count(st.get("lives")),
                "is_commander": 1 if st.get("isCommander") else 0,
                "is_admin": 1 if st.get("isAdmin") else 0,
                # Squad stats-collector counters. None (unreadable) → 0 default;
                # MAX-upsert keeps the last sane value. supplies/vehicle_damage
                # use the wide bounds — they are cumulative totals, not counts.
                "supplies_delivered": _wide_count(st.get("suppliesDelivered")) or 0,
                "fobs_built": _count(st.get("fobsBuilt")) or 0,
                "fobs_destroyed": _count(st.get("fobsDestroyed")) or 0,
                "captures": _count(st.get("captures")) or 0,
                "defenses": _count(st.get("defenses")) or 0,
                "vehicle_damage": _wide_score(st.get("vehicleDamage")) or 0.0,
            }
            self._pm_upsert(cur, match_id, eos, vals, now)
            cur.execute(
                "INSERT INTO players (eos_id, last_name, last_clan_tag, "
                " first_seen_at, last_seen_at) VALUES (?,?,?,?,?) "
                "ON CONFLICT(eos_id) DO UPDATE SET "
                "  last_name=COALESCE(excluded.last_name, players.last_name), "
                "  last_clan_tag=COALESCE(excluded.last_clan_tag, players.last_clan_tag), "
                "  last_seen_at=excluded.last_seen_at",
                (eos, name, _clean_tag(p.get("clanTag")), now, now))
        return _TickIndex(name_to_eos, name_to_team, pos_by_eos, pos_by_name)

    def _pm_upsert(self, cur: sqlite3.Cursor, match_id: str, eos: str,
                   vals: dict, now: int) -> None:
        cols = (["match_id", "eos_id"] + list(_PM_DESC)
                + list(_PM_COUNTERS_INT) + list(_PM_COUNTERS_REAL)
                + ["first_seen_at", "last_seen_at", "playtime_sec",
                   "tick_count"])
        params = [match_id, eos] + [vals.get(c) for c in _PM_DESC] \
            + [vals.get(c) for c in _PM_COUNTERS_INT] \
            + [vals.get(c) for c in _PM_COUNTERS_REAL] \
            + [now, now, 0, 1]
        set_desc = ", ".join(
            f"{c}=COALESCE(excluded.{c}, player_matches.{c})" for c in _PM_DESC)
        set_cnt = ", ".join(
            f"{c}=MAX(player_matches.{c}, COALESCE(excluded.{c}, 0))"
            for c in (_PM_COUNTERS_INT + _PM_COUNTERS_REAL))
        sql = (
            f"INSERT INTO player_matches ({', '.join(cols)}) "
            f"VALUES ({', '.join('?' * len(cols))}) "
            f"ON CONFLICT(match_id, eos_id) DO UPDATE SET "
            f"{set_desc}, {set_cnt}, "
            f"last_seen_at=excluded.last_seen_at, "
            f"playtime_sec=MAX(0, excluded.last_seen_at - player_matches.first_seen_at), "
            f"tick_count=player_matches.tick_count+1")
        cur.execute(sql, params)

    def _insert_kill_events(self, cur: sqlite3.Cursor, snap: dict,
                            match_id: str, tick: Any, idx: _TickIndex) -> None:
        """Persist this tick's kill events, positioned where we can position them.

        Positions come from `idx` — the same tick's memory read — because the
        log lines these events are parsed from carry no coordinates. That makes
        a stored position at most one tick (~2 s in production) older than the
        shot. It is a real observation, never an interpolation.

        Forward-only, by design: the dedupe index makes this INSERT OR IGNORE,
        so rows ingested before this migration stay unpositioned forever. A
        backfill of *not-yet-ingested* .sqrx archives picks the positions up for
        free, since it replays the same snapshots through this same path.
        """
        for ev in (snap.get("damageEvents") or []):
            attacker = ev.get("attacker")
            victim = ev.get("victim")
            a_eos = ev.get("attackerEosId") or idx.name_to_eos.get(attacker)
            v_eos = ev.get("victimEosId") or idx.name_to_eos.get(victim)
            a_team = idx.name_to_team.get(attacker)
            v_team = _i(ev.get("victimTeam"))
            if v_team is None:
                v_team = idx.name_to_team.get(victim)
            self_infl = 1 if ev.get("selfInflicted") else 0
            tk = 1 if (not self_infl and a_team is not None
                       and v_team is not None and a_team == v_team) else 0
            source = "memory" if ev.get("damage") is not None else "log"

            # EOS id first (a stable key), then name. A wounded victim is still
            # on the map, so victim positions land often; an instant kill whose
            # pawn has already despawned yields nothing, and stays NULL.
            a_xy = ((idx.pos_by_eos.get(a_eos) if a_eos else None)
                    or (idx.pos_by_name.get(attacker) if attacker else None))
            v_xy = ((idx.pos_by_eos.get(v_eos) if v_eos else None)
                    or (idx.pos_by_name.get(victim) if victim else None))
            # Only a real 2D range, and only when BOTH ends are real. cm -> m.
            dist_m = (math.hypot(a_xy[0] - v_xy[0], a_xy[1] - v_xy[1]) / 100.0
                      if a_xy and v_xy else None)

            cur.execute(
                "INSERT OR IGNORE INTO kill_events "
                "(match_id, ts, tick, attacker_eos, attacker_name, "
                " attacker_team, victim_eos, victim_name, victim_team, weapon, "
                " damage_type, hit_distance, headshot, killed, wounded, "
                " self_inflicted, team_kill, source, "
                " attacker_x, attacker_y, victim_x, victim_y, distance_m) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (match_id, _f(ev.get("ts")), _i(tick), a_eos, attacker, a_team,
                 v_eos, victim, v_team, ev.get("causerWeapon"),
                 ev.get("damageType"), _f(ev.get("hitDistance")),
                 1 if ev.get("headshot") else 0,
                 1 if ev.get("killed") else 0,
                 1 if ev.get("wounded") else 0,
                 self_infl, tk, source,
                 a_xy[0] if a_xy else None, a_xy[1] if a_xy else None,
                 v_xy[0] if v_xy else None, v_xy[1] if v_xy else None,
                 dist_m))

    def _finalize_match(self, cur: sqlite3.Cursor, match_id: str,
                        last_snap: Optional[dict], reason: str) -> None:
        t1, t2 = self._teams(last_snap or {})
        winner = None
        a, b = _count((t1 or {}).get("tickets")), _count((t2 or {}).get("tickets"))
        if a is not None and b is not None:
            winner = 1 if a > b else (2 if b > a else 0)
        now = _epoch(last_snap) if last_snap else int(time.time())
        cur.execute(
            "UPDATE matches SET status='final', ended_at=?, "
            "  duration_sec=MAX(0, ? - started_at), winner_team=?, "
            "  team1_tickets=COALESCE(?, team1_tickets), "
            "  team2_tickets=COALESCE(?, team2_tickets), "
            "  team1_faction=COALESCE(?, team1_faction), "
            "  team2_faction=COALESCE(?, team2_faction) "
            "WHERE match_id=?",
            (now, now, winner, a, b,
             (t1 or {}).get("factionId"), (t2 or {}).get("factionId"),
             match_id))
        # Rate the match now, on this same cursor: the UPDATE above is what
        # decided `winner_team`, and ELO reads it. Same transaction means they
        # commit together — a rating with no matching final row, or a final row
        # whose rating silently vanished, is the one state we cannot repair
        # (the idempotency guard would treat it as already-rated).
        if self.elo:
            elo_mod.apply_match_elo(
                cur, match_id,
                min_players=self.elo_min_players,
                min_duration=self.elo_min_duration,
                min_playtime=self.elo_min_playtime,
                now=now)

    # -- vehicle sessions ----------------------------------------------------
    # A single tick can move a fast vehicle ~160 m at the production rate; a
    # jump past this is a respawn/teleport/torn read, not travel — don't bank it.
    _VEH_TELEPORT_CM = 50_000.0   # 500 m

    def _track_vehicle_sessions(self, cur: sqlite3.Cursor, snap: dict,
                                match_id: str, now: int) -> None:
        """Open/continue/close per-player vehicle sessions for this tick.

        A player occupies at most one seat, so sessions are keyed by eos. When
        the (vehicle, seat) under a player changes, the old session closes and a
        new one opens. Distance accrues from the vehicle's position delta while
        occupied, teleport-guarded.
        """
        occ: dict[str, tuple] = {}   # eos -> (veh_id, veh_class, seat, xy)
        for v in (snap.get("vehicles") or []):
            veh_id = v.get("id")
            veh_class = v.get("classShort")
            pos = v.get("position")
            xy = None
            if isinstance(pos, dict):
                x, y = _f(pos.get("x")), _f(pos.get("y"))
                if x is not None and y is not None:
                    xy = (x, y)
            for s in (v.get("seats") or []):
                eos = s.get("occupantEosId")
                if eos:
                    occ.setdefault(eos, (veh_id, veh_class, _i(s.get("idx")), xy))

        # Continue or (re)open sessions for currently-seated players.
        for eos, (veh_id, veh_class, seat, xy) in occ.items():
            sess = self._veh_sessions.get(eos)
            if sess is not None and sess["vehicle_id"] == veh_id \
                    and sess["seat"] == seat:
                # Same stint: bank distance if the move is plausible.
                last = sess["last_xy"]
                if last is not None and xy is not None:
                    d = math.hypot(xy[0] - last[0], xy[1] - last[1])
                    if d <= self._VEH_TELEPORT_CM:
                        sess["distance_cm"] += d
                if xy is not None:
                    sess["last_xy"] = xy
                sess["exited_at"] = now
            else:
                if sess is not None:
                    self._close_vehicle_session(cur, eos, sess)
                self._veh_sessions[eos] = {
                    "match_id": match_id, "vehicle_id": veh_id,
                    "vehicle_class": veh_class, "seat": seat,
                    "entered_at": now, "exited_at": now,
                    "last_xy": xy, "distance_cm": 0.0}

        # Close sessions for players who left every seat.
        for eos in [e for e in self._veh_sessions if e not in occ]:
            self._close_vehicle_session(cur, eos, self._veh_sessions.pop(eos))

    def _close_vehicle_session(self, cur: sqlite3.Cursor, eos: str,
                               sess: dict) -> None:
        """Write a finished session — but only if it spanned real time. A
        one-tick tap (entered == exited) is noise, not a stint."""
        if sess["exited_at"] <= sess["entered_at"]:
            return
        cur.execute(
            "INSERT INTO vehicle_session "
            "(match_id, eos_id, vehicle_class, seat, entered_at, exited_at, "
            " distance_m) VALUES (?,?,?,?,?,?,?)",
            (sess["match_id"], eos, sess["vehicle_class"], sess["seat"],
             sess["entered_at"], sess["exited_at"], sess["distance_cm"] / 100.0))

    def _flush_vehicle_sessions(self, cur: sqlite3.Cursor) -> None:
        """Close every open session — match ended, changed, or went inactive."""
        for eos, sess in list(self._veh_sessions.items()):
            self._close_vehicle_session(cur, eos, sess)
        self._veh_sessions.clear()

    @staticmethod
    def _teams(snap: dict) -> tuple[Optional[dict], Optional[dict]]:
        t1 = t2 = None
        for x in (snap.get("teams") or []):
            tid = _i(x.get("id"))
            if tid == 1:
                t1 = x
            elif tid == 2:
                t2 = x
        return t1, t2


# --------------------------------------------------------------------------
# Readers (own read-only connection per call — safe from HTTP threads)
# --------------------------------------------------------------------------

def _ro(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro",
                           uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


def search_players(db_path: Path, q: str, limit: int = 30) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    like = f"%{q}%"
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            "SELECT p.eos_id, p.last_name, p.last_clan_tag, p.last_seen_at, "
            "  COUNT(pm.match_id) AS matches, "
            "  COALESCE(SUM(pm.kills),0) AS kills, "
            "  COALESCE(SUM(pm.deaths),0) AS deaths "
            "FROM players p LEFT JOIN player_matches pm ON pm.eos_id=p.eos_id "
            "  AND pm.match_id IN "
            "  (SELECT match_id FROM matches WHERE status='final') "
            "WHERE p.last_name LIKE ? OR p.last_clan_tag LIKE ? OR p.eos_id=? "
            "GROUP BY p.eos_id ORDER BY p.last_seen_at DESC LIMIT ?",
            (like, like, q, max(1, min(int(limit or 30), 100)))).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


PERIODS = ("daily", "weekly", "monthly", "alltime")


def period_cutoff(period: str, now: Optional[float] = None) -> Optional[int]:
    """Epoch-seconds floor for a leaderboard period; None means all-time.

    Boundaries are UTC: the daily board rolls at 00:00, the weekly one on Monday,
    the monthly one on the 1st. Matches are filtered on `started_at`, so a match
    that began before the cutoff is out even if it ran past it — a board should
    not change retroactively as a long match finishes.

    An unknown period is all-time rather than an error: this feeds a query string,
    and a typo should give the caller everything, not a 500.
    """
    p = (period or "alltime").strip().lower()
    if p not in PERIODS or p == "alltime":
        return None
    t = datetime.fromtimestamp(
        now if now is not None else time.time(), tz=timezone.utc)
    day = t.replace(hour=0, minute=0, second=0, microsecond=0)
    if p == "daily":
        start = day
    elif p == "weekly":
        start = day - timedelta(days=day.weekday())   # Monday
    else:                                             # monthly
        start = day.replace(day=1)
    return int(start.timestamp())


# ── Distributed build: the stats API exposes ONLY finished matches ──
# The in-progress match (matches.status='open' from its first tick until
# finalize flips it to 'final') must never be readable through these reads:
# that would be a near-live view of the RUNNING match — exactly what the
# finalized-only recording gate forbids. Every read below excludes it. Reads
# that join `matches` add `AND m.status='final'`; reads on player_matches /
# kill_events / vehicle_session that do not join `matches` restrict match_id
# to the finalized set. Regression-guarded by test_public_no_live.py.
_LEADER_STATS = {
    "kills": "SUM(pm.kills)", "deaths": "SUM(pm.deaths)",
    "score": "SUM(pm.combat_score)", "revives": "SUM(pm.revived_points)",
    "objective": "SUM(pm.objective_score)", "teamwork": "SUM(pm.team_work_score)",
    "vehicle_kills": "SUM(pm.vehicle_kills)", "matches": "COUNT(pm.match_id)",
    "kd": "CAST(SUM(pm.kills) AS REAL)/MAX(1,SUM(pm.deaths))",
}


def _elo_leaderboard(db_path: Path, limit: int) -> list[dict]:
    """ELO is a running total on player_elo, not a SUM over matches — it cannot
    be period-scoped, and it does not aggregate. Hence its own query."""
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            "SELECT p.eos_id, p.last_name, p.last_clan_tag, "
            "  pe.matches_played AS matches, pe.elo_rating AS value, "
            "  COALESCE(SUM(pm.kills),0) AS kills, "
            "  COALESCE(SUM(pm.deaths),0) AS deaths "
            "FROM player_elo pe "
            "JOIN players p ON p.eos_id = pe.eos_id "
            "LEFT JOIN player_matches pm ON pm.eos_id = pe.eos_id "
            "  AND pm.match_id IN (SELECT match_id FROM matches "
            "                      WHERE status='final') "
            "GROUP BY pe.eos_id "
            "ORDER BY pe.elo_rating DESC LIMIT ?",
            (max(1, min(int(limit or 50), 200)),)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            tier, label, color, next_at, progress = elo_mod.elo_tier_for(
                int(d["value"]))
            d["elo"] = {"rating": int(d["value"]), "tier": tier, "label": label,
                        "color": color, "nextAt": next_at, "progress": progress}
            out.append(d)
        return out
    finally:
        conn.close()


def _context_leaderboard(db_path: Path, context: str, limit: int = 50,
                         period: str = "alltime",
                         now: Optional[float] = None) -> list[dict]:
    """Infantry- vs vehicle-context K/D board, derived from kill_events by
    WEAPON classification (see _VEHICLE_WEAPON_SUBSTRINGS). A kill/death counts
    toward the *vehicle* board when the weapon is a vehicle/emplacement weapon
    (tank cannon, coax, autocannon, ATGM, …) and toward the *infantry* board
    otherwise; unclassifiable (NULL weapon) events count toward neither.

    Approximate by construction (substring match — same basis as
    _longest_infantry_kill): the log-sourced kill_events carry no
    killer_in_vehicle flag, so this attributes by the weapon used, not by
    whether the player was seated. Context deaths come from attributed
    kill_events only, so they run lower than the authoritative death counter
    (bleed/environment deaths are out of context) — intended, context-scoped.
    """
    subs = _VEHICLE_WEAPON_SUBSTRINGS
    if context == "veh_kd":
        pred = "(" + " OR ".join(["instr(lower(weapon), ?) > 0"] * len(subs)) + ")"
    else:  # inf_kd — weapon known and none of the vehicle fragments present
        pred = " AND ".join(["instr(lower(weapon), ?) = 0"] * len(subs))
    cutoff = period_cutoff(period, now)
    if cutoff is None:
        mfilter = "SELECT match_id FROM matches WHERE status='final'"
        mparams: list[Any] = []
    else:
        mfilter = ("SELECT match_id FROM matches "
                   "WHERE status='final' AND started_at >= ?")
        mparams = [cutoff]
    # The weapon predicate + match filter appear once per UNION leg (attacker,
    # then victim); bind params in that order, then the LIMIT.
    params: list[Any] = [*subs, *mparams, *subs, *mparams,
                         max(1, min(int(limit or 50), 200))]
    sql = (
        "SELECT p.eos_id, p.last_name, p.last_clan_tag, "
        "  agg.matches, agg.kills, agg.deaths, "
        "  CAST(agg.kills AS REAL)/MAX(1, agg.deaths) AS value "
        "FROM ( "
        "  SELECT eos, SUM(k) kills, SUM(d) deaths, "
        "         COUNT(DISTINCT match_id) matches "
        "  FROM ( "
        "    SELECT attacker_eos eos, match_id, 1 k, 0 d FROM kill_events "
        "      WHERE killed=1 AND COALESCE(team_kill,0)=0 "
        "        AND attacker_eos IS NOT NULL AND weapon IS NOT NULL "
        f"        AND {pred} AND match_id IN ({mfilter}) "
        "    UNION ALL "
        "    SELECT victim_eos eos, match_id, 0 k, 1 d FROM kill_events "
        "      WHERE killed=1 AND COALESCE(self_inflicted,0)=0 "
        "        AND victim_eos IS NOT NULL AND weapon IS NOT NULL "
        f"        AND {pred} AND match_id IN ({mfilter}) "
        "  ) GROUP BY eos "
        "  HAVING SUM(k) > 0 "
        "     AND COUNT(DISTINCT CASE WHEN k=1 THEN match_id END) >= 3 "
        ") agg JOIN players p ON p.eos_id = agg.eos "
        "ORDER BY value DESC LIMIT ?")
    conn = _ro(db_path)
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def leaderboard(db_path: Path, stat: str = "kills", limit: int = 50,
                period: str = "alltime",
                now: Optional[float] = None) -> list[dict]:
    if stat == "elo":
        return _elo_leaderboard(db_path, limit)
    if stat in ("inf_kd", "veh_kd"):
        return _context_leaderboard(db_path, stat, limit, period, now)
    expr = _LEADER_STATS.get(stat)
    if expr is None:
        stat, expr = "kills", _LEADER_STATS["kills"]
    # kd needs a floor of matches so a 1-kill-0-death player doesn't top it;
    # vehicle_kills gets the same floor so a single latched junk match can't
    # crown a low-match player (defense-in-depth behind the _vk write bound).
    having = ("HAVING COUNT(pm.match_id) >= 3"
              if stat in ("kd", "vehicle_kills") else "")
    cutoff = period_cutoff(period, now)
    # Period scoping joins `matches` for started_at. All-time keeps the original
    # two-table shape rather than paying for a join it does not need.
    if cutoff is None:
        src = "players p JOIN player_matches pm ON pm.eos_id=p.eos_id"
        params: list[Any] = []
    else:
        src = ("players p JOIN player_matches pm ON pm.eos_id=p.eos_id "
               "JOIN matches m ON m.match_id=pm.match_id AND m.started_at >= ?")
        params = [cutoff]
    params.append(max(1, min(int(limit or 50), 200)))
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            f"SELECT p.eos_id, p.last_name, p.last_clan_tag, "
            f"  COUNT(pm.match_id) AS matches, "
            f"  COALESCE(SUM(pm.kills),0) AS kills, "
            f"  COALESCE(SUM(pm.deaths),0) AS deaths, "
            f"  {expr} AS value "
            f"FROM {src} "
            f"WHERE pm.match_id IN "
            f"  (SELECT match_id FROM matches WHERE status='final') "
            f"GROUP BY p.eos_id {having} "
            f"ORDER BY value DESC LIMIT ?", params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def weapon_meta(db_path: Path, period: str = "alltime", limit: int = 40,
                min_kills: int = 3,
                now: Optional[float] = None) -> list[dict]:
    """Per-weapon kill stats over a period — the "what is actually killing people"
    board.

    `weapon` is the normalised causer class from the server log, so a row here is
    only as good as the log's attribution. avg/max range are computed from the
    positioned events only (`distance_m IS NOT NULL`), which is why a weapon can
    show kills but a null range: nothing was positioned. That is reported as
    null, not as zero.
    """
    cutoff = period_cutoff(period, now)
    where = ("ke.weapon IS NOT NULL AND ke.match_id IN "
             "(SELECT match_id FROM matches WHERE status='final')")
    params: list[Any] = []
    src = "kill_events ke"
    if cutoff is not None:
        src += " JOIN matches m ON m.match_id = ke.match_id"
        where += " AND m.started_at >= ?"
        params.append(cutoff)
    params += [max(0, int(min_kills)), max(1, min(int(limit or 40), 200))]
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            f"SELECT ke.weapon AS weapon, "
            f"  SUM(CASE WHEN ke.killed=1 AND COALESCE(ke.self_inflicted,0)=0 "
            f"            AND COALESCE(ke.team_kill,0)=0 THEN 1 ELSE 0 END) AS kills, "
            f"  SUM(CASE WHEN COALESCE(ke.team_kill,0)=1 THEN 1 ELSE 0 END) AS team_kills, "
            f"  SUM(CASE WHEN COALESCE(ke.wounded,0)=1 THEN 1 ELSE 0 END) AS wounds, "
            f"  COUNT(DISTINCT ke.attacker_eos) AS users, "
            f"  COUNT(DISTINCT ke.match_id) AS matches, "
            f"  AVG(ke.distance_m) AS avg_distance_m, "
            f"  MAX(ke.distance_m) AS max_distance_m "
            f"FROM {src} WHERE {where} "
            f"GROUP BY ke.weapon HAVING kills >= ? "
            f"ORDER BY kills DESC LIMIT ?", params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def recent_alerts(db_path: Path, limit: int = 100,
                  alert_type: Optional[str] = None) -> list[dict]:
    """Most recent plugin alerts, newest first. `details` is decoded back to a
    dict so the caller gets the evidence, not a JSON string to re-parse."""
    where = ""
    params: list[Any] = []
    if alert_type:
        where = "WHERE alert_type = ?"
        params.append(alert_type)
    params.append(max(1, min(int(limit or 100), 500)))
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            f"SELECT id, ts, tick, plugin_id, alert_type, eos_id, player_name, "
            f"  match_id, confidence, details FROM plugin_alerts "
            f"{where} ORDER BY ts DESC LIMIT ?", params).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            try:
                d["details"] = json.loads(d["details"]) if d["details"] else None
            except ValueError:
                d["details"] = None   # corrupt row: drop the evidence, keep the alert
            out.append(d)
        return out
    finally:
        conn.close()


def list_matches(db_path: Path, limit: int = 50, period: str = "alltime",
                 now: Optional[float] = None) -> list[dict]:
    """Finished/recent matches, newest first, with a player count. The DB has
    always held this — it just had no UI to browse it from until now."""
    cutoff = period_cutoff(period, now)
    where = "m.started_at IS NOT NULL AND m.status='final'"
    params: list[Any] = []
    if cutoff is not None:
        where += " AND m.started_at >= ?"
        params.append(cutoff)
    params.append(max(1, min(int(limit or 50), 200)))
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            f"SELECT m.match_id, m.map_name, m.layer_name, m.game_mode, "
            f"  m.started_at, m.ended_at, m.duration_sec, m.status, "
            f"  m.winner_team, m.team1_faction, m.team2_faction, "
            f"  m.team1_tickets, m.team2_tickets, m.peak_players, "
            f"  (SELECT COUNT(*) FROM player_matches pm "
            f"   WHERE pm.match_id = m.match_id) AS players "
            f"FROM matches m WHERE {where} "
            f"ORDER BY m.started_at DESC LIMIT ?", params).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def match_detail(db_path: Path, match_id: str) -> Optional[dict]:
    """One match's header + its full player scoreboard. None if unknown."""
    conn = _ro(db_path)
    try:
        m = conn.execute(
            "SELECT match_id, server_id, map_name, layer_name, game_mode, "
            "  started_at, ended_at, duration_sec, status, winner_team, "
            "  team1_faction, team2_faction, team1_tickets, team2_tickets, "
            "  peak_players FROM matches WHERE match_id=? AND status='final'",
            (match_id,)).fetchone()
        if m is None:
            return None
        players = conn.execute(
            "SELECT eos_id, name, clan_tag, team_id, squad_name, faction, "
            "  role_id, kills, deaths, woundeds, team_kills, vehicle_kills, "
            "  revived_points, heal_points, combat_score, objective_score, "
            "  team_work_score, score, captures, defenses, fobs_built, "
            "  fobs_destroyed, supplies_delivered, vehicle_damage, playtime_sec "
            "FROM player_matches WHERE match_id=? "
            "ORDER BY team_id, score DESC", (match_id,)).fetchall()
        out = dict(m)
        out["players"] = [dict(p) for p in players]
        return out
    finally:
        conn.close()


def layers_with_kills(db_path: Path, limit: int = 60) -> list[dict]:
    """Layers that actually have positioned kills, busiest first.

    This is the heatmap picker's source. A layer with no positioned kill cannot
    be drawn, so it is not offered — better than listing it and handing back an
    empty map.
    """
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            "SELECT m.layer_name, MAX(m.map_name) AS map_name, "
            "  COUNT(DISTINCT m.match_id) AS matches, "
            "  COUNT(*) AS deaths "
            "FROM kill_events ke JOIN matches m ON m.match_id = ke.match_id "
            "WHERE ke.victim_x IS NOT NULL AND m.layer_name IS NOT NULL "
            "  AND m.status='final' "
            "GROUP BY m.layer_name ORDER BY deaths DESC LIMIT ?",
            (max(1, min(int(limit or 60), 200)),)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def match_heatmap(db_path: Path, match_id: str) -> Optional[dict]:
    """Every positioned kill in one match, as points.

    Returns the layer name rather than resolving map bounds itself — the HTTP
    layer owns the (cached) Metadata instance and attaches `bounds`, so this
    module stays free of the static-data dependency.
    """
    conn = _ro(db_path)
    try:
        m = conn.execute(
            "SELECT match_id, map_name, layer_name, game_mode, started_at, "
            "  duration_sec, winner_team FROM matches "
            "WHERE match_id=? AND status='final'",
            (match_id,)).fetchone()
        if m is None:
            return None
        rows = conn.execute(
            "SELECT ts, tick, attacker_team, victim_team, weapon, "
            "  attacker_x, attacker_y, victim_x, victim_y, distance_m, "
            "  killed, wounded, team_kill "
            "FROM kill_events "
            "WHERE match_id=? AND victim_x IS NOT NULL "
            "ORDER BY ts", (match_id,)).fetchall()
        return {
            "matchId": m["match_id"],
            "mapName": m["map_name"],
            "layerName": m["layer_name"],
            "gameMode": m["game_mode"],
            "startedAt": m["started_at"],
            "durationSec": m["duration_sec"],
            "winnerTeam": m["winner_team"],
            "points": [dict(r) for r in rows],
        }
    finally:
        conn.close()


# Kill positions are UE centimetres and can be negative, and SQLite's
# CAST-to-INTEGER truncates toward zero rather than down — so bucketing raw
# coordinates would fold the two cells either side of an axis into one. We shift
# into positive space first, which makes truncation equal floor, then subtract
# the shift back out so the result is the cell's world-space corner.
#
# The shift MUST be a whole number of cells, or the grid ends up offset from the
# world origin by `shift % cell` and cell corners stop being multiples of the
# cell size. `_grid_shift` rounds up to guarantee both that and >= _MIN_SHIFT_CM,
# which is what keeps every in-bounds coordinate positive.
_MIN_SHIFT_CM = 1_000_000.0   # 10 km — an order of magnitude past any Squad map
_COORD_LIMIT_CM = 999_000     # junk-coordinate guard; also the shift precondition


def _grid_shift(cell: float) -> float:
    return math.ceil(_MIN_SHIFT_CM / cell) * cell


def map_heatmap(db_path: Path, layer_name: str, period: str = "alltime",
                cell_cm: int = 5000, limit: int = 5000,
                now: Optional[float] = None) -> dict:
    """Death density for one layer, aggregated server-side into a coarse grid.

    Aggregating here (rather than shipping every point) keeps the payload bounded
    no matter how many matches a layer has; the client just paints cells. Keyed
    on layer, not map: bounds are per-layer, so a per-map grid could not be drawn
    correctly.

    `cell_x`/`cell_y` are the cell's lower-left corner in world centimetres.
    """
    cutoff = period_cutoff(period, now)
    cell = float(max(500, min(int(cell_cm or 5000), 50_000)))
    p: dict[str, Any] = {
        "shift": _grid_shift(cell),
        "cell": cell,
        "layer": layer_name,
        "lim": max(1, min(int(limit or 5000), 20_000)),
        "bound": _COORD_LIMIT_CM,
    }
    where = ("ke.victim_x IS NOT NULL AND m.layer_name = :layer "
             "AND ke.victim_x BETWEEN -:bound AND :bound "
             "AND ke.victim_y BETWEEN -:bound AND :bound "
             "AND m.status='final'")
    if cutoff is not None:
        where += " AND m.started_at >= :cutoff"
        p["cutoff"] = cutoff
    conn = _ro(db_path)
    try:
        rows = conn.execute(
            "SELECT CAST((ke.victim_x + :shift) / :cell AS INTEGER) "
            "         * :cell - :shift AS cell_x, "
            "       CAST((ke.victim_y + :shift) / :cell AS INTEGER) "
            "         * :cell - :shift AS cell_y, "
            "       COUNT(*) AS n "
            "FROM kill_events ke JOIN matches m ON m.match_id = ke.match_id "
            f"WHERE {where} "
            "GROUP BY cell_x, cell_y ORDER BY n DESC LIMIT :lim", p).fetchall()
        cells = [dict(r) for r in rows]
        return {
            "layerName": layer_name,
            "period": (period or "alltime").lower(),
            "cellCm": cell,
            "maxCount": max((c["n"] for c in cells), default=0),
            "cells": cells,
        }
    finally:
        conn.close()


# Squad role ids are faction-prefixed (AFU_SLCrewman_01, USA_SLCrewman_01, …).
# The kit is the same across factions, so strip the faction prefix and the
# trailing variant number to collapse them to one role. Pure + testable.
_ROLE_PREFIX_RE = re.compile(r"^[A-Z0-9]{2,4}_")
_ROLE_SUFFIX_RE = re.compile(r"_\d+$")


def normalize_role(role_id: Optional[str]) -> Optional[str]:
    if not role_id:
        return None
    r = _ROLE_PREFIX_RE.sub("", role_id)
    r = _ROLE_SUFFIX_RE.sub("", r)
    return r or None


def _most_played_role(conn: sqlite3.Connection, eos_id: str) -> Optional[dict]:
    """The kit this player runs most, faction-normalized and counted in Python
    (SQLite can't do the regex collapse in SQL)."""
    rows = conn.execute(
        "SELECT role_id, COUNT(*) n FROM player_matches "
        "WHERE eos_id=? AND role_id IS NOT NULL "
        "  AND match_id IN (SELECT match_id FROM matches WHERE status='final') "
        "GROUP BY role_id",
        (eos_id,)).fetchall()
    tally: dict[str, int] = {}
    for r in rows:
        norm = normalize_role(r["role_id"])
        if norm:
            tally[norm] = tally.get(norm, 0) + r["n"]
    if not tally:
        return None
    role, n = max(tally.items(), key=lambda kv: kv[1])
    return {"role": role, "matches": n}


# Substrings that mark a VEHICLE / emplacement weapon. Used to approximate an
# "infantry-only" longest kill: our log-sourced kill_events carry no
# killer_in_vehicle / is_vehicle_weapon flag (that data isn't in the log), so we
# can't do the real thing. Excluding these class-name fragments gets close.
# Deliberately conservative — 40mm stays IN because the underbarrel GL (M203) is
# infantry; only the large tank/IFV calibres are out. Documented approximation.
_VEHICLE_WEAPON_SUBSTRINGS = (
    "coax", "cannon", "autocannon", "maingun", "main_gun", "atgm", "tow",
    "kornet", "hellfire", "mortar", "minigun", "rotary",
    "25mm", "30mm", "57mm", "73mm", "100mm", "105mm", "115mm", "120mm",
    "125mm", "152mm",
)


def _longest_infantry_kill(conn: sqlite3.Connection, eos_id: str) -> Optional[float]:
    """Approx infantry-only longest kill: MAX(distance_m) with vehicle-weapon
    class names filtered out. Approximate — see _VEHICLE_WEAPON_SUBSTRINGS."""
    excl = " AND ".join(
        ["instr(lower(weapon), ?) = 0"] * len(_VEHICLE_WEAPON_SUBSTRINGS))
    row = conn.execute(
        f"SELECT MAX(distance_m) d FROM kill_events "
        f"WHERE attacker_eos=? AND killed=1 AND distance_m IS NOT NULL "
        f"  AND COALESCE(team_kill,0)=0 AND weapon IS NOT NULL AND {excl} "
        f"  AND match_id IN (SELECT match_id FROM matches WHERE status='final')",
        (eos_id, *_VEHICLE_WEAPON_SUBSTRINGS)).fetchone()
    return float(row["d"]) if row and row["d"] is not None else None


def _best_match(conn: sqlite3.Connection, eos_id: str, order_col: str
                ) -> Optional[dict]:
    """The player's single best match by a column (kills / combat_score)."""
    row = conn.execute(
        f"SELECT pm.{order_col} AS value, pm.kills, pm.deaths, "
        f"  m.map_name, m.started_at "
        f"FROM player_matches pm JOIN matches m ON m.match_id=pm.match_id "
        f"WHERE pm.eos_id=? AND m.status='final' "
        f"ORDER BY pm.{order_col} DESC, m.started_at DESC "
        f"LIMIT 1", (eos_id,)).fetchone()
    return dict(row) if row else None


def _period_breakdown(conn: sqlite3.Connection, eos_id: str,
                      now: Optional[float] = None) -> dict:
    """Kills/deaths/matches for this week, this month, and all time — a
    'how am I doing lately' card."""
    week = period_cutoff("weekly", now)
    month = period_cutoff("monthly", now)
    row = conn.execute(
        "SELECT "
        "  SUM(CASE WHEN m.started_at >= ? THEN pm.kills ELSE 0 END) wk_k, "
        "  SUM(CASE WHEN m.started_at >= ? THEN pm.deaths ELSE 0 END) wk_d, "
        "  SUM(CASE WHEN m.started_at >= ? THEN 1 ELSE 0 END) wk_m, "
        "  SUM(CASE WHEN m.started_at >= ? THEN pm.kills ELSE 0 END) mo_k, "
        "  SUM(CASE WHEN m.started_at >= ? THEN pm.deaths ELSE 0 END) mo_d, "
        "  SUM(CASE WHEN m.started_at >= ? THEN 1 ELSE 0 END) mo_m, "
        "  COALESCE(SUM(pm.kills),0) all_k, COALESCE(SUM(pm.deaths),0) all_d, "
        "  COUNT(*) all_m "
        "FROM player_matches pm JOIN matches m ON m.match_id=pm.match_id "
        "WHERE pm.eos_id=? AND m.status='final'",
        (week, week, week, month, month, month, eos_id)).fetchone()
    r = dict(row) if row else {}
    return {
        "weekly":  {"kills": r.get("wk_k") or 0, "deaths": r.get("wk_d") or 0,
                    "matches": r.get("wk_m") or 0},
        "monthly": {"kills": r.get("mo_k") or 0, "deaths": r.get("mo_d") or 0,
                    "matches": r.get("mo_m") or 0},
        "alltime": {"kills": r.get("all_k") or 0, "deaths": r.get("all_d") or 0,
                    "matches": r.get("all_m") or 0},
    }


def player_profile(db_path: Path, eos_id: str) -> Optional[dict]:
    conn = _ro(db_path)
    try:
        ident = conn.execute(
            "SELECT eos_id, last_name, last_clan_tag, first_seen_at, "
            "last_seen_at FROM players WHERE eos_id=?", (eos_id,)).fetchone()
        if ident is None:
            return None
        life = conn.execute(
            "SELECT COUNT(*) matches, COALESCE(SUM(kills),0) kills, "
            "  COALESCE(SUM(deaths),0) deaths, COALESCE(SUM(woundeds),0) woundeds, "
            "  COALESCE(SUM(wounds),0) wounds, COALESCE(SUM(team_kills),0) team_kills, "
            "  COALESCE(SUM(vehicle_kills),0) vehicle_kills, "
            "  COALESCE(SUM(revived_points),0) revives, "
            "  COALESCE(SUM(heal_points),0) heals, "
            "  COALESCE(SUM(combat_score),0) combat_score, "
            "  COALESCE(SUM(objective_score),0) objective_score, "
            "  COALESCE(SUM(team_work_score),0) team_work_score, "
            "  COALESCE(SUM(captures),0) captures, "
            "  COALESCE(SUM(defenses),0) defenses, "
            "  COALESCE(SUM(fobs_built),0) fobs_built, "
            "  COALESCE(SUM(fobs_destroyed),0) fobs_destroyed, "
            "  COALESCE(SUM(supplies_delivered),0) supplies_delivered, "
            "  COALESCE(SUM(vehicle_damage),0) vehicle_damage, "
            "  COALESCE(SUM(playtime_sec),0) playtime_sec "
            "FROM player_matches WHERE eos_id=? AND match_id IN "
            "  (SELECT match_id FROM matches WHERE status='final')",
            (eos_id,)).fetchone()
        recent = conn.execute(
            "SELECT pm.match_id, pm.team_id, pm.squad_name, pm.faction, "
            "  pm.kills, pm.deaths, pm.woundeds, pm.team_kills, "
            "  pm.vehicle_kills, pm.revived_points, pm.combat_score, "
            "  pm.objective_score, pm.score, pm.playtime_sec, pm.role_id, "
            "  pm.elo_change, "
            "  m.map_name, m.game_mode, m.layer_name, m.started_at, "
            "  m.winner_team, m.status "
            "FROM player_matches pm JOIN matches m ON m.match_id=pm.match_id "
            "WHERE pm.eos_id=? AND m.status='final' "
            "ORDER BY m.started_at DESC LIMIT 25",
            (eos_id,)).fetchall()
        weapons = conn.execute(
            "SELECT weapon, COUNT(*) kills FROM kill_events "
            "WHERE attacker_eos=? AND killed=1 AND COALESCE(self_inflicted,0)=0 "
            "  AND COALESCE(team_kill,0)=0 AND weapon IS NOT NULL "
            "  AND match_id IN (SELECT match_id FROM matches WHERE status='final') "
            "GROUP BY weapon ORDER BY kills DESC LIMIT 12", (eos_id,)).fetchall()
        maps = conn.execute(
            "SELECT m.map_name, COUNT(*) matches, "
            "  COALESCE(SUM(pm.kills),0) kills, COALESCE(SUM(pm.deaths),0) deaths "
            "FROM player_matches pm JOIN matches m ON m.match_id=pm.match_id "
            "WHERE pm.eos_id=? AND m.map_name IS NOT NULL AND m.status='final' "
            "GROUP BY m.map_name ORDER BY matches DESC LIMIT 10",
            (eos_id,)).fetchall()
        nemeses = conn.execute(
            "SELECT attacker_eos eos, MAX(attacker_name) name, COUNT(*) c "
            "FROM kill_events WHERE victim_eos=? AND killed=1 "
            "  AND COALESCE(team_kill,0)=0 AND attacker_eos IS NOT NULL "
            "  AND attacker_eos<>? "
            "  AND match_id IN (SELECT match_id FROM matches WHERE status='final') "
            "GROUP BY attacker_eos ORDER BY c DESC LIMIT 6", (eos_id, eos_id)).fetchall()
        victims = conn.execute(
            "SELECT victim_eos eos, MAX(victim_name) name, COUNT(*) c "
            "FROM kill_events WHERE attacker_eos=? AND killed=1 "
            "  AND COALESCE(team_kill,0)=0 AND victim_eos IS NOT NULL "
            "  AND victim_eos<>? "
            "  AND match_id IN (SELECT match_id FROM matches WHERE status='final') "
            "GROUP BY victim_eos ORDER BY c DESC LIMIT 6", (eos_id, eos_id)).fetchall()
        # Squadmates: players who most often shared this player's squad (same
        # match, same team, same non-null squad name). SqReader keys squads by
        # name, not id, so two different "Able" squads on opposite teams stay
        # apart via the team join.
        squadmates = conn.execute(
            "SELECT o.eos_id eos, MAX(o.name) name, COUNT(*) c "
            "FROM player_matches me "
            "JOIN player_matches o ON o.match_id = me.match_id "
            "  AND o.team_id = me.team_id AND o.squad_name = me.squad_name "
            "  AND o.eos_id <> me.eos_id "
            "WHERE me.eos_id=? AND me.squad_name IS NOT NULL "
            "  AND me.match_id IN (SELECT match_id FROM matches "
            "                      WHERE status='final') "
            "GROUP BY o.eos_id ORDER BY c DESC LIMIT 6", (eos_id,)).fetchall()
        # Per-faction record.
        factions = conn.execute(
            "SELECT pm.faction, COUNT(*) matches, "
            "  COALESCE(SUM(pm.kills),0) kills, COALESCE(SUM(pm.deaths),0) deaths, "
            "  SUM(CASE WHEN m.winner_team=pm.team_id THEN 1 ELSE 0 END) wins "
            "FROM player_matches pm JOIN matches m ON m.match_id=pm.match_id "
            "WHERE pm.eos_id=? AND pm.faction IS NOT NULL AND m.status='final' "
            "GROUP BY pm.faction ORDER BY matches DESC LIMIT 12",
            (eos_id,)).fetchall()
        # Per-map win rate (extends favoriteMaps with the outcome).
        map_records = conn.execute(
            "SELECT m.map_name, COUNT(*) matches, "
            "  SUM(CASE WHEN m.winner_team=pm.team_id THEN 1 ELSE 0 END) wins, "
            "  COALESCE(SUM(pm.kills),0) kills, COALESCE(SUM(pm.deaths),0) deaths "
            "FROM player_matches pm JOIN matches m ON m.match_id=pm.match_id "
            "WHERE pm.eos_id=? AND m.map_name IS NOT NULL AND m.status='final' "
            "GROUP BY m.map_name HAVING matches >= 2 "
            "ORDER BY matches DESC LIMIT 10", (eos_id,)).fetchall()
        # Most-used vehicles: total seat-time and distance per vehicle class,
        # from the closed sessions. Ground distance only would need a heli
        # filter; we report all and let the UI label.
        vehicles_used = conn.execute(
            "SELECT vehicle_class, COUNT(*) sessions, "
            "  COALESCE(SUM(exited_at - entered_at),0) time_s, "
            "  COALESCE(SUM(distance_m),0) distance_m "
            "FROM vehicle_session "
            "WHERE eos_id=? AND vehicle_class IS NOT NULL "
            "  AND match_id IN (SELECT match_id FROM matches WHERE status='final') "
            "GROUP BY vehicle_class ORDER BY time_s DESC LIMIT 10",
            (eos_id,)).fetchall()
        # Temporal activity: kills bucketed by UTC day-of-week (0=Sun) × hour.
        # A 7×24 grid, distinct from the SPATIAL kill heatmap. Only positioned
        # `ts` rows — every kill_event has one.
        activity = conn.execute(
            "SELECT CAST(strftime('%w', ts, 'unixepoch') AS INTEGER) dow, "
            "  CAST(strftime('%H', ts, 'unixepoch') AS INTEGER) hour, "
            "  COUNT(*) n FROM kill_events "
            "WHERE attacker_eos=? AND ts IS NOT NULL AND killed=1 "
            "  AND match_id IN (SELECT match_id FROM matches WHERE status='final') "
            "GROUP BY dow, hour", (eos_id,)).fetchall()

        # Unrated players simply have no row here — a player who has only played
        # short/small matches is not "1000", they are unrated, and the UI must be
        # able to tell those apart.
        er = conn.execute(
            "SELECT elo_rating, matches_played FROM player_elo WHERE eos_id=?",
            (eos_id,)).fetchone()
        elo_block = None
        if er is not None:
            rating = int(er["elo_rating"])
            tier, label, color, next_at, progress = elo_mod.elo_tier_for(rating)
            elo_block = {
                "rating": rating, "tier": tier, "label": label, "color": color,
                "nextAt": next_at, "progress": progress,
                "matchesPlayed": int(er["matches_played"]),
            }
        return {
            "eosId": ident["eos_id"],
            "name": ident["last_name"],
            "clanTag": ident["last_clan_tag"],
            "firstSeenAt": ident["first_seen_at"],
            "lastSeenAt": ident["last_seen_at"],
            "elo": elo_block,
            "mostPlayedRole": _most_played_role(conn, eos_id),
            "longestKillInfM": _longest_infantry_kill(conn, eos_id),
            "bestMatch": {
                "byKills": _best_match(conn, eos_id, "kills"),
                "byScore": _best_match(conn, eos_id, "combat_score"),
            },
            "periodBreakdown": _period_breakdown(conn, eos_id),
            "lifetime": dict(life) if life else {},
            "recentMatches": [dict(r) for r in recent],
            "topWeapons": [dict(r) for r in weapons],
            "favoriteMaps": [dict(r) for r in maps],
            "mapRecords": [dict(r) for r in map_records],
            "factions": [dict(r) for r in factions],
            "squadmates": [dict(r) for r in squadmates],
            "vehiclesUsed": [dict(r) for r in vehicles_used],
            "activity": [dict(r) for r in activity],
            "nemeses": [dict(r) for r in nemeses],
            "victims": [dict(r) for r in victims],
        }
    finally:
        conn.close()
