"""
sqreader CLI — single entry point for the snapshot pipeline.

After `pip install -e .` (or with the project venv active), run:

    sqreader summary             # quick dashboard of the live game
    sqreader snapshot --pretty   # one JSON snapshot to stdout
    sqreader snapshot --out FILE # append one NDJSON line to FILE
    sqreader watch --hz 3 --duration 30
                                 # continuous capture, 3 Hz, 30 s
    sqreader watch --out captures/run.ndjson
    sqreader test                # run the test_all regression suite

All subcommands auto-detect the live SquadGameServer PID.
"""
from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from . import config, elo

# Plugins run inside the tick loop. At the production 0.5 Hz the whole tick has
# ~2 s, and the reader — not the plugins — owns that. Anything past this gets
# logged so a heavy detector is visible before it starts costing ticks.
_PLUGIN_BUDGET_MS = 250.0


def _target_alive(pid: int) -> bool:
    """True while the target process still exists. When Squad restarts
    (map change / crash) the old pid dies and reads start failing; we
    use this to exit cleanly so systemd re-runs `pidof` and re-attaches
    to the new pid, instead of spinning forever on a dead pid."""
    return os.path.exists(f"/proc/{pid}")


def _discover_with_retry(fn, pm, label, *, attempts: int = 3,
                         delay: float = 2.0):
    """Run a heap-signature discovery fn, retrying transient failures.

    Discovery scans the live heap; during a heavy GC / mid-realloc the
    signature can momentarily be absent, raising RuntimeError. A single
    failure used to cost a full process exit → systemd restart → another
    30 s discovery. Retrying in-process (re-reading maps between tries,
    since the heap may have grown) usually clears it on the 2nd attempt.
    """
    last: Exception | None = None
    for i in range(1, attempts + 1):
        try:
            return fn(pm)
        except Exception as e:
            last = e
            print(f"[!] {label} discovery attempt {i}/{attempts} failed: {e}",
                  file=sys.stderr)
            if i < attempts:
                try:
                    pm.refresh_maps()
                except Exception:
                    pass
                time.sleep(delay)
    raise RuntimeError(
        f"{label} discovery failed after {attempts} attempts: {last}")


def _resolve_gobjects(pm, binary_id: str | None = None):
    """Resolve GUObjectArray. Order: cached addr → known hardcoded addr →
    signature discovery. Every candidate is validated (sane num_elements)
    before use; whatever resolves is written back to the address cache so
    the next startup is instant instead of paying the ~30 s discovery."""
    from . import addrcache
    from .ue.uobject import (
        GUObjectArray, KNOWN_GOBJECTS_ADDR_V10_4_1, find_gobjects_base,
    )

    def _valid(addr):
        try:
            arr = GUObjectArray(pm, addr)
            n = arr.num_elements
            return arr if 0 < n < (1 << 26) else None
        except Exception:
            return None

    cached = addrcache.get(binary_id, "gobjects")
    if cached is not None:
        arr = _valid(cached)
        if arr is not None:
            print(f"[+] GUObjectArray from cache @ {cached:#x}", file=sys.stderr)
            return arr
        print(f"[!] cached GUObjectArray addr {cached:#x} stale; "
              "falling back", file=sys.stderr)

    arr = _valid(KNOWN_GOBJECTS_ADDR_V10_4_1)
    if arr is not None:
        addrcache.put(binary_id, "gobjects", KNOWN_GOBJECTS_ADDR_V10_4_1)
        return arr
    print("[!] known GUObjectArray addr invalid; running discovery...",
          file=sys.stderr)

    addr = _discover_with_retry(find_gobjects_base, pm, "GUObjectArray")
    print(f"[+] GUObjectArray discovered at {addr:#x}", file=sys.stderr)
    addrcache.put(binary_id, "gobjects", addr)
    return GUObjectArray(pm, addr)


def _resolve_fname_pool(pm, binary_id: str | None = None):
    """Resolve FNamePool. Order: cached addr → known hardcoded addr →
    heap-scan discovery. Validity = index 0 resolves to 'None' (the
    canonical first reserved EName). Resolved addr is cached."""
    from . import addrcache
    from .ue.fname import (
        FNameEntryAllocator, KNOWN_ALLOCATOR_ADDR_V10_4_1,
        find_fname_pool_base,
    )

    def _valid(addr):
        try:
            alloc = FNameEntryAllocator(pm, addr)
            return alloc if alloc.fname_to_str(0, 0) == "None" else None
        except Exception:
            return None

    cached = addrcache.get(binary_id, "fnamepool")
    if cached is not None:
        alloc = _valid(cached)
        if alloc is not None:
            print(f"[+] FNamePool from cache @ {cached:#x}", file=sys.stderr)
            return alloc
        print(f"[!] cached FNamePool addr {cached:#x} stale; falling back",
              file=sys.stderr)

    alloc = _valid(KNOWN_ALLOCATOR_ADDR_V10_4_1)
    if alloc is not None:
        addrcache.put(binary_id, "fnamepool", KNOWN_ALLOCATOR_ADDR_V10_4_1)
        return alloc
    print("[!] known FNamePool addr invalid; running discovery...",
          file=sys.stderr)

    addr = _discover_with_retry(find_fname_pool_base, pm, "FNamePool")
    print(f"[+] FNamePool discovered at {addr:#x}", file=sys.stderr)
    addrcache.put(binary_id, "fnamepool", addr)
    return FNameEntryAllocator(pm, addr)


def _open_pipeline(pid: int | None, *, with_metadata: bool):
    from . import addrcache
    from .mem import ProcessMemory
    from .squad.metadata import Metadata
    from .squad.snapshot import resolve_paths
    pid = pid or config.find_squad_server_pid()
    pm = ProcessMemory(pid)
    binary_id = addrcache.binary_identity(pid)
    arr = _resolve_gobjects(pm, binary_id)
    alloc = _resolve_fname_pool(pm, binary_id)
    paths = resolve_paths(pm, arr, alloc)
    metadata = Metadata.load() if with_metadata else None
    return pid, pm, arr, alloc, paths, metadata


def _scanner_suspect(snap: dict) -> bool:
    """Cache-poisoning signature: a populated InProgress match reading almost no
    alive-with-position soldiers. Squad remaps class subobjects mid-match and our
    caches poison silently → partial scans. Healthy live matches run 40-70% alive;
    poisoned scans show 5-10%. Only judged while InProgress — outside it a low
    alive-ratio is expected (players connected, soldiers despawned). Shared by the
    single-tier loop and the background BuildWorker; the caller owns the warmup
    skip + streak/reset response."""
    if (snap.get("gameState") or {}).get("matchState") != "InProgress":
        return False
    ps = snap.get("players") or []
    total = len(ps)
    if total <= 20:
        return False
    alive = sum(1 for p in ps
                if (s := p.get("soldier") or {}) and s.get("position")
                and (s.get("health") or 0) > 0)
    return alive < total * 0.20


# ----- subcommands -----------------------------------------------------------

def cmd_snapshot(args: argparse.Namespace) -> int:
    from .squad.snapshot import build_snapshot, clean_nonfinite
    pid, pm, arr, alloc, paths, meta = _open_pipeline(
        args.pid, with_metadata=not args.no_metadata)
    t0 = time.time()
    snap = clean_nonfinite(build_snapshot(
        pm, arr, alloc, server_id=args.server_id,
        include_motd=args.with_motd,
        paths=paths, metadata=meta))
    dt = time.time() - t0
    line = json.dumps(snap, indent=2 if args.pretty else None,
                      ensure_ascii=False)
    print(line)
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        with open(args.out, "a", encoding="utf-8") as f:
            f.write(json.dumps(snap, ensure_ascii=False) + "\n")
        print(f"\n# appended to {args.out} ({dt*1000:.0f}ms; pid {pid})",
              file=sys.stderr)
    else:
        print(f"\n# snapshot built in {dt*1000:.0f}ms (pid {pid})",
              file=sys.stderr)
    return 0


def cmd_summary(args: argparse.Namespace) -> int:
    from .squad.snapshot import build_snapshot
    from .squad.metadata import Metadata  # noqa: F401 (used via _open_pipeline)
    pid, pm, arr, alloc, paths, meta = _open_pipeline(
        args.pid, with_metadata=True)
    snap = build_snapshot(pm, arr, alloc, paths=paths, metadata=meta)
    _render_summary(snap)
    return 0


def cmd_watch(args: argparse.Namespace) -> int:
    from .squad.snapshot import (
        DamageTracker, SnapshotCaches, build_snapshot, clean_nonfinite,
    )
    from .sqrx import SqrxWriter
    pid, pm, arr, alloc, paths, meta = _open_pipeline(
        args.pid, with_metadata=not args.no_metadata)
    caches = SnapshotCaches()
    damage_tracker = DamageTracker()

    base_out_path = args.out
    if base_out_path is None:
        base_out_path = Path("captures") / (
            f"{args.server_id}_"
            f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.ndjson"
        )
    base_out_path = Path(base_out_path)
    base_out_path.parent.mkdir(parents=True, exist_ok=True)

    sqrx_path = Path(args.sqrx_out) if args.sqrx_out else None
    if sqrx_path:
        sqrx_path.parent.mkdir(parents=True, exist_ok=True)
    sqrx_writer = SqrxWriter(sqrx_path, args.server_id) if sqrx_path else None
    sqrx_raw_bytes = 0

    max_size_bytes = int(args.max_size_mb * 1024 * 1024) if args.max_size_mb else 0
    rotation_idx = 0

    def _path_for(idx: int) -> Path:
        if idx == 0:
            return base_out_path
        # Sliced into stem/suffix so we land on
        # captures/match_001.ndjson when base is captures/match.ndjson
        return base_out_path.with_name(
            f"{base_out_path.stem}_{idx:03d}{base_out_path.suffix}")

    out_path = _path_for(rotation_idx)
    period = 1.0 / args.hz
    rot_note = (f"; rotate at {args.max_size_mb:.0f} MB"
                if max_size_bytes else "")
    sqrx_note = f"; also writing {sqrx_path}" if sqrx_path else ""
    print(f"writing to {out_path}{rot_note}{sqrx_note}; "
          f"target period {period*1000:.0f}ms "
          f"({args.hz} Hz); pid {pid}", file=sys.stderr)

    stop = {"flag": False}
    def _stop(sig, frame):
        stop["flag"] = True
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    tick = 0
    started = time.time()
    last_report = started
    total_ms = 0.0
    f = out_path.open("a", encoding="utf-8")
    try:
        while not stop["flag"]:
            tick += 1
            t_tick = time.time()
            try:
                # Same rolling cache hygiene as serve — long watches are
                # equally exposed to slot-reuse poisoning.
                caches.partial_invalidate(tick, window=60,
                                          total_slots=arr.num_elements)
                snap = clean_nonfinite(build_snapshot(
                    pm, arr, alloc,
                    server_id=args.server_id,
                    include_motd=args.with_motd,
                    paths=paths, metadata=meta,
                    caches=caches, damage_tracker=damage_tracker,
                ))
                snap["tick"] = tick
                line = json.dumps(snap, ensure_ascii=False) + "\n"
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
                if sqrx_writer is not None:
                    sqrx_raw_bytes += sqrx_writer.write_line(line)
            except OSError as e:
                if not _target_alive(pid):
                    print(f"[tick {tick}] target pid {pid} is gone "
                          "(Squad restarted?); stopping capture",
                          file=sys.stderr)
                    break
                print(f"[tick {tick}] read error: {e!r}; retrying",
                      file=sys.stderr)
                time.sleep(period)
                continue

            # Rotate the output if the current file exceeds the cap.
            if max_size_bytes and f.tell() >= max_size_bytes:
                f.close()
                old = out_path
                rotation_idx += 1
                out_path = _path_for(rotation_idx)
                print(f"[tick {tick}] rotated {old.name} "
                      f"({old.stat().st_size/1024:.0f} KiB) "
                      f"-> {out_path.name}", file=sys.stderr)
                f = out_path.open("a", encoding="utf-8")
            build_ms = (time.time() - t_tick) * 1000
            total_ms += build_ms

            now = time.time()
            if now - last_report >= 5.0:
                gs = snap.get("gameState") or {}
                ts = snap.get("teams") or []
                de = snap.get("damageEvents") or []
                print(f"[tick {tick}] elapsed={now-started:5.1f}s  "
                      f"build={build_ms:4.0f}ms  avg={total_ms/tick:4.0f}ms  "
                      f"players={len(snap.get('players', []))}  "
                      f"vehicles={len(snap.get('vehicles', []))}  "
                      f"events={len(de)}  "
                      f"matchState={gs.get('matchState')!r}  "
                      f"tickets=[{','.join(str((t or {}).get('tickets')) for t in ts)}]",
                      file=sys.stderr)
                last_report = now
                for ev in de:
                    print(f"  >> hit  victim={ev.get('victim')!r}  "
                          f"attacker={ev.get('attacker')!r}",
                          file=sys.stderr)

            sleep_for = period - (time.time() - t_tick)
            if sleep_for > 0:
                time.sleep(sleep_for)
            if args.duration and now - started >= args.duration:
                break
    finally:
        f.close()
        if sqrx_writer is not None:
            sqrx_writer.close()

    elapsed = time.time() - started
    print(f"\nstopped: {tick} ticks in {elapsed:.1f}s "
          f"(effective rate {tick / elapsed:.2f} Hz)", file=sys.stderr)
    rotations_done = rotation_idx
    if rotations_done:
        print(f"output: {base_out_path.parent}/{base_out_path.stem}"
              f"[_001..{rotation_idx:03d}]{base_out_path.suffix} "
              f"({rotations_done+1} files)", file=sys.stderr)
    else:
        print(f"output: {out_path} ({out_path.stat().st_size / 1024:.1f} KiB)",
              file=sys.stderr)
    if sqrx_path and sqrx_path.exists():
        on_disk = sqrx_path.stat().st_size
        ratio = (sqrx_raw_bytes / on_disk) if on_disk else 0.0
        print(f"sqrx:   {sqrx_path} ({on_disk/1024:.1f} KiB, "
              f"{sqrx_raw_bytes/1024:.1f} KiB raw, "
              f"{ratio:.1f}x compression)", file=sys.stderr)
    return 0


def _load_placer_cache(caches, path: Path) -> None:
    """Re-attach captured deployable placers after a reader restart. The cache is
    keyed by each actor's STABLE instance name, so a fresh memory address on
    restart doesn't matter — a FOB/mine placed before the restart keeps its
    placer instead of falling back to '—'."""
    try:
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                caches.placer_cache = {k: v for k, v in data.items()
                                       if isinstance(v, dict) and v.get("name")}
                caches.placer_epoch = max(
                    (int(v.get("ep", 0)) for v in caches.placer_cache.values()),
                    default=0)
    except Exception:
        pass


def _save_placer_cache(caches, path: Path) -> None:
    try:
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(caches.placer_cache, ensure_ascii=False),
                       encoding="utf-8")
        tmp.replace(path)
    except Exception:
        pass


def cmd_serve(args: argparse.Namespace) -> int:
    """
    Run the snapshot producer in a loop, recording finished matches and
    (optionally) computing stats + pushing them to central. This is the
    distributed build: it serves finished replays + stats over HTTP but never
    a live view. Optional --out / --sqrx-out tee each tick to disk in parallel.
    """
    from .squad.snapshot import (
        DamageTracker, SnapshotCaches, build_snapshot, clean_nonfinite,
    )
    from .sqrx import SqrxWriter
    from .httpsrv import _TickBeat, serve_in_background

    pid, pm, arr, alloc, paths, meta = _open_pipeline(
        args.pid, with_metadata=not args.no_metadata)
    caches = SnapshotCaches()
    damage_tracker = DamageTracker()

    # Authoritative kill-feed events from the Squad server log. The memory
    # take-hit sampler only catches a fraction of kills (deaths are mostly
    # bleed-outs that emit no hit at 0.5 Hz); the log records every one with
    # the exact attacker + weapon. Read-only and isolated in a daemon
    # thread — if the log is missing/unreadable or the thread dies, the
    # reader keeps running and the feed just falls back to the memory events.
    log_tailer = None
    try:
        from .squad.logtail import LogTailer, find_squad_log
        squad_log = getattr(args, "squad_log", None) or find_squad_log()
        if squad_log:
            log_tailer = LogTailer(squad_log)
            log_tailer.start()
            print(f"  kill-feed from log -> {squad_log}", file=sys.stderr)
        else:
            print("  no Squad log found; kill-feed uses memory events",
                  file=sys.stderr)
    except Exception as e:
        print(f"  log tailer disabled: {e}", file=sys.stderr)
        log_tailer = None

    out_f = None
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        out_f = open(args.out, "a", encoding="utf-8")
    sqrx_writer = None
    sqrx_raw_bytes = 0
    if args.sqrx_out:
        Path(args.sqrx_out).parent.mkdir(parents=True, exist_ok=True)
        sqrx_writer = SqrxWriter(args.sqrx_out, args.server_id)

    # Producer-liveness heartbeat: marked each tick so /health can tell a live
    # server from a frozen one. No live view is served (distributed build).
    beat = _TickBeat()
    # Live ops metrics, exposed at /health/deep and embedded per tick as
    # snap["perf"] — answers "is the scanner healthy / how slow are
    # builds / is the cache thrashing?" from one curl.
    stats_state: dict = {"tick": 0, "lastBuildMs": None, "avgBuildMs": None,
                         "startedAt": time.time()}

    def _deep_health() -> dict:
        return {
            "pid": pid,
            "addresses": {
                "gobjects": hex(arr.base),
                "fnamepool": hex(alloc.base),
            },
            "tick": stats_state["tick"],
            "uptimeSec": round(time.time() - stats_state["startedAt"], 1),
            "lastBuildMs": stats_state["lastBuildMs"],
            "avgBuildMs": (round(stats_state["avgBuildMs"], 1)
                           if stats_state["avgBuildMs"] is not None else None),
            "lastTickAgeSec": round(beat.last_tick_age_sec, 1),
            "objClass": {
                "hits": caches.obj_class_hits,
                "misses": caches.obj_class_misses,
                "serialBumps": caches.obj_class_serial_bumps,
            },
            "resets": {
                "count": caches.reset_count,
                "lastTick": caches.last_reset_tick,
                "lastReason": caches.last_reset_reason,
            },
            # Assigned further down, before the server starts — so by the time
            # anything can call this, it exists. Surfaced because a plugin that
            # raises every single tick is otherwise invisible: the registry
            # swallows it and the reader carries on, exactly as designed.
            "plugins": plugin_mgr.stats() if plugin_mgr is not None else None,
            "cacheSizes": caches.sizes(),
        }

    recordings_dir = (Path(args.recordings_dir).expanduser()
                      if getattr(args, "recordings_dir", None) else None)
    if recordings_dir:
        recordings_dir.mkdir(parents=True, exist_ok=True)
    # Persistent player-stats store (SQLite). Strictly best-effort: a bad DB
    # path / init failure disables stats but must NEVER block the live reader.
    stats_store = None
    stats_db_path = (Path(args.stats_db).expanduser()
                     if getattr(args, "stats_db", None) else None)

    # Deployable placer cache persisted next to the stats DB so captured placers
    # survive reader restarts (mid-match agent deploys / crashes) instead of
    # reverting to '—'. Load any prior cache before the loop starts.
    placer_cache_path = (stats_db_path.parent / "placer_cache.json"
                         if stats_db_path else None)
    if placer_cache_path is not None:
        _load_placer_cache(caches, placer_cache_path)
    last_placer_save = time.time()

    # --- optional central push (OPT-IN): active only when this box is ENROLLED
    # (.env.agent present) AND enabled (`serve --push` or config push_enabled).
    # Every match is queued on finalize and flushed from a serve-loop timer, so
    # a down central just delays delivery — the live reader is never affected.
    from . import ingest_client
    push_creds = ingest_client.current_creds()
    push_active = (bool(push_creds) and stats_db_path is not None
                   and (getattr(args, "push", False)
                        or bool(config.get("push_enabled"))))
    push_backlog: Path | None = None
    if push_active and stats_db_path is not None and push_creds is not None:
        push_backlog = Path(config.get("push_backlog_dir")
                            or ingest_client.default_backlog_dir(stats_db_path))
        push_backlog.mkdir(parents=True, exist_ok=True)
        print(f"  central push -> {push_creds.get('SQREADER_PUSH_URL')} "
              f"(community {push_creds.get('SQREADER_COMMUNITY') or '?'})",
              file=sys.stderr)
    elif getattr(args, "push", False) and not push_creds:
        print("  --push given but this box is not enrolled; run "
              "`sqreader enroll <token>` first (push disabled)", file=sys.stderr)

    def _enqueue_push(match_id: str) -> None:
        if push_backlog is not None:
            ingest_client.enqueue(push_backlog, match_id)

    def _flush_push() -> None:
        if not push_active or push_backlog is None or stats_db_path is None:
            return
        try:
            res = ingest_client.flush_backlog(
                push_backlog, stats_db_path, recordings_dir, push_creds or {},
                push_replay_files=bool(config.get("push_replay")))
            if res["sent"] or res["errors"]:
                print(f"[push] sent={res['sent']} pending={res['pending']} "
                      f"errors={res['errors']}", file=sys.stderr)
        except Exception as _fe:
            print(f"[push] flush error: {_fe!r}", file=sys.stderr)

    # -- Fleet check-in (Phase 0 remote-update telemetry) -------------------
    # A lightweight sealed report — agent version, the Squad BUILD we're attached
    # to, and the reader's doctor-health — so central knows which enrolled servers
    # a Squad patch just broke. Same opt-in boundary as push (enrolled + push on).
    # Best-effort: a failed check-in is logged and forgotten, never fatal.
    from . import fleet, health, squad_build
    _checkin_channel = str(config.get("update_channel") or "stable")
    _checkin_build_sha = squad_build.build_sha256(pid) if push_active else None
    _checkin_restarts = (fleet.bump_restarts(stats_db_path.parent)
                         if push_active and stats_db_path is not None else 0)

    def _checkin() -> None:
        if not push_active or push_creds is None or push_backlog is None:
            return
        try:
            telem = fleet.gather(pm, arr, alloc, build_sha=_checkin_build_sha,
                                 restarts=_checkin_restarts,
                                 uptime_sec=time.time() - started,
                                 channel=_checkin_channel)
            ingest_client.checkin(
                push_creds, telem, seq=ingest_client._next_seq(push_backlog))
        except Exception as _ce:
            print(f"[checkin] {_ce!r}", file=sys.stderr)

    # -- Offset self-heal (Phase 1 remote-update) ---------------------------
    # When a Squad patch drifts our hardcoded offsets, fetch a SIGNED pack from
    # central, verify it (Ed25519), apply it AT RUNTIME, and confirm with doctor —
    # rolling back if it doesn't clear the drift. No code redeploy. Same opt-in
    # boundary as push; the user chose auto-apply. `offsets.active.json` persists a
    # committed pack so it re-applies across restarts.
    _offset_autoheal = bool(config.get("offset_autoheal"))
    _update_enabled = bool(config.get("update_enabled"))
    _offset_state_dir = stats_db_path.parent if stats_db_path is not None else None

    if (_offset_autoheal and push_active and _checkin_build_sha
            and _offset_state_dir is not None):
        from . import offset_client as _oc
        _committed = _oc.active_offsets_for(_offset_state_dir, _checkin_build_sha)
        if _committed:
            from .squad.snapshot import apply_offset_overrides, resolve_paths
            _n = apply_offset_overrides(_committed.get("offsets") or {})
            paths = resolve_paths(pm, arr, alloc)
            print(f"[selfheal] re-applied committed offset pack "
                  f"v{_committed.get('version')} ({len(_n)} offsets) at boot",
                  file=sys.stderr)

    def _selfheal():
        """One self-heal attempt: if the reader has DRIFTED and central offers a
        newer signed pack for our build, apply it in-process, verify with doctor,
        and commit — or roll back. Returns the re-resolved paths on a successful
        apply, else None. Best-effort; never raises out to the loop."""
        if not (_offset_autoheal and push_active and push_creds is not None
                and _checkin_build_sha and _offset_state_dir is not None
                and push_backlog is not None):
            return None
        try:
            from . import offset_client as _oc
            from .squad.snapshot import (
                apply_offset_overrides, resolve_paths, revert_offset_overrides)
            if health.run_doctor(pm, arr, alloc).get("state") != "drift":
                return None      # only self-heal a genuinely drifted reader
            minv = _oc.active_version(_offset_state_dir, _checkin_build_sha)
            got = _oc.fetch_and_accept(
                push_creds, _checkin_build_sha, _checkin_channel, minv,
                seq=ingest_client._next_seq(push_backlog))
            if not got:
                return None
            applied = apply_offset_overrides(got["offsets"])
            new_paths = resolve_paths(pm, arr, alloc)
            caches.reset()
            if health.run_doctor(pm, arr, alloc).get("state") == "ok":
                _oc.save_active(_offset_state_dir, _checkin_build_sha,
                                got["version"], got["offsets"])
                print(f"[selfheal] applied offset pack v{got['version']} "
                      f"({len(applied)} offsets) — reader healthy again",
                      file=sys.stderr)
                return new_paths
            revert_offset_overrides()     # pack didn't clear the drift → undo
            caches.reset()
            print(f"[selfheal] pack v{got['version']} did not clear drift; "
                  f"rolled back", file=sys.stderr)
            return None
        except Exception as _se:
            try:
                from .squad.snapshot import revert_offset_overrides
                revert_offset_overrides()
                caches.reset()
            except Exception:
                pass
            print(f"[selfheal] error: {_se!r}", file=sys.stderr)
            return None

    def _check_update() -> None:
        """If update_enabled, fetch + verify + download + STAGE a newer signed
        release. Never installs or restarts the live reader — it stages the
        verified artifact and logs that a restart (via `sqreader
        apply-staged-update`) will apply it. Best-effort; never raises."""
        if not (_update_enabled and push_active and push_creds is not None
                and _offset_state_dir is not None and push_backlog is not None):
            return
        try:
            from . import updater
            got = updater.fetch_and_accept(
                push_creds, _checkin_channel,
                seq=ingest_client._next_seq(push_backlog),
                min_applied=updater.staged_version(_offset_state_dir))
            if not got:
                return
            data = updater.download_verified(
                push_creds, got["artifact"], got["sha256"])
            if data is None:
                print(f"[update] release v{got['version']} download/verify failed",
                      file=sys.stderr)
                return
            updater.stage(_offset_state_dir, got["version"], got["artifact"], data)
            print(f"[update] staged agent release v{got['version']} — restart to "
                  f"apply (`sqreader apply-staged-update`)", file=sys.stderr)
        except Exception as _ue:
            print(f"[update] {_ue!r}", file=sys.stderr)

    if stats_db_path:
        try:
            from .stats import StatsStore
            stats_store = StatsStore(
                stats_db_path, server_id=args.server_id,
                on_finalize=_enqueue_push if push_active else None)
        except Exception as _se:
            print(f"stats store disabled (init failed): {_se!r}",
                  file=sys.stderr)
            stats_store = None
    # Plugins. Same containment as the stats store: a bad config or a plugin
    # that fails to construct disables plugins and says so. Alerts land in the
    # stats DB, so without one the plugins run but have nowhere to write —
    # pointless, and we say that instead of failing quietly.
    plugin_mgr = None
    plugins_cfg = (Path(args.plugins_config).expanduser()
                   if getattr(args, "plugins_config", None) else None)
    if plugins_cfg:
        try:
            from .plugins import PluginManager, load_config
            if stats_store is None:
                print("plugins: no --stats-db, alerts cannot be stored "
                      "— plugins disabled", file=sys.stderr)
            else:
                cfg = load_config(plugins_cfg)
                plugin_mgr = PluginManager(
                    cfg, server_id=args.server_id,
                    emit_alert=stats_store.insert_alert)
                if plugin_mgr.plugins:
                    print(f"plugins: {', '.join(plugin_mgr.plugins)}",
                          file=sys.stderr)
                else:
                    print("plugins: none enabled", file=sys.stderr)
        except Exception as _pe:
            print(f"plugins disabled (init failed): {_pe!r}", file=sys.stderr)
            plugin_mgr = None

    icons_dir = (Path(args.icons_dir).expanduser()
                 if getattr(args, "icons_dir", None) else None)
    if icons_dir is None:
        cwd_icons = Path("icons")
        if cwd_icons.is_dir():
            icons_dir = cwd_icons
    sqmaps_dir = (Path(args.sqmaps_dir).expanduser()
                  if getattr(args, "sqmaps_dir", None) else None)
    if sqmaps_dir is None:
        cwd_sqmaps = Path("sqmaps")
        if cwd_sqmaps.is_dir():
            sqmaps_dir = cwd_sqmaps
    frontend_dir = (Path(args.frontend_dir).expanduser()
                    if getattr(args, "frontend_dir", None) else None)
    if frontend_dir is None:
        for cand in (Path("frontend/dist"), Path("dist")):
            if (cand / "index.html").is_file():
                frontend_dir = cand
                break
    srv = serve_in_background(args.host, args.port, beat,
                              recordings_dir=recordings_dir,
                              icons_dir=icons_dir,
                              sqmaps_dir=sqmaps_dir,
                              frontend_dir=frontend_dir,
                              health_provider=_deep_health,
                              # 15 missed ticks is far past jitter and well into
                              # "the producer is wedged", with a 30s floor so a
                              # slow cadence doesn't make /health twitchy.
                              stale_after_sec=max(30.0, 15.0 / args.hz),
                              cors_origin=args.cors_origin,
                              stats_db=stats_db_path)
    period = 1.0 / args.hz
    feature_list = ["/health"]
    if recordings_dir:
        feature_list.append("/api/recordings")
    if icons_dir:
        feature_list.append("/icons")
    if sqmaps_dir:
        feature_list.append("/sqmaps")
    if frontend_dir:
        feature_list.append("/viewer-next")
    print(f"serving on http://{args.host}:{args.port}  "
          f"(GET {', '.join(feature_list)})", file=sys.stderr)
    print(f"target period {period*1000:.0f}ms ({args.hz} Hz); pid {pid}",
          file=sys.stderr)
    if out_f:
        print(f"  tee NDJSON  -> {args.out}", file=sys.stderr)
    if sqrx_writer:
        print(f"  tee .sqrx   -> {args.sqrx_out}", file=sys.stderr)

    # --- two-tier recording (opt-in: --record-hz > --hz) -------------------
    # The heavy full build runs on a background thread with its OWN pipeline;
    # the main loop paces at record_hz, writing a cheap 4 Hz position frame each
    # slot and folding in the worker's latest full frame whenever one is ready.
    # Off by default (record_hz unset / <= hz) → the classic single-tier loop
    # below runs byte-for-byte as before.
    from datetime import datetime as _dt, timezone as _tz
    record_hz = getattr(args, "record_hz", None)
    two_tier = bool(record_hz and record_hz > args.hz)
    worker = None
    entities = None            # SampledEntities from the last full frame
    last_full_gen = 0
    sample_positions: Any = None
    write_position_frame: Any = None
    if two_tier and record_hz is not None:
        from .squad.buildworker import ProcessBuildWorker
        from .squad.possample import sample_positions
        from .recorder import write_position_frame
        # The heavy full build runs in a SEPARATE PROCESS (own GIL/core) that
        # streams NDJSON snapshots; a thread worker starved the 4 Hz sampler via
        # the GIL. The parent reads that pipe on an I/O thread + samples inline.
        wargv = [sys.executable, "-m", "sqreader.cli", "build-worker",
                 "--pid", str(pid), "--server-id", args.server_id]
        if args.with_motd:
            wargv.append("--with-motd")
        if args.no_metadata:
            wargv.append("--no-metadata")
        worker = ProcessBuildWorker(
            wargv, target_alive=lambda: _target_alive(pid))
        worker.start()
        period = 1.0 / record_hz
        print(f"  two-tier: full ~{args.hz:g} Hz (bg process) + positions "
              f"{record_hz:g} Hz -> {period*1000:.0f}ms slot; pid {pid}",
              file=sys.stderr)

    stop = {"flag": False}

    def _stop(sig, frame):
        stop["flag"] = True
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    tick = 0
    started = time.time()
    last_report = started
    last_flush = started
    _flush_push()  # drain anything a previous run queued before we start ticking
    # First fleet check-in ~60s after boot (like the reference updater), then
    # every CHECKIN_INTERVAL_SEC. Seeding last_checkin in the past makes the first
    # one fire early so a freshly-broken server shows up on the fleet dashboard fast.
    last_checkin = started - (fleet.CHECKIN_INTERVAL_SEC - 60.0)
    # Per-match recorder state. Lives across ticks; the recorder module's
    # `_handle_snap` opens/closes .sqrx files as matchId / matchState
    # change. Stays empty when recordings_dir is None.
    record_state_box: dict = {
        "current": None,
        "last_state": None,
        "inactive_ticks": 0,
        "pending_match_id": None,
        "pending_match_buffer": [],
        "last_tick": None,
        "tick_sequence_required": True,
        "missing_tick_warned": False,
    }
    record_filename_buffer: list = []
    # Scanner-health streak counter. STABILITY-FIRST: a genuine suspicion
    # triggers an in-process cache reset, NEVER a process exit (see the
    # sanity block below). Kept only to rate-limit how often we reset.
    bad_streak = 0
    # Rolling cache invalidation. Squad memory layout drifts mid-match
    # (allocators move SQVehicle / SQDeployable / SQMapMarker
    # subclasses around); our caches poison silently — symptom is
    # partial scans (e.g. 12 vehicles when the map has 35). The old
    # strategy (full caches.reset() every 60 ticks) re-read all ~187k
    # objects in ONE tick → a 1-2 s build spike every ~30 s that froze
    # every entity on the live map and then snapped them forward. Now
    # partial_invalidate() drops 1/window of obj_class per tick — same
    # full-coverage-per-60-ticks guarantee, cost spread evenly, no
    # spike. A full reset still happens as a recovery step: once, when
    # the sanity check first flags a bad tick (see below).
    CACHE_WINDOW_TICKS = 60

    def _consume_full(snap: dict) -> None:
        """Full-frame consumers shared by the single-tier loop (every tick) and
        the two-tier loop (each fresh worker frame): authoritative kill-feed,
        liveness beat, NDJSON/.sqrx tee, per-match recorder, player stats,
        plugins. Every downstream is contained so its failure can never stop the
        reader. `snap` must already carry `tick` + `perf`."""
        nonlocal sqrx_raw_bytes
        if log_tailer is not None:
            from .squad.logtail import resolve_event_names
            snap["damageEvents"] = resolve_event_names(
                log_tailer.drain(), snap.get("players") or [])
        line = json.dumps(snap, ensure_ascii=False) + "\n"
        beat.mark()
        if out_f:
            out_f.write(line)
            out_f.flush()
        if sqrx_writer:
            sqrx_raw_bytes += sqrx_writer.write_line(line)
        # Per-match recorder: opens a new .sqrx on matchId change, closes when
        # matchState leaves InProgress. State lives in `record_state_box`.
        if recordings_dir:
            try:
                from .recorder import _handle_snap as _rec_step
                _rec_step(
                    snap=snap, raw_line=line,
                    state_box=record_state_box,
                    out_dir=recordings_dir,
                    server_id=args.server_id,
                    min_ticks=0,
                    filename_buffer=record_filename_buffer,
                )
            except Exception as _rec_e:
                print(f"[tick {tick}] recorder error: {_rec_e!r}",
                      file=sys.stderr)
        # Persistent player stats — same containment as the recorder: a stats
        # bug can only ever cost stats, never the live reader.
        if stats_store is not None:
            try:
                stats_store.record_tick(snap)
            except Exception as _st_e:
                print(f"[tick {tick}] stats error: {_st_e!r}", file=sys.stderr)
        # Plugins last, behind the same containment. They run on this thread on
        # purpose (see plugins/base.py), so a slow one shows up as reader lag.
        if plugin_mgr is not None:
            try:
                _pl_t0 = time.time()
                plugin_mgr.run_tick(snap, tick=tick)
                _pl_ms = (time.time() - _pl_t0) * 1000.0
                if _pl_ms > _PLUGIN_BUDGET_MS:
                    print(f"[tick {tick}] plugins took {_pl_ms:.0f}ms "
                          f"(budget {_PLUGIN_BUDGET_MS:.0f}ms)",
                          file=sys.stderr)
            except Exception as _pl_e:
                print(f"[tick {tick}] plugin error: {_pl_e!r}", file=sys.stderr)

    snap: dict = {}
    try:
        while not stop["flag"]:
            tick += 1
            t_tick = time.time()
            try:
                if two_tier:
                    # -- Two-tier: fold in the worker's latest full frame when
                    # ready, otherwise write a cheap 4 Hz position frame. --
                    if worker is not None and worker.target_gone:
                        print(f"[tick {tick}] target pid {pid} is gone "
                              "(build worker); exiting for systemd restart",
                              file=sys.stderr)
                        sys.exit(1)
                    frame = worker.latest() if worker is not None else None
                    if frame is not None and frame.gen != last_full_gen:
                        last_full_gen = frame.gen
                        snap = frame.snap
                        stats_state["tick"] = tick
                        stats_state["lastBuildMs"] = round(frame.build_ms, 1)
                        stats_state["avgBuildMs"] = (
                            frame.build_ms if stats_state["avgBuildMs"] is None
                            else stats_state["avgBuildMs"] * 0.9
                            + frame.build_ms * 0.1)
                        _consume_full(snap)
                        entities = frame.entities
                    elif entities is not None:
                        ts = _dt.now(_tz.utc).isoformat()
                        pos = sample_positions(pm, paths, entities, tick, ts)
                        pos_line = json.dumps(pos, ensure_ascii=False) + "\n"
                        beat.mark()
                        if out_f:
                            out_f.write(pos_line)
                            out_f.flush()
                        if sqrx_writer:
                            sqrx_raw_bytes += sqrx_writer.write_line(pos_line)
                        if recordings_dir:
                            write_position_frame(record_state_box, pos_line)
                    # else: worker still warming — no full frame + no entities.
                else:
                    # Inside the try so a transient read error from
                    # num_elements lands in the same per-tick recovery path
                    # as any other /proc hiccup.
                    caches.partial_invalidate(tick, window=CACHE_WINDOW_TICKS,
                                              total_slots=arr.num_elements)
                    snap = clean_nonfinite(build_snapshot(
                        pm, arr, alloc,
                        server_id=args.server_id,
                        include_motd=args.with_motd,
                        paths=paths, metadata=meta,
                        caches=caches, damage_tracker=damage_tracker,
                    ))
                    build_ms = (time.time() - t_tick) * 1000
                    stats_state["tick"] = tick
                    stats_state["lastBuildMs"] = round(build_ms, 1)
                    stats_state["avgBuildMs"] = (
                        build_ms if stats_state["avgBuildMs"] is None
                        else stats_state["avgBuildMs"] * 0.9 + build_ms * 0.1)
                    snap["tick"] = tick
                    snap["perf"] = {
                        "buildMs": round(build_ms, 1),
                        "objClassHits": caches.obj_class_hits,
                        "objClassMisses": caches.obj_class_misses,
                        "objClassSerialBumps": caches.obj_class_serial_bumps,
                        "cacheResets": caches.reset_count,
                    }
                    # Scanner-health, STABILITY-FIRST: never exits, only
                    # re-resolves the class caches on a genuine cache-poisoning
                    # suspicion (a populated InProgress match reading almost no
                    # alive-with-position soldiers), rate-limited. Warmup skip
                    # (>=10) so a cold start's partial scan isn't misjudged. In
                    # two-tier mode the BuildWorker runs this on its own thread.
                    if tick >= 10 and _scanner_suspect(snap):
                        bad_streak += 1
                        if bad_streak == 1 or bad_streak % 120 == 0:
                            caches.reset(tick=tick,
                                         reason="scanner-suspect recovery")
                            print(f"[tick {tick}] SANITY: InProgress low-alive "
                                  f"-> in-process cache reset (streak="
                                  f"{bad_streak}, NOT exiting)", file=sys.stderr)
                    else:
                        bad_streak = 0
                    _consume_full(snap)
            except OSError as e:
                if not _target_alive(pid):
                    print(f"[tick {tick}] target pid {pid} is gone "
                          "(Squad restarted?); exiting for systemd restart "
                          "(will re-resolve pid)", file=sys.stderr)
                    sys.exit(1)
                print(f"[tick {tick}] read error: {e!r}", file=sys.stderr)
                time.sleep(period)
                continue
            except Exception as e:
                import traceback
                print(f"[tick {tick}] snapshot error: {e!r}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                time.sleep(period)
                continue

            now = time.time()
            if now - last_report >= 5.0:
                avg = stats_state["avgBuildMs"]
                print(f"[tick {tick}] "
                      f"build={stats_state['lastBuildMs'] or 0:4.0f}ms  "
                      f"avg={avg or 0:4.0f}ms  "
                      f"players={len(snap.get('players', []))}  "
                      f"vehicles={len(snap.get('vehicles', []))}",
                      file=sys.stderr)
                last_report = now

            # Central push flush — every ~30s, well off the per-tick hot path.
            if push_active and now - last_flush >= 30.0:
                _flush_push()
                last_flush = now

            # Persist the placer cache every ~30s so captured placers survive a
            # reader restart (mid-match deploy / crash).
            if placer_cache_path is not None and now - last_placer_save >= 30.0:
                _save_placer_cache(caches, placer_cache_path)
                last_placer_save = now

            # Fleet check-in every ~5 min (first ~60s post-boot), then an offset
            # self-heal attempt on the same cadence. Off the hot path; both are
            # best-effort. A successful self-heal rebinds `paths` for later ticks
            # (and hands them to the build worker in two-tier mode).
            if push_active and now - last_checkin >= fleet.CHECKIN_INTERVAL_SEC:
                _checkin()
                _healed = _selfheal()
                if _healed is not None:
                    paths = _healed
                    if worker is not None:
                        worker.update_paths(_healed)
                _check_update()
                last_checkin = now

            sleep_for = period - (time.time() - t_tick)
            if sleep_for > 0:
                time.sleep(sleep_for)
    finally:
        if worker is not None:
            worker.stop()
        # Close any in-progress writer so the .sqrx footer is written.  A
        # shutdown does not prove that the match ended, so finalize_recording
        # deliberately leaves the sidecar ``unverified``; the HTTP gate keeps
        # it restricted until stable live context proves the match changed.
        if recordings_dir and record_state_box.get("current") is not None:
            try:
                from .recorder import finalize_recording
                finalize_recording(record_state_box["current"],
                                   min_ticks=0,
                                   reason="serve shutdown")
            except Exception as _e:
                print(f"recorder finalize error on shutdown: {_e!r}",
                      file=sys.stderr)
        if stats_store is not None:
            try:
                stats_store.finalize_open_match(reason="serve shutdown")
                stats_store.close()
            except Exception as _e:
                print(f"stats finalize error on shutdown: {_e!r}",
                      file=sys.stderr)
        _flush_push()  # best-effort: push whatever finalized before we exit
        if placer_cache_path is not None:
            _save_placer_cache(caches, placer_cache_path)  # keep placers
        srv.shutdown()
        if out_f:
            out_f.close()
        if sqrx_writer:
            sqrx_writer.close()

    elapsed = time.time() - started
    print(f"\nstopped: {tick} ticks in {elapsed:.1f}s "
          f"(effective rate {tick / elapsed:.2f} Hz)", file=sys.stderr)
    if sqrx_writer and args.sqrx_out and Path(args.sqrx_out).exists():
        on_disk = Path(args.sqrx_out).stat().st_size
        ratio = (sqrx_raw_bytes / on_disk) if on_disk else 0.0
        print(f"sqrx:   {args.sqrx_out} ({on_disk/1024:.1f} KiB, "
              f"{sqrx_raw_bytes/1024:.1f} KiB raw, "
              f"{ratio:.1f}x compression)", file=sys.stderr)
    return 0


def cmd_stats_backfill(args: argparse.Namespace) -> int:
    """Replay finished .sqrx recordings through a StatsStore to backfill the
    persistent player-stats DB with HISTORICAL matches. The archive holds the
    same per-tick snapshots the live writer consumes, so replay reproduces the
    exact same stats + kill events. Idempotent: every write is UPSERT /
    INSERT-OR-IGNORE on stable keys, so re-running — or overlapping the live
    writer on the same DB — can only converge, never double-count. Skips the
    recording still being written (the live match)."""
    import glob
    import json as _json
    from .stats import StatsStore
    from .sqrx import SqrxReader

    rec_dir = Path(args.recordings_dir).expanduser()
    files = sorted(glob.glob(str(rec_dir / "*.sqrx")), key=os.path.getmtime)
    now = time.time()
    eligible = []
    for f in files:
        try:
            if now - os.path.getmtime(f) >= args.skip_newer_than:
                eligible.append(f)
        except OSError:
            pass
    if args.limit:
        eligible = eligible[-args.limit:]  # newest N (still chronological)
    if not eligible:
        print(f"no eligible .sqrx in {rec_dir}", file=sys.stderr)
        return 1
    stats_db = Path(args.stats_db).expanduser()
    # Optional: enqueue every backfilled match for a central push (--push).
    from . import ingest_client
    do_push = getattr(args, "push", False)
    push_creds = ingest_client.current_creds() if do_push else None
    push_backlog: Path | None = None
    if do_push and push_creds is not None:
        push_backlog = Path(config.get("push_backlog_dir")
                            or ingest_client.default_backlog_dir(stats_db))
        push_backlog.mkdir(parents=True, exist_ok=True)
    elif do_push and push_creds is None:
        print("--push given but not enrolled; run `sqreader enroll <token>` "
              "first (push skipped)", file=sys.stderr)

    def _enqueue(match_id: str) -> None:
        if push_backlog is not None:
            ingest_client.enqueue(push_backlog, match_id)

    store = StatsStore(stats_db, server_id=args.server_id,
                       on_finalize=_enqueue if push_backlog is not None else None)
    print(f"backfilling {len(eligible)} matches from {rec_dir} "
          f"-> {args.stats_db}", file=sys.stderr)
    t0 = time.time()
    done = 0
    for i, f in enumerate(eligible, 1):
        base = os.path.basename(f)
        try:
            with SqrxReader(f) as r:
                for line in r:
                    try:
                        snap = _json.loads(line)
                    except Exception:
                        continue
                    store.record_tick(snap)
        except Exception as e:
            print(f"  [{i}/{len(eligible)}] ERROR {base}: {e!r}", file=sys.stderr)
            continue
        done += 1
        if done % 25 == 0 or i == len(eligible):
            dt = time.time() - t0
            print(f"  [{i}/{len(eligible)}] {done} matches, {dt:.0f}s",
                  file=sys.stderr)
    store.finalize_open_match(reason="backfill end")
    store.close()
    if push_backlog is not None and push_creds is not None:
        res = ingest_client.flush_backlog(
            push_backlog, stats_db, rec_dir, push_creds,
            push_replay_files=bool(config.get("push_replay")))
        print(f"push: sent={res['sent']} pending={res['pending']} "
              f"errors={res['errors']}", file=sys.stderr)
    print(f"backfill complete: {done}/{len(eligible)} matches in "
          f"{time.time() - t0:.0f}s", file=sys.stderr)
    print("note: run `sqreader stats-elo-recalc --stats-db ...` afterwards — "
          "backfilling can raise the stats of matches that were already rated, "
          "and only a chronological replay can fix that.", file=sys.stderr)
    return 0


def cmd_enroll(args: argparse.Namespace) -> int:
    """Enroll this box against a central platform, or show enrollment status.

    ``sqreader enroll <token>`` redeems a one-time token from your central site,
    stores the returned credentials in a 0600 ``.env.agent``, and unlocks the
    optional central push (finished-match stats + ``.sqrx`` replays). Push stays
    OFF until you ALSO run ``serve --push`` (or set ``push_enabled`` in config).
    Delete ``.env.agent`` to un-enroll.
    """
    from . import agent_creds, hwfp, ingest_client

    if args.status:
        creds = agent_creds.load()
        if not creds or not creds.get("SQREADER_AGENT_ID"):
            print("not enrolled — run: sqreader enroll <token> --central-url URL")
            return 0
        print(f"enrolled: agent_id={creds['SQREADER_AGENT_ID']}")
        print(f"  central:   {creds.get('SQREADER_PUSH_URL') or creds.get('SQREADER_CENTRAL_URL')}")
        print(f"  community: {creds.get('SQREADER_COMMUNITY') or '?'}")
        if getattr(args, "stats_db", None):
            backlog = ingest_client.default_backlog_dir(
                Path(args.stats_db).expanduser())
            n = len(list(backlog.glob("*.json"))) if backlog.is_dir() else 0
            print(f"  push queue: {n} match(es) pending")
        return 0

    if not args.token:
        print("usage: sqreader enroll <token> [--central-url URL]  (or --status)",
              file=sys.stderr)
        return 2
    central = args.central_url or config.get("central_url")
    if not central:
        print("no central URL — pass --central-url or set central_url in "
              "sqreader.config.json", file=sys.stderr)
        return 2
    fp = hwfp.compute()
    try:
        fields = ingest_client.enroll(central, args.token, fp)
    except ingest_client.PushError as exc:
        print(f"enroll failed: {exc}", file=sys.stderr)
        return 1
    fields["SQREADER_CENTRAL_URL"] = central
    fields["SQREADER_BOUND_HW"] = fp
    path = agent_creds.write(fields)
    print(f"enrolled as agent_id={fields['SQREADER_AGENT_ID']} "
          f"(community {fields.get('SQREADER_COMMUNITY') or '?'})")
    print(f"credentials written to {path}")
    print("next: run `sqreader serve --push …` (or set push_enabled in config) "
          "to start pushing finished matches to the central.")
    return 0


def cmd_stats_elo_recalc(args: argparse.Namespace) -> int:
    """Rebuild every rating from scratch, oldest match first.

    Needed after a backfill (see the note cmd_stats_backfill prints) and after
    any change to the score weights in elo.py — live ELO cannot revise a match
    it has already applied, so a full replay is the only way to make history
    agree with the current algorithm.
    """
    if not args.stats_db.exists():
        print(f"no such stats DB: {args.stats_db}", file=sys.stderr)
        return 1

    t0 = time.time()

    def _progress(done: int, total: int) -> None:
        print(f"  {done}/{total} matches ...", file=sys.stderr)

    out = elo.recalc_all_elo(
        args.stats_db,
        min_players=args.min_players,
        min_duration=args.min_duration,
        min_playtime=args.min_playtime,
        progress=_progress)
    print(f"elo recalc complete in {time.time() - t0:.0f}s", file=sys.stderr)
    print(f"  matches rated   : {out['matchesRated']}", file=sys.stderr)
    print(f"  matches skipped : {out['matchesSkipped']} "
          f"(under {args.min_players} players / {args.min_duration}s)",
          file=sys.stderr)
    print(f"  players rated   : {out['playersRated']}", file=sys.stderr)
    # A healthy distribution sits around the 1000 starting point. A median that
    # has drifted far from it means the weights are inflating or deflating the
    # whole population, which is the thing to look at before trusting the board.
    print(f"  rating min/med/max: {out['minElo']} / {out['medianElo']} / "
          f"{out['maxElo']}", file=sys.stderr)
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """
    Verify every empirically-discovered constant against the live process.
    Returns non-zero if any check fails — this is the "did the Squad
    update break us?" smoke test.
    """
    from . import addrcache
    from .mem import ProcessMemory
    from .ue.fname import KNOWN_ALLOCATOR_ADDR_V10_4_1
    from .ue.uobject import KNOWN_GOBJECTS_ADDR_V10_4_1, UOBJ_NAME_PRIVATE
    from .ue.reflection import (
        bool_property_mask, struct_layout_for_field,
        read_fstructproperty_struct, find_field_by_name_with_super,
    )
    from .squad.snapshot import (
        LANE_GRAPH_OFFSETS, LANE_LINK_NODEA_OFF, LANE_LINK_NODEB_OFF,
        COLLECTOR_CLASSES,
    )
    from .ue.value import read_fvector
    import struct as _s

    pid = args.pid or config.find_squad_server_pid()
    pm = ProcessMemory(pid)
    # Resolve via the SAME cache+discovery path the pipeline uses, so
    # doctor operates on the LIVE addresses. (The old version hardcoded
    # KNOWN_*, which after a Squad update pointed at stale memory — the
    # GUObjectArray walk then found nothing and crashed with IndexError.)
    binary_id = addrcache.binary_identity(pid)
    arr = _resolve_gobjects(pm, binary_id)
    alloc = _resolve_fname_pool(pm, binary_id)
    print(f"pid = {pid}")

    ok = True
    def check(label, condition, detail=""):
        nonlocal ok
        tag = "OK  " if condition else "FAIL"
        if not condition:
            ok = False
        sep = f"  {detail}" if detail else ""
        print(f"  {tag} {label}{sep}")

    print("\n== FNamePool / GUObjectArray ==")
    # What matters is that we resolved USABLE structures. Address drift
    # vs the hardcoded KNOWN_* constants is EXPECTED after a Squad update
    # and is handled transparently by discovery + the address cache, so
    # it is reported as INFO, never a failure.
    check("GUObjectArray resolved (num_elements sane)",
          0 < arr.num_elements < (1 << 26),
          f"@ {arr.base:#x}  num_elements={arr.num_elements}")
    check("FNamePool resolved (index0 == 'None')",
          alloc.fname_to_str(0, 0) == "None", f"@ {alloc.base:#x}")
    g_drift = arr.base != KNOWN_GOBJECTS_ADDR_V10_4_1
    p_drift = alloc.base != KNOWN_ALLOCATOR_ADDR_V10_4_1
    print("  INFO GUObjectArray "
          + (f"DRIFTED from known {KNOWN_GOBJECTS_ADDR_V10_4_1:#x} "
             f"-> using {arr.base:#x} (via cache/discovery)" if g_drift
             else f"matches known {KNOWN_GOBJECTS_ADDR_V10_4_1:#x}"))
    print("  INFO FNamePool "
          + (f"DRIFTED from known {KNOWN_ALLOCATOR_ADDR_V10_4_1:#x} "
             f"-> using {alloc.base:#x} (via cache/discovery)" if p_drift
             else f"matches known {KNOWN_ALLOCATOR_ADDR_V10_4_1:#x}"))

    print("\n== reflection-derived layouts ==")
    # FStructProperty.Struct at +0x70 — find SQPlayerState.PlayerStateData,
    # read its +0x70, confirm it's the PlayerStateDataObject UScriptStruct.
    ps_hits = arr.find_by_name("SQPlayerState", class_name="Class",
                               alloc=alloc, limit=1)
    if not ps_hits:
        check("SQPlayerState class present", False,
              "not found — server empty/loading, or a deeper break")
        print("\nFAIL  doctor: could not resolve SQPlayerState; "
              "re-run once a match is live.")
        return 1
    ps_class = ps_hits[0][1]
    psd_ff = find_field_by_name_with_super(pm, ps_class, "PlayerStateData", alloc)
    if psd_ff:
        psd_struct = read_fstructproperty_struct(pm, psd_ff)
        nm_b = pm.try_read(psd_struct + UOBJ_NAME_PRIVATE, 8)
        if nm_b is None:
            # doctor is what you run *because* reads are failing — report the
            # failed read, do not crash on None inside struct.unpack.
            check("FStructProperty.Struct at +0x70", False,
                  "could not read the struct's FName")
        else:
            ci, num = _s.unpack("<II", nm_b)
            sname = alloc.fname_to_str(ci, num)
            check("FStructProperty.Struct at +0x70",
                  sname == "PlayerStateDataObject", f"got {sname!r}")
    else:
        check("FStructProperty.Struct at +0x70", False,
              "PlayerStateData field not found")

    # FBoolProperty mask layout — bIsABot should be at byte mask 0x08
    m = bool_property_mask(pm, ps_class, "bIsABot", alloc)
    check("FBoolProperty.ByteMask layout (SQPlayerState.bIsABot)",
          m is not None and m[1] == 0x08,
          f"got {m!r}")

    # PlayerStateDataObject reflection (struct_layout_for_field)
    psd_layout = struct_layout_for_field(pm, ps_class, "PlayerStateData", alloc)
    check("PlayerStateDataObject reflection (25 fields incl NumKills)",
          "NumKills" in psd_layout and "RevivedPoints" in psd_layout,
          f"{len(psd_layout)} fields found")

    print("\n== Squad-class field offsets ==")
    # SQDeployable / SQVehicleSpawner / SQMapMarker / SQProjectile —
    # hardcoded *_OFFSETS dicts. Verify they still align by reading via
    # reflection and comparing.
    def offsets_match(class_name: str, hardcoded: dict[str, int]) -> tuple[bool, list[str]]:
        h = arr.find_by_name(class_name, class_name="Class",
                             alloc=alloc, limit=1)
        if not h:
            return False, [f"class {class_name!r} not found"]
        from .ue.reflection import get_class_layout
        live = get_class_layout(pm, h[0][1], alloc)
        problems = []
        for fname, hardcoded_off in hardcoded.items():
            p = live.get(fname)
            if p is None:
                problems.append(f"{fname}: not reflected")
            elif p.offset != hardcoded_off:
                problems.append(
                    f"{fname}: hardcoded {hardcoded_off:#x} != live {p.offset:#x}")
        return len(problems) == 0, problems

    # A Squad update that shifts a struct layout is silent: the reader keeps
    # reading the old offset, gets neighbouring bytes, and ships plausible-looking
    # garbage. `offsets_match` catches it by reading each offset back through live
    # reflection — so every group we hardcode is listed in one place. The table
    # set is shared with the fleet health signal (`health.hardcoded_offset_tables`)
    # so this human command and the machine-readable `run_doctor` can never
    # disagree about which offsets "correct" means.
    from .health import hardcoded_offset_tables
    for cls, table in hardcoded_offset_tables():
        passed, problems = offsets_match(cls, table)
        check(f"{cls} hardcoded offsets ({len(table)} fields)",
              passed, "; ".join(problems))

    # Lane graph layout: DesignOutgoingLinks ArrayProperty offset on
    # SQGraphInitializerComponent + the FSQDesignLink struct shape.
    print("\n== Lane graph (AAS/RAAS) ==")
    gi_hits = arr.find_by_name("SQGraphInitializerComponent",
                               class_name="Class", alloc=alloc, limit=1)
    if not gi_hits:
        check("SQGraphInitializerComponent class present", False,
              "class not found in GUObjectArray")
    else:
        from .ue.reflection import get_class_layout
        gi_layout = get_class_layout(pm, gi_hits[0][1], alloc)
        dol = gi_layout.get("DesignOutgoingLinks")
        check(f"DesignOutgoingLinks @ +{LANE_GRAPH_OFFSETS['DesignOutgoingLinks']:#x}",
              dol is not None and dol.offset == LANE_GRAPH_OFFSETS["DesignOutgoingLinks"],
              f"got {dol.offset if dol else None}")
        # ArrayProperty.Inner at FProperty+0x78 (UE 5.7) → must resolve to
        # a StructProperty whose Struct is named 'SQDesignLink'.
        link_struct_addr = 0
        if dol is not None:
            inner_addr = pm.read_u64(dol.addr + 0x78)
            if inner_addr:
                from .ue.reflection import read_fproperty, read_fstructproperty_struct
                inner = read_fproperty(pm, inner_addr, alloc)
                check("DesignOutgoingLinks inner is StructProperty SQDesignLink",
                      inner is not None and inner.type_name == "StructProperty",
                      f"got {inner.type_name if inner else None}")
                if inner and inner.type_name == "StructProperty":
                    link_struct_addr = read_fstructproperty_struct(pm, inner_addr)
                    nm_b = pm.try_read(link_struct_addr + UOBJ_NAME_PRIVATE, 8)
                    if nm_b is None:
                        check("DesignOutgoingLinks inner Struct == 'SQDesignLink'",
                              False, "could not read the struct's FName")
                    else:
                        ci, num = _s.unpack("<II", nm_b)
                        sname = alloc.fname_to_str(ci, num)
                        check("DesignOutgoingLinks inner Struct == 'SQDesignLink'",
                              sname == "SQDesignLink", f"got {sname!r}")
            else:
                check("DesignOutgoingLinks ArrayProperty inner ptr (+0x78)",
                      False, "null inner")
        # SQDesignLink (16 B): NodeA@+0x00 / NodeB@+0x08
        if link_struct_addr:
            link_layout = get_class_layout(pm, link_struct_addr, alloc)
            na = link_layout.get("NodeA")
            nb = link_layout.get("NodeB")
            check("FSQDesignLink layout (NodeA@+0x00, NodeB@+0x08)",
                  (na is not None and nb is not None
                   and na.offset == LANE_LINK_NODEA_OFF
                   and nb.offset == LANE_LINK_NODEB_OFF
                   and na.type_name == "ObjectProperty"
                   and nb.type_name == "ObjectProperty"),
                  f"NodeA@{na.offset if na else None} NodeB@{nb.offset if nb else None}")

    # Marker FastArraySerializer element stride. Player-placed markers are
    # read from SQMapMarkerManagerComponent.MarkerArray.Items with a BRUTE-
    # FORCED 104-byte element stride — a Squad update that resizes the item
    # struct would silently misread every marker. Verify the property chain
    # + the element size against live reflection.
    print("\n== Marker FastArray stride ==")
    from .squad.snapshot import (MARKER_MGR_MARKER_ARRAY_OFFSET,
                                 MARKER_ARRAY_ITEMS_OFFSET, MARKER_ITEM_SIZE)
    from .ue.reflection import (find_field_by_name_with_super,
        read_fstructproperty_struct, read_fproperty, read_ustruct_header)
    mm = arr.find_by_name("SQMapMarkerManagerComponent", class_name="Class",
                          alloc=alloc, limit=1)
    if not mm:
        check("SQMapMarkerManagerComponent class present", False, "not found")
    else:
        mm_layout = get_class_layout(pm, mm[0][1], alloc)
        marr = mm_layout.get("MarkerArray")
        marr_ok = (marr is not None
                   and marr.offset == MARKER_MGR_MARKER_ARRAY_OFFSET
                   and marr.type_name == "StructProperty")
        check(f"MarkerArray StructProperty @ {MARKER_MGR_MARKER_ARRAY_OFFSET:#x}",
              marr_ok,
              f"got {marr.type_name if marr else None} @ "
              f"{marr.offset if marr else 0:#x}")
        # marr_ok came from the class layout; this is a second, independent
        # lookup, so it can come back None on a transient read failure even
        # when the layout said the field is there.
        ff = (find_field_by_name_with_super(pm, mm[0][1], "MarkerArray", alloc)
              if marr_ok else None)
        if marr_ok and ff is None:
            check("MarkerArray re-resolves for the Items walk", False,
                  "field vanished between the layout read and the lookup")
        if ff is not None:
            fa_struct = read_fstructproperty_struct(pm, ff)
            fa_layout = get_class_layout(pm, fa_struct, alloc)
            items = fa_layout.get("Items")
            items_ok = (items is not None
                        and items.offset == MARKER_ARRAY_ITEMS_OFFSET
                        and items.type_name == "ArrayProperty")
            check(f"MarkerArray.Items ArrayProperty @ {MARKER_ARRAY_ITEMS_OFFSET:#x}",
                  items_ok, f"got {items.type_name if items else None} @ "
                  f"{items.offset if items else 0:#x}")
            if items is not None and items_ok:
                inner_addr = pm.read_u64(items.addr + 0x78)
                inner = read_fproperty(pm, inner_addr, alloc) if inner_addr else None
                if inner and inner.type_name == "StructProperty":
                    elem = read_fstructproperty_struct(pm, inner_addr)
                    info = read_ustruct_header(pm, elem, alloc)
                    check(f"marker item stride == {MARKER_ITEM_SIZE} bytes",
                          info.properties_size == MARKER_ITEM_SIZE,
                          f"live element size {info.properties_size}")
                else:
                    check("MarkerArray.Items inner is StructProperty", False,
                          f"got {inner.type_name if inner else None}")

    # ComponentToWorld at +0x210 — pick any unattached actor, verify its
    # cached translation matches the RelativeLocation we read separately.
    print("\n== ComponentToWorld at SceneComponent +0x210 ==")
    from .squad.metadata import Metadata
    from .squad.snapshot import build_snapshot, resolve_paths
    paths = resolve_paths(pm, arr, alloc)
    # Enrich (metadata != None) so the static cap-zone geometry check below
    # reflects reality — the merge only runs when metadata is present. Metadata
    # only ADDS fields, so the raw-offset assertions above/below are unaffected.
    snap = build_snapshot(pm, arr, alloc, paths=paths, metadata=Metadata.load())
    matches = 0
    total = 0
    for v in snap.get("vehicles", []):
        if v.get("attached") or not v.get("position"):
            continue
        total += 1
        root = pm.try_read(int(v["id"], 16)
                           + paths.actor_root_component_off, 8)
        if not root:
            continue
        rp = _s.unpack("<Q", root)[0]
        ctw = read_fvector(pm, rp + paths.scene_component_to_world_translation_off)
        rl = read_fvector(pm, rp + paths.scene_relative_location_off)
        if ctw and rl and ctw.x == rl.x and ctw.y == rl.y and ctw.z == rl.z:
            matches += 1
    check("ComponentToWorld.Translation matches RelativeLocation "
          "on unattached vehicles",
          total > 0 and matches == total,
          f"{matches}/{total}")

    # Stats-collector singletons (captures/defenses/fobsBuilt/fobsDestroyed/
    # vehicleDamage/suppliesDelivered). These are hardcoded struct layouts —
    # reflection can't reach them — so doctor is their only drift check. Classes
    # spawn once per map, so an early tick (or Jensen) may see none; that's INFO,
    # not FAIL. The real signal is: if a collector resolved, does a live player
    # carry a sane value from it?
    print("\n== Squad stats collectors ==")
    for key, cls_name in COLLECTOR_CLASSES.items():
        cls_addr = paths.collector_classes.get(key, 0)
        print(f"  {'OK  ' if cls_addr else 'INFO'} {cls_name} "
              + (f"resolved @ {cls_addr:#x}" if cls_addr
                 else "not loaded this tick (map init / Jensen?)"))
    # Snapshot already spliced collector counters onto players. A populated
    # match should have at least one player with a non-null collector field.
    _fields = ("captures", "defenses", "fobsBuilt", "fobsDestroyed",
               "vehicleDamage", "suppliesDelivered")
    seen = {f: False for f in _fields}
    for p in snap.get("players", []):
        st = p.get("stats") or {}
        for f in _fields:
            if st.get(f) is not None:
                seen[f] = True
    any_collector = any(paths.collector_classes.values())
    for f in _fields:
        # Only demand the value when the class was actually present; otherwise
        # its absence is expected, not a drift.
        if any_collector:
            check(f"collector field '{f}' present on some player", seen[f],
                  "" if seen[f] else "no player carried it — offset drift?")
        else:
            print(f"  INFO collector field '{f}' — no collector loaded to check")

    # Phase-8 reader fields. Each is fail-safe (null on a wrong offset), so
    # these are INFO/observational: "did the field come through on a live
    # match?" rather than a hard offset assertion.
    print("\n== Phase-8 reader fields ==")
    deps = snap.get("deployables") or []
    fobs_bleeding = [d for d in deps if d.get("fobBleeding")]
    edt_present = any(d.get("estimatedDeathTime") is not None for d in deps)
    print(f"  INFO FOB bleed-out: {len(fobs_bleeding)} bleeding FOB(s); "
          f"estimatedDeathTime {'present' if edt_present else 'absent'} "
          f"(only set while bleeding)")
    spawners = snap.get("vehicleSpawners") or []
    nss = [s.get("nextSpawnSec") for s in spawners
           if s.get("nextSpawnSec") is not None]
    print(f"  INFO vehicle spawners: {len(spawners)} total, "
          f"{len(nss)} with a decoded nextSpawnSec")
    projs = snap.get("projectiles") or []
    firers = [p for p in projs if p.get("firer")]
    print(f"  INFO projectiles: {len(projs)} in flight, "
          f"{len(firers)} with a resolved firer")
    czs = snap.get("captureZones") or []
    adv = [c for c in czs if c.get("playerAdvantage") is not None]
    print(f"  {'OK  ' if (not czs or adv) else 'INFO'} capzone playerAdvantage: "
          f"{len(adv)}/{len(czs)} zones "
          + ("(reflection resolved the field)" if adv
             else "(field absent — SDK name may differ, harmless)"))
    # Static SquadCalc geometry merge (capzones.json). AAS: shape glued onto
    # each live zone. RAAS: captureZones empty → shapes resolved onto the
    # active lane instead.
    layer_nm = (snap.get("gameState") or {}).get("mapName")
    with_geo = [c for c in czs if c.get("geometry")]
    lane_objs = ((snap.get("gameState") or {}).get("lane") or {}).get("staticObjectives") or []
    if czs:
        hint = "" if (with_geo or not layer_nm) else \
            "  (0 matched — check layer name vs capzones.json / rerun fetch_capzones.py)"
        print(f"  {'OK  ' if with_geo else 'INFO'} capzone static geometry: "
              f"{len(with_geo)}/{len(czs)} zones matched{hint}")
    elif lane_objs:
        print(f"  OK   capzone static geometry (RAAS): "
              f"{len(lane_objs)} lane objectives shaped")
    else:
        print(f"  INFO capzone static geometry: no live zones / lane objectives "
              f"to match on this layer ({layer_nm or '?'})")

    print()
    print("PASS  doctor: every hardcoded offset still matches the live "
          "binary." if ok else
          "FAIL  doctor: at least one offset has drifted — Squad may "
          "have updated. Re-derive values with scripts/dump_struct_layout.py.")
    return 0 if ok else 1


def cmd_test(args: argparse.Namespace) -> int:
    # Delegate to scripts/test_all.py for now; it already lives next to
    # the verify_* scripts and orchestrates them with subprocess.
    here = Path(__file__).resolve().parent.parent  # the sqreader/ project root
    test_all = here / "scripts" / "test_all.py"
    if not test_all.is_file():
        print(f"scripts/test_all.py not found at {test_all}", file=sys.stderr)
        return 2
    env = os.environ.copy()
    env["PYTHONPATH"] = str(here)
    py = sys.executable
    r = subprocess.run([py, str(test_all)], cwd=str(here), env=env)
    return r.returncode


# ----- summary renderer ------------------------------------------------------

def _fmt_seconds(s):
    if s is None:
        return "-"
    m, sec = divmod(int(s), 60)
    h, m = divmod(m, 60)
    return f"{h:d}:{m:02d}:{sec:02d}" if h else f"{m:d}:{sec:02d}"


def _render_summary(snap: dict) -> None:
    gs = snap.get("gameState") or {}
    layer = gs.get("layer") or {}
    teams = snap.get("teams") or []
    squads = snap.get("squads") or []
    players = snap.get("players") or []
    vehicles = snap.get("vehicles") or []
    events = snap.get("damageEvents") or []

    print("=" * 78)
    print(f" {gs.get('serverName', '?')}")
    print("=" * 78)
    print(f"  Map:        {layer.get('mapName', '?')}  ({gs.get('mapName', '?')})")
    print(f"  Mode:       {gs.get('gameModeName', '?')}  [{gs.get('gameModeId', '?')}]")
    print(f"  Match:      {gs.get('matchState', '?')}  "
          f"elapsed={_fmt_seconds(gs.get('elapsedSec'))}  "
          f"tickRate={gs.get('tickRate', 0):.1f}Hz")
    print(f"  MatchID:    {gs.get('matchId', '?')}")

    print(f"\n {'TEAMS':-^76}")
    print(f"  {'team':<4} {'tickets':>8} {'score':>8} {'k/d/w':>14}"
          f"  {'faction':<28} {'players':>8}")
    for t in teams:
        kdw = f"{t.get('kills','-')}/{t.get('deaths','-')}/{t.get('woundeds','-')}"
        print(f"  {t.get('id'):<4} {t.get('tickets','-'):>8} "
              f"{t.get('score','-'):>8} {kdw:>14}  "
              f"{(t.get('factionId') or '?'):<28} {t.get('playerCount','-'):>8}")

    if squads:
        print(f"\n {'SQUADS':-^76}")
        for s in squads:
            members = f"{s.get('playerCount','-')}/{s.get('maxSize','-')}"
            kd = f"{s.get('kills','-')}/{s.get('deaths','-')}"
            print(f"  #{s.get('id'):<2} team={s.get('teamId')} "
                  f"size={members}  "
                  f"name={(s.get('name') or '<unnamed>'):<24} "
                  f"score={int(s.get('score', 0))}  k/d={kd}  "
                  f"creator={s.get('creatorName','?')}")

    print(f"\n {'PLAYERS':-^76}")
    print(f"  {'name':<22} {'tm':>3} {'sq':>3} {'pool':<5} "
          f"{'K/D/TK':>9} {'ping':>4} {'HP':>5}  role")
    for p in players:
        s = p.get('stats') or {}
        sld = p.get('soldier') or {}
        hp = sld.get('health')
        hp_s = f"{hp:.0f}" if isinstance(hp, (int, float)) else '-'
        kdtk = f"{s.get('kills','-')}/{s.get('deaths','-')}/{s.get('teamKills','-')}"
        print(f"  {(p.get('name') or '?'):<22} "
              f"{p.get('teamId','?'):>3} "
              f"{p.get('squadId') or '-':>3} "
              f"{(p.get('rolePool') or '-'):<5} "
              f"{kdtk:>9} "
              f"{p.get('ping','-'):>4} "
              f"{hp_s:>5}  "
              f"{p.get('roleId', '?')}")

    print(f"\n {'VEHICLES':-^76}")
    print(f"  {'class':<38} {'team':>4} {'HP':>11}  {'kind':<10}  faction")
    for v in vehicles:
        hp = v.get('health')
        mhp = v.get('maxHealth')
        hp_s = f"{int(hp)}/{int(mhp)}" if hp is not None and mhp else "-"
        fac = ','.join(v.get('faction') or []) or '-'
        print(f"  {v.get('classShort','?'):<38} "
              f"{v.get('team','-'):>4} {hp_s:>11}  "
              f"{(v.get('kind') or '-'):<10}  {fac}")

    if events:
        print(f"\n {'DAMAGE EVENTS (this tick)':-^76}")
        for ev in events:
            tag = " (self)" if ev.get("selfInflicted") else ""
            print(f"  {ev.get('attacker') or '?':>18s}  hit  "
                  f"{ev.get('victim') or '?':<20s}{tag}")

    print()
    print("=" * 78)
    print(f"  totals:  {len(players)} players  {len(vehicles)} vehicles  "
          f"{len(squads)} squads  {snap.get('counts', {}).get('totalUObjects', 0)} UObjects")


# ----- argparse plumbing -----------------------------------------------------

def cmd_build_worker(args: argparse.Namespace) -> int:
    """Internal: the full-build subprocess for two-tier recording. Opens its own
    read-only pipeline to the target and free-runs `build_snapshot`, streaming
    each finished snapshot as one NDJSON line to stdout. The parent `serve` loop
    reads these on an I/O thread while sampling positions at 4 Hz — the build's
    CPU/GIL cost lives here, in a separate process, so it can't starve the
    sampler. Runs until the target dies or the parent kills it. Not for hand-use.
    """
    from .squad.snapshot import (
        DamageTracker, SnapshotCaches, build_snapshot, clean_nonfinite,
    )
    pid, pm, arr, alloc, paths, meta = _open_pipeline(
        args.pid, with_metadata=not args.no_metadata)
    caches = SnapshotCaches()
    damage_tracker = DamageTracker()
    out = sys.stdout
    tick = 0
    bad_streak = 0
    cache_window = 60
    parent_pid = os.getppid()
    print(f"build-worker: streaming full snapshots for pid {pid}",
          file=sys.stderr)
    while True:
        # Orphan guard: if the parent `serve` died (ppid changed), stop —
        # don't linger building against a closed pipe.
        if os.getppid() != parent_pid:
            return 0
        tick += 1
        t0 = time.time()
        try:
            caches.partial_invalidate(tick, window=cache_window,
                                      total_slots=arr.num_elements)
            snap = clean_nonfinite(build_snapshot(
                pm, arr, alloc,
                server_id=args.server_id, include_motd=args.with_motd,
                paths=paths, metadata=meta,
                caches=caches, damage_tracker=damage_tracker))
            build_ms = (time.time() - t0) * 1000
            snap["tick"] = tick
            snap["perf"] = {
                "buildMs": round(build_ms, 1),
                "objClassHits": caches.obj_class_hits,
                "objClassMisses": caches.obj_class_misses,
                "objClassSerialBumps": caches.obj_class_serial_bumps,
                "cacheResets": caches.reset_count,
                "tier": "full",
            }
            # Scanner-health on the worker's own caches (STABILITY-FIRST: never
            # exit on a content heuristic; only re-resolve, rate-limited).
            if tick >= 10 and _scanner_suspect(snap):
                bad_streak += 1
                if bad_streak == 1 or bad_streak % 120 == 0:
                    caches.reset(tick=tick, reason="scanner-suspect recovery")
            else:
                bad_streak = 0
            out.write(json.dumps(snap, ensure_ascii=False) + "\n")
            out.flush()
        except OSError as e:
            if not _target_alive(pid):
                print(f"[build-worker] target pid {pid} gone; exiting",
                      file=sys.stderr)
                return 1
            print(f"[build-worker] read error: {e!r}", file=sys.stderr)
            time.sleep(0.5)
        except BrokenPipeError:
            # Parent closed the pipe (serve stopped / restarted) — we're done.
            return 0
        except Exception as e:  # noqa: BLE001 - one bad tick must not kill us
            import traceback
            print(f"[build-worker] snapshot error: {e!r}", file=sys.stderr)
            traceback.print_exc(file=sys.stderr)
            time.sleep(0.5)


def cmd_profile_build(args: argparse.Namespace) -> int:
    """Profile the FULL snapshot build vs the fast POSITION sampler on the live
    process — the Phase-0 measurement that gates the two-tier 4 Hz concurrency
    choice. Read-only: runs N builds + N samples and reports timing percentiles,
    entity counts, and an optional cProfile breakdown of one build."""
    import statistics

    from .squad.possample import SampledEntities, sample_positions
    from .squad.snapshot import SnapshotCaches, build_snapshot, clean_nonfinite

    pid, pm, arr, alloc, paths, meta = _open_pipeline(args.pid, with_metadata=True)
    caches = SnapshotCaches()
    n = max(1, int(args.iters))

    def _pctl(xs: list[float], p: float) -> float:
        s = sorted(xs)
        return s[min(len(s) - 1, int(len(s) * p))]

    def _build() -> dict:
        caches.partial_invalidate(_build.i, total_slots=arr.num_elements)  # type: ignore[attr-defined]
        _build.i += 1  # type: ignore[attr-defined]
        return clean_nonfinite(build_snapshot(
            pm, arr, alloc, paths=paths, metadata=meta, caches=caches))
    _build.i = 0  # type: ignore[attr-defined]

    print(f"pid {pid}: warming caches (3 builds)...", file=sys.stderr)
    snap = {}
    for _ in range(3):
        snap = _build()

    build_ms: list[float] = []
    for _ in range(n):
        t = time.perf_counter()
        snap = _build()
        build_ms.append((time.perf_counter() - t) * 1000)

    ents = SampledEntities.from_snapshot(snap)
    samp_ms: list[float] = []
    for i in range(n):
        t = time.perf_counter()
        sample_positions(pm, paths, ents, i, "t")
        samp_ms.append((time.perf_counter() - t) * 1000)

    np_ = len(snap.get("players") or [])
    nv = len(snap.get("vehicles") or [])
    print(f"\n=== profile-build  (N={n}) ===")
    print(f"players={np_}  vehicles={nv}  "
          f"sampled={len(ents.players)}p/{len(ents.vehicles)}v")
    print(f"FULL build ms:  avg={statistics.mean(build_ms):6.0f}  "
          f"p50={_pctl(build_ms, 0.5):5.0f}  p95={_pctl(build_ms, 0.95):5.0f}  "
          f"min={min(build_ms):5.0f}  max={max(build_ms):5.0f}")
    print(f"POS sample ms:  avg={statistics.mean(samp_ms):6.1f}  "
          f"p50={_pctl(samp_ms, 0.5):5.1f}  p95={_pctl(samp_ms, 0.95):5.1f}  "
          f"max={max(samp_ms):5.1f}")
    print(f"obj_class: hits={caches.obj_class_hits} misses={caches.obj_class_misses}")
    fp95 = _pctl(build_ms, 0.95)
    if fp95 < 200:
        print("GATE: full build p95 < 200ms -> INLINE 4 Hz viable (no worker)")
    else:
        print(f"GATE: full build p95 {fp95:.0f}ms -> background worker needed "
              "(thread if pos-jitter ok, else process)")

    if args.profile:
        import cProfile
        import io
        import pstats
        pr = cProfile.Profile()
        pr.enable()
        _build()
        pr.disable()
        buf = io.StringIO()
        pstats.Stats(pr, stream=buf).sort_stats("cumulative").print_stats(25)
        print("\n=== cProfile (one build, top 25 by cumulative) ===")
        print(buf.getvalue())
    return 0


def cmd_apply_staged_update(args: argparse.Namespace) -> int:
    """Install a staged agent release (fetched + verified by `serve`). Meant to be
    run by the deploy/systemd layer at restart, NOT inside the live reader. It is
    conservative: pip-installs the staged wheel into the current environment with
    --no-deps, then clears the marker. Restarting the service runs the new code.
    Rolls nothing back automatically — keep the previous wheel/venv if you want a
    fast manual revert."""
    import subprocess
    from . import updater
    if args.state_dir:
        state_dir = Path(args.state_dir).expanduser()
    elif args.stats_db:
        state_dir = Path(args.stats_db).expanduser().parent
    else:
        state_dir = Path(".")
    st = updater.staged(state_dir)
    if not st:
        print("no staged update", file=sys.stderr)
        return 0
    art = st.get("path")
    if not art or not Path(art).is_file():
        print("staged artifact missing on disk", file=sys.stderr)
        return 1
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--no-deps", art]
    print(f"applying staged update v{st.get('version')}: {' '.join(cmd)}",
          file=sys.stderr)
    rc = subprocess.call(cmd)
    if rc == 0:
        updater.clear_staged(state_dir)
        print(f"installed v{st.get('version')}; restart the service to run it",
              file=sys.stderr)
        return 0
    print(f"pip install failed (rc={rc}); staged update kept for retry",
          file=sys.stderr)
    return 1


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="sqreader",
                                 description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True, metavar="COMMAND")

    p_snap = sub.add_parser("snapshot", help="emit one NDJSON snapshot")
    p_snap.add_argument("--pid", type=int)
    p_snap.add_argument("--server-id", default=config.get("server_id"))
    p_snap.add_argument("--pretty", action="store_true")
    p_snap.add_argument("--out", type=Path,
                        help="append one NDJSON line to this file")
    p_snap.add_argument("--with-motd", action="store_true")
    p_snap.add_argument("--no-metadata", action="store_true")
    p_snap.set_defaults(func=cmd_snapshot)

    p_sum = sub.add_parser("summary",
                           help="human-readable dashboard of one snapshot")
    p_sum.add_argument("--pid", type=int)
    p_sum.set_defaults(func=cmd_summary)

    p_watch = sub.add_parser("watch",
                             help="continuous NDJSON capture to a file")
    p_watch.add_argument("--pid", type=int)
    p_watch.add_argument("--server-id", default=config.get("server_id"))
    p_watch.add_argument("--hz", type=float, default=2.0)
    p_watch.add_argument("--duration", type=float,
                         help="stop after N seconds")
    p_watch.add_argument("--out", type=Path)
    p_watch.add_argument("--with-motd", action="store_true")
    p_watch.add_argument("--no-metadata", action="store_true")
    p_watch.add_argument("--max-size-mb", type=float, default=0.0,
                         help="rotate the output file when it exceeds N MB "
                              "(rotated file gets a _NNN.ndjson suffix; "
                              "0 = no rotation, the default)")
    p_watch.add_argument("--sqrx-out", type=Path,
                         help="also write each tick to a .sqrx file "
                              "(zstd-compressed NDJSON, ~6-10x smaller)")
    p_watch.set_defaults(func=cmd_watch)

    p_serve = sub.add_parser("serve",
                             help="run the reader: record finished matches, "
                                  "compute stats, optionally push to central, "
                                  "and serve finished replays + stats over HTTP "
                                  "(no live view)")
    p_serve.add_argument("--pid", type=int)
    p_serve.add_argument("--server-id", default=config.get("server_id"))
    p_serve.add_argument("--host", default="127.0.0.1",
                         help="bind address (default 127.0.0.1; use 0.0.0.0 "
                              "to expose externally)")
    p_serve.add_argument("--port", type=int, default=8080)
    p_serve.add_argument("--hz", type=float, default=3.0)
    p_serve.add_argument(
        "--record-hz", type=float, default=None,
        help="Two-tier recording: sample entity positions at this rate (e.g. 4) "
             "between full ~--hz snapshots. A background thread runs the full "
             "build; the main loop writes 4 Hz position frames for smooth replay. "
             "Omit (or <= --hz) to keep the classic single-tier loop.")
    p_serve.add_argument("--with-motd", action="store_true")
    p_serve.add_argument("--no-metadata", action="store_true")
    p_serve.add_argument("--out", type=Path,
                         help="ALSO append each tick to this NDJSON file")
    p_serve.add_argument("--sqrx-out", type=Path,
                         help="ALSO write each tick to this .sqrx file")
    p_serve.add_argument("--recordings-dir", type=Path,
                         help="enable /api/recordings + /api/recording/<id> "
                              "endpoints, serving .sqrx files from this dir")
    p_serve.add_argument("--stats-db", type=Path, default=None,
                         help="SQLite file for the persistent player-stats "
                              "system. The writer runs inside the serve loop "
                              "(best-effort, never blocks the reader); readers "
                              "back /api/players + /api/leaderboard.")
    p_serve.add_argument("--plugins-config", type=Path, default=None,
                         help="plugins_config.json — {plugin_id: {enabled, "
                              "config}}. Plugins run inside the tick loop and "
                              "write alerts to --stats-db (which is therefore "
                              "required for them to do anything).")
    p_serve.add_argument("--cors-origin", default="",
                         help="send Access-Control-Allow-Origin with this value. "
                              "Off by default: the viewer is same-origin in every "
                              "real deployment, and a wildcard would let any page "
                              "on the internet pull the whole match archive.")
    p_serve.add_argument("--squad-log", type=str, default=None,
                         help="path to the server's SquadGame.log for "
                              "authoritative kill-feed events. Auto-detected "
                              "(newest readable serverfiles log) if omitted.")
    p_serve.add_argument("--icons-dir", type=Path,
                         help="serve icon images under /icons/<cat>/<file>. "
                              "Defaults to ./icons if that directory exists.")
    p_serve.add_argument("--sqmaps-dir", type=Path,
                         help="serve map textures under /sqmaps/<name>. "
                              "Defaults to ./sqmaps if that directory exists.")
    p_serve.add_argument("--frontend-dir", type=Path,
                         help="serve the Vite-built SPA at /viewer-next + "
                              "/assets/*. Defaults to ./frontend/dist then "
                              "./dist if either has an index.html.")
    p_serve.add_argument("--push", action="store_true",
                         help="push finished-match stats + .sqrx replays to the "
                              "enrolled central (requires `sqreader enroll` "
                              "first; also honours push_enabled in config). "
                              "Off by default — nothing leaves the box.")
    p_serve.set_defaults(func=cmd_serve)

    p_backfill = sub.add_parser(
        "stats-backfill",
        help="replay finished .sqrx recordings into the player-stats DB "
             "(one-time historical backfill; idempotent, safe to re-run)")
    p_backfill.add_argument("--recordings-dir", type=Path, required=True,
                            help="directory of .sqrx recordings to replay")
    p_backfill.add_argument("--stats-db", type=Path, required=True,
                            help="target SQLite player-stats DB")
    p_backfill.add_argument("--server-id", default=config.get("server_id"),
                            help="server id stamped on backfilled matches")
    p_backfill.add_argument("--skip-newer-than", type=float, default=120.0,
                            help="skip .sqrx modified within N seconds — the "
                                 "still-recording live match (default 120)")
    p_backfill.add_argument("--limit", type=int, default=0,
                            help="only backfill the newest N eligible files "
                                 "(0 = all); handy for a test run")
    p_backfill.add_argument("--push", action="store_true",
                            help="also push each backfilled match to the "
                                 "enrolled central (requires `sqreader enroll`)")
    p_backfill.set_defaults(func=cmd_stats_backfill)

    p_elo = sub.add_parser(
        "stats-elo-recalc",
        help="rebuild every ELO rating from scratch, oldest match first "
             "(run after a backfill, or after changing the score weights)")
    p_elo.add_argument("--stats-db", type=Path, required=True,
                       help="player-stats DB to recalculate in place")
    p_elo.add_argument("--min-players", type=int, default=elo.MIN_PLAYERS,
                       help=f"skip matches with fewer players "
                            f"(default {elo.MIN_PLAYERS})")
    p_elo.add_argument("--min-duration", type=int, default=elo.MIN_DURATION_SEC,
                       help=f"skip matches shorter than N seconds "
                            f"(default {elo.MIN_DURATION_SEC})")
    p_elo.add_argument("--min-playtime", type=int, default=elo.MIN_PLAYTIME_SEC,
                       help=f"skip players who played under N seconds "
                            f"(default {elo.MIN_PLAYTIME_SEC})")
    p_elo.set_defaults(func=cmd_stats_elo_recalc)

    p_test = sub.add_parser("test", help="run the full regression suite")
    p_test.set_defaults(func=cmd_test)

    p_doc = sub.add_parser("doctor",
                           help="verify every hardcoded offset still matches "
                                "the live binary (run after Squad updates)")
    p_doc.add_argument("--pid", type=int)
    p_doc.set_defaults(func=cmd_doctor)

    p_prof = sub.add_parser(
        "profile-build",
        help="profile the full build vs the 4 Hz position sampler (Phase-0 gate)")
    p_prof.add_argument("--pid", type=int, default=None,
                        help="Squad server PID (else auto-resolved)")
    p_prof.add_argument("--iters", type=int, default=20,
                        help="builds + samples to time (default 20)")
    p_prof.add_argument("--profile", action="store_true",
                        help="also print a cProfile breakdown of one build")
    p_prof.set_defaults(func=cmd_profile_build)

    # Internal: the full-build subprocess spawned by `serve --record-hz` for
    # two-tier recording. Streams NDJSON snapshots to stdout; not for hand-use.
    p_bw = sub.add_parser("build-worker",
                          help="(internal) full-build subprocess for two-tier "
                               "recording")
    p_bw.add_argument("--pid", type=int, default=None)
    p_bw.add_argument("--server-id", default=config.get("server_id"))
    p_bw.add_argument("--with-motd", action="store_true")
    p_bw.add_argument("--no-metadata", action="store_true")
    p_bw.set_defaults(func=cmd_build_worker)

    p_enroll = sub.add_parser(
        "enroll",
        help="enroll this box against a central platform so finished matches "
             "can be pushed (opt-in; nothing is sent until you also serve --push)")
    p_enroll.add_argument("token", nargs="?",
                          help="one-time enrollment token from your central site")
    p_enroll.add_argument("--central-url",
                          help="central base URL (else central_url in config)")
    p_enroll.add_argument("--status", action="store_true",
                          help="show enrollment status instead of enrolling")
    p_enroll.add_argument("--stats-db", type=Path,
                          help="with --status: report the pending push-queue depth")
    p_enroll.set_defaults(func=cmd_enroll)

    p_apply = sub.add_parser(
        "apply-staged-update",
        help="install a staged agent release (run by the deploy layer at restart)")
    p_apply.add_argument("--state-dir", default=None,
                         help="dir holding pending_release.json (default: stats-db dir)")
    p_apply.add_argument("--stats-db", default=None,
                         help="stats DB path; its parent dir holds the staged update")
    p_apply.set_defaults(func=cmd_apply_staged_update)
    return ap


def main(argv: Sequence[str] | None = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
