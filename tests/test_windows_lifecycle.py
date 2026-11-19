"""How the reader stops, and what it leaves running, on each platform.

On Linux systemd stops the unit with SIGTERM and an orphaned build worker sees
its ppid change. On Windows a service manager stops a console program with
Ctrl+C / Ctrl+Break, and nothing is ever reparented. These pin the platform
branches; the policy tests run anywhere, the job-object test needs Windows.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from sqreader import cli, procinfo
from sqreader.squad import buildworker

REPO = Path(__file__).resolve().parent.parent


def _pin(monkeypatch, mod, platform):
    monkeypatch.setattr(mod, "sys", SimpleNamespace(platform=platform,
                                                    stderr=sys.stderr))


# ------------------------------------------------------------ stop signals


def test_every_platform_stop_signal_reaches_the_handler(monkeypatch):
    registered = {}
    fake = SimpleNamespace(SIGTERM=15, SIGINT=2, SIGBREAK=21,
                           signal=lambda sig, h: registered.__setitem__(sig, h))
    monkeypatch.setattr(cli, "signal", fake)

    def handler(sig, frame):
        pass

    cli._install_stop_handlers(handler)
    assert registered == {15: handler, 2: handler, 21: handler}


def test_sigbreak_is_skipped_where_it_does_not_exist(monkeypatch):
    registered = {}
    fake = SimpleNamespace(SIGTERM=15, SIGINT=2,
                           signal=lambda sig, h: registered.__setitem__(sig, h))
    monkeypatch.setattr(cli, "signal", fake)
    cli._install_stop_handlers(lambda s, f: None)
    assert set(registered) == {15, 2}


# ------------------------------------------------------------- self-update


def test_self_update_is_off_on_windows_only(monkeypatch):
    _pin(monkeypatch, cli, "win32")
    assert not cli._self_update_supported()
    _pin(monkeypatch, cli, "linux")
    assert cli._self_update_supported()


# --------------------------------------------------------- worker orphaning


def test_linux_orphan_check_watches_the_ppid(monkeypatch):
    _pin(monkeypatch, cli, "linux")
    monkeypatch.setattr(cli.os, "getppid", lambda: 1)
    assert cli._parent_gone(4242)
    assert not cli._parent_gone(1)


def test_windows_orphan_check_asks_whether_the_parent_lives(monkeypatch):
    """Windows never reparents: the ppid stays the same after the parent dies,
    so comparing it (the Linux check) would never fire."""
    _pin(monkeypatch, cli, "win32")
    monkeypatch.setattr(cli.os, "getppid", lambda: 4242)
    monkeypatch.setattr(procinfo, "pid_alive", lambda pid: False)
    assert cli._parent_gone(4242)
    monkeypatch.setattr(procinfo, "pid_alive", lambda pid: True)
    assert not cli._parent_gone(4242)


def test_windows_worker_gets_its_own_group_and_our_lifetime(monkeypatch):
    calls = {}

    class FakePopen:
        pid = 777

        def __init__(self, argv, **kw):
            calls["kw"] = kw

    import sqreader.winproc as winproc
    _pin(monkeypatch, buildworker, "win32")
    monkeypatch.setattr(buildworker.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(buildworker.subprocess, "CREATE_NEW_PROCESS_GROUP",
                        0x200, raising=False)
    monkeypatch.setattr(winproc, "kill_with_this_process",
                        lambda pid: calls.__setitem__("job", pid) or True)

    buildworker.ProcessBuildWorker(["x"])._spawn()
    assert calls["kw"]["creationflags"] == 0x200
    assert calls["job"] == 777


def test_linux_worker_spawn_is_unchanged(monkeypatch):
    calls = {}

    class FakePopen:
        pid = 777

        def __init__(self, argv, **kw):
            calls["kw"] = kw

    _pin(monkeypatch, buildworker, "linux")
    monkeypatch.setattr(buildworker.subprocess, "Popen", FakePopen)
    buildworker.ProcessBuildWorker(["x"])._spawn()
    assert "creationflags" not in calls["kw"]


# A parent that puts a sleeping child under kill_with_this_process, reports
# the child's pid, then waits to be killed.
_PARENT = """
import subprocess, sys, time
from sqreader import winproc
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
ok = winproc.kill_with_this_process(child.pid)
print(child.pid, ok, flush=True)
time.sleep(120)
"""


@pytest.mark.skipif(sys.platform != "win32", reason="Windows job objects")
def test_killing_the_parent_takes_the_worker_with_it():
    """The worst case: the parent is TerminateProcess'd, so no shutdown code
    runs at all. The child must still not outlive it."""
    python = getattr(sys, "_base_executable", None) or sys.executable
    env = dict(os.environ, PYTHONPATH=str(REPO))
    parent = subprocess.Popen([python, "-c", _PARENT], stdout=subprocess.PIPE,
                              text=True, env=env)
    try:
        child_pid, ok = parent.stdout.readline().split()
        child_pid = int(child_pid)
        assert ok == "True"
        assert procinfo.pid_alive(child_pid)
        parent.kill()                                  # TerminateProcess
        parent.wait(timeout=10)
        deadline = time.time() + 10
        while procinfo.pid_alive(child_pid) and time.time() < deadline:
            time.sleep(0.1)
        assert not procinfo.pid_alive(child_pid), "worker outlived its parent"
    finally:
        if parent.poll() is None:
            parent.kill()
