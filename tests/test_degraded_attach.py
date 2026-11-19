"""The agent stays reachable when it cannot read the game.

This is the failure that would otherwise force "log into your server and paste
this" — and it is the one that arrives everywhere at once. `_open_pipeline`
raises when Squad is not running, and it raises when a Squad patch moves what
the reader reads; it ran before anything that talks to central, so the agent
died, systemd restarted it, and it died again. Silently. The channel built to
push the fix was severed by the fault it existed to fix.

What is pinned down here is that a failed attach keeps the box audible and
fixable: it reports itself, it can take an offset pack, and it can take a
release.
"""
import types

import pytest

import sqreader
from sqreader import cli, fleet


class _Args:
    pid = 999999
    no_metadata = True
    stats_db = None


def _fail_then(monkeypatch, failures, result=("pid", "pm", "arr", "al", "p", "m")):
    """Make the attach fail `failures` times, then succeed."""
    calls = {"n": 0}

    def fake(pid, *, with_metadata=True):
        calls["n"] += 1
        if calls["n"] <= failures:
            raise SystemExit("no SquadGameServer process running")
        return result

    monkeypatch.setattr(cli, "_open_pipeline", fake)
    monkeypatch.setattr(cli.time, "sleep", lambda s: None)
    return calls


def test_a_missing_game_server_no_longer_kills_the_agent(monkeypatch):
    calls = _fail_then(monkeypatch, 3)
    monkeypatch.setattr(cli, "_is_compiled", lambda: False)

    got = cli._open_pipeline_or_wait(_Args(), state_dir=None,
                                     channel="stable", started=0.0)

    assert got[0] == "pid"
    assert calls["n"] == 4, "it must keep trying, not give up"


def test_it_reports_itself_while_it_cannot_see_the_game(monkeypatch, tmp_path):
    """A crash-looping agent that says nothing is indistinguishable from one
    nobody installed. `health=down` is what makes it findable."""
    _fail_then(monkeypatch, 1)
    sent = []
    fake_ic = types.SimpleNamespace(
        current_creds=lambda: {"SQREADER_AGENT_ID": "a"},
        default_backlog_dir=lambda d: tmp_path,
        checkin=lambda creds, telem, seq: sent.append(telem),
        _next_seq=lambda b: 1)
    monkeypatch.setattr(sqreader, "ingest_client", fake_ic)
    monkeypatch.setattr(cli.config, "get",
                        lambda k: False if k in ("offset_autoheal",
                                                 "update_enabled") else "stable")

    cli._open_pipeline_or_wait(_Args(), state_dir=tmp_path,
                               channel="stable", started=0.0)

    assert len(sent) == 1
    assert sent[0]["health"] == "down"
    assert "SquadGameServer" in sent[0]["drift"][0]


def test_offline_telemetry_is_the_same_shape_as_normal(monkeypatch):
    """Central parses one check-in schema. A degraded agent that sent a
    different shape would be dropped at the door, which is the same silence
    this whole thing exists to end."""
    off = fleet.gather_offline(reason="boom", build_sha=None, restarts=2,
                               uptime_sec=9, channel="stable")

    for key in ("schema", "agent_version", "platform", "squad_build", "engine",
                "health", "drift", "restarts", "uptime_sec", "channel"):
        assert key in off, key
    assert off["health"] == "down"
    assert off["drift"] == ["boom"]


def test_a_reason_cannot_be_a_flood(monkeypatch):
    off = fleet.gather_offline(reason="x" * 5000, build_sha=None, restarts=0,
                               uptime_sec=0, channel="stable")
    assert len(off["drift"][0]) <= 200


def test_it_restarts_itself_to_install_a_release(monkeypatch, tmp_path):
    """With no match to protect, a degraded agent applies a release at once —
    which is how a fleet that cannot attach gets a fix without anyone touching
    a server."""
    _fail_then(monkeypatch, 5)
    fake_ic = types.SimpleNamespace(
        current_creds=lambda: {"SQREADER_AGENT_ID": "a"},
        default_backlog_dir=lambda d: tmp_path,
        checkin=lambda *a, **k: None,
        _next_seq=lambda b: 1)
    monkeypatch.setattr(sqreader, "ingest_client", fake_ic)
    monkeypatch.setattr(cli.config, "get",
                        lambda k: True if k == "update_enabled" else
                        (False if k == "offset_autoheal" else "stable"))
    monkeypatch.setattr(cli, "_is_compiled", lambda: True)
    monkeypatch.setattr(cli, "_self_update_supported", lambda: True)
    fake_up = types.SimpleNamespace(
        running_binary=lambda **k: tmp_path / "sqreader",
        staged_version=lambda d: "",
        fetch_and_accept=lambda *a, **k: {"version": "9.9.9", "artifact": "x",
                                          "sha256": "s"},
        download_verified=lambda *a, **k: b"bytes",
        stage=lambda *a, **k: None)
    monkeypatch.setattr(sqreader, "updater", fake_up)

    with pytest.raises(SystemExit) as ei:
        cli._open_pipeline_or_wait(_Args(), state_dir=tmp_path,
                                   channel="stable", started=0.0)

    assert ei.value.code == 0, "exit 0 so systemd restarts into the new binary"


def test_where_a_release_cannot_be_installed_it_is_not_fetched(monkeypatch,
                                                               tmp_path):
    """Windows: nothing can swap the binary, so staging a release would only
    restart the agent into the same version, forever. It keeps waiting for the
    game instead, and never asks central for a release."""
    _fail_then(monkeypatch, 2)
    fake_ic = types.SimpleNamespace(
        current_creds=lambda: {"SQREADER_AGENT_ID": "a"},
        default_backlog_dir=lambda d: tmp_path,
        checkin=lambda *a, **k: None,
        _next_seq=lambda b: 1)
    monkeypatch.setattr(sqreader, "ingest_client", fake_ic)
    monkeypatch.setattr(cli.config, "get",
                        lambda k: True if k == "update_enabled" else
                        (False if k == "offset_autoheal" else "stable"))
    monkeypatch.setattr(cli, "_is_compiled", lambda: True)
    monkeypatch.setattr(cli, "_self_update_supported", lambda: False)
    fake_up = types.SimpleNamespace(
        running_binary=lambda **k: tmp_path / "sqreader",
        staged_version=lambda d: "",
        fetch_and_accept=lambda *a, **k: pytest.fail("fetched a release"))
    monkeypatch.setattr(sqreader, "updater", fake_up)

    got = cli._open_pipeline_or_wait(_Args(), state_dir=tmp_path,
                                     channel="stable", started=0.0)
    assert got[0] == "pid"
