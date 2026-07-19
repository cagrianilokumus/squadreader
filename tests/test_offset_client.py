"""offset_client: fetch/accept verification (build match, version monotonicity,
Ed25519 trust, fail-closed) and the on-disk committed-pack persistence."""
import base64

import pytest

from sqreader import offset_client, update_sign, update_trust

pytest.importorskip("cryptography")
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import (  # noqa: E402
    Ed25519PrivateKey,
)


def _keypair(monkeypatch):
    priv = Ed25519PrivateKey.generate()
    pub = base64.b64encode(priv.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw)).decode()
    monkeypatch.setattr(update_trust, "EMBEDDED_ED25519_PUBKEY_B64", pub)
    return priv


def _sign(priv, doc):
    sig = priv.sign(update_sign.canonical_bytes(doc))
    return {**doc, "signature": base64.b64encode(sig).decode()}


def _pack(priv, build, version, offsets, channel="stable"):
    return _sign(priv, {"kind": "offset-pack", "squad_build": build,
                        "channel": channel, "version": version,
                        "offsets": offsets, "notes": ""})


def test_accept_valid(monkeypatch):
    priv = _keypair(monkeypatch)
    p = _pack(priv, "buildA", 3, {"SQ_VEHICLE_TURRETS_OFFSET": 0xA98})
    got = offset_client.accept(p, squad_build="buildA", min_version=0)
    assert got == {"version": 3, "offsets": {"SQ_VEHICLE_TURRETS_OFFSET": 0xA98}}


def test_accept_rejects_wrong_build(monkeypatch):
    priv = _keypair(monkeypatch)
    p = _pack(priv, "buildA", 3, {"X_OFFSET": 1})
    assert offset_client.accept(p, squad_build="buildB", min_version=0) is None


def test_accept_enforces_version_monotonic(monkeypatch):
    priv = _keypair(monkeypatch)
    p = _pack(priv, "b", 3, {"X_OFFSET": 1})
    assert offset_client.accept(p, squad_build="b", min_version=3) is None  # not > 3
    assert offset_client.accept(p, squad_build="b", min_version=2) is not None


def test_accept_rejects_tampered(monkeypatch):
    priv = _keypair(monkeypatch)
    p = _pack(priv, "b", 3, {"X_OFFSET": 1})
    p["offsets"]["X_OFFSET"] = 2                     # tamper after signing
    assert offset_client.accept(p, squad_build="b", min_version=0) is None


def test_accept_fails_closed_without_trust_anchor(monkeypatch):
    priv = _keypair(monkeypatch)
    p = _pack(priv, "b", 3, {"X_OFFSET": 1})
    monkeypatch.setattr(update_trust, "EMBEDDED_ED25519_PUBKEY_B64", "")
    assert offset_client.accept(p, squad_build="b", min_version=0) is None


def test_accept_rejects_bad_offsets(monkeypatch):
    priv = _keypair(monkeypatch)
    empty = _pack(priv, "b", 4, {})
    assert offset_client.accept(empty, squad_build="b", min_version=0) is None
    assert offset_client.accept(None, squad_build="b", min_version=0) is None


def test_persistence_roundtrip(tmp_path):
    assert offset_client.active_version(tmp_path, "b") == 0
    assert offset_client.active_offsets_for(tmp_path, "b") is None
    offset_client.save_active(tmp_path, "b", 5, {"X_OFFSET": 7})
    assert offset_client.active_version(tmp_path, "b") == 5
    d = offset_client.active_offsets_for(tmp_path, "b")
    assert d["offsets"] == {"X_OFFSET": 7} and d["version"] == 5
    # a committed pack for a DIFFERENT build must not be applied
    assert offset_client.active_offsets_for(tmp_path, "other") is None
    assert offset_client.active_version(tmp_path, "other") == 0
    offset_client.clear_active(tmp_path)
    assert offset_client.active_version(tmp_path, "b") == 0


def test_fetch_and_accept(monkeypatch):
    priv = _keypair(monkeypatch)
    p = _pack(priv, "b", 2, {"X_OFFSET": 9})
    from sqreader import ingest_client
    monkeypatch.setattr(ingest_client, "fetch_offsets", lambda *a, **k: p)
    creds = {"SQREADER_AGENT_ID": "x", "SQREADER_AGENT_SECRET_HEX": "00" * 32,
             "SQREADER_PUSH_URL": "http://x"}
    got = offset_client.fetch_and_accept(creds, "b", "stable", 0, seq=1)
    assert got["version"] == 2 and got["offsets"] == {"X_OFFSET": 9}

    def boom(*a, **k):
        raise ingest_client.PushError("central down")
    monkeypatch.setattr(ingest_client, "fetch_offsets", boom)
    assert offset_client.fetch_and_accept(creds, "b", "stable", 0, seq=2) is None


def test_selfheal_end_to_end_drill(tmp_path, monkeypatch):
    """The whole self-heal chain, minus the live reader: a signed pack that
    corrects a drifted offset is fetched → accepted → applied (the module constant
    changes) → committed (persists for a restart) → the monotonic guard then
    refuses the same version → revert restores the baked value."""
    from sqreader import ingest_client
    from sqreader.squad import snapshot as sn

    priv = _keypair(monkeypatch)                 # installs the trust anchor
    build = "buildZ"
    baked = sn.SQ_VEHICLE_TURRETS_OFFSET
    corrected = baked + 0x8                       # the value the Squad patch moved it to
    pack = _pack(priv, build, 1, {"SQ_VEHICLE_TURRETS_OFFSET": corrected})
    monkeypatch.setattr(ingest_client, "fetch_offsets", lambda *a, **k: pack)
    creds = {"SQREADER_AGENT_ID": "z", "SQREADER_AGENT_SECRET_HEX": "00" * 32,
             "SQREADER_PUSH_URL": "http://z"}

    got = offset_client.fetch_and_accept(
        creds, build, "stable", offset_client.active_version(tmp_path, build), seq=1)
    assert got and got["version"] == 1
    applied = sn.apply_offset_overrides(got["offsets"])
    try:
        assert "SQ_VEHICLE_TURRETS_OFFSET" in applied
        assert sn.SQ_VEHICLE_TURRETS_OFFSET == corrected      # reader now reads right
        offset_client.save_active(tmp_path, build, got["version"], got["offsets"])
        committed = offset_client.active_offsets_for(tmp_path, build)
        assert committed["offsets"]["SQ_VEHICLE_TURRETS_OFFSET"] == corrected
        # the same version can't replay now (monotonic floor)
        assert offset_client.fetch_and_accept(
            creds, build, "stable",
            offset_client.active_version(tmp_path, build), seq=2) is None
    finally:
        sn.revert_offset_overrides()
    assert sn.SQ_VEHICLE_TURRETS_OFFSET == baked              # rollback restores baked
