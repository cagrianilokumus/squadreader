"""The kill-feed tailer must not stand in the way of the server's own log
rotation, and must follow it.

When the Squad server restarts it renames SquadGame.log to
SquadGame-backup-<date>.log and starts a new SquadGame.log. On Windows a file
opened with Python's open() cannot be renamed by anyone else (WinError 32),
so a tailer holding the log would break the rotation, which the server and
anything else reading that log depend on. These run the real tailer thread
against real files.
"""
from __future__ import annotations

import os
import sys
import time
from types import SimpleNamespace

import pytest

from sqreader.squad import logtail

BOM = chr(0xFEFF)       # the Windows server writes its log as UTF-8 with BOM


def _wait(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def _append(path, text):
    with open(path, "a", encoding="utf-8", newline="") as f:
        f.write(text)


def test_the_server_can_rotate_a_log_we_are_tailing(tmp_path):
    log = tmp_path / "SquadGame.log"
    backup = tmp_path / "SquadGame-backup-2026.11.18-04.59.59.log"
    log.write_text(BOM + "Log file open\r\n", encoding="utf-8", newline="")

    t = logtail.LogTailer(str(log), poll_sec=0.02, catchup_bytes=0)
    t.start()
    try:
        # The tailer starts at the END of the file, from its own thread: keep
        # writing until it has demonstrably begun following.
        def warm():
            _append(log, "warmup\r\n")
            return t.lines_read > 0
        assert _wait(warm), t.last_error
        before = t.lines_read
        _append(log, "one\r\ntwo\r\n")
        assert _wait(lambda: t.lines_read >= before + 2), t.last_error

        os.rename(log, backup)                 # what the server does on restart
        log.write_text(BOM + "Log file open\r\nthree\r\nfour\r\nfive\r\n",
                       encoding="utf-8", newline="")
        assert _wait(lambda: t.lines_read >= before + 2 + 4), t.last_error
        assert t.last_error is None
    finally:
        t.stop()


@pytest.mark.skipif(sys.platform != "win32", reason="Windows file sharing")
def test_plain_open_is_what_blocked_it(tmp_path):
    """Pins down the cause, so nobody 'simplifies' _open_log back to open()."""
    log = tmp_path / "SquadGame.log"
    log.write_text("x\n", encoding="utf-8")
    with open(log, encoding="utf-8"):
        with pytest.raises(PermissionError):
            os.rename(log, tmp_path / "moved.log")
    with logtail._open_log(str(log)) as f:
        os.rename(log, tmp_path / "moved.log")
        assert f.read() == "x\n"


def test_crlf_and_bom_read_like_the_linux_log(tmp_path):
    log = tmp_path / "SquadGame.log"
    log.write_bytes(b"\xef\xbb\xbfa\r\nb\r\n")
    with logtail._open_log(str(log)) as f:
        assert f.read().lstrip(BOM) == "a\nb\n"


def test_linux_keeps_its_plain_open(tmp_path, monkeypatch):
    monkeypatch.setattr(logtail, "sys", SimpleNamespace(platform="linux"))
    log = tmp_path / "SquadGame.log"
    log.write_text("x\n", encoding="utf-8")
    with logtail._open_log(str(log)) as f:
        assert f.read() == "x\n"
