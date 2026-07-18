"""Plugin registry and per-tick runner.

Adapted from the Squad-Replay project's `plugins/` framework, minus the parts
that only exist for a multi-server deployment (per-server enable lists, an RCON
handle, a separate ticker thread). sqreader watches one server from inside its
own process, so a plugin is just a function of the tick.

Config (`--plugins-config`) is a flat JSON object:

    {
      "cheat_detect": {
        "enabled": true,
        "config": { "speed_threshold_ms": 18.0 }
      }
    }

A plugin that is absent from the file, or `enabled: false`, is not constructed at
all. An unreadable or malformed file disables every plugin and says so — it never
takes the reader down with it.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Callable, Optional

from .base import Plugin, TickContext

log = logging.getLogger(__name__)

# plugin_id -> class. Populated by @register at import time.
PLUGIN_CLASSES: dict[str, type[Plugin]] = {}


def register(cls: type[Plugin]) -> type[Plugin]:
    if not cls.PLUGIN_ID:
        raise ValueError(f"{cls.__name__} has no PLUGIN_ID")
    PLUGIN_CLASSES[cls.PLUGIN_ID] = cls
    return cls


def load_config(path: Optional[Path]) -> dict[str, dict]:
    """Read plugins_config.json. Any problem -> {} (every plugin off).

    Config is an operator convenience, not a dependency: a typo in it must cost
    the plugins, never the reader.
    """
    if path is None:
        return {}
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        log.warning("config unreadable (%r) — all plugins disabled", e)
        return {}
    if not isinstance(raw, dict):
        log.warning("config is not a JSON object — all plugins disabled")
        return {}
    out: dict[str, dict] = {}
    for pid, block in raw.items():
        if not isinstance(block, dict):
            continue
        out[str(pid)] = {
            "enabled": bool(block.get("enabled", False)),
            "config": block.get("config") if isinstance(
                block.get("config"), dict) else {},
        }
    return out


class PluginManager:
    """Holds the live plugin instances and runs them once per tick.

    Instances are long-lived on purpose: a detector's whole job is to notice
    something *across* ticks (a speed sustained over five samples, ammo that
    never drops), so its counters and cooldowns have to survive between calls.
    """

    def __init__(self, config: dict[str, dict], *, server_id: str,
                 emit_alert: Optional[Callable[[dict], None]] = None) -> None:
        self.server_id = server_id
        self._emit = emit_alert
        self.plugins: dict[str, Plugin] = {}
        self.errors: dict[str, int] = {}
        self.alerts: dict[str, int] = {}
        self.ticks = 0
        self.last_error: dict[str, str] = {}

        for pid, block in config.items():
            if not block.get("enabled"):
                continue
            cls = PLUGIN_CLASSES.get(pid)
            if cls is None:
                log.warning("no such plugin %r — skipped", pid)
                continue
            try:
                self.plugins[pid] = cls(block.get("config") or {})
                self.errors[pid] = 0
                self.alerts[pid] = 0
            except Exception as e:
                log.warning("%s failed to construct: %r", pid, e)

    # -- alert plumbing ----------------------------------------------------
    def _alert_sink(self, pid: str) -> Callable[[dict], None]:
        def sink(row: dict) -> None:
            self.alerts[pid] = self.alerts.get(pid, 0) + 1
            if self._emit is None:
                return
            try:
                self._emit(row)
            except Exception as e:
                # An alert we could not store is a lost alert, not a lost tick.
                log.warning("%s alert not stored: %r", pid, e)
        return sink

    # -- the tick ----------------------------------------------------------
    def run_tick(self, snapshot: dict, *, tick: int,
                 now: Optional[float] = None) -> None:
        """Run every enabled plugin against one snapshot.

        Each plugin is contained on its own: one that raises is counted, logged,
        and skipped, and the next one still runs. The caller wraps this whole
        call in its own try/except as well — two layers, because the thing being
        protected is a live memory reader that must not miss a tick.
        """
        if not self.plugins:
            return
        self.ticks += 1
        gs = snapshot.get("gameState") or {}
        ts = now if now is not None else time.time()
        for pid, plugin in self.plugins.items():
            ctx = TickContext(
                snapshot=snapshot,
                server_id=self.server_id,
                tick=tick,
                now=ts,
                match_state=gs.get("matchState"),
                match_id=gs.get("matchId"),
                emit_alert=self._alert_sink(pid),
            )
            try:
                plugin.on_tick(ctx)
            except Exception as e:
                self.errors[pid] = self.errors.get(pid, 0) + 1
                self.last_error[pid] = repr(e)
                log.exception("[tick %d] plugin %s error: %r", tick, pid, e)

    def stats(self) -> dict[str, Any]:
        """Surfaced at /health/deep — 'is a plugin quietly failing every tick?'"""
        return {
            "ticks": self.ticks,
            "plugins": {
                pid: {
                    "label": p.LABEL or pid,
                    "errors": self.errors.get(pid, 0),
                    "alerts": self.alerts.get(pid, 0),
                    "lastError": self.last_error.get(pid),
                }
                for pid, p in self.plugins.items()
            },
        }


# Importing a plugin module is what registers it.
from . import cheat_detect  # noqa: E402,F401  (import for side effect)

__all__ = [
    "PLUGIN_CLASSES", "Plugin", "PluginManager", "TickContext",
    "load_config", "register",
]
