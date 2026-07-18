"""Light, stable hardware fingerprint used to bind an enrolled credential to a
host (anti-copy).

Independent AGPL implementation. It is NOT a security boundary on its own — it
just lets the central notice when a credential is reused on a different machine.
Derived from stable host identifiers, hashed under a namespace so the raw values
never leave the box.
"""
from __future__ import annotations

import hashlib
import platform
import socket
import uuid

NAMESPACE = b"sqreader/hw_fp/v1|"


def _machine_id() -> str:
    for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
        try:
            with open(path, encoding="ascii") as fh:
                value = fh.read().strip()
            if value:
                return value
        except OSError:
            continue
    return ""


def _primary_mac() -> str:
    # uuid.getnode() returns a 48-bit MAC, OR a random value with the multicast
    # bit (LSB of the first octet = bit 40) set when no real NIC was found —
    # skip that so the fingerprint stays meaningful.
    node = uuid.getnode()
    if (node >> 40) & 0x1:
        return ""
    return f"{node:012x}"


def compute() -> str:
    """A hex fingerprint stable across restarts on the same host."""
    digest = hashlib.sha256(NAMESPACE)
    for part in (_machine_id(), _primary_mac(), socket.gethostname(),
                 platform.system()):
        digest.update(b"|")
        digest.update(part.encode("utf-8", "replace"))
    return digest.hexdigest()


__all__ = ["compute", "NAMESPACE"]
