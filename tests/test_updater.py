"""Agent self-update client: version comparison, manifest accept (platform /
newer / downgrade guard / Ed25519 / fail-closed / safe artifact name), artifact
download+sha verify, and the on-disk staging."""
import base64
from pathlib import Path

import pytest

from sqreader import update_sign, update_trust, updater

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


def _manifest(priv, version, *, platform="linux", channel="stable",
              artifact="sqreader-9.9.9.whl", sha="a" * 64):
    return _sign(priv, {"kind": "agent-release", "version": version,
                        "platform": platform, "channel": channel,
                        "artifact": artifact, "sha256": sha,
                        "min_from": "", "notes": ""})


def test_is_newer():
    assert updater.is_newer("1.2.0", "1.1.0")
    assert updater.is_newer("1.10.0", "1.9.0")        # not lexical
    assert not updater.is_newer("1.1.0", "1.1.0")
    assert not updater.is_newer("1.0.0", "1.1.0")


def test_accept_valid(monkeypatch):
    priv = _keypair(monkeypatch)
    got = updater.accept(_manifest(priv, "9.9.9"), current_version="1.1.0",
                         min_applied="", this_platform="linux")
    assert got == {"version": "9.9.9", "artifact": "sqreader-9.9.9.whl",
                   "sha256": "a" * 64}


def test_accept_rejects_not_newer(monkeypatch):
    priv = _keypair(monkeypatch)
    assert updater.accept(_manifest(priv, "1.0.0"), current_version="1.1.0",
                          min_applied="", this_platform="linux") is None


def test_accept_rejects_wrong_platform(monkeypatch):
    priv = _keypair(monkeypatch)
    m = _manifest(priv, "9.9.9", platform="windows")
    assert updater.accept(m, current_version="1.1.0", min_applied="",
                          this_platform="linux") is None


def test_accept_downgrade_guard(monkeypatch):
    priv = _keypair(monkeypatch)
    m = _manifest(priv, "2.0.0")
    assert updater.accept(m, current_version="1.1.0", min_applied="2.0.0",
                          this_platform="linux") is None       # already staged 2.0.0
    assert updater.accept(m, current_version="1.1.0", min_applied="1.5.0",
                          this_platform="linux") is not None


def test_accept_rejects_tampered(monkeypatch):
    priv = _keypair(monkeypatch)
    m = _manifest(priv, "9.9.9")
    m["sha256"] = "b" * 64                              # tamper after signing
    assert updater.accept(m, current_version="1.1.0", min_applied="",
                          this_platform="linux") is None


def test_accept_fails_closed_without_trust(monkeypatch):
    priv = _keypair(monkeypatch)
    m = _manifest(priv, "9.9.9")
    monkeypatch.setattr(update_trust, "EMBEDDED_ED25519_PUBKEY_B64", "")
    assert updater.accept(m, current_version="1.1.0", min_applied="",
                          this_platform="linux") is None


def test_accept_rejects_unsafe_artifact_name(monkeypatch):
    priv = _keypair(monkeypatch)
    m = _manifest(priv, "9.9.9", artifact="../evil.whl")
    assert updater.accept(m, current_version="1.1.0", min_applied="",
                          this_platform="linux") is None


def test_staging_roundtrip(tmp_path):
    assert updater.staged(tmp_path) is None
    assert updater.staged_version(tmp_path) == ""
    p = updater.stage(tmp_path, "9.9.9", "sqreader-9.9.9.whl", b"WHEELDATA")
    assert p.is_file() and p.read_bytes() == b"WHEELDATA"
    st = updater.staged(tmp_path)
    assert st["version"] == "9.9.9" and Path(st["path"]).read_bytes() == b"WHEELDATA"
    assert updater.staged_version(tmp_path) == "9.9.9"
    updater.clear_staged(tmp_path)
    assert updater.staged(tmp_path) is None


def test_download_verified(monkeypatch):
    import hashlib

    from sqreader import ingest_client
    data = b"artifact-bytes"
    sha = hashlib.sha256(data).hexdigest()
    monkeypatch.setattr(ingest_client, "download_artifact", lambda *a, **k: data)
    assert updater.download_verified({}, "f.whl", sha) == data
    assert updater.download_verified({}, "f.whl", "0" * 64) is None   # sha mismatch
    monkeypatch.setattr(ingest_client, "download_artifact", lambda *a, **k: None)
    assert updater.download_verified({}, "f.whl", sha) is None


def test_fetch_and_accept(monkeypatch):
    priv = _keypair(monkeypatch)
    m = _manifest(priv, "9.9.9", platform=updater.platform_name())
    from sqreader import ingest_client
    monkeypatch.setattr(ingest_client, "fetch_manifest", lambda *a, **k: m)
    creds = {"SQREADER_AGENT_ID": "x", "SQREADER_AGENT_SECRET_HEX": "00" * 32,
             "SQREADER_PUSH_URL": "http://x"}
    got = updater.fetch_and_accept(creds, "stable", seq=1)
    assert got and got["version"] == "9.9.9"

    def boom(*a, **k):
        raise ingest_client.PushError("central down")
    monkeypatch.setattr(ingest_client, "fetch_manifest", boom)
    assert updater.fetch_and_accept(creds, "stable", seq=2) is None
