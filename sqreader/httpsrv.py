"""
Tiny HTTP server that serves finished match replays + persistent stats.
Pure stdlib — no aiohttp/FastAPI dependency.

This is the DISTRIBUTED (open-source) build: it deliberately serves NO live
view of the running match. There is no SSE tick stream, no latest-snapshot
endpoint, and only fully finalized recordings are served — an in-progress
(near-live) recording is refused. Watching a live match is a private-fork
capability, not something this build can expose. See docs/ for the rationale.

Endpoints
---------
    GET /                       landing page
    GET /viewer  /viewer.html   the canvas viewer (replay UI)
    GET /health                 producer liveness (last-tick age, plain text)
    GET /health/deep            rich JSON ops stats (build ms, cache sizes,
                                hit rates) — via the producer's callback
    GET /api/recordings         list FINALIZED .sqrx files with sidecar metadata
    GET /api/recording/<id>     decompressed NDJSON stream for one finished file
    GET /api/recording/<id>/meta  just the sidecar metadata for one file

The `/api/recordings*` endpoints only activate when the server is
started with a `recordings_dir` (passed through from
`sqreader serve --recordings-dir PATH`). Without it they 404.
"""
from __future__ import annotations

import http.server
import json
import os
import re
import socketserver
import threading
import time
import urllib.parse
import zlib
from pathlib import Path
from typing import Any, Optional

from .recording_lifecycle import (
    RECORDING_STATE_ACTIVE as _REC_STATE_ACTIVE,
    RECORDING_STATE_FINALIZED as _REC_STATE_FINALIZED,
    RECORDING_STATE_UNVERIFIED as _REC_STATE_UNVERIFIED,
)


# Freshness fallback for legacy sidecars that predate the durable lifecycle
# marker. Expiry can only remove this conservative hint; final authorization
# still requires stable same-server match context and valid metadata.
_IN_PROGRESS_WINDOW_SEC = 8

# Lifecycle and transition constants live in recording_lifecycle.py so the
# writer and authorization gate cannot silently drift to different policies.

# Id allowlist for /api/recording/<id> — bare filename without extension.
_REC_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")
# gzip level for the replay-stream FALLBACK path (clients that accept gzip but
# not zstd). NDJSON is highly redundant so even a low level shrinks it a lot;
# 6 is a safe CPU/ratio midpoint. The zstd-passthrough path spends zero CPU.
_REPLAY_GZIP_LEVEL = 6
# Player account id (OnlineUserId) — a UUID on current Squad (e.g.
# "ddea5914-b687-4df7-b96d-2f320f7dc057"); allow hyphens. Only a sanity gate —
# the value is always passed as a bound parameter, never string-formatted.
_EOS_RE = re.compile(r"^[A-Za-z0-9-]{16,64}$")

# Path validation for /icons/<category>/<file>: strict allowlist (no
# dotfiles, no traversal). Category and basename use distinct charsets
# so a slash anywhere in the basename is rejected at the regex level.
_ICON_PATH_RE = re.compile(
    r"^([A-Za-z0-9_-]+)/([A-Za-z0-9_.+-]+\.(?:png|svg|jpg|jpeg|webp|gif))$"
)
_ICON_MIME = {
    ".png": "image/png", ".svg": "image/svg+xml; charset=utf-8",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif",
}

# Map-texture name validation: the metadata's `layer.texture` field is
# the bare basename (no path, no extension). Restrict to safe chars.
_SQMAP_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_SQMAP_EXTS = (".webp", ".png", ".jpg", ".jpeg")


class _TickBeat:
    """Producer-liveness heartbeat for /health.

    A stalled producer keeps the listening socket open, so an "is the port up"
    check stays green while the reader has quietly frozen. The producer calls
    ``mark()`` after each tick; ``/health`` reports the age of the last mark so a
    monitor can tell a live server from a frozen one. Seeded at construction so a
    producer that never marks at all reads as increasingly stale, not
    forever-fresh.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last = time.monotonic()

    def mark(self) -> None:
        with self._lock:
            self._last = time.monotonic()

    @property
    def last_tick_age_sec(self) -> float:
        with self._lock:
            return time.monotonic() - self._last


# ---------- recordings helpers ----------------------------------------------

class _MetaCache:
    """
    Cache by both .sqrx and sidecar identity. Watching the sidecar is security-
    relevant: finalize_recording atomically replaces lifecycle metadata after
    closing the writer, often without a later .sqrx change.

    Self-heals missing sidecars by calling out to `recorder.extract_metadata`
    (lazy import to avoid a hard recorder dependency at server-startup time).
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cache: dict[
            str,
            tuple[
                tuple[int, int, int, int],
                Optional[tuple[int, int, int, int]],
                dict,
            ],
        ] = {}

    @staticmethod
    def _stat_sig(st: os.stat_result) -> tuple[int, int, int, int]:
        return st.st_mtime_ns, st.st_ctime_ns, st.st_size, st.st_ino

    @classmethod
    def _sidecar_sig(
        cls, sqrx_path: Path
    ) -> Optional[tuple[int, int, int, int]]:
        try:
            st = sqrx_path.with_suffix(".meta.json").stat()
            return cls._stat_sig(st)
        except OSError:
            return None

    def get(self, sqrx_path: Path) -> Optional[dict]:
        key = sqrx_path.name
        last_st: Optional[os.stat_result] = None

        # Metadata and its signatures must describe the same filesystem
        # snapshot.  An atomic active->finalized sidecar replacement can race
        # this read; retry instead of caching old content under the new file's
        # identity.  Persistent churn returns an unverified stub (fail closed).
        for _attempt in range(3):
            try:
                st_before = sqrx_path.stat()
            except FileNotFoundError:
                return None
            last_st = st_before
            sqrx_sig = self._stat_sig(st_before)
            side_sig = self._sidecar_sig(sqrx_path)

            with self._lock:
                entry = self._cache.get(key)
            if entry and entry[0] == sqrx_sig and entry[1] == side_sig:
                # Recheck after fetching the entry so a concurrent replacement
                # cannot be mistaken for a stable cache hit.
                try:
                    st_after = sqrx_path.stat()
                except FileNotFoundError:
                    return None
                if (self._stat_sig(st_after) == sqrx_sig
                        and self._sidecar_sig(sqrx_path) == side_sig):
                    return self._mark_in_progress(entry[2], st_after.st_mtime)
                continue

            meta = self._load(sqrx_path, st_before)
            if meta is None:
                return None
            try:
                st_after = sqrx_path.stat()
            except FileNotFoundError:
                return None
            side_sig_after = self._sidecar_sig(sqrx_path)
            if (self._stat_sig(st_after) != sqrx_sig
                    or side_sig_after != side_sig):
                continue

            with self._lock:
                self._cache[key] = (sqrx_sig, side_sig, meta)
            return self._mark_in_progress(meta, st_after.st_mtime)

        if last_st is None:
            return None
        return _stub_meta(sqrx_path, last_st)

    def _mark_in_progress(self, meta: dict, mtime: float) -> dict:
        # Don't mutate the cached dict.  Explicit lifecycle state is
        # authoritative and never expires with wall-clock age.  mtime remains
        # only as a conservative signal for legacy sidecars written before the
        # lifecycle field existed. The recording handlers serve a file only when
        # recordingState is "finalized" (inProgress False), so an "active" /
        # "unverified" / legacy-recent file is never exposed as a near-live view.
        out = dict(meta)
        state = out.get("recordingState")
        if state == _REC_STATE_FINALIZED and out.get("inProgress") is False:
            out["inProgress"] = False
        elif state in (_REC_STATE_ACTIVE, _REC_STATE_UNVERIFIED):
            out["inProgress"] = True
        else:
            out["inProgress"] = (
                (time.time() - mtime) < _IN_PROGRESS_WINDOW_SEC)
        return out

    def _load(self, sqrx_path: Path, st: os.stat_result) -> Optional[dict]:
        sidecar = sqrx_path.with_suffix(".meta.json")
        if sidecar.exists():
            try:
                loaded = json.loads(sidecar.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    return loaded
            except (json.JSONDecodeError, OSError):
                pass  # fall through to self-heal
        # Self-heal: extract by scanning the .sqrx. Skip on in-progress
        # files (they're still being written; extracting mid-write would
        # give wrong tick counts).
        if (time.time() - st.st_mtime) < _IN_PROGRESS_WINDOW_SEC:
            return _stub_meta(sqrx_path, st)
        try:
            from .recorder import extract_metadata
            meta = extract_metadata(sqrx_path)
        except Exception:
            return _stub_meta(sqrx_path, st)
        try:
            tmp = sidecar.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(meta, indent=2), encoding="utf-8")
            os.replace(tmp, sidecar)
        except OSError:
            pass  # cache miss next time, no big deal
        return meta


def _stub_meta(sqrx_path: Path, st: os.stat_result) -> dict:
    """Minimum-viable meta when no sidecar exists yet (recording in flight)."""
    return {
        "id": sqrx_path.stem,
        "filename": sqrx_path.name,
        "sizeBytes": st.st_size,
        "ticks": None,
        "durationSec": None,
        "startedAtUtc": None,
        "endedAtUtc": None,
        "serverId": None,
        "mapName": None,
        "gameMode": None,
        "layerName": None,
        "matchId": None,
        "peakPlayers": None,
        "recordingState": _REC_STATE_UNVERIFIED,
        "inProgress": True,
    }


_SQMAP_STRIP_SUFFIX_RE = re.compile(
    r"(_Minimap(_Large)?|_Skirmish(_v\d+)?|_Seed(_v\d+)?|_RAAS(_v\d+)?|"
    r"_AAS(_v\d+)?|_Invasion(_v\d+)?|_TC(_v\d+)?|_v\d+)+$",
    re.IGNORECASE,
)
_SQMAP_FIRST_WORD_RE = re.compile(r"[A-Z][a-z]+|[a-z]+")


def _resolve_sqmap(sqmaps_dir: Path, name: str) -> Optional[Path]:
    """
    Match the metadata's `layer.texture` (e.g. 'Fallujah_Minimap' or
    'T_AlBasrah_Minimap') against the actual files on disk. Priority:

        1. exact                  Fallujah_Minimap.webp
        2. stripped suffix        Fallujah.webp           — overrides stock
        3. T_-prefixed stock      T_Fallujah_Minimap.webp
        4. lowercase fallbacks    fallujah.webp
        5. lowercase, no underscores
                                  foolsroad.webp  (from Fools_Road_Minimap)
                                  blackcoast.webp (from Black_Coast_Minimap)
        6. lowercase first word   pacific.webp (from PacificProvingGrounds_V1_Minimap)
                                  logar.webp   (from Logar_Valley_Minimap)

    Both the original `name` AND a `T_`-leading-stripped variant get the
    full candidate ladder, so `T_AlBasrah_Minimap` resolves to
    `albasrah.webp` via (without-T_ → strip-suffix → lowercase →
    "albasrah"). The stripped-name slot lets users drop a bare
    `<MapName>.webp` to upgrade resolution; slots (5) and (6) accept
    short user-aliases for compound names.
    """
    # Some metadata texture values come pre-prefixed with T_ (Squad's
    # internal asset naming). Strip a leading T_ once and run the full
    # candidate ladder on the bare name too — that way the user's
    # `<MapName>.webp` always has a shot at matching.
    bare = name[2:] if name.startswith("T_") else name

    def variants(s: str) -> list[str | None]:
        stripped = _SQMAP_STRIP_SUFFIX_RE.sub("", s)
        m = _SQMAP_FIRST_WORD_RE.match(stripped)
        first_camel = m.group(0).lower() if m else None
        first_underscore = stripped.split("_")[0].lower() or None
        no_under_lower = stripped.lower().replace("_", "") or None
        no_under_cased = stripped.replace("_", "") or None
        # Title-case the stripped name so a lowercased metadata texture
        # (e.g. 'gorodok_minimap') matches a bare `Gorodok.webp` on a
        # case-sensitive filesystem. Linux serves are case-sensitive;
        # without this `Gorodok` failed to match `gorodok` despite the
        # rest of the ladder having both forms.
        stripped_title = stripped[:1].upper() + stripped[1:].lower() \
                         if stripped else None
        first_camel_title = first_camel[:1].upper() + first_camel[1:].lower() \
                            if first_camel else None
        return [
            s,
            stripped if stripped != s else None,
            stripped_title if stripped_title not in (None, stripped) else None,
            no_under_cased if no_under_cased != stripped else None,
            f"T_{s}",
            f"T_{stripped}" if stripped != s else None,
            f"T_{stripped_title}" if stripped_title not in (None, stripped) else None,
            s.lower(),
            stripped.lower() if stripped != s else None,
            no_under_lower if no_under_lower not in (None, stripped.lower()) else None,
            first_camel,
            first_camel_title if first_camel_title not in (None, first_camel) else None,
            first_underscore if first_underscore != first_camel else None,
            f"T_{s}".lower(),
        ]

    candidates = variants(name) + (variants(bare) if bare != name else [])
    seen = set()
    for stem in candidates:
        if not stem or stem in seen:
            continue
        seen.add(stem)
        for ext in _SQMAP_EXTS:
            p = sqmaps_dir / f"{stem}{ext}"
            if p.is_file():
                return p
    return None


def _make_handler(
    heartbeat: _TickBeat,
    recordings_dir: Optional[Path],
    meta_cache: Optional[_MetaCache],
    icons_dir: Optional[Path],
    sqmaps_dir: Optional[Path],
    frontend_dir: Optional[Path],
    health_provider=None,
    stale_after_sec: float = 30.0,
    cors_origin: str = "",
    stats_db: Optional[Path] = None,
) -> type[http.server.BaseHTTPRequestHandler]:

    # Static layer bounds, for turning heatmap world coordinates into something
    # the client can draw. Loaded lazily and kept: `serve` should not pay to read
    # the data dir when nobody ever asks for a heatmap, and it should not re-read
    # it per request either. The box also caches the failure (None), so a missing
    # data dir costs one attempt, not one per request.
    _metadata_box: list[Any] = []

    def _layer_bounds(layer_name: Optional[str]) -> Optional[dict]:
        if not layer_name:
            return None
        if not _metadata_box:
            try:
                from .squad.metadata import Metadata
                _metadata_box.append(Metadata.load())
            except Exception:
                _metadata_box.append(None)
        md = _metadata_box[0]
        if md is None:
            return None
        try:
            return md.layer_bounds_for(layer_name)
        except Exception:
            return None

    class _H(http.server.BaseHTTPRequestHandler):
        # silence stdlib's per-request logging — too noisy at 5 Hz
        def log_message(self, *_args) -> None:
            pass

        def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
            path = self.path.split("?", 1)[0]
            # /api/recording/<id>[/meta] — variable path, handle first
            if path.startswith("/api/recording/"):
                self._handle_recording_one(path[len("/api/recording/"):])
                return
            if path.startswith("/api/players/") and path != "/api/players/":
                self._handle_player_profile(path[len("/api/players/"):])
                return
            if path.startswith("/api/match/") and path != "/api/match/":
                self._handle_match_detail(path[len("/api/match/"):])
                return
            if path.startswith("/icons/"):
                self._handle_icon(path[len("/icons/"):])
                return
            if path.startswith("/sqmaps/"):
                self._handle_sqmap(path[len("/sqmaps/"):])
                return
            if path in ("/api/recordings", "/api/recordings/"):
                self._handle_recordings_list()
            elif path in ("/api/players", "/api/players/"):
                self._handle_players_search()
            elif path in ("/api/leaderboard", "/api/leaderboard/"):
                self._handle_leaderboard()
            elif path in ("/api/weapons", "/api/weapons/"):
                self._handle_weapon_meta()
            elif path in ("/api/heatmap", "/api/heatmap/"):
                self._handle_heatmap()
            elif path in ("/api/matches", "/api/matches/"):
                self._handle_matches()
            elif path in ("/api/layers", "/api/layers/"):
                self._handle_layers()
            elif path in ("/health/deep", "/api/health/deep"):
                self._handle_health_deep()
            elif path in ("/health", "/healthz"):
                self._handle_health()
            elif path in ("/", "", "/viewer", "/viewer.html",
                          "/viewer-next", "/viewer-next/") \
                    or path.startswith("/assets/"):
                self._handle_spa(path)
            else:
                self.send_error(404, "no such endpoint")

        def _send_cors_headers(self) -> None:
            # Off unless someone deliberately opts in. Every real deployment is
            # same-origin — nginx mounts the viewer and the API under one prefix,
            # and the dev server proxies — so nothing here needed CORS, while the
            # `*` that used to sit here let ANY page on the internet read live
            # player positions and pull the entire match archive cross-origin.
            if cors_origin:
                self.send_header("Access-Control-Allow-Origin", cors_origin)

        def _negotiate_encoding(self, *, allow_zstd: bool) -> str:
            """Pick a Content-Encoding from the request's Accept-Encoding:
            'zstd' | 'gzip' | 'identity'. zstd wins when offered AND allowed
            (finalized files only — see the recording handler); else gzip if
            offered; else identity. Tokens with an explicit q=0 are treated as
            not acceptable; a missing header → identity (today's behavior)."""
            raw = self.headers.get("Accept-Encoding", "")
            accepted: set[str] = set()
            for part in raw.split(","):
                tok = part.strip().lower()
                if not tok:
                    continue
                name, _, params = tok.partition(";")
                name = name.strip()
                q = 1.0
                if "q=" in params:
                    try:
                        q = float(params.split("q=", 1)[1])
                    except ValueError:
                        q = 1.0
                if q > 0:
                    accepted.add(name)
            if allow_zstd and "zstd" in accepted:
                return "zstd"
            if "gzip" in accepted:
                return "gzip"
            return "identity"

        def _handle_health(self) -> None:
            # A stalled producer keeps its SSE clients and its keepalives, so an
            # "is the port open" check stays green while the map quietly freezes.
            # Report the age of the last tick and fail the check once it is old
            # enough that no healthy cadence could explain it, so a monitor sees
            # the freeze instead of a reassuring OK.
            age = heartbeat.last_tick_age_sec
            stale = age > stale_after_sec
            body = (f"{'STALE' if stale else 'OK'}\n"
                    f"lastTickAgeSec={age:.1f}\n"
                    f"staleAfterSec={stale_after_sec:.1f}\n").encode()
            self.send_response(503 if stale else 200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _handle_health_deep(self) -> None:
            """Rich JSON ops snapshot (build timing, cache stats, ...).

            Content comes from the producer's `health_provider` callback
            — the HTTP layer stays ignorant of scanner internals. 404s
            when the server was started without a provider (e.g. tests).

            OPS ONLY: it hands out the target pid and the resolved GUObjectArray /
            FNamePool addresses, which is the reader's whole attack surface. Reach
            it by ssh + curl on the box, not through the public vhost.

            A loopback check cannot express that — nginx proxies FROM loopback, so
            every public request already looks local. The proxy hop is the thing we
            can actually see: nginx always stamps X-Real-IP / X-Forwarded-For, and
            a direct local call never does. 404 rather than 403 so a probe through
            the vhost learns nothing about it.
            """
            if (self.headers.get("X-Real-IP")
                    or self.headers.get("X-Forwarded-For")):
                self.send_error(404, "no such endpoint")
                return
            if health_provider is None:
                self.send_error(404, "deep health disabled "
                                "(no health provider wired)")
                return
            try:
                payload = health_provider()
            except Exception as e:  # provider must never kill the server
                payload = {"error": repr(e)}
            body = json.dumps(payload, ensure_ascii=False,
                              default=str).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _handle_icon(self, tail: str) -> None:
            if icons_dir is None:
                self.send_error(404, "icons disabled (server started "
                                "without --icons-dir)")
                return
            m = _ICON_PATH_RE.match(tail)
            if not m:
                self.send_error(400, "bad icon path")
                return
            category, fname = m.group(1), m.group(2)
            path = icons_dir / category / fname
            try:
                # Resolve to make sure the path stays inside icons_dir even
                # if a clever name slips past the regex (defense in depth).
                resolved = path.resolve()
                resolved.relative_to(icons_dir.resolve())
            except ValueError:
                self.send_error(400, "icon path escapes root")
                return
            try:
                st = resolved.stat()
                body = resolved.read_bytes()
            except FileNotFoundError:
                self.send_error(404, "no such icon")
                return
            etag = f'W/"{int(st.st_mtime)}-{st.st_size}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.end_headers()
                return
            ext = resolved.suffix.lower()
            self.send_response(200)
            self.send_header("Content-Type",
                             _ICON_MIME.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            # Short max-age + ETag: browsers revalidate within a
            # minute and we 304 unchanged files cheaply, so we get
            # both "fast" (cached) and "fresh" (instant on swap).
            self.send_header("Cache-Control", "public, max-age=60, must-revalidate")
            self.send_header("ETag", etag)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _handle_sqmap(self, name: str) -> None:
            if sqmaps_dir is None:
                self.send_error(404, "sqmaps disabled (server started "
                                "without --sqmaps-dir)")
                return
            # Strip a trailing extension if the client included one — we
            # do the lookup against the bare stem.
            for ext in _SQMAP_EXTS:
                if name.lower().endswith(ext):
                    name = name[: -len(ext)]
                    break
            if not _SQMAP_NAME_RE.match(name):
                self.send_error(400, "bad sqmap name")
                return
            path = _resolve_sqmap(sqmaps_dir, name)
            if path is None:
                self.send_error(404, f"no such map texture: {name}")
                return
            try:
                st = path.stat()
                body = path.read_bytes()
            except OSError:
                self.send_error(500, "failed to read map texture")
                return
            # ETag tied to mtime + size — when the user drops a fresh
            # file, the etag changes and the browser revalidates and
            # downloads the new bytes. Short max-age also nudges
            # browsers that don't honour ETag-only flow.
            etag = f'W/"{int(st.st_mtime)}-{st.st_size}"'
            if self.headers.get("If-None-Match") == etag:
                self.send_response(304)
                self.send_header("ETag", etag)
                self.end_headers()
                return
            ext = path.suffix.lower()
            self.send_response(200)
            self.send_header("Content-Type",
                             _ICON_MIME.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public, max-age=60, must-revalidate")
            self.send_header("ETag", etag)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _handle_spa(self, path: str) -> None:
            """
            Serve the Vite-built SPA.

            Routes:
              /                                  → index.html
              /viewer  /viewer.html  /viewer-next → index.html (aliases)
              /assets/<hashed>                   → dist/assets/<hashed>

            /viewer-next stays as a legacy alias for any bookmarks
            from the Phase 1 migration window.
            """
            if frontend_dir is None:
                self.send_error(404, "frontend disabled (server started "
                                "without --frontend-dir)")
                return
            if path in ("/", "/viewer", "/viewer.html",
                        "/viewer-next", "/viewer-next/"):
                target = frontend_dir / "index.html"
                ctype = "text/html; charset=utf-8"
                cache = "no-cache"
            elif path.startswith("/assets/"):
                # Hashed bundle filenames, safe to long-cache.
                rel = path[len("/assets/"):]
                if not re.match(r"^[A-Za-z0-9_.\-]+$", rel):
                    self.send_error(400, "bad asset path")
                    return
                target = frontend_dir / "assets" / rel
                # Vite emits .js/.css/.svg/.woff etc. Map by extension.
                ext = target.suffix.lower()
                ctype = {
                    ".js":  "application/javascript; charset=utf-8",
                    ".mjs": "application/javascript; charset=utf-8",
                    ".css": "text/css; charset=utf-8",
                    ".map": "application/json; charset=utf-8",
                    ".svg": "image/svg+xml; charset=utf-8",
                    ".woff":  "font/woff",
                    ".woff2": "font/woff2",
                    ".png": "image/png",
                    ".webp": "image/webp",
                }.get(ext, "application/octet-stream")
                cache = "public, max-age=31536000, immutable"
            else:
                self.send_error(404, "no such SPA path")
                return
            try:
                body = target.read_bytes()
            except FileNotFoundError:
                self.send_error(404, f"not found: {target.name}")
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(body)

        # ---------- /api/players + /api/leaderboard (persistent stats) ----------

        def _stats_db_or_404(self) -> Optional[Path]:
            """The stats DB path, or None once a 404 has been sent.

            Hands back the path rather than a bool: a bool guard narrows
            nothing, so every call site downstream still looked like it might
            be passing None into a query.
            """
            if stats_db is None:
                self.send_error(404, "stats disabled "
                                "(server started without --stats-db)")
                return None
            return stats_db

        def _query(self) -> dict:
            parts = self.path.split("?", 1)
            return urllib.parse.parse_qs(parts[1]) if len(parts) == 2 else {}

        def _send_json(self, obj) -> None:
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _handle_players_search(self) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            qs = self._query()
            q = qs.get("q", [""])[0].strip()
            try:
                limit = int(qs.get("limit", ["30"])[0])
            except (ValueError, TypeError):
                limit = 30
            try:
                from .stats import search_players
                self._send_json(search_players(db, q, limit))
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")

        def _handle_player_profile(self, tail: str) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            eos = tail.rstrip("/")
            if not _EOS_RE.match(eos):
                self.send_error(400, "bad eos id")
                return
            try:
                from .stats import player_profile
                prof = player_profile(db, eos)
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")
                return
            if prof is None:
                self.send_error(404, "no such player")
                return
            self._send_json(prof)

        def _handle_leaderboard(self) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            qs = self._query()
            stat = qs.get("stat", ["kills"])[0]
            period = qs.get("period", ["alltime"])[0]
            try:
                limit = int(qs.get("limit", ["50"])[0])
            except (ValueError, TypeError):
                limit = 50
            try:
                from .stats import leaderboard
                self._send_json(leaderboard(db, stat, limit, period))
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")

        def _handle_weapon_meta(self) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            qs = self._query()
            period = qs.get("period", ["alltime"])[0]
            try:
                limit = int(qs.get("limit", ["40"])[0])
            except (ValueError, TypeError):
                limit = 40
            try:
                from .stats import weapon_meta
                self._send_json(weapon_meta(db, period, limit))
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")

        def _handle_layers(self) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            try:
                from .stats import layers_with_kills
                self._send_json(layers_with_kills(db))
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")

        def _handle_matches(self) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            qs = self._query()
            period = qs.get("period", ["alltime"])[0]
            try:
                limit = int(qs.get("limit", ["50"])[0])
            except (ValueError, TypeError):
                limit = 50
            try:
                from .stats import list_matches
                self._send_json(list_matches(db, limit, period))
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")

        def _handle_match_detail(self, tail: str) -> None:
            db = self._stats_db_or_404()
            if db is None:
                return
            match_id = tail.rstrip("/")
            if not match_id:
                self.send_error(400, "no match id")
                return
            try:
                from .stats import match_detail
                out = match_detail(db, match_id)
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")
                return
            if out is None:
                self.send_error(404, "no such match")
                return
            self._send_json(out)

        def _handle_heatmap(self) -> None:
            """?match=<id> for one match's kill points, ?layer=<name> for the
            aggregated death grid across every match on that layer."""
            db = self._stats_db_or_404()
            if db is None:
                return
            qs = self._query()
            match_id = (qs.get("match", [""])[0] or "").strip()
            layer = (qs.get("layer", [""])[0] or "").strip()
            if not match_id and not layer:
                self.send_error(400, "need ?match=<id> or ?layer=<name>")
                return
            try:
                if match_id:
                    from .stats import match_heatmap
                    out = match_heatmap(db, match_id)
                    if out is None:
                        self.send_error(404, "no such match")
                        return
                else:
                    from .stats import map_heatmap
                    period = qs.get("period", ["alltime"])[0]
                    try:
                        cell = int(qs.get("cell", ["5000"])[0])
                    except (ValueError, TypeError):
                        cell = 5000
                    out = map_heatmap(db, layer, period, cell)
                # Bounds ride along with the data so the client needs no second
                # request and no static copy of the map table. Null when we do
                # not know the layer — the UI must say so, not invent an extent.
                out["bounds"] = _layer_bounds(out.get("layerName"))
                self._send_json(out)
            except Exception as e:
                self.send_error(500, f"stats query failed: {e!r}")

        # ---------- /api/recordings ----------

        def _recordings_dir_or_404(self) -> Optional[Path]:
            """The recordings dir, or None once a 404 has been sent.

            Same shape as _stats_db_or_404 — see the note there.
            """
            if recordings_dir is None:
                self.send_error(404, "recordings disabled "
                                "(server started without --recordings-dir)")
                return None
            return recordings_dir

        def _handle_recordings_list(self) -> None:
            rec_dir = self._recordings_dir_or_404()
            if rec_dir is None:
                return
            # Snapshot mtimes defensively: the retention sweep / recorder
            # rotation can unlink a .sqrx between the glob and the stat, and an
            # unguarded stat() in the sort key would abort the whole listing.
            by_mtime = []
            for sqrx in rec_dir.glob("*.sqrx"):
                try:
                    by_mtime.append((sqrx.stat().st_mtime, sqrx))
                except OSError:
                    continue  # vanished / unreadable — skip it
            by_mtime.sort(key=lambda t: t[0], reverse=True)
            # Only FINALIZED recordings are listed — the same fail-closed rule
            # the single-recording handler enforces. An actively-recording
            # ("active") or shutdown-interrupted ("unverified") file is a
            # near-live view and is omitted, so the distributed build never
            # advertises a match still in play.
            entries = []
            for _mtime, sqrx in by_mtime:
                meta = meta_cache.get(sqrx) if meta_cache else None
                if (meta is not None
                        and meta.get("recordingState") == _REC_STATE_FINALIZED
                        and meta.get("inProgress") is False):
                    entries.append(meta)
            body = json.dumps(entries, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _handle_recording_one(self, tail: str) -> None:
            rec_dir = self._recordings_dir_or_404()
            if rec_dir is None:
                return
            # tail = "<id>" or "<id>/meta"
            want_meta = False
            if tail.endswith("/meta"):
                want_meta = True
                rec_id = tail[: -len("/meta")]
            else:
                rec_id = tail.rstrip("/")
            if not _REC_ID_RE.match(rec_id):
                self.send_error(400, "bad recording id")
                return
            sqrx = rec_dir / f"{rec_id}.sqrx"
            if not sqrx.exists():
                self.send_error(404, "no such recording")
                return
            # SECURITY (distributed build): serve ONLY a recording whose sidecar
            # proves the match cleanly ended. `finalize_recording` writes
            # recordingState="finalized" (inProgress=False) only after the match
            # transition is confirmed; an actively-recording file stays "active"
            # and a shutdown-interrupted partial stays "unverified" — both keep
            # inProgress=True. So this single finalized-and-not-in-progress test
            # excludes every near-live view of the running match without needing
            # any live match-context oracle. FAILS CLOSED: missing/unreadable
            # meta (None) is refused too. 404 (not 403) so a probe cannot tell a
            # mid-match file from a non-existent one.
            meta = meta_cache.get(sqrx) if meta_cache else None
            if (meta is None
                    or meta.get("recordingState") != _REC_STATE_FINALIZED
                    or meta.get("inProgress") is not False):
                self.send_error(404, "no such recording")
                return
            if want_meta:
                body = json.dumps(meta, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(body)
                return
            # ---- Full NDJSON stream: content-negotiated encoding + caching ----
            # The on-disk .sqrx is ~6-10x smaller than the NDJSON it decodes to.
            # We used to decompress it and ship full-size plaintext, uncached —
            # every open re-transferred ~6-10x the on-disk bytes. Now:
            #   * zstd passthrough: ship the raw .sqrx body verbatim (the browser
            #     decodes) — smallest transfer, ZERO server (de)compression.
            #   * gzip: compress the NDJSON on the fly for clients without zstd.
            #   * identity: unchanged fallback.
            # plus ETag/immutable caching so repeat opens hit the browser cache.
            from .sqrx import SqrxReader

            # Only finalized (immutable) recordings reach here — the gate above
            # 404s everything else — so zstd passthrough and long-lived caching
            # are always safe.
            finalized = True
            enc = self._negotiate_encoding(allow_zstd=finalized)

            etag: str | None = None
            if finalized:
                _st = sqrx.stat()
                # Encoding is part of the representation, so it is baked into the
                # ETag (belt-and-suspenders with Vary: Accept-Encoding below, so a
                # shared cache can't hand a gzip body to a zstd-expecting client).
                etag = f'"{rec_id}-{_st.st_size}-{_st.st_mtime_ns}-{enc}"'
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.send_header("ETag", etag)
                    self.send_header(
                        "Cache-Control", "public, max-age=31536000, immutable")
                    self.send_header("Vary", "Accept-Encoding")
                    self._send_cors_headers()
                    self.end_headers()
                    return

            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Transfer-Encoding", "chunked")
            self.send_header("Vary", "Accept-Encoding")
            if enc != "identity":
                self.send_header("Content-Encoding", enc)
            if finalized and etag is not None:
                self.send_header(
                    "Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("ETag", etag)
            else:
                self.send_header("Cache-Control", "no-cache")
            self._send_cors_headers()
            self.end_headers()

            def _chunk(data: bytes) -> None:
                # HTTP/1.1 chunked: hex-length + \r\n + data + \r\n. Never emit a
                # zero-length chunk — that byte sequence terminates the body.
                if data:
                    self.wfile.write(
                        f"{len(data):x}\r\n".encode("ascii") + data + b"\r\n")

            try:
                with SqrxReader(sqrx) as r:
                    if enc == "zstd":
                        for raw in r.raw_body():
                            _chunk(raw)
                    elif enc == "gzip":
                        co = zlib.compressobj(
                            _REPLAY_GZIP_LEVEL, zlib.DEFLATED, 31)  # 31 → gzip
                        for line in r:
                            _chunk(co.compress(line.encode("utf-8") + b"\n"))
                        _chunk(co.flush())  # Z_FINISH: emit gzip trailer
                    else:  # identity — original behavior
                        for line in r:
                            _chunk(line.encode("utf-8") + b"\n")
                self.wfile.write(b"0\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError,
                    ConnectionAbortedError):
                pass

    return _H


class _ThreadingHTTPServer(socketserver.ThreadingMixIn,
                           http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve_in_background(host: str, port: int, heartbeat: _TickBeat,
                        *, recordings_dir: Optional[Path] = None,
                        icons_dir: Optional[Path] = None,
                        sqmaps_dir: Optional[Path] = None,
                        frontend_dir: Optional[Path] = None,
                        health_provider=None,
                        stale_after_sec: float = 30.0,
                        cors_origin: str = "",
                        stats_db: Optional[Path] = None,
                        ) -> _ThreadingHTTPServer:
    """Bind and start the server on a daemon thread; return the server.

    This is the distributed (open-source) build: it serves finished replays +
    stats only, with no live view. The producer calls ``heartbeat.mark()`` after
    each tick so ``/health`` can distinguish a live server from a frozen one.

    Only FINALIZED recordings are served; an in-progress (near-live) recording
    is refused — see `_handle_recording_one`. There is no live-access gate to
    configure because there is no live surface to gate.

    `stale_after_sec` is how long /health tolerates silence from the producer
    before reporting STALE (503). Size it well above the tick period: a stall
    that short is normal jitter, not a freeze.

    `cors_origin` is empty (no CORS) unless a cross-origin viewer genuinely needs
    it — see `_send_cors_headers`.
    """
    meta_cache = _MetaCache() if recordings_dir is not None else None
    srv = _ThreadingHTTPServer(
        (host, port),
        _make_handler(heartbeat, recordings_dir, meta_cache, icons_dir,
                      sqmaps_dir, frontend_dir, health_provider,
                      stale_after_sec, cors_origin, stats_db),
    )
    t = threading.Thread(target=srv.serve_forever, daemon=True,
                         name="sqreader-httpsrv")
    t.start()
    return srv


__all__ = ["serve_in_background", "_TickBeat"]
