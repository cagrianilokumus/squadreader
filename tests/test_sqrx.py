"""Pure-logic tests for the .sqrx recording format — no live process,
no memory reads. Covers the round trip, the crash-safety guarantee the
format is built around, and the header-validation error paths."""
import io
import json
import struct

import pytest
import zstandard as zstd

from sqreader.sqrx import (
    SqrxReader,
    SqrxWriter,
    SQRX_FORMAT_VERSION,
    SQRX_MAGIC,
)


def _write(path, server_id, dicts):
    with SqrxWriter(path, server_id) as w:
        for d in dicts:
            w.write_line(json.dumps(d))
    return path


def test_round_trip_lines_and_header(tmp_path):
    rows = [{"tick": i, "players": i * 2} for i in range(6)]
    p = _write(tmp_path / "r.sqrx", "altai-srv-1", rows)

    r = SqrxReader(p)
    assert r.format_version == SQRX_FORMAT_VERSION
    assert r.server_id == "altai-srv-1"
    assert r.created_ms > 0
    got = [json.loads(x) for x in r.lines()]
    r.close()
    assert got == rows


def test_server_id_utf8_round_trips(tmp_path):
    # Turkish server names must survive the UTF-8 length-prefixed header.
    name = "Altaı Sunucu — Kuşadası"
    p = _write(tmp_path / "u.sqrx", name, [{"a": 1}])
    with SqrxReader(p) as r:
        assert r.server_id == name
        assert list(r.lines()) == ['{"a": 1}']


def test_write_line_newline_normalization(tmp_path):
    # With or without a trailing newline the stored line is identical,
    # and the reader yields it without the newline.
    p = tmp_path / "n.sqrx"
    with SqrxWriter(p, "s") as w:
        n1 = w.write_line('{"x": 1}')       # no newline
        n2 = w.write_line('{"x": 2}\n')     # already has one
    assert n1 == len(b'{"x": 1}\n')
    assert n2 == len(b'{"x": 2}\n')
    with SqrxReader(p) as r:
        assert list(r.lines()) == ['{"x": 1}', '{"x": 2}']


def test_frames_written_counter(tmp_path):
    with SqrxWriter(tmp_path / "c.sqrx", "s") as w:
        assert w.frames_written == 0
        w.write_line("{}")
        w.write_line("{}")
        assert w.frames_written == 2


def test_empty_stream_has_no_lines(tmp_path):
    p = tmp_path / "e.sqrx"
    SqrxWriter(p, "s").close()  # header only, zero frames
    with SqrxReader(p) as r:
        assert list(r.lines()) == []


def test_truncation_recovers_prior_frames(tmp_path):
    # The whole point of one-zstd-frame-per-tick: a crash mid-write of
    # the final frame must never cost the frames already flushed.
    rows = [{"tick": i} for i in range(5)]
    p = _write(tmp_path / "t.sqrx", "s", rows)
    full = p.read_bytes()

    # Chop the tail so the last frame is incomplete.
    p.write_bytes(full[:-3])
    got = list(SqrxReader(p).lines())

    # The four complete frames survive and parse cleanly. (A partial
    # fifth line may or may not appear depending on where the cut landed;
    # the guarantee is only about the frames that were fully flushed.)
    assert len(got) >= 4
    assert [json.loads(x) for x in got[:4]] == rows[:4]


def test_truncation_dropping_whole_last_frame(tmp_path):
    rows = [{"tick": i} for i in range(5)]
    p = _write(tmp_path / "t2.sqrx", "s", rows)
    full = p.read_bytes()
    # Remove clearly more than one frame's worth of trailing bytes.
    p.write_bytes(full[:-15])
    got = [json.loads(x) for x in SqrxReader(p).lines()]
    # Every surviving line is intact and a strict prefix of the original.
    assert got == rows[: len(got)]
    assert len(got) >= 3


def test_bad_magic_rejected(tmp_path):
    p = tmp_path / "bad.sqrx"
    p.write_bytes(b"NOPE" + b"\x00" * 32)
    with pytest.raises(ValueError, match="not a .sqrx"):
        SqrxReader(p)


def test_unsupported_version_rejected(tmp_path):
    p = _write(tmp_path / "v.sqrx", "s", [{"a": 1}])
    raw = bytearray(p.read_bytes())
    # Bytes 4-5 are the little-endian u16 format_version; bump past it.
    struct.pack_into("<H", raw, 4, SQRX_FORMAT_VERSION + 99)
    p.write_bytes(raw)
    with pytest.raises(ValueError, match="unsupported .sqrx version"):
        SqrxReader(p)


def test_server_id_too_long_rejected(tmp_path):
    with pytest.raises(ValueError, match="server_id too long"):
        SqrxWriter(tmp_path / "big.sqrx", "x" * 70000)


def test_raw_body_round_trips_via_zstd(tmp_path):
    # raw_body() yields the on-disk compressed frames verbatim. Concatenated
    # independent zstd frames form ONE valid zstd stream, so a plain decoder —
    # e.g. the browser via `Content-Encoding: zstd` — recovers the exact NDJSON.
    rows = [{"tick": i, "players": list(range(i))} for i in range(6)]
    p = _write(tmp_path / "rb.sqrx", "altai-srv-1", rows)
    with SqrxReader(p) as r:
        body = b"".join(r.raw_body())
    ndjson = zstd.ZstdDecompressor().stream_reader(
        io.BytesIO(body), read_across_frames=True).read().decode("utf-8")
    got = [json.loads(x) for x in ndjson.splitlines() if x]
    assert got == rows


def test_raw_body_starts_after_header(tmp_path):
    # raw_body must begin at the body (after the 18-byte + server_id header),
    # never including the "SQRX" magic — else the client's zstd decoder chokes.
    p = _write(tmp_path / "rb2.sqrx", "srv", [{"a": 1}])
    with SqrxReader(p) as r:
        body = b"".join(r.raw_body())
    assert not body.startswith(SQRX_MAGIC)


def test_raw_body_empty_stream(tmp_path):
    # A header-only file (zero frames) has an empty body.
    p = tmp_path / "rbe.sqrx"
    SqrxWriter(p, "s").close()
    with SqrxReader(p) as r:
        assert b"".join(r.raw_body()) == b""
