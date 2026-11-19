"""``sqreader supervise``: keep ``serve`` running on Windows, as systemd does.

On Linux the agent leans on its unit file for four things, and Windows has a
counterpart for none of them that a scheduled task gives for free:

* **Restart.** ``serve`` exits on purpose when the game process goes away
  (the server restarts daily, and on every map crash) and expects to be
  started again; systemd's ``Restart=always`` does that with a back-off.
* **Logs.** systemd puts stdout/stderr in the journal. A scheduled task
  throws them away, and on a hosted machine reached only by FTP the log
  file is the one way anyone will ever see what happened.
* **Restraint.** The unit runs at ``Nice=19`` with ``CPUQuota=50%``: the
  game server always wins.
* **Clean stop.** SIGTERM lets ``serve`` close its recording. Task Scheduler
  ends a task with TerminateProcess instead.

So the scheduled task runs this, and this runs ``serve`` as its child:

* restarts it when it exits, 5 s at first, doubling to 30 s while it keeps
  failing, back to 5 s once a run lasted two minutes;
* writes every line the child (and its own build worker) prints to one log
  file, timestamped, rotated by size;
* starts it at below-normal priority, inside a job object that both caps
  its CPU and ends it if this process is killed;
* asks it to stop through a stop file (SQREADER_STOP_FILE): ``serve`` leaves
  its loop through the same path SIGTERM takes, then this exits too.

Two more control files sit beside the stop file, for an owner who can reach
the folder (over FTP, say) but cannot run anything on the machine:

* ``sqreader.restart``: ``serve`` stops cleanly and is started again at
  once, so a config change takes effect now rather than at the game
  server's next restart;
* ``enroll-token.txt``: ``serve`` redeems the token when it starts (see
  cli._enroll_from_drop_file); drop it, then the restart file.

Two things keep it self-contained, so a host can run it as one process from
its own panel, with no Task Scheduler and nothing written outside the folder:

* **Retention.** The Linux unit has a daily timer that prunes old
  recordings. Here a thread of this process does it (``retention=``): first
  a few minutes after start, then every ``retention_every`` seconds.
* **Address cache.** ``serve`` keeps a small cache of game addresses, by
  default in the user's profile. The child is pointed at ``addresses.json``
  beside the control files instead (SQR_ADDR_CACHE, unless already set).
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Sequence

#: Back-off between restarts, as the Linux unit's RestartSec / RestartMaxDelay.
MIN_DELAY_SEC = 5.0
MAX_DELAY_SEC = 30.0
#: A run this long counts as healthy: the next failure starts over at MIN.
HEALTHY_AFTER_SEC = 120.0

#: The control files beside the stop file (see the module docstring).
RESTART_FILE_NAME = "sqreader.restart"
ENROLL_FILE_NAME = "enroll-token.txt"
#: The child's address cache, also beside the stop file.
ADDR_CACHE_NAME = "addresses.json"

#: The first clean-up waits this long, so the reader attaches undisturbed.
RETENTION_FIRST_DELAY_SEC = 300.0
#: Then once a day, as the Linux timer does.
RETENTION_EVERY_SEC = 86400.0
#: How long stopping waits for a clean-up that is still deleting files.
RETENTION_JOIN_SEC = 60.0

_BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
_CREATE_NEW_PROCESS_GROUP = 0x00000200


class RotatingLog:
    """Append-only, timestamped, size-rotated log: ``x.log``, ``x.log.1``...

    One writer (this process) owns the file, which is what makes rotating it
    safe: the child's output reaches it through a pipe, never a handle of
    its own.
    """

    def __init__(self, path: Path | str, *, max_bytes: int = 20 << 20,
                 keep: int = 5):
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.keep = max(1, keep)
        self._lock = threading.Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._f = open(self.path, "a", encoding="utf-8", newline="\n")
        self._size = self.path.stat().st_size

    def write_line(self, text: str) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        line = f"{stamp} {text}\n"
        with self._lock:
            self._f.write(line)
            self._f.flush()
            self._size += len(line.encode("utf-8"))
            if self._size >= self.max_bytes:
                self._rotate()

    def _rotate(self) -> None:
        self._f.close()
        oldest = self.path.with_name(f"{self.path.name}.{self.keep}")
        oldest.unlink(missing_ok=True)
        for i in range(self.keep - 1, 0, -1):
            src = self.path.with_name(f"{self.path.name}.{i}")
            if src.exists():
                os.replace(src, self.path.with_name(f"{self.path.name}.{i + 1}"))
        os.replace(self.path, self.path.with_name(f"{self.path.name}.1"))
        self._f = open(self.path, "a", encoding="utf-8", newline="\n")
        self._size = 0

    def close(self) -> None:
        with self._lock:
            self._f.close()


class _Stdout:
    """RotatingLog's interface onto stdout, for running supervise by hand."""

    def write_line(self, text: str) -> None:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")
        print(f"{stamp} {text}", flush=True)

    def close(self) -> None:
        pass


def _spawn(argv: Sequence[str], env: dict[str, str]) -> subprocess.Popen:
    kwargs: dict = {}
    if sys.platform == "win32":
        # Below normal so the game always wins the CPU; its own group so a
        # console Ctrl+C reaches this process, which then stops the child
        # through the stop file instead of letting it die mid-write.
        kwargs["creationflags"] = (_BELOW_NORMAL_PRIORITY_CLASS
                                   | _CREATE_NEW_PROCESS_GROUP)
    return subprocess.Popen(list(argv), stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            env=env, **kwargs)


def _retention_loop(job: Callable[[Callable[[str], None]], object],
                    out: RotatingLog | _Stdout, *, first: float, every: float,
                    done: threading.Event) -> None:
    """Run ``job`` after ``first`` seconds, then every ``every`` seconds,
    until ``done`` is set. A failing run is logged and tried again next
    time; it never takes the supervisor down."""
    wait = first
    while not done.wait(wait):
        try:
            job(out.write_line)
        except Exception as e:  # noqa: BLE001 - housekeeping must not kill us
            out.write_line(f"[retention] failed: {e!r}")
        wait = every


def run(argv: Sequence[str], *, stop_file: Path | str,
        log: RotatingLog | _Stdout | None = None,
        cpu_percent_of_one_core: float | None = None,
        retention: Callable[[Callable[[str], None]], object] | None = None,
        retention_first: float = RETENTION_FIRST_DELAY_SEC,
        retention_every: float = RETENTION_EVERY_SEC,
        min_delay: float = MIN_DELAY_SEC, max_delay: float = MAX_DELAY_SEC,
        healthy_after: float = HEALTHY_AFTER_SEC,
        sleep: Callable[[float], None] = time.sleep,
        clock: Callable[[], float] = time.monotonic) -> int:
    """Run ``argv`` until the stop file appears, restarting it whenever it
    exits. Returns 0 once stopped.

    ``retention``, if given, is called on a thread of its own with a
    function that logs one line: ``retention_first`` seconds after start,
    then every ``retention_every`` seconds."""
    out = log or _Stdout()
    stop = Path(stop_file)
    restart = stop.with_name(RESTART_FILE_NAME)
    stop.unlink(missing_ok=True)            # a stale one would stop us at once
    restart.unlink(missing_ok=True)
    env = dict(os.environ, SQREADER_STOP_FILE=str(stop),
               SQREADER_RESTART_FILE=str(restart),
               SQREADER_ENROLL_FILE=str(stop.with_name(ENROLL_FILE_NAME)),
               PYTHONUNBUFFERED="1", PYTHONIOENCODING="utf-8")
    env.setdefault("SQR_ADDR_CACHE", str(stop.with_name(ADDR_CACHE_NAME)))
    out.write_line(f"[supervisor] started (pid {os.getpid()}); child: "
                   f"{' '.join(argv)}")
    retention_done = threading.Event()
    retention_thread = None
    if retention is not None:
        retention_thread = threading.Thread(
            target=_retention_loop, name="sqreader-retention", daemon=True,
            args=(retention, out),
            kwargs=dict(first=retention_first, every=retention_every,
                        done=retention_done))
        retention_thread.start()
        out.write_line(f"[supervisor] retention: in {retention_first:g}s, "
                       f"then every {retention_every / 3600:g}h")
    if sys.platform == "win32":
        # Into the job BEFORE the first child exists, so the child and all it
        # starts are born inside it: capped together, and ended with us.
        from . import winproc
        try:
            contained = winproc.contain_this_process(
                cpu_percent_of_one_core=cpu_percent_of_one_core)
        except OSError:
            contained = False
        cap = (f", CPU capped at {cpu_percent_of_one_core:g}% of one core"
               if cpu_percent_of_one_core else "")
        out.write_line(f"[supervisor] job object: "
                       f"{'on' + cap if contained else 'NOT available'}")
    delay = min_delay
    while not stop.exists():
        started = clock()
        try:
            proc = _spawn(argv, env)
        except OSError as e:
            out.write_line(f"[supervisor] cannot start the child: {e!r}")
            rc, ran = None, 0.0
        else:
            out.write_line(f"[supervisor] child running (pid {proc.pid})")
            assert proc.stdout is not None
            for raw in proc.stdout:
                out.write_line(raw.decode("utf-8", errors="replace").rstrip("\r\n"))
            rc = proc.wait()
            ran = clock() - started
            out.write_line(f"[supervisor] child exited with code {rc} after "
                           f"{ran:.0f}s")
        if stop.exists():
            break
        if restart.exists():
            restart.unlink(missing_ok=True)
            out.write_line("[supervisor] restart requested; starting again now")
            delay = min_delay
            continue
        delay = min_delay if ran >= healthy_after else delay
        out.write_line(f"[supervisor] restarting in {delay:g}s")
        steps = max(1, int(delay + 0.999))
        for _ in range(steps):
            if stop.exists() or restart.exists():
                break
            sleep(delay / steps)
        restart.unlink(missing_ok=True)
        delay = min(delay * 2, max_delay)
    retention_done.set()
    if retention_thread is not None:
        retention_thread.join(RETENTION_JOIN_SEC)
    stop.unlink(missing_ok=True)
    out.write_line("[supervisor] stopped")
    out.close()
    return 0


def request_stop(stop_file: Path | str) -> None:
    """Ask a running supervisor (and its child) to stop cleanly."""
    Path(stop_file).write_text("stop\n", encoding="utf-8")


__all__ = ["RotatingLog", "run", "request_stop", "MIN_DELAY_SEC",
           "MAX_DELAY_SEC", "HEALTHY_AFTER_SEC", "RESTART_FILE_NAME",
           "ENROLL_FILE_NAME", "ADDR_CACHE_NAME", "RETENTION_FIRST_DELAY_SEC",
           "RETENTION_EVERY_SEC"]
