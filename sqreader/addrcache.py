"""
Persistent cache of discovered UE global addresses, keyed by the target
binary's identity.

Discovery (signature-scanning the heap for GUObjectArray / FNamePool)
costs 20-30 s on a populated server. Those addresses only move when the
Squad binary itself changes: SquadGameServer is a non-PIE executable, so
its global VAs are fixed across restarts AND across every instance of the
same binary. We therefore persist the last known-good addresses keyed by
a cheap binary fingerprint and try them first on the next startup,
turning a 30 s cold start into an instant validated read.

The cache is ADVISORY: every cached address is validated by the caller
before use, so a stale or corrupt entry costs nothing more than a
fallback to the normal known-addr / discovery path.

Cache file shape (JSON):
    {
      "<binaryId>": {"gobjects": 246154488, "fnamepool": 245699840},
      ...
    }
Multiple binaries (e.g. several Squad instances on one box) coexist as
separate keys; a binary update changes the id and its old entry is simply
never matched again.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# Override with SQR_ADDR_CACHE; defaults under XDG-ish cache dir so it
# survives restarts and is writable by the service user.
DEFAULT_CACHE_PATH = Path(
    os.environ.get("SQR_ADDR_CACHE")
    or (Path.home() / ".cache" / "sqreader" / "addresses.json")
)


def binary_identity(pid: int) -> str | None:
    """Cheap, stable fingerprint of the target process's executable.

    Uses the on-disk size + mtime of /proc/<pid>/exe. Identical across
    restarts and across instances of the same binary (non-PIE → same
    VAs); changes when the binary is updated. Returns None if the exe
    can't be stat'd, which disables the cache (callers then always
    validate / discover).
    """
    try:
        st = os.stat(f"/proc/{pid}/exe")
    except OSError:
        return None
    return f"{st.st_size}:{int(st.st_mtime)}"


def load(path: Path | str = DEFAULT_CACHE_PATH) -> dict:
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def get(binary_id: str | None, key: str,
        *, path: Path | str = DEFAULT_CACHE_PATH) -> int | None:
    """Return the cached address for (binary_id, key), or None."""
    if not binary_id:
        return None
    entry = load(path).get(binary_id)
    if not isinstance(entry, dict):
        return None
    val = entry.get(key)
    return val if isinstance(val, int) else None


def put(binary_id: str | None, key: str, addr: int,
        *, path: Path | str = DEFAULT_CACHE_PATH) -> None:
    """Persist address for (binary_id, key). No-op if unchanged or if the
    write fails (the cache is advisory — losing it just means the next
    start re-validates the known addr / re-discovers)."""
    if not binary_id:
        return
    path = Path(path)
    data = load(path)
    entry = data.get(binary_id)
    if not isinstance(entry, dict):
        entry = {}
        data[binary_id] = entry
    if entry.get(key) == addr:
        return  # unchanged — skip the disk write
    entry[key] = addr
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        os.replace(tmp, path)  # atomic
    except OSError:
        pass


__all__ = ["binary_identity", "load", "get", "put", "DEFAULT_CACHE_PATH"]
