"""Ed25519 verification of signed update artifacts (offset packs, release
manifests).

The AGENT only ever VERIFIES. The private key lives OFFLINE on the operator's
release box (`python -m central.release`), never here and never on central — so
a compromised central, a MITM, or a leaked per-agent AES secret cannot forge an
update the fleet will run. The trust anchor is a public key baked into the agent
at build time: `update_trust.EMBEDDED_ED25519_PUBKEY_B64`.

A document is signed over its CANONICAL form: JSON with sorted keys and compact
separators, excluding the `signature` field itself. Verification FAILS CLOSED —
an empty/misconfigured pubkey, a missing or malformed signature, or any tampering
returns False, never an exception the caller might mistake for success.

Ed25519 comes from the already-present `cryptography` dependency (the same one
the crypto envelope uses), so no new dependency is introduced.
"""
from __future__ import annotations

import base64
import json
from typing import Any

SIG_FIELD = "signature"


def canonical_bytes(doc: dict[str, Any]) -> bytes:
    """The exact bytes signed/verified over: the doc minus its signature field,
    as JSON with sorted keys and no whitespace. Deterministic across machines."""
    body = {k: v for k, v in doc.items() if k != SIG_FIELD}
    return json.dumps(body, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False).encode("utf-8")


def verify(pubkey_b64: str, doc: dict[str, Any]) -> bool:
    """True iff ``doc[SIG_FIELD]`` is a valid Ed25519 signature over
    ``canonical_bytes(doc)`` under ``pubkey_b64`` (standard base64 of the 32-byte
    raw public key). Fails closed on anything unexpected — an empty pubkey (no
    trust anchor configured), a missing/bad signature, or tampering."""
    try:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.asymmetric.ed25519 import (
            Ed25519PublicKey,
        )
        if not pubkey_b64:
            return False
        sig_b64 = doc.get(SIG_FIELD)
        if not isinstance(sig_b64, str) or not sig_b64:
            return False
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pubkey_b64))
        try:
            pub.verify(base64.b64decode(sig_b64), canonical_bytes(doc))
            return True
        except InvalidSignature:
            return False
    except Exception:
        return False
