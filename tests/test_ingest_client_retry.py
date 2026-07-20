"""Tests for ingest_client._send's exponential-backoff retry wrapper.

Covers the transient-vs-permanent split (network errors + 5xx retry,
4xx returns immediately) and the exhaustion path. time.sleep and
urllib.request.urlopen are both monkeypatched so no wall-clock delay
and no real network call happen."""
from __future__ import annotations

import urllib.error
import urllib.request

import pytest

from sqreader import ingest_client as ic


class _MockResp:
    """Context-manager response mock for urllib.request.urlopen."""

    def __init__(self, body: bytes = b"") -> None:
        self.body = body

    def __enter__(self) -> "_MockResp":
        return self

    def __exit__(self, *_):
        return None

    def read(self) -> bytes:
        return self.body


def _make_req() -> urllib.request.Request:
    return urllib.request.Request("http://example.invalid/", data=b"{}")


def _install_urlopen(monkeypatch, side_effects):
    """Consume side_effects (Exception|_MockResp) in order per urlopen call."""
    it = iter(side_effects)

    def _urlopen(req, timeout=None):
        v = next(it)
        if isinstance(v, Exception):
            raise v
        return v

    monkeypatch.setattr(ic.urllib.request, "urlopen", _urlopen)


def _install_no_sleep(monkeypatch) -> list[float]:
    calls: list[float] = []
    monkeypatch.setattr(ic.time, "sleep", calls.append)
    return calls


def test_send_returns_body_on_first_success(monkeypatch):
    _install_urlopen(monkeypatch, [_MockResp(b"hello")])
    sleeps = _install_no_sleep(monkeypatch)
    assert ic._send(_make_req(), timeout=1.0) == b"hello"
    assert sleeps == []  # no sleep on first-try success


def test_send_retries_url_error_then_succeeds(monkeypatch):
    _install_urlopen(monkeypatch, [
        urllib.error.URLError("boom"),
        urllib.error.URLError("boom"),
        _MockResp(b"ok"),
    ])
    sleeps = _install_no_sleep(monkeypatch)
    assert ic._send(_make_req(), timeout=1.0) == b"ok"
    assert sleeps == [ic._RETRY_BACKOFFS[0], ic._RETRY_BACKOFFS[1]]


def test_send_retries_5xx_then_succeeds(monkeypatch):
    _install_urlopen(monkeypatch, [
        urllib.error.HTTPError("http://x/", 503, "svc", {}, None),
        _MockResp(b"ok"),
    ])
    sleeps = _install_no_sleep(monkeypatch)
    assert ic._send(_make_req(), timeout=1.0) == b"ok"
    assert sleeps == [ic._RETRY_BACKOFFS[0]]


def test_send_does_not_retry_4xx(monkeypatch):
    _install_urlopen(monkeypatch, [
        urllib.error.HTTPError("http://x/", 400, "bad", {}, None),
    ])
    sleeps = _install_no_sleep(monkeypatch)
    with pytest.raises(ic.PushError, match="HTTP 400"):
        ic._send(_make_req(), timeout=1.0)
    assert sleeps == []  # 4xx = client bug, not transient


def test_send_gives_up_after_max_retries_on_network_errors(monkeypatch):
    n = len(ic._RETRY_BACKOFFS)
    _install_urlopen(monkeypatch, [
        urllib.error.URLError("boom") for _ in range(n + 1)
    ])
    sleeps = _install_no_sleep(monkeypatch)
    with pytest.raises(ic.PushError, match="unreachable"):
        ic._send(_make_req(), timeout=1.0)
    # One backoff per gap between (n+1) attempts → n sleeps total.
    assert sleeps == list(ic._RETRY_BACKOFFS)


def test_send_gives_up_after_max_retries_on_persistent_5xx(monkeypatch):
    n = len(ic._RETRY_BACKOFFS)
    _install_urlopen(monkeypatch, [
        urllib.error.HTTPError("http://x/", 500, "err", {}, None)
        for _ in range(n + 1)
    ])
    sleeps = _install_no_sleep(monkeypatch)
    with pytest.raises(ic.PushError, match="HTTP 500"):
        ic._send(_make_req(), timeout=1.0)
    assert sleeps == list(ic._RETRY_BACKOFFS)


def test_send_retries_timeout_error(monkeypatch):
    """TimeoutError is a subclass of OSError but worth an explicit case
    so a future refactor can't silently drop it from the retry set."""
    _install_urlopen(monkeypatch, [
        TimeoutError("slow"),
        _MockResp(b"ok"),
    ])
    sleeps = _install_no_sleep(monkeypatch)
    assert ic._send(_make_req(), timeout=1.0) == b"ok"
    assert sleeps == [ic._RETRY_BACKOFFS[0]]
