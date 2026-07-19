"""Remote offset self-heal client (Phase 1).

When a Squad patch drifts the reader's hardcoded offsets, the agent fetches a
SIGNED offset pack from central, verifies it, and applies it at runtime — no code
redeploy. This module is the PURE, testable layer: fetch + verify + persistence.
The serve loop drives the apply → `doctor` → commit / rollback over the live
reader, using `squad.snapshot.apply_offset_overrides` / `revert_offset_overrides`.

Verification is fail-closed and layered (see `accept`): a pack is only trusted if
it (a) targets OUR Squad build, (b) is a NEWER version than what we've applied,
and (c) carries a valid Ed25519 signature under the baked-in trust key. A leaked
per-agent transport secret cannot forge one, because the signature is checked
against the offline key, not the transport.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import ingest_client, update_sign, update_trust

_ACTIVE_FILE = "offsets.active.json"


def accept(pack: Any, *, squad_build: str, min_version: int) -> dict[str, Any] | None:
    """Verify a fetched pack. Returns ``{"version": int, "offsets": {name: int}}``
    iff it is trusted (valid Ed25519 signature), for OUR ``squad_build``, and a
    version strictly greater than ``min_version``. Fail-closed: any problem → None
    (never raises)."""
    if not isinstance(pack, dict):
        return None
    if str(pack.get("squad_build") or "") != squad_build:
        return None
    try:
        version = int(pack.get("version"))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if version <= int(min_version):
        return None
    if not update_sign.verify(update_trust.EMBEDDED_ED25519_PUBKEY_B64, pack):
        return None
    offsets = pack.get("offsets")
    if not isinstance(offsets, dict) or not offsets:
        return None
    # every value must be a plain int (bool is an int subclass — exclude it)
    if not all(isinstance(v, int) and not isinstance(v, bool)
               for v in offsets.values()):
        return None
    return {"version": version, "offsets": dict(offsets)}


def fetch_and_accept(creds: dict[str, str], squad_build: str, channel: str,
                     min_version: int, *, seq: int,
                     timeout: float = 15.0) -> dict[str, Any] | None:
    """Fetch central's current pack for our build+channel and verify it in one
    call. None if nothing acceptable is offered or central is unreachable."""
    try:
        pack = ingest_client.fetch_offsets(creds, squad_build, channel,
                                           seq=seq, timeout=timeout)
    except ingest_client.PushError:
        return None
    return accept(pack, squad_build=squad_build, min_version=min_version)


# -- persistence: the committed pack survives a restart --------------------

def _path(state_dir: str | Path) -> Path:
    return Path(state_dir) / _ACTIVE_FILE


def load_active(state_dir: str | Path) -> dict[str, Any] | None:
    """The committed pack ``{squad_build, version, offsets}``, or None."""
    try:
        d = json.loads(_path(state_dir).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def active_offsets_for(state_dir: str | Path,
                       squad_build: str) -> dict[str, Any] | None:
    """The committed pack ONLY if it targets the CURRENT build. A committed pack
    from a previous Squad version must never be applied to a new binary."""
    d = load_active(state_dir)
    if (d and str(d.get("squad_build") or "") == squad_build
            and isinstance(d.get("offsets"), dict)):
        return d
    return None


def active_version(state_dir: str | Path, squad_build: str) -> int:
    """Highest committed pack version for this build (0 if none) — the monotonic
    floor `accept` enforces so an old pack can't replay over a newer one."""
    d = active_offsets_for(state_dir, squad_build)
    try:
        return int(d["version"]) if d else 0
    except (TypeError, ValueError, KeyError):
        return 0


def save_active(state_dir: str | Path, squad_build: str, version: int,
                offsets: dict[str, Any]) -> None:
    """Commit an applied pack (atomic write) so it re-applies at next boot."""
    p = _path(state_dir)
    tmp = p.with_name(p.name + ".tmp")
    tmp.write_text(json.dumps({"squad_build": squad_build, "version": int(version),
                               "offsets": offsets}, separators=(",", ":")),
                   encoding="utf-8")
    tmp.replace(p)


def clear_active(state_dir: str | Path) -> None:
    try:
        _path(state_dir).unlink()
    except OSError:
        pass
