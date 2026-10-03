"""`?from=` — start a replay stream part-way in.

The viewer plays a recording while it downloads, and clicking ahead of what has
arrived restarts the download at that point. There is no Range support and none
is possible — the body is a compressed stream with no index, so a byte offset
means nothing — so the server walks its own copy and drops what comes first.

Run against the real handler: what can break here is the wiring (the query
parameter, the encoding downgrade, the ETag), not the substring search.
"""
import datetime
import gzip
import json
import os
import time
import urllib.error
import urllib.request

import pytest

from sqreader.httpsrv import _replay_from, _replay_ts_ms, _TickBeat, serve_in_background
from sqreader.sqrx import SqrxWriter

STAMPS = [f"2026-09-11T19:{m:02d}:00+00:00" for m in range(0, 50, 5)]


def _ms(iso: str) -> int:
    return int(datetime.datetime.fromisoformat(iso).timestamp() * 1000)


def _line(iso: str, **extra: object) -> str:
    return json.dumps({"timestamp": iso, "players": [], **extra})


# ---- the helpers ---------------------------------------------------------

def test_timestamp_is_read_without_parsing_the_line() -> None:
    iso = "2026-09-11T19:48:17.195+00:00"
    assert _replay_ts_ms(_line(iso)) == _ms(iso)


@pytest.mark.parametrize("bad", ["{}", '{"timestamp"', '{"timestamp": "x"}', ""])
def test_an_unreadable_timestamp_is_not_an_error(bad: str) -> None:
    assert _replay_ts_ms(bad) is None


def test_a_point_between_frames_rounds_forward() -> None:
    lines = [_line(s) for s in STAMPS]
    assert list(_replay_from(lines, _ms(STAMPS[3]) + 1)) == lines[4:]


def test_never_starts_on_a_position_frame() -> None:
    # A `"t":"pos"` line is a delta against the last FULL frame; opening a
    # stream on one hands the client a delta against a frame it never got.
    lines = [_line(STAMPS[0]),
             json.dumps({"t": "pos", "timestamp": STAMPS[1]}),
             _line(STAMPS[2])]
    kept = list(_replay_from(lines, _ms(STAMPS[1])))
    assert json.loads(kept[0])["timestamp"] == STAMPS[2]


def test_past_the_end_yields_the_last_frame_not_nothing() -> None:
    # The timeline's length comes from the match row and a recording can stop
    # before the round does; an empty body reaches the viewer as a failed load.
    lines = [_line(s) for s in STAMPS]
    assert list(_replay_from(lines, _ms(STAMPS[-1]) + 3_600_000)) == [lines[-1]]


# ---- the handler ---------------------------------------------------------

@pytest.fixture
def served(tmp_path):
    rec_dir = tmp_path / "recordings"
    rec_dir.mkdir()
    path = rec_dir / "2026-09-11_190000_Narva_RAAS_v1_abcdef12.sqrx"
    with SqrxWriter(path, server_id="t") as w:
        for s in STAMPS:
            w.write_line(_line(s))
    path.with_suffix(".meta.json").write_text(json.dumps({
        "id": path.stem, "filename": path.name,
        "sizeBytes": path.stat().st_size, "ticks": len(STAMPS),
        "durationSec": 2700.0, "serverId": "t", "matchId": "abcdef12",
        "recordingState": "finalized", "inProgress": False,
    }), encoding="utf-8")
    old = time.time() - 3600
    os.utime(path, (old, old))
    srv = serve_in_background("127.0.0.1", 0, _TickBeat(), recordings_dir=rec_dir)
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}/api/recording/{path.stem}"
    finally:
        srv.shutdown()
        srv.server_close()


def _get(url: str, accept: str = "gzip", etag: str | None = None):
    headers = {"Accept-Encoding": accept}
    if etag:
        headers["If-None-Match"] = etag
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                    timeout=30) as r:
            head, body, status = dict(r.headers), r.read(), r.status
    except urllib.error.HTTPError as e:            # urlopen raises on 304
        return e.code, dict(e.headers), []
    if head.get("Content-Encoding") == "gzip":
        body = gzip.decompress(body)
    elif head.get("Content-Encoding") == "zstd":
        import zstandard
        body = zstandard.ZstdDecompressor().decompressobj().decompress(body)
    return status, head, [ln for ln in body.decode("utf-8").split("\n") if ln.strip()]


def test_serves_only_the_tail_byte_identical(served: str) -> None:
    _, _, whole = _get(served)
    _, _, tail = _get(f"{served}?from={_ms(STAMPS[5])}")
    assert json.loads(tail[0])["timestamp"] == STAMPS[5]
    assert tail == whole[len(whole) - len(tail):]


def test_a_zstd_client_is_downgraded_for_a_seek(served: str) -> None:
    # The zstd path hands the stored frames over untouched — it cannot leave
    # any out.
    _, head, lines = _get(f"{served}?from={_ms(STAMPS[5])}", accept="zstd, gzip")
    assert head.get("Content-Encoding") == "gzip"
    assert json.loads(lines[0])["timestamp"] == STAMPS[5]


def test_a_seeks_etag_cannot_satisfy_the_whole_recording(served: str) -> None:
    _, head, _ = _get(f"{served}?from={_ms(STAMPS[5])}")
    tag = head["ETag"]
    assert _get(f"{served}?from={_ms(STAMPS[5])}", etag=tag)[0] == 304
    assert _get(served, etag=tag)[0] == 200


def test_the_whole_bodys_etag_is_unchanged(served: str) -> None:
    # A suffix on the no-seek tag would invalidate every viewer's cached copy
    # for bytes that did not change.
    _, head, _ = _get(served)
    assert "-f" not in head["ETag"]


@pytest.mark.parametrize("raw", ["notanumber", "", "-5"])
def test_an_unreadable_from_is_ignored(served: str, raw: str) -> None:
    status, _, lines = _get(f"{served}?from={raw}")
    assert status == 200 and len(lines) == len(STAMPS)
