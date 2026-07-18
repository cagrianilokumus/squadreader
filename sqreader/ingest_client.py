"""Outbound push client: send finished-match stats + .sqrx replays to a central.

This is the ONLY part of sqreader that talks to the network, and only when the
box is enrolled (``.env.agent`` present) and push is enabled. It:

  * builds a self-contained JSON bundle for one finished match (stats/scoreboard
    + kill events + vehicle sessions + ELO) straight from the stats DB,
  * seals it with the shared crypto envelope and POSTs it to ``/ingest/match``,
  * uploads the match's ``.sqrx`` replay to ``/ingest/replay`` (raw zstd body +
    a sealed manifest header), and
  * keeps a small on-disk BACKLOG so nothing is lost if the central is down or
    the replay file has not finished closing yet.

Idempotency is by ``match_id`` (the central dedups), so a re-push is harmless.
HTTP uses stdlib ``urllib`` — no new dependency beyond the opt-in ``cryptography``
that the envelope needs.
"""
from __future__ import annotations

import hashlib
import json
import platform
import sqlite3
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from . import agent_creds
from .crypto_envelope import EnvelopeError, seal_json

SCHEMA_MATCH = "sqr-match-1"
SCHEMA_REPLAY = "sqr-replay-1"
_UA = "sqreader-push/1"
_STATS_TABLES = ("matches", "player_matches", "kill_events", "vehicle_session")


class PushError(Exception):
    """Central unreachable, refused the push, or a bad response."""


# --------------------------------------------------------------------------
# match bundle (read-only, straight from the stats DB)
# --------------------------------------------------------------------------

def build_match_bundle(db_path: str | Path, match_id: str) -> dict[str, Any] | None:
    """Read one finished match into a JSON-able bundle. None if unknown."""
    conn = sqlite3.connect(f"file:{Path(db_path)}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        match = _one(conn, "SELECT * FROM matches WHERE match_id=?", (match_id,))
        if match is None:
            return None
        players = _all(conn, "SELECT * FROM player_matches WHERE match_id=?",
                       (match_id,))
        kills = _all(conn, "SELECT * FROM kill_events WHERE match_id=?",
                     (match_id,))
        vehicles = _all(conn, "SELECT * FROM vehicle_session WHERE match_id=?",
                        (match_id,))
        eos = sorted({str(p["eos_id"]) for p in players if p.get("eos_id")})
        elo: list[dict[str, Any]] = []
        if eos:
            marks = ",".join("?" * len(eos))
            elo = _all(conn, f"SELECT * FROM player_elo WHERE eos_id IN ({marks})",
                       tuple(eos))
        return {
            "schema": SCHEMA_MATCH,
            "server_id": match.get("server_id"),
            "match": match,
            "players": players,
            "kills": kills,
            "vehicles": vehicles,
            "elo": elo,
        }
    finally:
        conn.close()


def _one(conn: sqlite3.Connection, sql: str, args: tuple) -> dict[str, Any] | None:
    try:
        row = conn.execute(sql, args).fetchone()
    except sqlite3.OperationalError:
        return None
    return dict(row) if row is not None else None


def _all(conn: sqlite3.Connection, sql: str, args: tuple) -> list[dict[str, Any]]:
    try:
        return [dict(r) for r in conn.execute(sql, args).fetchall()]
    except sqlite3.OperationalError:
        return []  # table absent on an older DB — skip, don't fail the push


# --------------------------------------------------------------------------
# enrollment + push (HTTP)
# --------------------------------------------------------------------------

def enroll(central_url: str, token: str, hw_fp: str, *,
           timeout: float = 30.0) -> dict[str, str]:
    """Redeem an enrollment token → the agent's credentials.

    POSTs {token, hw_fp, platform} to ``{central}/api/enroll`` and returns
    ``{agent_id, secret_hex, push_url, community}``. Raises PushError on any
    failure (the central masks unknown/expired/consumed as the same error).
    """
    body = {"token": token, "hw_fp": hw_fp, "platform": platform.system()}
    resp = _post_json(central_url.rstrip("/") + "/api/enroll", body,
                      timeout=timeout)
    secret = str(resp.get("secret_hex", ""))
    if len(secret) != 64:
        raise PushError("enroll response missing a 32-byte secret_hex")
    return {
        "SQREADER_AGENT_ID": str(resp["agent_id"]),
        "SQREADER_AGENT_SECRET_HEX": secret,
        "SQREADER_PUSH_URL": str(resp.get("push_url") or central_url),
        "SQREADER_COMMUNITY": str(resp.get("community", "")),
    }


def push_match(creds: dict[str, str], bundle: dict[str, Any], *, seq: int,
               timeout: float = 30.0) -> None:
    env = seal_json(bundle, secret=_secret(creds),
                    agent_id=creds["SQREADER_AGENT_ID"], seq=seq)
    _post_json(_push_base(creds) + "/ingest/match", env, timeout=timeout)


def push_replay(creds: dict[str, str], match_id: str, server_id: str,
                sqrx_path: str | Path, *, seq: int, timeout: float = 300.0) -> None:
    data = Path(sqrx_path).read_bytes()
    manifest = seal_json(
        {"schema": SCHEMA_REPLAY, "server_id": server_id, "match_id": match_id,
         "size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
        secret=_secret(creds), agent_id=creds["SQREADER_AGENT_ID"], seq=seq)
    req = urllib.request.Request(
        _push_base(creds) + "/ingest/replay", data=data, method="POST",
        headers={"Content-Type": "application/octet-stream",
                 "X-Sqr-Manifest": json.dumps(manifest, separators=(",", ":")),
                 "User-Agent": _UA})
    _send(req, timeout=timeout)


# --------------------------------------------------------------------------
# backlog queue (durable, idempotent, survives a down central)
# --------------------------------------------------------------------------

def enqueue(backlog_dir: str | Path, match_id: str) -> None:
    """Drop a marker for a just-finalized match. Cheap + crash-safe."""
    d = Path(backlog_dir)
    d.mkdir(parents=True, exist_ok=True)
    marker = d / f"{_safe_id(match_id)}.json"
    if marker.exists():
        return
    _atomic_json(marker, {"match_id": match_id, "created_at": int(time.time()),
                          "stats_done": False, "replay_done": False})


def flush_backlog(backlog_dir: str | Path, db_path: str | Path,
                  recordings_dir: str | Path | None, creds: dict[str, str], *,
                  push_replay_files: bool = True) -> dict[str, int]:
    """Push every queued match (stats first, then replay once its .sqrx has
    closed). Idempotent; leaves a marker in place on failure to retry later.
    Returns counts {sent, pending, errors}."""
    d = Path(backlog_dir)
    sent = pending = errors = 0
    if not d.is_dir():
        return {"sent": 0, "pending": 0, "errors": 0}
    for marker in sorted(d.glob("*.json")):
        try:
            state = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        mid = state.get("match_id")
        if not mid:
            marker.unlink(missing_ok=True)
            continue
        try:
            if not state.get("stats_done"):
                bundle = build_match_bundle(db_path, mid)
                if bundle is None:            # match vanished from the DB
                    marker.unlink(missing_ok=True)
                    continue
                push_match(creds, bundle, seq=_next_seq(d))
                state["stats_done"] = True
                _atomic_json(marker, state)

            if push_replay_files and not state.get("replay_done"):
                sqrx = (_find_replay(recordings_dir, mid)
                        if recordings_dir else None)
                if sqrx is None:              # .sqrx not closed yet — retry next
                    pending += 1
                    continue
                push_replay(creds, mid, _server_id(db_path, mid),
                            sqrx, seq=_next_seq(d))
                state["replay_done"] = True
                _atomic_json(marker, state)

            marker.unlink(missing_ok=True)
            sent += 1
        except PushError:
            errors += 1                        # central down/refused — keep marker
        except (EnvelopeError, OSError, sqlite3.Error):
            errors += 1
    return {"sent": sent, "pending": pending, "errors": errors}


def _server_id(db_path: str | Path, match_id: str) -> str:
    conn = sqlite3.connect(f"file:{Path(db_path)}?mode=ro", uri=True)
    try:
        row = conn.execute(
            "SELECT server_id FROM matches WHERE match_id=?", (match_id,)
        ).fetchone()
        return str(row[0]) if row and row[0] else "squad"
    except sqlite3.OperationalError:
        return "squad"
    finally:
        conn.close()


# --------------------------------------------------------------------------
# internals
# --------------------------------------------------------------------------

def _find_replay(recordings_dir: str | Path, match_id: str) -> Path | None:
    """The finalized .sqrx for match_id, or None if still open / absent.

    Filenames carry only the last-8 of match_id; the full id + the inProgress
    flag live in the ``.meta.json`` sidecar, so we match on those.
    """
    for sqrx in Path(recordings_dir).glob("*.sqrx"):
        meta = sqrx.with_suffix(".meta.json")
        try:
            m = json.loads(meta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if m.get("matchId") == match_id and m.get("inProgress") is False:
            return sqrx
    return None


def _secret(creds: dict[str, str]) -> bytes:
    try:
        return bytes.fromhex(creds["SQREADER_AGENT_SECRET_HEX"])
    except (KeyError, ValueError) as exc:
        raise PushError("missing/invalid agent secret") from exc


def _push_base(creds: dict[str, str]) -> str:
    base = creds.get("SQREADER_PUSH_URL") or creds.get("SQREADER_CENTRAL_URL")
    if not base:
        raise PushError("no push_url configured")
    return base.rstrip("/")


def _next_seq(backlog_dir: Path) -> int:
    """Monotonic advisory counter (AAD/freshness only — match_id is the real
    idempotency key). Persisted so a restart resumes it."""
    f = backlog_dir / ".push.seq"
    try:
        n = int(f.read_text(encoding="ascii").strip()) + 1
    except (OSError, ValueError):
        n = 1
    try:
        f.write_text(str(n), encoding="ascii")
    except OSError:
        pass
    return n


def _post_json(url: str, obj: dict[str, Any], *, timeout: float) -> dict[str, Any]:
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"Content-Type": "application/json", "User-Agent": _UA})
    raw = _send(req, timeout=timeout)
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError as exc:
        raise PushError("central returned non-JSON") from exc
    return parsed if isinstance(parsed, dict) else {}


def _send(req: urllib.request.Request, *, timeout: float) -> bytes:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise PushError(f"central HTTP {exc.code}") from exc
    except (urllib.error.URLError, OSError, TimeoutError) as exc:
        raise PushError(f"central unreachable: {exc}") from exc


def _atomic_json(path: Path, obj: dict[str, Any]) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def _safe_id(match_id: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in match_id)[:80]


def default_backlog_dir(db_path: str | Path) -> Path:
    """Push queue next to the stats DB by default."""
    return Path(db_path).parent / "push_queue"


def current_creds() -> dict[str, str] | None:
    """The enrolled credentials, or None (opt-in: absent → push disabled)."""
    creds = agent_creds.load()
    if creds and creds.get("SQREADER_AGENT_ID") and creds.get("SQREADER_AGENT_SECRET_HEX"):
        return creds
    return None


__all__ = [
    "PushError", "SCHEMA_MATCH", "SCHEMA_REPLAY",
    "build_match_bundle", "enroll", "push_match", "push_replay",
    "enqueue", "flush_backlog", "default_backlog_dir", "current_creds",
]
