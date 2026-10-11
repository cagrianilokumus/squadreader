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
    # The game port of the instance THIS agent reads (Squad's ``-Port=``), for
    # boxes running several servers. Unset means "the only one there is", which
    # is resolved by name and is a coin toss the moment there are two. Set it
    # and the choice stops depending on which server happened to start first.
    "squad_port": None,
    # Squad server log the kill-feed tailer reads (glob; ``*`` = any user).
    "squad_log_glob": "/home/*/serverfiles/SquadGame/Saved/Logs/SquadGame.log",
    # Default value of the snapshot ``server`` field and the stats-DB partition
    # key. Override per deployment (e.g. "eu-1") when you run more than one.
    "server_id": "squad",
    # Unlicensed (custom) Squad servers never get a MatchID from OWI's backend,
    # which silently disables BOTH the recorder and the stats store. When true,
    # the agent derives a stable id for those servers instead. Inert on licensed
    # servers, which always supply their own. See sqreader/synth_match.py.
    "synthetic_match_ids": True,
    # False 404s /api/leaderboard and the viewer drops its leaderboard tabs and
    # Top Players panel. Profiles, weapons, the match list and heatmaps stay
    # public, and stats are still recorded either way.
    "leaderboard_public": True,
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
    # Remote-update rollout channel this agent follows. "stable" gets promoted
    # packs/releases; "beta" opts into canary ones first. Reported on each fleet
    # check-in and used by central to decide what (if anything) to serve us.
    "update_channel": "stable",
    # Auto-apply signed offset packs when a Squad patch drifts the reader
    # (self-heal). Verified (Ed25519) → applied → re-checked with doctor → rolled
    # back if it doesn't clear the drift. Only ever active on an enrolled,
    # push-enabled box. Set false to require manual offset updates.
    "offset_autoheal": True,
    # Fetch + verify + apply signed agent code releases (self-update).
    #
    # ON by default, but that default can only ever fire on a box that is
    # ENROLLED and pushing: the check lives inside the fleet check-in, which
    # only runs when a central is configured and reachable. A self-hosted
    # install has no central to fetch from, so the flag is inert there — and
    # remote update is precisely what an operator gets by using squadreader.com
    # instead of running their own. Set false to pin the binary and upgrade by
    # hand.
    #
    # The running reader still never overwrites itself. It stages the verified
    # artifact, waits for a moment with no match in progress, and exits;
    # systemd's ExecStartPre runs `sqreader apply-staged-update`, which does the
    # swap between the two processes and rolls back if the new binary will not
    # boot. See sqreader/updater.py.
    "update_enabled": True,

    # Path to plugins_config.json, for deployments whose start command is not
    # ours to edit - a container entrypoint baked into an image, a unit file
    # someone else manages. `--plugins-config` still wins when it is given.
    # Without either, no plugin is constructed at all.
    "plugins_config": None,

    # Where to announce plugin alerts. A Discord webhook URL, or None to keep
    # them in the database only. This is a CREDENTIAL — anyone holding it can
    # post into that channel — so it lives in the config file rather than in a
    # command line other users on the box can read out of `ps`.
    "alert_webhook": None,
    # Alerts below this confidence are stored but not announced. Detectors are
    # tuned to be noisy on purpose so the evidence is kept; a channel humans
    # actually read wants a higher bar than a table does.
    "alert_min_confidence": 0.0,
    # Base URL used to build "watch the replay" links, e.g.
    # "https://squadreader.com". Without it an alert still arrives, just
    # without a way to go and look at it.
    "alert_replay_base": None,
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


def _has_game_port(args: list[str], port: int) -> bool:
    """Whether a command line names ``port`` as Squad's GAME port.

    ``-QueryPort=`` and ``-BeaconPort=`` carry port numbers too, so the argument
    is matched whole rather than searched for: on a box where one server's game
    port is another's query port, a substring test picks the wrong game.
    """
    want = f"port={port}"
    return any(a.lstrip("-/").lower() == want for a in args)


def _is_game_binary(pid: str, proc: str) -> bool:
    """Whether ``pid`` IS the game server rather than something that starts it.

    Not a `comm` check: the kernel truncates comm to 15 bytes, so LinuxGSM's
    ``SquadGameServer.sh`` launcher reports exactly ``SquadGameServer`` — the
    same as the binary — and carries the same ``-Port=`` on its command line.
    Attaching to that shell finds no game module mapped and the reader dies on
    startup, over and over, because the unit restarts it.

    The exe link is what separates them: the launcher's resolves to a shell.
    Unreadable means no, since a reader that cannot identify its target has no
    business attaching to it.
    """
    try:
        return os.path.basename(os.readlink(f"/proc/{pid}/exe")) == proc
    except OSError:
        return False


def _pid_by_game_port(proc: str, port: int) -> int | None:
    """PID of the ``proc`` instance started with Squad's ``-Port=<port>``."""
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/cmdline") as f:
                args = f.read().split("\0")
        except OSError:
            continue
        if _has_game_port(args, port) and _is_game_binary(entry, proc):
            return int(entry)
    return None


def find_squad_server_pid() -> int:
    """Resolve the Squad dedicated-server PID.

    ``squad_port`` decides it outright when set — the only answer that does not
    depend on start order, and the only one worth trusting on a box running more
    than one server. Missing is an error rather than a fallback: reading a
    server the operator did not ask for is worse than reading none, because
    every match it publishes lands under the wrong server's name.

    Without it:

    1. ``pidof -s <process>`` — the reliable path (same as the systemd unit's
       ``--pid $(pidof ...)``).
    2. pgrep the configured install pattern, preferring the instance carrying a
       ``Port=`` argument (multi-instance boxes).
    3. Generic ``/proc`` scan matching ``comm`` EXACTLY == ``<process>`` — skips
       the tmux / launch-shell wrappers that carry the name in their cmdline but
       map no SquadGameServer module.

    Note that 1 answers first and answers arbitrarily when several are running,
    so 2's multi-instance filter is only ever reached once `pidof` has failed.
    That is why ``squad_port`` exists rather than a smarter pattern.
    """
    proc = get("squad_process_name")
    pattern = get("squad_binary_pattern")
    port = get("squad_port")
    if port:
        pid = _pid_by_game_port(proc, int(port))
        if pid is not None:
            return pid
        raise SystemExit(f"no {proc} running with -Port={port} "
                         f"(squad_port is set, so no other instance will do)")
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
