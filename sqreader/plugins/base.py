"""The plugin contract.

A plugin is a small piece of logic that gets handed every snapshot the reader
produces and may raise an alert about it. That is all. It does not get to change
the snapshot, it does not get to stop the reader, and it does not get its own
thread.

Two invariants, both load-bearing:

1. **`on_tick` must never raise.** The registry catches anyway — a plugin bug is
   not allowed to cost a tick — but a plugin that leans on that fills the log
   with noise and hides real faults. Handle your own errors.

2. **`ctx.snapshot` is read-only.** It is the same dict that was already
   published to every SSE subscriber and written to the .sqrx. Mutating it here
   would rewrite history that has already left the building.

Plugins run on the serve thread, in the tick loop, after stats. That is
deliberate: it means `emit_alert` shares the StatsStore's connection and needs no
locking, and it means a slow plugin shows up as reader lag rather than as a
silent backlog on some other thread. The budget is the tick interval (~2 s in
production) — a plugin that wants a slower cadence gates itself on `ctx.tick`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass(frozen=True)
class TickContext:
    """What a plugin sees. One per tick."""

    #: The published snapshot. NEVER mutate — see the module docstring.
    snapshot: dict
    #: Which Squad server this is (matters once alerts are shared).
    server_id: str
    #: Monotonic tick counter from the reader loop.
    tick: int
    #: Wall-clock epoch seconds for this tick.
    now: float
    #: gameState.matchState, or None if it could not be read.
    match_state: Optional[str] = None
    #: gameState.matchId, or None. Alerts carry it so they can be joined to a
    #: recording later.
    match_id: Optional[str] = None
    #: Persist an alert. Never raises: a failed write costs the alert, not the
    #: tick. Injected by the manager.
    emit_alert: Callable[[dict], None] = field(default=lambda _a: None)

    def players(self) -> list[dict]:
        return self.snapshot.get("players") or []

    def damage_events(self) -> list[dict]:
        return self.snapshot.get("damageEvents") or []

    def vehicles(self) -> list[dict]:
        return self.snapshot.get("vehicles") or []

    def game_state(self) -> dict:
        return self.snapshot.get("gameState") or {}


class Plugin:
    """Base class. Subclass, set the class attributes, implement `on_tick`."""

    #: Stable key. This is what plugins_config.json keys on — renaming it
    #: silently disables the plugin on every deployment that configured it.
    PLUGIN_ID: str = ""
    LABEL: str = ""
    DESCRIPTION: str = ""
    #: Defaults, overlaid by the `config` block in plugins_config.json. Anything
    #: tunable belongs here rather than as a constant in the body — an operator
    #: should be able to move a threshold without a redeploy.
    DEFAULT_CONFIG: dict[str, Any] = {}

    def __init__(self, config: Optional[dict] = None) -> None:
        cfg = dict(self.DEFAULT_CONFIG)
        cfg.update(config or {})
        self.config = cfg

    def on_tick(self, ctx: TickContext) -> None:
        raise NotImplementedError

    # -- convenience -------------------------------------------------------
    def alert(self, ctx: TickContext, *, alert_type: str,
              eos_id: Optional[str] = None,
              player_name: Optional[str] = None,
              confidence: Optional[float] = None,
              details: Optional[dict] = None) -> None:
        ctx.emit_alert({
            "ts": ctx.now,
            "tick": ctx.tick,
            "plugin_id": self.PLUGIN_ID,
            "alert_type": alert_type,
            "eos_id": eos_id,
            "player_name": player_name,
            "match_id": ctx.match_id,
            "confidence": confidence,
            "details": details or {},
        })


__all__ = ["Plugin", "TickContext"]
