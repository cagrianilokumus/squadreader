"""Detect WHICH Squad build a reader is attached to — the key an offset pack is
routed by.

A Squad game patch rebuilds the server binary and shuffles struct offsets, so
the update system must be able to say "this offset pack is for THAT build". The
robust, tamper-evident key is a content hash of the running executable:
`build_sha256(pid)` streams `/proc/<pid>/exe` through SHA-256. It is stable for
the life of a process (the exe file doesn't change under a running process), so
the serve loop computes it once at boot and caches it.

`engine_version()` is a best-effort HUMAN label (e.g. "v10.4.1") scraped from the
FEngineVersion string in memory — never the routing key, and safe to be None.
(Wiring the in-memory string precisely is a documented follow-up; the SHA-256 is
the functional identity today.)

Linux-only, like the rest of the reader; on any platform without `/proc` every
function degrades to None instead of raising.
"""
from __future__ import annotations

import hashlib
from typing import Any

_CHUNK = 1 << 16  # 64 KiB


def build_sha256(pid: int) -> str | None:
    """Streamed SHA-256 of the target's executable, or None if unreadable.

    This is the offset-pack routing key. Reading `/proc/<pid>/exe` follows the
    symlink to the on-disk binary; hashing it is ~1s once per process boot, so
    callers should cache the result rather than recompute per check-in.
    """
    try:
        h = hashlib.sha256()
        with open(f"/proc/{pid}/exe", "rb") as f:
            while True:
                chunk = f.read(_CHUNK)
                if not chunk:
                    break
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return None


def short_build(sha: str | None) -> str | None:
    """A human-friendly 12-char prefix of the build hash for display/logs."""
    return sha[:12] if sha else None


def engine_version(pm: Any, arr: Any, alloc: Any) -> str | None:
    """Best-effort Squad/UE version LABEL from memory. None is fine — it is a
    display string, never the routing key. Deliberately conservative: returns
    None rather than guess. (Precise FEngineVersion wiring is a follow-up; see
    docs/findings.md for where the `…/Squad/vX.Y.Z` string lives.)"""
    return None
