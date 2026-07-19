"""Fleet telemetry — what each enrolled agent tells central about itself.

Phase 0 of the remote-update system. On a periodic sealed check-in the agent
reports its version, the Squad BUILD it is attached to, and its reader HEALTH
(the `doctor` drift signal from `health.run_doctor`). Central records this so an
operator can answer, in one glance after a Squad patch, "which of my enrolled
servers just broke, and what are they running?" — the prerequisite for targeting
an offset pack (Phase 1) or a code release (Phase 2) at the servers that need it.

This module only ASSEMBLES the telemetry dict and keeps the restart counter;
`ingest_client.checkin()` seals + sends it over the same per-agent envelope as a
match push. Same opt-in boundary as push (only enrolled, push-enabled boxes
report), and best-effort — a failed check-in never touches the live reader.
"""
from __future__ import annotations

import platform
from pathlib import Path
from typing import Any

from . import __version__, health, squad_build

SCHEMA_CHECKIN = "sqr-checkin-1"
# 5-minute cadence: frequent enough to see a fleet-wide breakage within minutes
# of a Squad patch, rare enough to be free. Covers IDLE servers too — a box that
# never finishes a match still reports its health on this timer.
CHECKIN_INTERVAL_SEC = 300.0


def bump_restarts(state_dir: str | Path) -> int:
    """Increment + return a persistent boot counter. Each serve start is a
    restart under systemd `Restart=always`, so a climbing count is the signal of
    a crash-looping reader. Best-effort; never raises."""
    p = Path(state_dir) / ".sqr_restarts"
    try:
        n = int(p.read_text(encoding="ascii").strip()) + 1
    except (OSError, ValueError):
        n = 1
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(str(n), encoding="ascii")
    except OSError:
        pass
    return n


def gather(pm: Any, arr: Any, alloc: Any, *, build_sha: str | None,
           restarts: int, uptime_sec: float, channel: str) -> dict[str, Any]:
    """Assemble the check-in telemetry over the reader's own open handles.

    `health.run_doctor` walks the live class layouts (cheap) and classifies the
    reader as ok / drift / unknown; a `drift` server is one a Squad patch broke.
    The drift list is capped so a totally-broken reader can't send a huge body.
    """
    doc = health.run_doctor(pm, arr, alloc)
    return {
        "schema": SCHEMA_CHECKIN,
        "agent_version": __version__,
        "platform": platform.system(),
        "squad_build": build_sha,
        "engine": squad_build.engine_version(pm, arr, alloc),
        "health": doc.get("state", "unknown"),      # ok | drift | unknown
        "drift": (doc.get("drift") or [])[:20],
        "restarts": int(restarts),
        "uptime_sec": int(uptime_sec),
        "channel": channel,
    }
