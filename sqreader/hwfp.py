"""Light, stable hardware fingerprint used to bind an enrolled credential to a
host (anti-copy).

Independent implementation. It is NOT a security boundary on its own — it
just lets the central notice when a credential is reused on a different machine.
Derived from stable host identifiers, hashed under a namespace so the raw values
never leave the box.
"""
from __future__ import annotations

import hashlib
import platform
import socket
import sys
import uuid

NAMESPACE = b"sqreader/hw_fp/v1|"


def _machine_id() -> str:
    if sys.platform == "win32":
        # Windows has no machine-id file; MachineGuid is its counterpart, set
        # once at install time and stable across reboots. The 64-bit view is
        # read explicitly so a 32-bit interpreter sees the same value.
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                                r"SOFTWARE\Microsoft\Cryptography", 0,
                                winreg.KEY_READ | winreg.KEY_WOW64_64KEY) as key:
                value, _ = winreg.QueryValueEx(key, "MachineGuid")
            return str(value).strip()
        except OSError:
            return ""
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
