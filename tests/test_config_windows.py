"""Which Windows process the reader attaches to.

The policy (`_pick_windows_pid`) takes plain tuples and makes no OS call, so
it runs on every platform. The trap it exists for: a packaged Squad server on
Windows runs a launcher and the real game under the same file name.
"""
from __future__ import annotations

import pytest

from sqreader.config import _is_game_binary_windows, _pick_windows_pid

PROC = "SquadGameServer"
ROOT = r"C:\servers\squad"
LAUNCHER = ROOT + r"\SquadGameServer.exe"
GAME = ROOT + r"\SquadGame\Binaries\Win64\SquadGameServer.exe"
ROOT2 = r"D:\squad2"
GAME2 = ROOT2 + r"\SquadGame\Binaries\Win64\SquadGameServer.exe"
ARGS = ["SquadGameServer.exe", "Port=7787", "QueryPort=27165", "-log"]
ARGS2 = ["SquadGameServer.exe", "Port=7797", "QueryPort=7787", "-log"]


def test_launcher_is_not_the_game():
    assert _is_game_binary_windows(GAME, PROC)
    assert not _is_game_binary_windows(LAUNCHER, PROC)


def test_name_match_is_case_insensitive_and_slash_agnostic():
    assert _is_game_binary_windows(GAME.upper(), PROC)
    assert _is_game_binary_windows(GAME.replace("\\", "/"), PROC)


def test_unreadable_or_foreign_image_is_not_the_game():
    assert not _is_game_binary_windows(None, PROC)
    assert not _is_game_binary_windows("", PROC)
    assert not _is_game_binary_windows(ROOT + r"\Binaries\Win64\other.exe", PROC)


def test_picks_the_game_over_its_launcher():
    # The launcher starts first, so it is listed first; it must still lose.
    cands = [(100, LAUNCHER, ARGS), (200, GAME, ARGS)]
    assert _pick_windows_pid(cands, PROC, None) == 200


def test_port_selects_among_several_servers():
    cands = [(100, LAUNCHER, ARGS), (200, GAME, ARGS),
             (300, ROOT2 + r"\SquadGameServer.exe", ARGS2), (400, GAME2, ARGS2)]
    assert _pick_windows_pid(cands, PROC, 7787) == 200
    # 7787 is ALSO server 2's QueryPort: matched whole, never as a substring.
    assert _pick_windows_pid(cands, PROC, 7797) == 400


def test_port_set_but_absent_is_an_error_not_a_fallback():
    cands = [(200, GAME, ARGS)]
    with pytest.raises(SystemExit, match="-Port=9999"):
        _pick_windows_pid(cands, PROC, 9999)


def test_port_set_ignores_a_launcher_carrying_it():
    cands = [(100, LAUNCHER, ARGS)]
    with pytest.raises(SystemExit):
        _pick_windows_pid(cands, PROC, 7787)


def test_no_game_running():
    with pytest.raises(SystemExit, match="no SquadGameServer process running"):
        _pick_windows_pid([(100, LAUNCHER, ARGS)], PROC, None)
    with pytest.raises(SystemExit):
        _pick_windows_pid([], PROC, None)


def test_without_port_prefers_an_instance_started_with_one():
    cands = [(200, GAME, ["SquadGameServer.exe", "-log"]), (400, GAME2, ARGS2)]
    assert _pick_windows_pid(cands, PROC, None) == 400


def test_without_port_unreadable_cmdline_still_attaches():
    assert _pick_windows_pid([(200, GAME, None)], PROC, None) == 200


def test_a_config_written_with_a_bom_is_still_read(tmp_path, monkeypatch):
    """Windows PowerShell 5.1 writes UTF-8 with a BOM. Read as plain utf-8 the
    file failed to parse and was IGNORED: squad_port silently fell back to
    "any server", which on a shared machine means someone else's."""
    from sqreader import config
    cfg = tmp_path / "sqreader.config.json"
    cfg.write_bytes(b"\xef\xbb\xbf" + b'{"squad_port": 11271, "server_id": "bf"}')
    monkeypatch.setenv("SQREADER_CONFIG", str(cfg))
    monkeypatch.setattr(config, "_cache", None)
    assert config.get("squad_port") == 11271
    assert config.get("server_id") == "bf"
    monkeypatch.setattr(config, "_cache", None)    # do not leak into other tests
