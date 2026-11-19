"""Background full-build worker — the slow tier of two-tier recording.

The full `build_snapshot` is a ~1-2 s CPU/GIL-bound walk of ~187k objects. A
*thread* worker does NOT work: the CPU-bound build holds the GIL and starves the
latency-sensitive 4 Hz sampler thread (measured live: the 4 Hz loop collapsed to
0.06 Hz — classic multicore GIL convoy). So the build runs in a SEPARATE PROCESS
(`sqreader build-worker`, own GIL, own core) that streams each finished snapshot
as one NDJSON line to its stdout. The main process reads that pipe on a
blocking-I/O reader thread — which spends its life parked in `readline` with the
GIL RELEASED — so the 4 Hz sampler on the main thread runs unimpeded.

Hand-off is a single lock-guarded `FullFrame` slot (latest wins; intermediate
frames the main loop didn't consume are simply dropped). If the worker process
dies while the target game is still alive it is respawned automatically (a build
hiccup must not blip the live map); if the target itself is gone, `target_gone`
latches so the serve loop can exit for a systemd restart.
"""
from __future__ import annotations

import json
import subprocess
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable, Optional, Sequence

from .possample import SampledEntities

# Cap for the respawn backoff. Long enough that a permanently-broken worker
# cannot burn the game server's CPU, short enough that a transient failure
# recovers well within one match.
_RESPAWN_MAX_DELAY_SEC = 30.0


@dataclass(frozen=True, slots=True)
class FullFrame:
    """One published rich snapshot + the entity set derived from it. Immutable;
    the main loop holds a reference while the worker builds the next one."""
    gen: int
    snap: dict[str, Any]
    entities: SampledEntities
    build_ms: float


class ProcessBuildWorker:
    """Spawns `sqreader build-worker` and publishes its latest `FullFrame`.

    `argv` is the full subprocess command (built by the caller so this module
    stays free of CLI/pipeline knowledge). `target_alive()` distinguishes "the
    build worker crashed" (respawn) from "the game process is gone" (latch
    `target_gone`)."""

    def __init__(self, argv: Sequence[str], *,
                 target_alive: Optional[Callable[[], bool]] = None):
        self._argv = list(argv)
        self._target_alive = target_alive
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._latest: Optional[FullFrame] = None
        self._gen = 0
        self._stop = threading.Event()
        self.target_gone = False
        self.last_error: Optional[str] = None
        self._fails = 0            # consecutive spawns that produced no frame
        self._gen_at_spawn = 0     # _gen when the current child was started
        self._reader = threading.Thread(
            target=self._read_loop, name="sqr-build-reader", daemon=True)

    # -- public API ---------------------------------------------------------
    def start(self) -> None:
        self._spawn()
        self._reader.start()

    def stop(self) -> None:
        self._stop.set()
        proc = self._proc
        if proc is not None:
            try:
                proc.terminate()
            except Exception:  # noqa: BLE001
                pass

    def latest(self) -> Optional[FullFrame]:
        with self._lock:
            return self._latest

    def update_paths(self, paths: Any) -> None:
        # The worker subprocess resolves its own paths at startup; an offset
        # self-heal in the parent does not reach it. That is acceptable: a real
        # offset drift (Squad patch) is handled by the fleet updater restarting
        # the whole service, which respawns the worker fresh. No-op by design.
        return

    # -- internals ----------------------------------------------------------
    def _spawn(self) -> None:
        # Remember the frame counter at spawn time; if the child exits with it
        # unchanged it never produced anything, which is the failure the
        # respawn backoff exists for.
        self._gen_at_spawn = self._gen
        # stderr inherits the parent's so the worker's own logs land in the
        # journal; stdout is the NDJSON frame pipe.
        if sys.platform == "win32":
            # A console Ctrl+C (which is how a Windows service manager stops
            # us) goes to every process in the group; in a group of its own
            # the worker is spared it and stop() ends it instead, rather than
            # it dying first and the read loop respawning it mid-shutdown.
            # The job ties its life to ours: Windows has no reparenting for
            # the worker's own orphan check to notice.
            self._proc = subprocess.Popen(
                self._argv, stdout=subprocess.PIPE, stderr=None,
                text=True, bufsize=1,
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
            from .. import winproc
            try:
                winproc.kill_with_this_process(self._proc.pid)
            except OSError:
                pass
            return
        self._proc = subprocess.Popen(
            self._argv, stdout=subprocess.PIPE, stderr=None,
            text=True, bufsize=1)

    def _ingest_line(self, line: str) -> Optional[FullFrame]:
        """Parse one NDJSON frame → publish a FullFrame (latest wins). Returns
        the frame, or None for a blank/torn line. Pure + synchronous — the read
        loop's per-line body, factored out so it is testable without threads."""
        line = line.strip()
        if not line:
            return None
        try:
            snap = json.loads(line)
        except Exception as e:  # noqa: BLE001 - a torn line must not kill us
            self.last_error = f"frame parse: {e!r}"
            return None
        build_ms = float((snap.get("perf") or {}).get("buildMs") or 0.0)
        entities = SampledEntities.from_snapshot(snap)
        with self._lock:
            self._gen += 1
            frame = FullFrame(self._gen, snap, entities, build_ms)
            self._latest = frame
        return frame

    def _read_loop(self) -> None:
        while not self._stop.is_set():
            proc = self._proc
            if proc is None or proc.stdout is None:
                return
            # Blocking line iteration — the GIL is released while parked here.
            for line in proc.stdout:
                if self._stop.is_set():
                    return
                self._ingest_line(line)
            # stdout closed → the worker exited.
            if self._stop.is_set():
                return
            if self._target_alive is not None and not self._target_alive():
                self.target_gone = True   # game gone → serve loop should exit
                return
            # Worker died but the game is alive → respawn and keep streaming.
            # Back off when it dies WITHOUT having produced a frame: a worker
            # that fails at startup (bad argv, missing interpreter) would
            # otherwise be re-forked in a tight loop forever, on a machine that
            # is also running the game server. A worker that ran normally and
            # then exited respawns immediately, as before.
            if self._gen == self._gen_at_spawn:
                self._fails += 1
                delay = min(2.0 ** min(self._fails, 5), _RESPAWN_MAX_DELAY_SEC)
                self.last_error = (f"build-worker exited without producing a "
                                   f"frame ({self._fails}x); retrying in {delay:g}s")
                if self._stop.wait(delay):
                    return
            else:
                self._fails = 0
                self.last_error = "build-worker exited; respawning"
            try:
                self._spawn()
            except OSError as exc:
                # Cannot even fork/exec it — keep the reader alive and retry.
                self._fails += 1
                self.last_error = f"build-worker respawn failed: {exc}"
                if self._stop.wait(min(2.0 ** min(self._fails, 5),
                                       _RESPAWN_MAX_DELAY_SEC)):
                    return
