"""Read/write the agent's enrollment credentials — the SECRET half of config.

`config.py` is load-once and read-only and its file (`sqreader.config.json`) is
world-readable; the enrollment secret must NOT live there. It lives here in a
`0600` `.env.agent` next to the config, written only by `sqreader enroll`.

Absent file → not enrolled → push stays OFF (opt-in default). Environment
variables of the same name override the file (systemd-creds / container secrets).
"""
from __future__ import annotations

import os
from pathlib import Path

# The only keys we persist. Secrets never go in sqreader.config.json.
FIELDS: tuple[str, ...] = (
    "SQREADER_CENTRAL_URL",
    "SQREADER_AGENT_ID",
    "SQREADER_AGENT_SECRET_HEX",
    "SQREADER_PUSH_URL",
    "SQREADER_COMMUNITY",
    "SQREADER_BOUND_HW",
)


def creds_path() -> Path:
    """`.env.agent` location: next to $SQREADER_CONFIG, else the CWD."""
    cfg = os.environ.get("SQREADER_CONFIG")
    base = Path(cfg).parent if cfg else Path.cwd()
    return base / ".env.agent"


def load(path: Path | None = None) -> dict[str, str] | None:
    """Parse `.env.agent` → dict, or None when unreadable. Missing file → {}
    (then env-var overrides may still populate it). Env overrides the file."""
    target = path or creds_path()
    out: dict[str, str] = {}
    try:
        text = target.read_text(encoding="utf-8")
    except FileNotFoundError:
        text = ""
    except OSError:
        return None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key in FIELDS:
            out[key] = value.strip()
    for key in FIELDS:
        env = os.environ.get(key)
        if env:
            out[key] = env
    return out or None


def write(fields: dict[str, str], *, path: Path | None = None) -> Path:
    """Atomically write `.env.agent` (0600). Rejects unknown keys."""
    unknown = set(fields) - set(FIELDS)
    if unknown:
        raise ValueError(f"unknown credential fields: {sorted(unknown)}")
    target = path or creds_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(f"{key}={fields[key]}\n" for key in FIELDS if key in fields)
    tmp = target.with_name(target.name + ".tmp")
    tmp.write_text(body, encoding="utf-8")
    _chmod600(tmp)
    os.replace(tmp, target)
    _chmod600(target)
    return target


def is_enrolled(path: Path | None = None) -> bool:
    creds = load(path)
    return bool(creds and creds.get("SQREADER_AGENT_ID")
               and creds.get("SQREADER_AGENT_SECRET_HEX"))


def _chmod600(path: Path) -> None:
    try:
        os.chmod(path, 0o600)
    except (OSError, NotImplementedError):
        pass  # win32 / filesystems without POSIX perms


__all__ = ["FIELDS", "creds_path", "load", "write", "is_enrolled"]
