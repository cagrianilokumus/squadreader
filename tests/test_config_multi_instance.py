"""Picking the right Squad server on a box that runs several.

Without `squad_port` the server is resolved by process name, and `pidof -s`
answers with one of them arbitrarily — so several agents can end up reading the
same game, and which game that is can change on any restart. These pin the
behaviour that makes the choice deterministic.
"""
from types import SimpleNamespace

import pytest

from sqreader import config


@pytest.fixture(autouse=True)
def _procfs_path(monkeypatch):
    """These tests drive the Linux /proc resolver through mocks, so they pin
    that path even when the suite runs on Windows (where config would
    otherwise take its Win32 branch and never consult the mocks). Only the
    module's own view of the platform changes, not the interpreter's."""
    monkeypatch.setattr(config, "sys", SimpleNamespace(platform="linux"))

MAIN = ["/data/serverfiles/.../SquadGameServer", "SquadGame",
         "-MultiHome=203.0.113.10", "-Port=7787", "-QueryPort=27165"]
TOURNAMENT = ["/data/serverfiles/.../SquadGameServer", "SquadGame",
              "-MultiHome=203.0.113.10", "-Port=7797", "-QueryPort=27175"]


def test_matches_the_game_port():
    assert config._has_game_port(MAIN, 7787)
    assert config._has_game_port(TOURNAMENT, 7797)
    assert not config._has_game_port(MAIN, 7797)


def test_a_query_port_is_not_a_game_port():
    """One server's game port can be another's query port; a substring test
    would then attach the reader to the wrong game entirely."""
    assert not config._has_game_port(["-QueryPort=7787"], 7787)
    assert not config._has_game_port(["-BeaconPort=7787"], 7787)


def test_port_is_matched_whole():
    assert not config._has_game_port(["-Port=77870"], 7787)
    assert not config._has_game_port(["-Port=17787"], 7787)


def test_the_launcher_shell_is_not_mistaken_for_the_game(monkeypatch):
    """LinuxGSM starts the server from `SquadGameServer.sh`, which the kernel
    truncates to a comm of exactly `SquadGameServer` — and which carries the
    same -Port= on its command line. Attaching to that shell finds no game
    mapped, and the unit restarts the reader into the same wall forever."""
    exes = {"4772": "/usr/bin/dash", "4781": "/data/serverfiles/.../SquadGameServer"}
    monkeypatch.setattr(config.os, "listdir", lambda p: ["4772", "4781"])
    monkeypatch.setattr(config.os, "readlink", lambda p: exes[p.split("/")[2]])
    assert config._is_game_binary("4781", "SquadGameServer")
    assert not config._is_game_binary("4772", "SquadGameServer")


def test_an_unidentifiable_process_is_not_attached_to(monkeypatch):
    def boom(_p):
        raise PermissionError

    monkeypatch.setattr(config.os, "readlink", boom)
    assert not config._is_game_binary("4781", "SquadGameServer")


def test_configured_port_wins_over_process_name(monkeypatch):
    monkeypatch.setattr(config, "get",
                        lambda k: 7797 if k == "squad_port" else
                        config.DEFAULTS.get(k))
    monkeypatch.setattr(config, "_pid_by_game_port", lambda proc, port: 4546)
    monkeypatch.setattr(
        config.subprocess, "check_output",
        lambda *a, **k: pytest.fail("fell back to pidof despite squad_port"))
    assert config.find_squad_server_pid() == 4546


def test_a_configured_port_that_is_not_running_is_an_error(monkeypatch):
    """Reading whichever server happens to be up is worse than reading none:
    the matches would publish under another server's name and nobody would
    have a reason to look."""
    monkeypatch.setattr(config, "get",
                        lambda k: 7797 if k == "squad_port" else
                        config.DEFAULTS.get(k))
    monkeypatch.setattr(config, "_pid_by_game_port", lambda proc, port: None)
    with pytest.raises(SystemExit) as ei:
        config.find_squad_server_pid()
    assert "7797" in str(ei.value)
