"""The replay download has to be readable by whoever asks for it.

It streams, so it has no Content-Length, and it used to frame the body with
HTTP/1.1 chunked encoding on every reply — including the ones whose own status
line said HTTP/1.0, which has no chunked encoding at all. Browsers accept that
contradiction. A reverse proxy in front of a partner's site did not, and read
the hex chunk lengths as part of the recording.

These tests speak raw HTTP at a real server rather than using a client library,
because a client library is exactly the thing that papers over the bug.
"""
import gzip
import json
import os
import socket
import time
import pytest

from sqreader.httpsrv import _TickBeat, serve_in_background
from sqreader.sqrx import SqrxWriter

FRAMES = [{"t": "snap", "tick": i, "players": [{"id": f"p{i}"}]} for i in range(40)]


@pytest.fixture
def server(tmp_path):
    rec_dir = tmp_path / "recordings"
    rec_dir.mkdir()
    path = rec_dir / "2026-09-11_120000_Narva_RAAS_v1_abcdef12.sqrx"
    with SqrxWriter(path, server_id="t") as w:
        for f in FRAMES:
            w.write_line(json.dumps(f))

    # Only a FINALIZED recording is listed or served - an in-flight one is a
    # near-live view and is deliberately withheld. Write the sidecar the
    # recorder would have written, and backdate the file out of the
    # "still being written" window.
    path.with_suffix(".meta.json").write_text(json.dumps({
        "id": path.stem,
        "filename": path.name,
        "sizeBytes": path.stat().st_size,
        "ticks": len(FRAMES),
        "durationSec": 40.0,
        "serverId": "t",
        "mapName": "Narva",
        "gameMode": "RAAS",
        "layerName": "Narva_RAAS_v1",
        "matchId": "abcdef12",
        "recordingState": "finalized",
        "inProgress": False,
    }), encoding="utf-8")
    old = time.time() - 3600
    os.utime(path, (old, old))

    srv = serve_in_background("127.0.0.1", 0, _TickBeat(),
                              recordings_dir=rec_dir)
    try:
        yield srv.server_address[1], path.stem
    finally:
        srv.shutdown()
        srv.server_close()


def _raw_get(port: int, path: str, version: str,
             headers: str = "") -> tuple[bytes, bytes]:
    """One request, spoken by hand. Returns (head, body)."""
    s = socket.create_connection(("127.0.0.1", port), timeout=15)
    try:
        req = (f"GET {path} {version}\r\nHost: 127.0.0.1\r\n"
               f"{headers}Connection: close\r\n\r\n")
        s.sendall(req.encode("ascii"))
        buf = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
    finally:
        s.close()
    head, _, body = buf.partition(b"\r\n\r\n")
    return head, body


def _find_recording_id(port: int) -> str:
    head, body = _raw_get(port, "/api/recordings", "HTTP/1.1")
    assert b" 200 " in head, head
    recs = json.loads(body)
    assert recs, "no recordings listed"
    return recs[0]["id"]


# --- the actual complaint -------------------------------------------------

def test_a_http10_client_is_never_sent_chunked(server):
    port, _ = server
    rec = _find_recording_id(port)
    head, body = _raw_get(port, f"/api/recording/{rec}", "HTTP/1.0",
                          headers="Accept-Encoding: identity\r\n")

    assert head.startswith(b"HTTP/1.0 200"), head[:40]
    assert b"transfer-encoding" not in head.lower(), \
        "HTTP/1.0 has no chunked encoding; sending the header is the bug"
    # The body must be the recording, not the recording wrapped in chunk
    # framing. If framing leaked in, the first line is a hex length.
    first = body.split(b"\n", 1)[0]
    assert json.loads(first)["tick"] == 0, f"body starts with {first[:40]!r}"
    assert len(body.strip().splitlines()) == len(FRAMES)


def test_a_http11_client_still_gets_chunked(server):
    """Chunked is not dead weight: its terminator is how a client knows the
    download finished rather than died. Keep it where it is legal."""
    port, _ = server
    rec = _find_recording_id(port)
    head, body = _raw_get(port, f"/api/recording/{rec}", "HTTP/1.1",
                          headers="Accept-Encoding: identity\r\n")

    assert head.startswith(b"HTTP/1.1 200"), \
        "chunked on a 1.0 status line is what broke; the version must match"
    assert b"Transfer-Encoding: chunked" in head
    assert body.endswith(b"0\r\n\r\n"), "no terminating chunk"


def test_both_versions_deliver_identical_recordings(server):
    """Whatever the framing, the bytes underneath must be the same file."""
    port, _ = server
    rec = _find_recording_id(port)
    _, body10 = _raw_get(port, f"/api/recording/{rec}", "HTTP/1.0",
                         headers="Accept-Encoding: identity\r\n")
    _, body11 = _raw_get(port, f"/api/recording/{rec}", "HTTP/1.1",
                         headers="Accept-Encoding: identity\r\n")

    dechunked = b""
    rest = body11
    while True:
        size_line, _, rest = rest.partition(b"\r\n")
        n = int(size_line, 16)
        if n == 0:
            break
        dechunked += rest[:n]
        rest = rest[n + 2:]

    assert dechunked == body10
    assert [json.loads(l)["tick"] for l in body10.strip().splitlines()] == \
        [f["tick"] for f in FRAMES]


def test_a_compressed_http10_download_is_still_a_valid_gzip(server):
    """Content-Encoding and Transfer-Encoding are separate layers, and only the
    transfer one is version-bound. Dropping chunk framing must not disturb the
    gzip stream inside it."""
    port, _ = server
    rec = _find_recording_id(port)
    head, body = _raw_get(port, f"/api/recording/{rec}", "HTTP/1.0",
                          headers="Accept-Encoding: gzip\r\n")

    assert b"transfer-encoding" not in head.lower()
    assert b"Content-Encoding: gzip" in head
    lines = gzip.decompress(body).strip().splitlines()
    assert [json.loads(l)["tick"] for l in lines] == [f["tick"] for f in FRAMES]


def test_the_connection_closes_so_nothing_inherits_the_upgrade(server):
    """The 1.1 reply upgrades this handler instance. If the socket were reused,
    the next response on it would be framed as 1.1 without a length - and the
    SSE stream has neither a length nor chunking."""
    port, _ = server
    rec = _find_recording_id(port)
    head, _ = _raw_get(port, f"/api/recording/{rec}", "HTTP/1.1",
                       headers="Accept-Encoding: identity\r\n")
    assert b"Connection: close" in head
