"""Agent code self-update client (Phase 2).

Fetches a SIGNED release manifest from central, verifies it (Ed25519 + our
platform + it is actually NEWER than the running version + a downgrade guard),
downloads the artifact and verifies its sha256, then STAGES it to disk. The
actual install + restart is a deliberate SEPARATE step (`sqreader
apply-staged-update`, run by the deploy/systemd layer) — the live reader never
pip-installs or replaces itself mid-run, which keeps a running match safe.

Opt-in via config `update_enabled` (default false). Verification is fail-closed
and mirrors the offset-pack path: a leaked per-agent transport secret cannot
forge a release, because the manifest is Ed25519-signed under the OFFLINE key and
the artifact is sha256-pinned by that signed manifest.
"""
from __future__ import annotations

import hashlib
import json
import platform
import re
from pathlib import Path
from typing import Any

from . import __version__, ingest_client, update_sign, update_trust

_STAGED_MARKER = "pending_release.json"
_ARTIFACT_RE = re.compile(r"[A-Za-z0-9._-]{1,128}")


def platform_name() -> str:
    """The platform token central routes releases by ("linux" on the servers)."""
    return "linux" if platform.system() == "Linux" else platform.system().lower()


def _ver_tuple(v: str) -> tuple[int, ...]:
    """Best-effort numeric version tuple for comparison. Non-numeric suffixes on a
    part (e.g. "1.2.0rc1") stop at the first non-digit; empty parts count as 0, so
    an odd version never raises — it just sorts conservatively."""
    out: list[int] = []
    for part in str(v).split("."):
        digits = ""
        for ch in part:
            if ch.isdigit():
                digits += ch
            else:
                break
        out.append(int(digits) if digits else 0)
    return tuple(out)


def is_newer(candidate: str, current: str) -> bool:
    return _ver_tuple(candidate) > _ver_tuple(current)


def accept(manifest: Any, *, current_version: str, min_applied: str,
           this_platform: str) -> dict[str, Any] | None:
    """Verify a fetched manifest. Returns ``{version, artifact, sha256}`` iff it is
    trusted (valid Ed25519 signature), for OUR platform, strictly NEWER than the
    running version, and newer than the highest version already staged (downgrade
    guard). Fail-closed: any problem → None (never raises)."""
    if not isinstance(manifest, dict):
        return None
    if str(manifest.get("platform") or "linux") != this_platform:
        return None
    version = str(manifest.get("version") or "")
    if not version or not is_newer(version, current_version):
        return None
    if min_applied and not is_newer(version, min_applied):
        return None
    artifact = str(manifest.get("artifact") or "")
    sha = str(manifest.get("sha256") or "")
    if not _ARTIFACT_RE.fullmatch(artifact) or len(sha) != 64:
        return None
    if not update_sign.verify(update_trust.EMBEDDED_ED25519_PUBKEY_B64, manifest):
        return None
    return {"version": version, "artifact": artifact, "sha256": sha}


def fetch_and_accept(creds: dict[str, str], channel: str, *, seq: int,
                     timeout: float = 15.0,
                     min_applied: str = "") -> dict[str, Any] | None:
    """Fetch central's current manifest for our platform+channel and verify it."""
    try:
        manifest = ingest_client.fetch_manifest(creds, platform_name(), channel,
                                                 seq=seq, timeout=timeout)
    except ingest_client.PushError:
        return None
    return accept(manifest, current_version=__version__, min_applied=min_applied,
                  this_platform=platform_name())


def download_verified(creds: dict[str, str], artifact: str, sha256: str, *,
                      timeout: float = 300.0) -> bytes | None:
    """Download the artifact and verify its sha256. None on any failure."""
    try:
        data = ingest_client.download_artifact(creds, artifact, timeout=timeout)
    except ingest_client.PushError:
        return None
    if not data or hashlib.sha256(data).hexdigest() != sha256:
        return None
    return data


# -- staging: the verified artifact waits for the explicit apply step ------

def stage(state_dir: str | Path, version: str, artifact: str, data: bytes) -> Path:
    """Write the verified artifact + a pending marker under state_dir/staged/.
    Returns the staged artifact path. Install is a separate explicit step so the
    live reader is never replaced mid-run."""
    d = Path(state_dir) / "staged"
    d.mkdir(parents=True, exist_ok=True)
    art_path = d / artifact
    tmp = art_path.with_name(art_path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(art_path)
    marker = Path(state_dir) / _STAGED_MARKER
    mtmp = marker.with_name(marker.name + ".tmp")
    mtmp.write_text(json.dumps({"version": version, "artifact": artifact,
                                "path": str(art_path)}, separators=(",", ":")),
                    encoding="utf-8")
    mtmp.replace(marker)
    return art_path


def staged(state_dir: str | Path) -> dict[str, Any] | None:
    """The pending staged release ``{version, artifact, path}``, or None."""
    try:
        d = json.loads((Path(state_dir) / _STAGED_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return d if isinstance(d, dict) else None


def staged_version(state_dir: str | Path) -> str:
    d = staged(state_dir)
    return str(d.get("version")) if d else ""


def clear_staged(state_dir: str | Path) -> None:
    try:
        (Path(state_dir) / _STAGED_MARKER).unlink()
    except OSError:
        pass
