"""AES-256-GCM sealed envelope for pushing data to a central platform.

Implements the documented sqreader ingest wire contract so the agent (this
module) and a central server can interoperate from INDEPENDENT codebases — the
shared artifact is this specification, not the code (keeps the AGPL agent and a
private central at arm's length):

    envelope   = {v, agent_id, seq, ts, nonce, ciphertext}          # JSON
    ciphertext = AES-256-GCM(gzip(payload), aad)
    key        = HKDF-SHA256(secret, salt=b"", info=b"squad-ingest-v1")[:32]
    aad        = f"{v}|{agent_id}|{seq}|{ts}".encode("ascii")

`nonce` and `ciphertext` are base64url (no padding). `ts` is Unix seconds; the
receiver rejects envelopes outside a freshness window (120 s default). The AAD
binds v/agent_id/seq/ts, so a captured packet cannot be replayed under a
different id or sequence number.

AES-GCM needs the optional `cryptography` dependency (extra: ``sqreader[push]``)
and is lazy-imported so the base install stays dependency-light. HKDF is
stdlib. Everything here is deterministic and unit-testable offline.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import json
import os
import time
from typing import Any

ENVELOPE_VERSION = "1"
HKDF_INFO = b"squad-ingest-v1"
NONCE_BYTES = 12                       # standard AES-GCM nonce
DEFAULT_FRESHNESS_SEC = 120
MAX_PLAINTEXT_BYTES = 64 * 1024 * 1024  # decompressed-payload sanity cap


class EnvelopeError(Exception):
    """Malformed envelope, wrong key, failed auth, or stale timestamp."""


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def hkdf_sha256(secret: bytes, *, length: int = 32,
                info: bytes = HKDF_INFO, salt: bytes = b"") -> bytes:
    """RFC 5869 HKDF-SHA256. Empty salt → HashLen zero bytes (per the spec)."""
    if not salt:
        salt = b"\x00" * hashlib.sha256().digest_size
    prk = hmac.new(salt, secret, hashlib.sha256).digest()
    okm = b""
    block = b""
    counter = 1
    while len(okm) < length:
        block = hmac.new(prk, block + info + bytes([counter]),
                         hashlib.sha256).digest()
        okm += block
        counter += 1
    return okm[:length]


def _key(secret: bytes) -> bytes:
    return hkdf_sha256(secret, length=32)


def _aesgcm(key: bytes):  # noqa: ANN202 - returns AESGCM, lazy-imported
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover - environment dependent
        raise EnvelopeError(
            "AES-GCM needs the 'cryptography' package — install the push "
            "extra: pip install sqreader[push]") from exc
    return AESGCM(key)


def seal(payload: bytes, *, secret: bytes, agent_id: str, seq: int,
         ts: int | None = None, v: str = ENVELOPE_VERSION) -> dict[str, Any]:
    """Seal raw `payload` bytes (gzipped, then AES-GCM) into an envelope dict."""
    if ts is None:
        ts = int(time.time())
    nonce = os.urandom(NONCE_BYTES)
    aad = f"{v}|{agent_id}|{seq}|{ts}".encode("ascii")
    ct = _aesgcm(_key(secret)).encrypt(nonce, gzip.compress(payload), aad)
    return {
        "v": v, "agent_id": agent_id, "seq": int(seq), "ts": int(ts),
        "nonce": _b64(nonce), "ciphertext": _b64(ct),
    }


def seal_json(obj: Any, **kw: Any) -> dict[str, Any]:
    """Convenience: JSON-encode `obj` compactly, then seal()."""
    raw = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
    return seal(raw.encode("utf-8"), **kw)


def open_envelope(env: dict[str, Any], *, secret: bytes,
                  freshness_sec: int | None = DEFAULT_FRESHNESS_SEC,
                  now: int | None = None) -> bytes:
    """Verify + decrypt an envelope → the original payload bytes.

    Raises EnvelopeError on any failure (shape, auth, gzip, or staleness). The
    central uses this to receive; the agent uses it in round-trip tests.
    """
    try:
        v = str(env["v"])
        agent_id = str(env["agent_id"])
        seq = int(env["seq"])
        ts = int(env["ts"])
        nonce = _unb64(str(env["nonce"]))
        ct = _unb64(str(env["ciphertext"]))
    except (KeyError, ValueError, TypeError) as exc:
        # base64 decode errors raise binascii.Error, which is a ValueError.
        raise EnvelopeError(f"malformed envelope: {exc}") from exc
    if freshness_sec is not None:
        now = int(time.time()) if now is None else now
        if abs(now - ts) > freshness_sec:
            raise EnvelopeError("stale envelope (ts outside freshness window)")
    aad = f"{v}|{agent_id}|{seq}|{ts}".encode("ascii")
    try:
        gz = _aesgcm(_key(secret)).decrypt(nonce, ct, aad)
    except EnvelopeError:
        raise
    except Exception as exc:  # noqa: BLE001 - InvalidTag/ValueError → auth fail
        raise EnvelopeError("authentication failed") from exc
    try:
        payload = gzip.decompress(gz)
    except (OSError, EOFError) as exc:
        raise EnvelopeError(f"bad gzip: {exc}") from exc
    if len(payload) > MAX_PLAINTEXT_BYTES:
        raise EnvelopeError("payload exceeds size cap")
    return payload


__all__ = [
    "ENVELOPE_VERSION", "HKDF_INFO", "DEFAULT_FRESHNESS_SEC",
    "EnvelopeError", "hkdf_sha256", "seal", "seal_json", "open_envelope",
]
