"""Unit tests for the enrollment-credential store and HW fingerprint."""
import re

import pytest

from sqreader import agent_creds, hwfp


def test_hwfp_is_stable_hex(monkeypatch):
    fp1 = hwfp.compute()
    fp2 = hwfp.compute()
    assert fp1 == fp2
    assert re.fullmatch(r"[0-9a-f]{64}", fp1)


def test_primary_mac_skips_randomised_multicast(monkeypatch):
    # A random uuid.getnode() sets the multicast bit (bit 40) — must be ignored.
    monkeypatch.setattr(hwfp.uuid, "getnode", lambda: (0x01 << 40) | 0x123456)
    assert hwfp._primary_mac() == ""
    monkeypatch.setattr(hwfp.uuid, "getnode", lambda: 0x00AABBCCDDEE)
    assert hwfp._primary_mac() == "00aabbccddee"


def test_write_then_load_round_trip(tmp_path):
    p = tmp_path / ".env.agent"
    agent_creds.write({
        "SQREADER_CENTRAL_URL": "https://c.example",
        "SQREADER_AGENT_ID": "eu1",
        "SQREADER_AGENT_SECRET_HEX": "ab" * 32,
        "SQREADER_PUSH_URL": "https://c.example/ingest",
        "SQREADER_COMMUNITY": "testcom",
        "SQREADER_BOUND_HW": "deadbeef",
    }, path=p)
    creds = agent_creds.load(p)
    assert creds is not None
    assert creds["SQREADER_AGENT_ID"] == "eu1"
    assert creds["SQREADER_AGENT_SECRET_HEX"] == "ab" * 32
    assert creds["SQREADER_COMMUNITY"] == "testcom"
    assert agent_creds.is_enrolled(p) is True


def test_file_is_0600(tmp_path):
    import os
    import sys
    p = tmp_path / ".env.agent"
    agent_creds.write({"SQREADER_AGENT_ID": "x", "SQREADER_AGENT_SECRET_HEX": "y"},
                      path=p)
    if sys.platform != "win32":
        assert oct(os.stat(p).st_mode & 0o777) == "0o600"


def test_unknown_field_rejected(tmp_path):
    with pytest.raises(ValueError, match="unknown credential fields"):
        agent_creds.write({"NOT_A_FIELD": "v"}, path=tmp_path / ".env.agent")


def test_missing_file_not_enrolled(tmp_path):
    p = tmp_path / "nope.env"
    assert agent_creds.load(p) is None
    assert agent_creds.is_enrolled(p) is False


def test_env_var_overrides_file(tmp_path, monkeypatch):
    p = tmp_path / ".env.agent"
    agent_creds.write({"SQREADER_AGENT_ID": "fromfile",
                       "SQREADER_AGENT_SECRET_HEX": "s"}, path=p)
    monkeypatch.setenv("SQREADER_AGENT_ID", "fromenv")
    creds = agent_creds.load(p)
    assert creds is not None and creds["SQREADER_AGENT_ID"] == "fromenv"


def test_load_ignores_comments_and_unknown_lines(tmp_path):
    p = tmp_path / ".env.agent"
    p.write_text(
        "# a comment\n"
        "\n"
        "GARBAGE LINE NO EQUALS\n"
        "UNKNOWN_KEY=ignored\n"
        "SQREADER_AGENT_ID=eu1\n"
        "SQREADER_AGENT_SECRET_HEX=abc\n",
        encoding="utf-8",
    )
    creds = agent_creds.load(p)
    assert creds == {"SQREADER_AGENT_ID": "eu1",
                     "SQREADER_AGENT_SECRET_HEX": "abc"}


def test_partial_creds_not_enrolled(tmp_path):
    p = tmp_path / ".env.agent"
    agent_creds.write({"SQREADER_CENTRAL_URL": "https://c"}, path=p)  # no id/secret
    assert agent_creds.is_enrolled(p) is False


def test_config_push_defaults_off():
    from sqreader import config
    assert config.DEFAULTS["push_enabled"] is False
    assert config.DEFAULTS["central_url"] is None
    assert config.DEFAULTS["push_replay"] is True
