"""Machine-specific runtime configuration.

The reader is driven by CLI flags first; anything not passed falls back to this
config, and anything not in the config falls back to a built-in default. So a
stranger on a standard box needs NO config at all — the Squad server is found by
its process name and output dirs default next to the repo. Only non-standard
setups (an install path outside ``/home/<user>/serverfiles``, a custom server
id) need a ``sqreader.config.json`` — copy ``sqreader.config.example.json``.

Resolution order for every key:  CLI flag  >  sqreader.config.json  >  DEFAULTS.
The config file is located via ``$SQREADER_CONFIG``, else ``./sqreader.config.json``.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    # The Squad dedicated-server binary name. This is a Squad constant (the same
    # on every install), exposed only so an exotic rename can be handled without
    # editing source.
    "squad_process_name": "SquadGameServer",
    # pgrep -f regex, used ONLY to pick the right instance on a multi-instance
    # box. ``.*`` matches any user / any path by default, so single-instance
    # boxes never need to touch this.
    "squad_binary_pattern": r"/home/.*/serverfiles/.*SquadGameServer",
    # Squad server log the kill-feed tailer reads (glob; ``*`` = any user).
    "squad_log_glob": "/home/*/serverfiles/SquadGame/Saved/Logs/SquadGame.log",
    # Default value of the snapshot ``server`` field and the stats-DB partition
    # key. Override per deployment (e.g. "eu-1") when you run more than one.
    "server_id": "squad",
    # --- optional central push (OFF by default; opt-in via `sqreader enroll`) ---
    # If set + the box is enrolled (see agent_creds/.env.agent), finished-match
    # stats + .sqrx replays are pushed to this central. NON-SECRET keys only —
    # the enrollment secret lives in the 0600 .env.agent, never here.
    "central_url": None,
    # Master switch. Even when enrolled, push is skipped unless this is true (or
    # `serve --push` is passed). Keeps a fresh install fully local.
    "push_enabled": False,
    # Whether to also upload the match's .sqrx replay (not just the stats).
    "push_replay": True,
    # Where the pending-push queue lives; default is next to the stats DB.
    "push_backlog_dir": None,
}

_cache: dict[str, Any] | None = None


def _load() -> dict[str, Any]:
    global _cache
    if _cache is not None:
        return _cache
    cfg = dict(DEFAULTS)
    env = os.environ.get("SQREADER_CONFIG")
    path = Path(env) if env else Path.cwd() / "sqreader.config.json"
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                # Skip `_comment` annotation keys used in the example file.
                cfg.update({k: v for k, v in data.items()
                            if not k.startswith("_")})
        except (OSError, ValueError):
            pass
    _cache = cfg
    return cfg


def get(key: str) -> Any:
    """Config value for ``key`` (config file overrides the built-in default)."""
    return _load().get(key, DEFAULTS.get(key))


def find_squad_server_pid() -> int:
    """Resolve the Squad dedicated-server PID.

    1. ``pidof -s <process>`` — the reliable path (same as the systemd unit's
       ``--pid $(pidof ...)``).
    2. pgrep the configured install pattern, preferring the instance carrying a
       ``Port=`` argument (multi-instance boxes).
    3. Generic ``/proc`` scan matching ``comm`` EXACTLY == ``<process>`` — skips
       the tmux / launch-shell wrappers that carry the name in their cmdline but
       map no SquadGameServer module.
    """
    proc = get("squad_process_name")
    pattern = get("squad_binary_pattern")
    # 1. pidof — same resolver the service uses.
    try:
        out = subprocess.check_output(["pidof", "-s", proc], text=True).strip()
        if out:
            return int(out.split()[0])
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        pass
    # 2. configured install pattern (Port= filter for multi-instance).
    try:
        pids = subprocess.check_output(
            ["pgrep", "-f", pattern], text=True).strip().splitlines()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pids = []
    for s in pids:
        try:
            if "Port=" in open(f"/proc/{s}/cmdline").read():
                return int(s)
        except (FileNotFoundError, ValueError):
            pass
    # 3. Generic /proc scan — comm EXACT match (skips tmux/sh wrappers).
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/comm") as f:
                comm = f.read().strip()
        except OSError:
            continue
        if comm == proc:
            return int(entry)
    raise SystemExit(f"no {proc} process running")


__all__ = ["DEFAULTS", "get", "find_squad_server_pid"]
