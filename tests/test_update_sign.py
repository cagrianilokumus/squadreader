"""Ed25519 update-signature verification: sign/verify roundtrip, tamper
rejection, wrong-key rejection, and fail-closed behaviour."""
import base64

import pytest

from sqreader import update_sign

pytest.importorskip("cryptography")
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: E402
    Ed25519PrivateKey,
)


def _keypair():
    priv = Ed25519PrivateKey.generate()
    pub_raw = priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw)
    return priv, base64.b64encode(pub_raw).decode()


def _sign(priv, doc):
    sig = priv.sign(update_sign.canonical_bytes(doc))
    return {**doc, "signature": base64.b64encode(sig).decode()}


def test_roundtrip_valid():
    priv, pub = _keypair()
    pack = {"kind": "offset-pack", "squad_build": "ab" * 32, "version": 3,
            "offsets": {"SQ_VEHICLE_TURRETS_OFFSET": 0xA98, "MARKER_ITEM_SIZE": 104}}
    assert update_sign.verify(pub, _sign(priv, pack)) is True


def test_tamper_rejected():
    priv, pub = _keypair()
    signed = _sign(priv, {"version": 1, "offsets": {"X": 1}})
    signed["offsets"]["X"] = 2                 # tamper after signing
    assert update_sign.verify(pub, signed) is False


def test_wrong_key_rejected():
    priv, _pub = _keypair()
    _priv2, pub2 = _keypair()
    assert update_sign.verify(pub2, _sign(priv, {"version": 1})) is False


def test_empty_pubkey_fails_closed():
    priv, _pub = _keypair()
    assert update_sign.verify("", _sign(priv, {"version": 1})) is False


def test_missing_or_blank_signature_fails_closed():
    _priv, pub = _keypair()
    assert update_sign.verify(pub, {"version": 1}) is False
    assert update_sign.verify(pub, {"version": 1, "signature": ""}) is False


def test_canonical_excludes_signature_and_sorts():
    doc = {"b": 2, "a": 1, "signature": "xxx"}
    assert update_sign.canonical_bytes(doc) == b'{"a":1,"b":2}'
