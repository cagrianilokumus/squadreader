"""
Match recorder for sqreader. Runs IN-PROCESS inside `sqreader serve`: the
serve loop hands each snapshot tick to `_handle_snap`, which writes one
`.sqrx` file per match plus a sidecar `.meta.json` describing it. There is
no separate SSE-consuming `record` process in this (distributed) build.

State machine:
- WaitingToStart / WaitingPostMatch  → idle, no writes
- InProgress, stable new matchId     → open new writer, start recording
- InProgress, same matchId           → keep writing
- 3 known not-InProgress ticks       → close writer, finalize sidecar
- ambiguous tick                     → keep the current writer open
- shutdown                           → close writer as unverified

Logs only on state transitions (open/close/error) so we don't spam
the journal at 3 Hz.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .recording_lifecycle import (
    INACTIVE_MATCH_STATES as _INACTIVE_MATCH_STATES,
    MATCH_TRANSITION_CONFIRM_TICKS as _MATCH_END_CONFIRM_TICKS,
    RECORDING_STATE_ACTIVE,
    RECORDING_STATE_FINALIZED,
    RECORDING_STATE_UNVERIFIED,
)
from .sqrx import SqrxReader, SqrxWriter

log = logging.getLogger("sqreader.recorder")

# Maximum number of ticks to buffer before committing the .sqrx filename
# when the first snapshot lacks a populated mapName / gameModeName (rare
# but possible at the very edge of a match transition).
_FILENAME_BUFFER_LIMIT = 10

# Persistent recording lifecycle written into every metadata sidecar.
#
# Security invariant: closing a writer (for example during a service restart)
# does not prove that its match ended.  Only a confirmed match transition may
# write ``recordingState=finalized``; uncertain closes write ``unverified``.
# The HTTP layer additionally compares every recording with its debounced live
# match context, and never uses mtime as proof of finality.
# Sanitise a string for use in a filename component.
_FNAME_SAFE_RE = re.compile(r"[^A-Za-z0-9]+")


def _sanitize_fname(s: str | None, fallback: str = "Unknown") -> str:
    if not s:
        return fallback
    cleaned = _FNAME_SAFE_RE.sub("", s)
    return cleaned or fallback


def _short_match_id(match_id: str | None) -> str:
    if not match_id:
        return "00000000"
    # last 8 hex chars; matchId may be longer than 8 — pad/trim either way
    return match_id[-8:].rjust(8, "0")


def _layer_version(layer_name: str | None) -> str:
    """'Gorodok_RAAS_v1' -> 'v1'. Falls back to 'v0' when not found."""
    if not layer_name:
        return "v0"
    m = re.search(r"v(\d+)$", layer_name)
    return f"v{m.group(1)}" if m else "v0"


def compute_filename(snap: dict, started_at: datetime) -> str:
    """
    `YYYY-MM-DD_HHMMSS_<MapName>_<GameMode>_<LayerVer>_<MatchId8>.sqrx`
    e.g. `2026-05-25_002432_Gorodok_RAAS_v1_40323435.sqrx`
    """
    gs = snap.get("gameState") or {}
    layer = (gs.get("layer") or {})
    map_name = _sanitize_fname(gs.get("mapName"))
    game_mode = _sanitize_fname(gs.get("gameModeName") or gs.get("gameModeId"))
    layer_ver = _layer_version(layer.get("name") or gs.get("mapName"))
    match_id_short = _short_match_id(gs.get("matchId"))
    ts = started_at.strftime("%Y-%m-%d_%H%M%S")
    return f"{ts}_{map_name}_{game_mode}_{layer_ver}_{match_id_short}.sqrx"


@dataclass
class RecordingState:
    """Per-active-match bookkeeping. None of these survive across matches."""
    match_id: str
    writer: SqrxWriter
    path: Path
    started_at: datetime
    first_snap_ts: Optional[str] = None
    last_snap_ts: Optional[str] = None
    last_snap: Optional[dict] = None
    tick_count: int = 0
    peak_players: int = 0
    raw_bytes: int = 0  # uncompressed payload size, for meta.sizeBytes hint
    # Two-tier recording: 4 Hz position frames interleaved between the ~1 Hz
    # full frames. Counted separately so `tick_count` (and therefore meta
    # `ticks`, central `has_replay`, peakPlayers) stays full-frame-only and
    # backward-compatible; positionFrames is purely additive.
    position_count: int = 0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_snap_ts(s: str | None) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Snap timestamps look like "2026-05-25T10:41:03.318+00:00"
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def _atomic_write_json(path: Path, payload: dict) -> None:
    """Write `payload` to `path` via tempfile + os.replace (atomic rename)."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def extract_metadata(sqrx_path: Path) -> dict:
    """
    Read a .sqrx end-to-end to derive its metadata. Used as the slow
    self-heal path when a sidecar is missing.
    """
    first: Optional[dict] = None
    last: Optional[dict] = None
    ticks = 0
    position_frames = 0
    peak_players = 0
    with SqrxReader(sqrx_path) as r:
        server_id = r.server_id
        created_ms = r.created_ms
        for line in r:
            try:
                snap = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Two-tier: position frames are lighter interleaved lines. They
            # carry no map/mode/roster, so they never count as ticks or set
            # first/last/peak — that keeps a re-scanned meta identical to a
            # full-only recording plus a positionFrames tally. An old .sqrx
            # (full frames, no "t") has t=None here → treated as a full frame.
            if snap.get("t") == "pos":
                position_frames += 1
                continue
            if first is None:
                first = snap
            last = snap
            ticks += 1
            pc = len(snap.get("players") or [])
            if pc > peak_players:
                peak_players = pc
    return _build_meta(
        sqrx_path=sqrx_path,
        server_id=server_id,
        created_ms=created_ms,
        first_snap=first,
        last_snap=last,
        ticks=ticks,
        peak_players=peak_players,
        position_frames=position_frames,
    )


def _build_meta(
    *,
    sqrx_path: Path,
    server_id: str,
    created_ms: int,
    first_snap: Optional[dict],
    last_snap: Optional[dict],
    ticks: int,
    peak_players: int,
    position_frames: int = 0,
) -> dict:
    """Common meta dict assembly used by both finalize and self-heal paths."""
    first_gs = (first_snap or {}).get("gameState") or {}
    last_gs = (last_snap or {}).get("gameState") or {}
    first_ts = _parse_snap_ts((first_snap or {}).get("timestamp"))
    last_ts = _parse_snap_ts((last_snap or {}).get("timestamp"))
    duration = (
        int((last_ts - first_ts).total_seconds())
        if first_ts and last_ts else 0
    )
    size_bytes = sqrx_path.stat().st_size if sqrx_path.exists() else 0
    return {
        "id": sqrx_path.stem,
        "filename": sqrx_path.name,
        "sizeBytes": size_bytes,
        "ticks": ticks,
        "positionFrames": position_frames,
        "totalFrames": ticks + position_frames,
        "durationSec": duration,
        "startedAtUtc": (
            first_ts.isoformat() if first_ts
            else datetime.fromtimestamp(
                created_ms / 1000, tz=timezone.utc).isoformat()),
        "endedAtUtc": last_ts.isoformat() if last_ts else None,
        "serverId": server_id,
        # Prefer the LAST snapshot's name (as finalize_recording does): a
        # recording that opened before the map name populated has a null
        # mapName in its first frame, so keying off first_gs would make the
        # self-heal path regenerate blank map/mode/layer metadata.
        "mapName": last_gs.get("mapName") or first_gs.get("mapName"),
        "gameMode": (last_gs.get("gameModeName") or last_gs.get("gameModeId")
                     or first_gs.get("gameModeName") or first_gs.get("gameModeId")),
        "layerName": ((last_gs.get("layer") or {}).get("name")
                      or (first_gs.get("layer") or {}).get("name")
                      or last_gs.get("mapName") or first_gs.get("mapName")),
        "matchId": last_gs.get("matchId") or first_gs.get("matchId"),
        "peakPlayers": peak_players,
        # Reading a stream end-to-end proves that every frame currently on
        # disk is valid; it does NOT prove that the writer will not append
        # another frame later.  Only finalize_recording() may assert finality.
        "recordingState": RECORDING_STATE_UNVERIFIED,
        "inProgress": True,
    }


def _write_active_sidecar(state: RecordingState, snap: dict) -> None:
    """Persist the fail-closed marker for a newly opened recording.

    This is deliberately best-effort for availability: if the metadata write
    fails, the missing-sidecar path in httpsrv still treats the file as live.
    The recording itself therefore keeps running without weakening the gate.
    """
    gs = snap.get("gameState") or {}
    meta = {
        "id": state.path.stem,
        "filename": state.path.name,
        "sizeBytes": (state.path.stat().st_size
                      if state.path.exists() else 0),
        "ticks": 0,
        "durationSec": 0,
        "startedAtUtc": state.started_at.isoformat(),
        "endedAtUtc": None,
        "serverId": state.writer.server_id_bytes.decode("utf-8"),
        "mapName": gs.get("mapName"),
        "gameMode": gs.get("gameModeName") or gs.get("gameModeId"),
        "layerName": ((gs.get("layer") or {}).get("name")
                      or gs.get("mapName")),
        "matchId": state.match_id,
        "peakPlayers": 0,
        "recordingState": RECORDING_STATE_ACTIVE,
        "inProgress": True,
    }
    try:
        _atomic_write_json(state.path.with_suffix(".meta.json"), meta)
    except OSError as e:
        log.warning("active metadata write failed for %s: %r",
                    state.path.name, e)


def finalize_recording(state: RecordingState, *, min_ticks: int = 0,
                       reason: str = "",
                       confirmed_ended: bool = False) -> Optional[Path]:
    """
    Close the writer + write the sidecar. Returns the meta path on success,
    None if the recording was discarded (too short). ``confirmed_ended`` must
    only be set when snapshots prove the match transitioned; shutdown paths
    deliberately remain ``unverified`` because the match may still be live.
    """
    try:
        state.writer.close()
    except Exception as e:
        log.warning("writer close failed for %s: %r", state.path.name, e)

    if state.tick_count < min_ticks:
        # Recording too short to be useful (likely a false start). Drop it.
        for p in (state.path, state.path.with_suffix(".meta.json")):
            try:
                if p.exists():
                    p.unlink()
            except OSError:
                pass
        log.info("discarded short recording %s (%d ticks < %d)%s",
                 state.path.name, state.tick_count, min_ticks,
                 f" [{reason}]" if reason else "")
        return None

    first_ts = _parse_snap_ts(
        state.first_snap_ts) or state.started_at.replace(tzinfo=timezone.utc)
    last_ts = _parse_snap_ts(state.last_snap_ts) or first_ts
    meta = {
        "id": state.path.stem,
        "filename": state.path.name,
        "sizeBytes": (state.path.stat().st_size
                      if state.path.exists() else 0),
        "ticks": state.tick_count,
        "positionFrames": state.position_count,
        "totalFrames": state.tick_count + state.position_count,
        "durationSec": int((last_ts - first_ts).total_seconds()),
        "startedAtUtc": first_ts.isoformat(),
        "endedAtUtc": last_ts.isoformat(),
        "serverId": state.writer.server_id_bytes.decode("utf-8"),
        "mapName": _meta_field(state.last_snap, "mapName"),
        "gameMode": (_meta_field(state.last_snap, "gameModeName")
                     or _meta_field(state.last_snap, "gameModeId")),
        "layerName": _meta_field(state.last_snap, "layer", "name")
                     or _meta_field(state.last_snap, "mapName"),
        "matchId": state.match_id,
        "peakPlayers": state.peak_players,
        "recordingState": (RECORDING_STATE_FINALIZED if confirmed_ended
                           else RECORDING_STATE_UNVERIFIED),
        "inProgress": not confirmed_ended,
    }
    meta_path = state.path.with_suffix(".meta.json")
    _atomic_write_json(meta_path, meta)
    log.info("closed %s (%s): %d ticks, %d s, peak %d players%s",
             state.path.name, meta["recordingState"], state.tick_count,
             meta["durationSec"], state.peak_players,
             f" [{reason}]" if reason else "")
    return meta_path


def _meta_field(snap: Optional[dict], *keys: str):
    if not snap:
        return None
    cur: Any = snap.get("gameState") or {}
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


# ---------- main loop -------------------------------------------------------

def _handle_snap(
    *,
    snap: dict,
    raw_line: str,
    state_box: dict,
    out_dir: Path,
    server_id: str,
    min_ticks: int,
    filename_buffer: list,
) -> None:
    """
    State-machine step: takes one snap, updates/creates/closes the
    current recording as needed. `state_box['current']` holds the
    `RecordingState | None`.
    """
    gs = snap.get("gameState") or {}
    match_state = gs.get("matchState")
    # Narrow once, here: anything that is not a non-empty str is not an id.
    # Everything downstream keys files, sidecars and the authorization gate off
    # this value, so it must never be carried around as "maybe a string".
    raw_match_id = gs.get("matchId")
    match_id: Optional[str] = (
        raw_match_id if isinstance(raw_match_id, str) and raw_match_id else None)
    current: Optional[RecordingState] = state_box.get("current")

    is_active = match_state == "InProgress" and match_id is not None
    is_known_inactive = (isinstance(match_state, str)
                         and match_state in _INACTIVE_MATCH_STATES)

    def _clear_pending_match() -> None:
        state_box["pending_match_id"] = None
        state_box["pending_match_buffer"] = []

    # Producer tick ids let us distinguish genuinely consecutive confirmations
    # from B frames whose intervening A resets were lost to a tick gap. Older /
    # offline fixtures with no tick field retain compatibility until a sequenced
    # tick has been observed.
    tick = snap.get("tick")
    tick_is_valid = isinstance(tick, int) and not isinstance(tick, bool)
    sequence_required = bool(state_box.get("tick_sequence_required"))
    last_tick = state_box.get("last_tick")
    sequence_broken = False
    if tick_is_valid:
        state_box["tick_sequence_required"] = True
        if (isinstance(last_tick, int) and not isinstance(last_tick, bool)
                and tick != last_tick + 1):
            sequence_broken = True
        state_box["last_tick"] = tick
    elif sequence_required:
        if not state_box.get("missing_tick_warned"):
            log.warning(
                "live snapshot has no integer tick id; ignoring transitions "
                "until sequenced frames resume"
            )
            state_box["missing_tick_warned"] = True
        sequence_broken = True
        state_box["last_tick"] = None

    if sequence_broken:
        state_box["inactive_ticks"] = 0
        _clear_pending_match()
        if current is None:
            filename_buffer.clear()
        # Once this source has advertised sequence ids, an unsequenced frame
        # is ambiguous and must not contribute to a transition confirmation.
        if not tick_is_valid:
            return

    # Missing/torn state cannot prove a match ended.  It also breaks a pending
    # end-state confirmation so non-consecutive glitches cannot accumulate.
    if not is_active and not is_known_inactive:
        state_box["inactive_ticks"] = 0
        _clear_pending_match()
        if current is None:
            filename_buffer.clear()
        return

    if not is_active:
        _clear_pending_match()
        # With no opened/buffered match there is nothing security-relevant to
        # close, so normal idle logging need not wait for confirmation.
        if current is None:
            filename_buffer.clear()
            state_box["inactive_ticks"] = 0
            if state_box.get("last_state") != match_state:
                log.info("idle: matchState=%r", match_state)
                state_box["last_state"] = match_state
            return

        inactive_ticks = int(state_box.get("inactive_ticks", 0)) + 1
        state_box["inactive_ticks"] = inactive_ticks
        if inactive_ticks < _MATCH_END_CONFIRM_TICKS:
            return

        state_box["inactive_ticks"] = 0
        if current is not None:
            finalize_recording(
                current,
                min_ticks=min_ticks,
                reason=f"confirmed matchState={match_state!r}",
                confirmed_ended=True,
            )
            state_box["current"] = None
            state_box["last_state"] = match_state
        elif state_box.get("last_state") != match_state:
            log.info("idle: matchState=%r", match_state)
            state_box["last_state"] = match_state
        # Abandon any pre-open buffered ticks: a match that was buffering
        # (InProgress but no map name yet) and went inactive never opened,
        # so its ticks must not leak into the NEXT match's recording.
        filename_buffer.clear()
        return

    state_box["inactive_ticks"] = 0

    # Active match. A different id must also be stable: one torn FString must
    # neither close A nor create a B recording containing a live A snapshot.
    if current is not None and current.match_id != match_id:
        pending = state_box.get("pending_match_buffer")
        if (state_box.get("pending_match_id") == match_id
                and isinstance(pending, list)):
            pending.append((snap, raw_line))
        else:
            pending = [(snap, raw_line)]
            state_box["pending_match_id"] = match_id
            state_box["pending_match_buffer"] = pending
        if len(pending) < _MATCH_END_CONFIRM_TICKS:
            return

        finalize_recording(current, min_ticks=min_ticks,
                           reason="matchId changed",
                           confirmed_ended=True)
        state_box["current"] = None
        current = None
        # Seed the normal open buffer with the already confirmed B frames. The
        # current frame is appended below, so transfer all but its final entry.
        filename_buffer.clear()
        filename_buffer.extend(pending[:-1])
        _clear_pending_match()
    else:
        _clear_pending_match()

    # Need to (re)open writer.
    if current is None:
        # Discard buffered ticks that belong to a superseded match — a match
        # can start buffering pre-open and then be replaced directly by a new
        # matchId without ever going inactive; without this the old match's
        # ticks would be flushed into the new match's file.
        if filename_buffer:
            buf_mid = (filename_buffer[0][0].get("gameState") or {}).get("matchId")
            if buf_mid != match_id:
                filename_buffer.clear()
        # If the very first snap of the match has a populated map/mode
        # we open immediately. Otherwise buffer up to N ticks and decide
        # the filename when we have a name OR hit the buffer cap.
        filename_buffer.append((snap, raw_line))
        latest = filename_buffer[-1][0]
        latest_gs = latest.get("gameState") or {}
        have_name = bool(latest_gs.get("mapName")
                         and (latest_gs.get("gameModeName")
                              or latest_gs.get("gameModeId")))
        if len(filename_buffer) < _MATCH_END_CONFIRM_TICKS:
            return  # require a stable match id before creating any file
        if not have_name and len(filename_buffer) < _FILENAME_BUFFER_LIMIT:
            return  # keep buffering
        if match_id is None:
            # Unreachable today: the early returns above only let an active
            # match through, and `is_active` requires a non-empty id. Kept as a
            # hard stop because a recording opened with a null id would key its
            # sidecar — and therefore the live-access gate — off nothing.
            return
        started_at = _utc_now()
        filename = compute_filename(latest, started_at)
        out_path = out_dir / filename
        # Collision guard: append _2/_3/... if it exists already
        suffix = 2
        while out_path.exists():
            out_path = out_dir / f"{filename[:-5]}_{suffix}.sqrx"
            suffix += 1
        writer = SqrxWriter(out_path, server_id=server_id)
        current = RecordingState(
            match_id=match_id,
            writer=writer,
            path=out_path,
            started_at=started_at,
        )
        state_box["current"] = current
        state_box["last_state"] = "InProgress"
        _write_active_sidecar(current, latest)
        log.info("recording: started match %s -> %s",
                 match_id, out_path.name)
        # Flush the buffer (including the just-arrived snap) into the writer
        for buf_snap, buf_line in filename_buffer:
            _write_line(current, buf_snap, buf_line)
        filename_buffer.clear()
        return

    # Steady-state: append to current writer.
    _write_line(current, snap, raw_line)


def _write_line(state: RecordingState, snap: dict, raw_line: str) -> None:
    n = state.writer.write_line(raw_line)
    state.raw_bytes += n
    state.tick_count += 1
    ts = snap.get("timestamp")
    if state.first_snap_ts is None:
        state.first_snap_ts = ts
    state.last_snap_ts = ts
    state.last_snap = snap
    pc = len(snap.get("players") or [])
    if pc > state.peak_players:
        state.peak_players = pc


def write_position_frame(state_box: dict, pos_line: str) -> int:
    """Append a 4 Hz position frame to the currently-open recording, if any.

    Deliberately thin and side-channel: it appends `pos_line` (an already-
    serialized ``{"t":"pos",...}`` NDJSON line) to the active writer and does
    NOTHING else — it never opens or closes a recording, never touches the
    match state machine or tick-sequence tracking, and never advances
    `tick_count` / `peak_players` / timestamps (full frames own those, so
    `ticks` and `has_replay` stay full-frame-based and backward-compatible).
    Returns bytes written, or 0 when no recording is open (the sampler ran
    between matches — the frame is simply dropped)."""
    state: Optional[RecordingState] = state_box.get("current")
    if state is None:
        return 0
    n = state.writer.write_line(pos_line)
    state.raw_bytes += n
    state.position_count += 1
    return n


__all__ = [
    "compute_filename", "RecordingState",
    "extract_metadata", "finalize_recording", "write_position_frame",
]
