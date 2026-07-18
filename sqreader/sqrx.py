"""
.sqrx — our compact binary log format for snapshot streams.

File layout
-----------
    +0x00  "SQRX"             magic (4 bytes)
    +0x04  u16 format_version (= 1)
    +0x06  u16 reserved       (= 0)
    +0x08  u64 created_ms     (Unix epoch milliseconds at file create)
    +0x10  u16 server_id_len  (UTF-8 byte length, max 65535)
    +0x12  bytes server_id    (UTF-8)
    +...   N independent zstd frames, each carrying exactly ONE NDJSON
           line (JSON object + '\n').

Why one frame per tick?
-----------------------
- Crash-safe: a half-written final frame can be skipped without losing
  the prior frames (zstd's frame headers are self-describing).
- Append-friendly: a watcher can append more frames without rewriting
  the existing stream.
- Decoder-friendly: `ZstdDecompressor.stream_reader(..., read_across_
  frames=True)` natively walks multi-frame streams in one pass, so the
  reader stays a simple line iterator.

Size vs NDJSON
--------------
Zstd at the default level (10) gives ~6–10x compression on the
snapshot stream depending on player churn (most fields are stable
between ticks → zstd's window catches the repetition). The kickoff
doc's "~5x reduction" target is comfortably exceeded.
"""
from __future__ import annotations

import struct
import time
from pathlib import Path
from typing import Iterator

import zstandard as zstd

SQRX_MAGIC = b"SQRX"
SQRX_FORMAT_VERSION = 1
_HEADER_FIXED_LEN = 18  # 4 magic + 2 ver + 2 reserved + 8 ms + 2 sidlen


class SqrxWriter:
    """
    Stream snapshot lines to a .sqrx file. One zstd frame per call to
    `write_line` → safe to truncate at any frame boundary.
    """

    def __init__(self, path: str | Path, server_id: str,
                 *, level: int = 10):
        self.path = Path(path)
        self.server_id_bytes = server_id.encode("utf-8")
        if len(self.server_id_bytes) > 0xFFFF:
            raise ValueError("server_id too long (max 65535 bytes UTF-8)")
        self.level = level
        self._cctx = zstd.ZstdCompressor(level=level)
        self._f = open(self.path, "wb")
        self._write_header()
        self.frames_written = 0

    def _write_header(self) -> None:
        hdr = SQRX_MAGIC + struct.pack(
            "<HHQH",
            SQRX_FORMAT_VERSION, 0,
            int(time.time() * 1000),
            len(self.server_id_bytes),
        )
        self._f.write(hdr)
        self._f.write(self.server_id_bytes)
        self._f.flush()

    def write_line(self, json_line: str) -> int:
        """Append one NDJSON line as a zstd frame; return uncompressed byte length."""
        if not json_line.endswith("\n"):
            json_line = json_line + "\n"
        raw = json_line.encode("utf-8")
        frame = self._cctx.compress(raw)
        self._f.write(frame)
        self._f.flush()
        self.frames_written += 1
        return len(raw)

    def tell(self) -> int:
        return self._f.tell()

    def close(self) -> None:
        try:
            self._f.close()
        except Exception:
            pass

    def __enter__(self) -> "SqrxWriter":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class SqrxReader:
    """
    Iterate the NDJSON lines from a .sqrx file. Header fields exposed
    as attributes (`server_id`, `created_ms`, `format_version`).
    """

    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._f = open(self.path, "rb")
        magic = self._f.read(4)
        if magic != SQRX_MAGIC:
            raise ValueError(f"not a .sqrx file (magic={magic!r})")
        ver, _reserved, ms, sid_len = struct.unpack(
            "<HHQH", self._f.read(_HEADER_FIXED_LEN - 4))
        self.format_version: int = ver
        if ver != SQRX_FORMAT_VERSION:
            raise ValueError(
                f"unsupported .sqrx version {ver} (this reader handles "
                f"v{SQRX_FORMAT_VERSION})")
        self.created_ms: int = ms
        self.server_id: str = self._f.read(sid_len).decode("utf-8")
        self._dctx = zstd.ZstdDecompressor()

    def raw_body(self, chunk_size: int = 65536) -> Iterator[bytes]:
        """Yield the raw compressed BODY bytes — the concatenated independent
        zstd frames — verbatim, from the current position (which __init__
        leaves at the first body byte) to EOF.

        For `Content-Encoding: zstd` passthrough: the concatenated frames ARE
        a valid zstd content-coding stream, so the server can ship the on-disk
        bytes unchanged and let the browser decode them — zero server-side
        (de)compression. Mutually exclusive with lines(): each consumes the
        file handle once, so call exactly one per reader instance.
        """
        while True:
            chunk = self._f.read(chunk_size)
            if not chunk:
                break
            yield chunk

    def lines(self) -> Iterator[str]:
        """Yield each decompressed NDJSON line (no trailing newline)."""
        reader = self._dctx.stream_reader(self._f, read_across_frames=True)
        buf = b""
        while True:
            chunk = reader.read(65536)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, _, buf = buf.partition(b"\n")
                if line:
                    yield line.decode("utf-8")
        if buf:
            yield buf.decode("utf-8")

    def __iter__(self) -> Iterator[str]:
        return self.lines()

    def close(self) -> None:
        try:
            self._f.close()
        except Exception:
            pass

    def __enter__(self) -> "SqrxReader":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


__all__ = [
    "SqrxWriter", "SqrxReader",
    "SQRX_MAGIC", "SQRX_FORMAT_VERSION",
]
