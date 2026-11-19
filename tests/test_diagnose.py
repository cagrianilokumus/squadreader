"""`sqreader diagnose`: the report a hosting technician runs and sends back.

What matters is that it always completes, that it is honest about what
failed, and that on a shared machine it carries nothing about other
customers' servers beyond their count.
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

from sqreader import cli, config, diagnose


def _no_game(monkeypatch):
    def gone():
        raise SystemExit("no SquadGameServer process running")
    monkeypatch.setattr(config, "find_squad_server_pid", gone)
    monkeypatch.setattr(diagnose, "_raw_candidates", lambda proc: [])


def test_ports_are_the_only_thing_taken_from_a_command_line():
    args = ["SquadGameServer.exe", "Port=7787", "-QueryPort=27165",
            "/beaconport=15000", "RCONPASSWORD=hunter2", "-log",
            "Port=notanumber"]
    assert diagnose.parse_ports(args) == {
        "Port": 7787, "QueryPort": 27165, "beaconport": 15000}


def test_other_servers_are_counted_not_described():
    raw = [(10, True, ["C:\\cust-a\\SquadGameServer.exe", "Port=7787",
                       "AdminPassword=secret-a"]),
           (20, True, ["D:\\cust-b\\SquadGameServer.exe", "Port=7797"]),
           (30, False, ["C:\\cust-a\\launcher", "Port=7787"])]
    out = diagnose.summarize_candidates(raw)
    assert out == [(10, "game", {"Port": 7787}),
                   (20, "game", {"Port": 7797}),
                   (30, "launcher", {"Port": 7787})]
    assert "secret" not in repr(out) and "cust" not in repr(out)


def test_report_completes_without_a_game_and_says_why(monkeypatch):
    _no_game(monkeypatch)
    r = diagnose.run()
    text = r.text()
    assert r.failures == 1
    assert "[FAIL] our game server: no SquadGameServer process running" in text
    for section in ("Environment", "Configuration", "Game process",
                    "Memory access", "Game build", "Server log"):
        assert f"== {section} ==" in text
    assert text.rstrip().endswith("(see the FAIL lines above)")


def test_several_servers_without_squad_port_is_a_warning(monkeypatch):
    monkeypatch.setattr(diagnose, "_raw_candidates", lambda proc: [
        (10, True, ["Port=7787"]), (20, True, ["Port=7797"])])
    monkeypatch.setattr(config, "find_squad_server_pid",
                        lambda: (_ for _ in ()).throw(SystemExit("boom")))
    text = diagnose.run().text()
    assert "2 game server(s)" in text
    assert "[WARN] several game servers" in text


def test_a_crashing_check_is_a_fail_not_a_crash(monkeypatch):
    _no_game(monkeypatch)

    def broken():
        raise RuntimeError("disk on fire")
    monkeypatch.setattr(diagnose.shutil, "disk_usage", lambda p: broken())
    r = diagnose.run()
    assert "[FAIL] disk: RuntimeError: disk on fire" in r.text()


def test_cli_writes_the_file_and_exits_nonzero_on_failure(monkeypatch, tmp_path):
    _no_game(monkeypatch)
    out = tmp_path / "report.txt"
    rc = cli.main(["diagnose", "--out", str(out)])
    assert rc == 1
    assert out.read_text(encoding="utf-8").startswith("sqreader diagnose")


# ------------------------------------------------------------- live, Windows

_CHILD = """
import sys
sys.stdin.readline()
"""


@pytest.mark.skipif(sys.platform != "win32", reason="live Windows process")
def test_live_report_against_a_real_process(monkeypatch):
    """Point the report at a parked interpreter as if it were the game: the
    process, account, memory and module checks must all come out OK."""
    python = getattr(sys, "_base_executable", None) or sys.executable
    child = subprocess.Popen([python, "-c", _CHILD, "Port=7787"],
                             stdin=subprocess.PIPE, text=True)
    real_get = config.get
    monkeypatch.setattr(config, "get", lambda k: "python"
                        if k == "squad_process_name" else real_get(k))
    try:
        r = diagnose.run(child.pid)
    finally:
        child.stdin.write("\n")
        child.stdin.flush()
        child.wait(timeout=10)
    text = r.text()
    assert f"[OK  ] our game server: pid {child.pid}, ports {{'Port': 7787}}" in text
    assert "(same account as the reader)" in text
    assert "[OK  ] open the game:" in text
    assert "[OK  ] game module: python.exe at" in text
    assert "header readable" in text
    assert "[INFO] build: sha256 " in text


@pytest.mark.skipif(sys.platform != "win32", reason="Windows accounts")
def test_process_user_names_this_account():
    from sqreader import winproc
    me = winproc.process_user(os.getpid())
    assert me and me.lower().endswith("\\" + os.environ["USERNAME"].lower())
