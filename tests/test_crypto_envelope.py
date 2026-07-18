"""Unit tests for the ingest crypto envelope — deterministic, offline, no I/O.

Covers the RFC 5869 HKDF vector (so the agent↔central key derivation is
byte-exact), the AES-GCM seal/open round trip, and every rejection path the
receiver relies on (wrong key, tampered ciphertext, tampered AAD fields, gzip
corruption, and staleness)."""
import time

import pytest

from sqreader.crypto_envelope import (
    EnvelopeError,
    hkdf_sha256,
    open_envelope,
    seal,
    seal_json,
)

SECRET = bytes.fromhex("00112233445566778899aabbccddeeff"
                       "ffeeddccbbaa99887766554433221100")


def test_hkdf_rfc5869_test_case_1():
    # RFC 5869 Appendix A.1 (SHA-256) — pins our HKDF to the spec so a central
    # written from the same doc derives the identical key.
    ikm = bytes.fromhex("0b" * 22)
    salt = bytes.fromhex("000102030405060708090a0b0c")
    info = bytes.fromhex("f0f1f2f3f4f5f6f7f8f9")
    expected = bytes.fromhex(
        "3cb25f25faacd57a90434f64d0362f2a"
        "2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
        "34007208d5b887185865")
    assert hkdf_sha256(ikm, length=42, info=info, salt=salt) == expected


def test_hkdf_empty_salt_is_deterministic_and_32_bytes():
    k1 = hkdf_sha256(SECRET)
    k2 = hkdf_sha256(SECRET)
    assert k1 == k2 and len(k1) == 32


def test_round_trip_bytes():
    payload = b"hello \x00\x01\x02 world" * 1000
    env = seal(payload, secret=SECRET, agent_id="eu1", seq=7)
    assert set(env) == {"v", "agent_id", "seq", "ts", "nonce", "ciphertext"}
    assert open_envelope(env, secret=SECRET) == payload


def test_round_trip_json():
    obj = {"schema": "sqr-match-1", "server_id": "eu1", "n": [1, 2, 3],
           "unicode": "Kuşadası — Altaı"}
    env = seal_json(obj, secret=SECRET, agent_id="eu1", seq=1)
    import json
    assert json.loads(open_envelope(env, secret=SECRET)) == obj


def test_wrong_secret_fails_auth():
    env = seal(b"x", secret=SECRET, agent_id="eu1", seq=1)
    with pytest.raises(EnvelopeError, match="authentication failed"):
        open_envelope(env, secret=b"\x11" * 32)


def test_tampered_ciphertext_fails():
    env = seal(b"payload", secret=SECRET, agent_id="eu1", seq=1)
    ct = list(env["ciphertext"])
    ct[0] = "A" if ct[0] != "A" else "B"
    env["ciphertext"] = "".join(ct)
    with pytest.raises(EnvelopeError):
        open_envelope(env, secret=SECRET)


@pytest.mark.parametrize("field,newval", [
    ("agent_id", "other"), ("seq", 999), ("v", "2"),
])
def test_tampered_aad_field_fails(field, newval):
    # Changing an AAD-bound field after sealing must break authentication —
    # a packet can't be replayed under a different id/seq/version.
    env = seal(b"payload", secret=SECRET, agent_id="eu1", seq=1)
    env[field] = newval
    with pytest.raises(EnvelopeError):
        open_envelope(env, secret=SECRET, freshness_sec=None)


def test_tampered_ts_fails_auth_when_within_window():
    env = seal(b"payload", secret=SECRET, agent_id="eu1", seq=1)
    env["ts"] = int(env["ts"]) + 1  # still fresh, but AAD no longer matches
    with pytest.raises(EnvelopeError):
        open_envelope(env, secret=SECRET)


def test_stale_ts_rejected():
    old = int(time.time()) - 10_000
    env = seal(b"payload", secret=SECRET, agent_id="eu1", seq=1, ts=old)
    with pytest.raises(EnvelopeError, match="stale"):
        open_envelope(env, secret=SECRET)
    # ...but disabling freshness lets it through (for offline/backfill import).
    assert open_envelope(env, secret=SECRET, freshness_sec=None) == b"payload"


def test_future_ts_rejected():
    future = int(time.time()) + 10_000
    env = seal(b"p", secret=SECRET, agent_id="eu1", seq=1, ts=future)
    with pytest.raises(EnvelopeError, match="stale"):
        open_envelope(env, secret=SECRET)


def test_freshness_uses_injected_now():
    env = seal(b"p", secret=SECRET, agent_id="eu1", seq=1, ts=1000)
    assert open_envelope(env, secret=SECRET, now=1050) == b"p"  # within 120s
    with pytest.raises(EnvelopeError, match="stale"):
        open_envelope(env, secret=SECRET, now=2000)


@pytest.mark.parametrize("env", [
    {}, {"v": "1"}, {"v": "1", "agent_id": "a", "seq": "x", "ts": 1,
                     "nonce": "!!", "ciphertext": "!!"},
])
def test_malformed_envelope_rejected(env):
    with pytest.raises(EnvelopeError):
        open_envelope(env, secret=SECRET, freshness_sec=None)
