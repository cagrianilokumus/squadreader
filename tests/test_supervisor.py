"""`sqreader supervise`: what systemd does for the Linux agent, on Windows.

Real child processes throughout: the point is how restarts, the stop file,
output capture and (on Windows) priority and the CPU cap behave for an
actual process, which a fake would only restate.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

from sqreader import cli, supervisor

PY = sys.executable
REPO = Path(__file__).resolve().parent.parent


class Lines:
    """A log that keeps its lines in memory."""

    def __init__(self):
        self.lines: list[str] = []

    def write_line(self, text):
        self.lines.append(text)

    def close(self):
        pass

    def find(self, prefix):
        return [ln for ln in self.lines if ln.startswith(prefix)]


def _stop_after(stop, n_sleeps):
    """A sleep() that requests the stop on its n-th call."""
    calls = {"n": 0}

    def fake(seconds):
        calls["n"] += 1
        if calls["n"] >= n_sleeps:
            supervisor.request_stop(stop)
    return fake


def test_a_failing_child_is_restarted_with_backoff(tmp_path):
    stop = tmp_path / "sqreader.stop"
    log = Lines()
    delays = []

    def fake_sleep(seconds):
        delays.append(seconds)
        if len(log.find("[supervisor] child exited")) >= 5:
            supervisor.request_stop(stop)

    rc = supervisor.run([PY, "-c", "raise SystemExit(3)"], stop_file=stop,
                        log=log, sleep=fake_sleep)
    assert rc == 0
    restarts = [ln.split()[-1] for ln in log.find("[supervisor] restarting in")]
    assert restarts[:5] == ["5s", "10s", "20s", "30s", "30s"]
    assert all("code 3" in ln for ln in log.find("[supervisor] child exited"))
    assert not stop.exists(), "the stop file is consumed on the way out"


def test_a_healthy_run_resets_the_backoff(tmp_path):
    stop = tmp_path / "sqreader.stop"
    log = Lines()
    ticks = iter(range(0, 10_000, 200))      # every run "lasts" 200 s

    rc = supervisor.run([PY, "-c", "pass"], stop_file=stop, log=log,
                        sleep=_stop_after(stop, 20),
                        clock=lambda: next(ticks))
    assert rc == 0
    restarts = log.find("[supervisor] restarting in")
    assert restarts and all(ln.endswith(" 5s") for ln in restarts)


_WAITS_FOR_STOP = """
import os, sys, time
print("child up", flush=True)
print("to stderr", file=sys.stderr, flush=True)
stop = os.environ["SQREADER_STOP_FILE"]
while not os.path.exists(stop):
    time.sleep(0.02)
print("clean exit", flush=True)
"""


def test_the_stop_file_stops_the_child_cleanly_then_the_supervisor(tmp_path):
    stop = tmp_path / "sqreader.stop"
    stop.write_text("stale\n")                 # a leftover must not stop us
    log = Lines()
    timer = threading.Timer(1.0, supervisor.request_stop, [stop])
    timer.start()
    try:
        rc = supervisor.run([PY, "-c", _WAITS_FOR_STOP], stop_file=stop, log=log)
    finally:
        timer.cancel()
    assert rc == 0
    assert "child up" in log.lines and "to stderr" in log.lines
    assert "clean exit" in log.lines, "the child left through its own path"
    assert log.lines[-1] == "[supervisor] stopped"
    assert len(log.find("[supervisor] child running")) == 1, "no restart"
    assert not stop.exists()


def test_the_log_is_timestamped_and_rotated(tmp_path):
    path = tmp_path / "logs" / "sqreader.log"
    log = supervisor.RotatingLog(path, max_bytes=200, keep=2)
    for i in range(30):
        log.write_line(f"line {i:02d} " + "x" * 20)
    log.close()
    assert path.exists()
    assert (tmp_path / "logs" / "sqreader.log.1").exists()
    assert (tmp_path / "logs" / "sqreader.log.2").exists()
    assert not (tmp_path / "logs" / "sqreader.log.3").exists(), "keep=2"
    last = path.read_text(encoding="utf-8").splitlines()[-1]
    assert last.endswith("line 29 " + "x" * 20)
    assert last[:4].isdigit() and last[19] == "Z", last   # 2026-11-19 10:00:00Z


def test_cli_refuses_to_supervise_nothing():
    assert cli.main(["supervise"]) == 2


def test_cli_runs_the_subcommand_under_this_program(tmp_path, monkeypatch):
    seen = {}

    def fake_run(argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        return 0
    monkeypatch.setattr(supervisor, "run", fake_run)
    monkeypatch.setattr(cli, "_install_stop_handlers", lambda h: None)
    rc = cli.main(["supervise", "--cpu-limit", "50", "--stop-file",
                   str(tmp_path / "s"), "--", "serve", "--hz", "2"])
    assert rc == 0
    assert seen["argv"] == [*cli._self_command(), "serve", "--hz", "2"]
    assert seen["kw"]["cpu_percent_of_one_core"] == 50.0


# ------------------------------------------------------- serve's side of it


def test_serve_sees_the_stop_file_only_when_supervised(tmp_path, monkeypatch):
    stop = tmp_path / "sqreader.stop"
    monkeypatch.delenv("SQREADER_STOP_FILE", raising=False)
    stop.write_text("x")
    assert not cli._stop_requested(), "no env var: a Linux unit is unaffected"
    monkeypatch.setenv("SQREADER_STOP_FILE", str(stop))
    assert cli._stop_requested()


def test_the_long_degraded_wait_is_cut_short_by_a_stop(tmp_path, monkeypatch):
    stop = tmp_path / "sqreader.stop"
    monkeypatch.setenv("SQREADER_STOP_FILE", str(stop))
    monkeypatch.setattr(cli.time, "sleep", lambda s: stop.write_text("x"))
    with pytest.raises(SystemExit) as ei:
        cli._sleep_unless_stopping(300)
    assert ei.value.code == 0


# -------------------------------------------------------------- Windows only

_PROBE = """
import ctypes, json, os, time
k32 = ctypes.WinDLL("kernel32")
k32.GetCurrentProcess.restype = ctypes.c_void_p
k32.GetPriorityClass.argtypes = [ctypes.c_void_p]
prio = k32.GetPriorityClass(k32.GetCurrentProcess())
t0, c0 = time.perf_counter(), time.process_time()
while time.perf_counter() - t0 < 1.5:
    pass
ratio = (time.process_time() - c0) / (time.perf_counter() - t0)
print("PROBE " + json.dumps({"priority": prio, "cpu_ratio": ratio}), flush=True)
open(os.environ["SQREADER_STOP_FILE"], "w").close()
"""

_HOST = """
import sys
from pathlib import Path
from sqreader import supervisor
class L:
    def write_line(self, t): print(t, flush=True)
    def close(self): pass
supervisor.run([sys.executable, "-c", sys.argv[1]], stop_file=Path(sys.argv[2]),
               log=L(), cpu_percent_of_one_core=float(sys.argv[3]) or None)
"""


def _probe(tmp_path, cap):
    """Run the probe under a supervisor in a process of its own, so the job
    object (one per process) is that process's, not pytest's."""
    out = subprocess.run(
        [PY, "-c", _HOST, _PROBE, str(tmp_path / f"stop{cap}"), str(cap)],
        capture_output=True, text=True, timeout=60,
        env=dict(os.environ, PYTHONPATH=str(REPO)))
    line = next(ln for ln in out.stdout.splitlines() if ln.startswith("PROBE "))
    return json.loads(line[len("PROBE "):])


@pytest.mark.skipif(sys.platform != "win32", reason="Windows priority classes")
def test_the_child_runs_below_normal_priority(tmp_path):
    assert _probe(tmp_path, 0)["priority"] == 0x4000      # BELOW_NORMAL


@pytest.mark.skipif(sys.platform != "win32", reason="Windows job CPU rate")
def test_the_cpu_cap_holds_a_busy_child_down(tmp_path):
    free = _probe(tmp_path, 0)["cpu_ratio"]
    capped = _probe(tmp_path, 25)["cpu_ratio"]
    assert free > 0.8, f"uncapped spin should use a whole core, got {free:.2f}"
    assert capped < 0.45, f"capped at 25% of a core, used {capped:.2f}"


_SLEEPER = "import time; time.sleep(120)"


@pytest.mark.skipif(sys.platform != "win32", reason="Windows job objects")
def test_ending_the_task_ends_everything_below_it(tmp_path):
    """Task Scheduler's "End" is TerminateProcess on the supervisor: nothing
    of ours may keep running on the game server after it."""
    from sqreader import procinfo, winproc
    host = subprocess.Popen(
        [PY, "-c", _HOST, _SLEEPER, str(tmp_path / "stop"), "0"],
        stdout=subprocess.PIPE, text=True,
        env=dict(os.environ, PYTHONPATH=str(REPO)))
    try:
        child = None
        for line in host.stdout:
            if "[supervisor] child running (pid " in line:
                child = int(line.rsplit("pid ", 1)[1].rstrip(")\n"))
                break
        assert child and procinfo.pid_alive(child)
        time.sleep(0.5)                       # let the venv stub start its child
        below = [e.pid for e in winproc.list_processes() if e.ppid == child]
        host.kill()                           # TerminateProcess, no clean path
        host.wait(timeout=10)
        deadline = time.time() + 10
        alive = lambda: [p for p in [child, *below] if procinfo.pid_alive(p)]  # noqa: E731
        while alive() and time.time() < deadline:
            time.sleep(0.1)
        assert not alive(), f"left running: {alive()}"
    finally:
        if host.poll() is None:
            host.kill()
