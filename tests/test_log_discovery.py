"""Finding the server's log without assuming how it was installed.

The kill feed reads SquadGame.log. Discovery used to be a single glob against
`/home/*/serverfiles/...`, which is LinuxGSM's layout — so a Docker image, an
/opt install, or a server owned by a user outside /home found nothing. The
failure is quiet and the expensive kind: the reader keeps working, falls back
to memory-sampled hits, and produces stats that look fine and undercount kills.

The process knows where its own log is. These tests pin that down, and pin down
that an operator's explicit setting still wins.
"""
import os
from types import SimpleNamespace

import pytest

from sqreader import procinfo
from sqreader.squad import logtail


@pytest.fixture(autouse=True)
def _procfs_path(monkeypatch):
    """These tests drive the Linux /proc resolver through mocks, so they pin
    that path even when the suite runs on Windows (where procinfo would
    otherwise take its Win32 branch and never consult the mocks). Only the
    module's own view of the platform changes, not the interpreter's."""
    monkeypatch.setattr(procinfo, "sys", SimpleNamespace(platform="linux"))


def _install(root, *, with_log=True):
    """A Squad install laid out the way Squad lays itself out."""
    exe = root / "SquadGame" / "Binaries" / "Linux" / "SquadGameServer"
    exe.parent.mkdir(parents=True)
    exe.write_text("#!/bin/sh\n", encoding="utf-8")
    log = root / "SquadGame" / "Saved" / "Logs" / "SquadGame.log"
    log.parent.mkdir(parents=True)
    if with_log:
        log.write_text("hello\n", encoding="utf-8")
    return exe, log


def test_it_finds_the_log_from_the_running_binary(tmp_path, monkeypatch):
    """Works for any install path — which is the whole point."""
    exe, log = _install(tmp_path / "opt" / "squad")
    monkeypatch.setattr(os.path, "realpath",
                        lambda p: str(exe) if "/proc/" in str(p) else p)

    assert logtail.log_from_pid(1234) == str(log)


def test_a_missing_log_is_not_a_guess(tmp_path, monkeypatch):
    exe, log = _install(tmp_path / "srv" / "squad", with_log=False)
    monkeypatch.setattr(os.path, "realpath",
                        lambda p: str(exe) if "/proc/" in str(p) else p)

    assert logtail.log_from_pid(1234) is None


def test_an_unreadable_process_falls_back_rather_than_raising(monkeypatch):
    def boom(p):
        if "/proc/" in str(p):
            raise OSError("gone")
        return p

    monkeypatch.setattr(os.path, "realpath", boom)
    assert logtail.log_from_pid(1234) is None


def test_the_process_is_asked_before_the_linuxgsm_glob(tmp_path, monkeypatch):
    """A box can have BOTH a stale LinuxGSM tree and the real server elsewhere.
    The process is the one source that cannot be out of date."""
    _, real_log = _install(tmp_path / "opt" / "squad")
    stale = tmp_path / "home" / "sq" / "serverfiles" / "SquadGame" / "Saved" / "Logs"
    stale.mkdir(parents=True)
    (stale / "SquadGame.log").write_text("old\n", encoding="utf-8")

    exe = tmp_path / "opt" / "squad" / "SquadGame" / "Binaries" / "Linux" / "SquadGameServer"
    monkeypatch.setattr(os.path, "realpath",
                        lambda p: str(exe) if "/proc/" in str(p) else p)
    monkeypatch.setattr(logtail, "_TS_RE", logtail._TS_RE)   # keep module intact
    monkeypatch.setattr("sqreader.config.get",
                        lambda k: str(stale / "SquadGame.log")
                        if k == "squad_log_glob" else None)

    assert logtail.find_squad_log(pid=1234) == str(real_log)


def test_without_a_pid_it_still_uses_the_configured_glob(tmp_path, monkeypatch):
    logs = tmp_path / "home" / "sq" / "serverfiles" / "SquadGame" / "Saved" / "Logs"
    logs.mkdir(parents=True)
    (logs / "SquadGame.log").write_text("x\n", encoding="utf-8")
    monkeypatch.setattr("sqreader.config.get",
                        lambda k: str(logs / "SquadGame.log")
                        if k == "squad_log_glob" else None)

    assert logtail.find_squad_log() == str(logs / "SquadGame.log")


@pytest.mark.skipif(os.name == "nt", reason="needs a real /proc")
def test_it_reads_this_very_process(tmp_path):
    """A sanity check against the real /proc rather than a stubbed one: the
    derivation must survive a genuine exe path, even though it finds no log."""
    assert logtail.log_from_pid(os.getpid()) is None
