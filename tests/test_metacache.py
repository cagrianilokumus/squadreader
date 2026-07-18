"""Metadata-cache regression tests.

Covers `_MetaCache`: sidecar loading, cache invalidation on sidecar/size
change, fail-closed stubs for missing/corrupt sidecars, and the lifecycle
`inProgress` flag. The live-context authorization gate lives on the private
`live` branch; this (distributed) build serves finalized recordings only and
never a near-live view — see test_public_no_live.py for that HTTP contract.
"""
import json
import os
import time

from sqreader.httpsrv import _MetaCache, _IN_PROGRESS_WINDOW_SEC


def _touch_sqrx(path, mtime=None):
    path.write_bytes(b"SQRX\x00\x00\x00\x00dummy-bytes")
    if mtime is not None:
        os.utime(path, (mtime, mtime))


def _sidecar(path, meta):
    path.with_suffix(".meta.json").write_text(json.dumps(meta), encoding="utf-8")


def test_missing_sqrx_returns_none(tmp_path):
    assert _MetaCache().get(tmp_path / "nope.sqrx") is None


def test_sidecar_is_loaded(tmp_path):
    p = tmp_path / "rec.sqrx"
    _touch_sqrx(p)
    _sidecar(p, {"id": "rec", "ticks": 1200, "mapName": "Fallujah"})

    meta = _MetaCache().get(p)
    assert meta["id"] == "rec"
    assert meta["ticks"] == 1200
    assert meta["mapName"] == "Fallujah"
    assert "inProgress" in meta


def test_in_progress_flag_reflects_mtime(tmp_path):
    p = tmp_path / "rec.sqrx"
    _sidecar_meta = {"id": "rec", "ticks": 10}

    # Freshly-written file (mtime ~ now) → still being recorded.
    _touch_sqrx(p, mtime=time.time())
    _sidecar(p, _sidecar_meta)
    assert _MetaCache().get(p)["inProgress"] is True

    # Old file (mtime well past the window) → finished.
    old = time.time() - (_IN_PROGRESS_WINDOW_SEC + 3600)
    _touch_sqrx(p, mtime=old)
    _sidecar(p, _sidecar_meta)
    assert _MetaCache().get(p)["inProgress"] is False


def test_sidecar_removal_invalidates_cache_and_fails_closed(tmp_path):
    p = tmp_path / "rec.sqrx"
    old = time.time() - (_IN_PROGRESS_WINDOW_SEC + 3600)
    _touch_sqrx(p, mtime=old)
    _sidecar(p, {"id": "rec", "ticks": 777})

    mc = _MetaCache()
    first = mc.get(p)
    assert first["ticks"] == 777

    # Sidecar identity is part of the cache key. Losing the only lifecycle
    # evidence must invalidate the cached result and fail closed even though
    # the .sqrx itself did not change.
    p.with_suffix(".meta.json").unlink()
    second = mc.get(p)
    assert second["ticks"] is None
    assert second["recordingState"] == "unverified"
    assert second["inProgress"] is True


def test_size_change_invalidates_cache(tmp_path):
    p = tmp_path / "rec.sqrx"
    old = time.time() - (_IN_PROGRESS_WINDOW_SEC + 3600)
    _touch_sqrx(p, mtime=old)
    _sidecar(p, {"id": "rec", "ticks": 100})

    mc = _MetaCache()
    assert mc.get(p)["ticks"] == 100

    # A grown file (still being appended) + refreshed sidecar must be
    # re-read, not served stale from the cache.
    p.write_bytes(b"SQRX\x00\x00\x00\x00dummy-bytes-now-longer")
    os.utime(p, (old, old))  # keep it "finished" so we read the sidecar
    _sidecar(p, {"id": "rec", "ticks": 200})
    assert mc.get(p)["ticks"] == 200


def test_fresh_file_without_sidecar_returns_stub(tmp_path):
    # Recording just started, no sidecar yet: a stub is synthesized
    # (never a re-scan of the half-written stream).
    p = tmp_path / "live.sqrx"
    _touch_sqrx(p, mtime=time.time())

    meta = _MetaCache().get(p)
    assert meta["id"] == "live"
    assert meta["ticks"] is None
    assert meta["recordingState"] == "unverified"
    assert meta["inProgress"] is True


def test_non_object_sidecar_is_unverified_not_trusted(tmp_path):
    p = tmp_path / "corrupt.sqrx"
    old = time.time() - (_IN_PROGRESS_WINDOW_SEC + 3600)
    _touch_sqrx(p, mtime=old)
    p.with_suffix(".meta.json").write_text("[]", encoding="utf-8")

    meta = _MetaCache().get(p)
    assert meta["recordingState"] == "unverified"
    assert meta["inProgress"] is True


def test_explicit_active_state_never_expires_with_mtime(tmp_path):
    p = tmp_path / "live.sqrx"
    old = time.time() - 86_400
    _touch_sqrx(p, mtime=old)
    _sidecar(p, {
        "id": "live", "matchId": "match-a",
        "recordingState": "active", "inProgress": True,
    })

    assert _MetaCache().get(p)["inProgress"] is True


def test_explicit_finalized_state_is_public_even_with_fresh_mtime(tmp_path):
    p = tmp_path / "done.sqrx"
    _touch_sqrx(p, mtime=time.time())
    _sidecar(p, {
        "id": "done", "matchId": "match-a",
        "recordingState": "finalized", "inProgress": False,
    })

    assert _MetaCache().get(p)["inProgress"] is False


def test_active_to_finalized_sidecar_invalidates_cache(tmp_path):
    p = tmp_path / "rec.sqrx"
    _touch_sqrx(p, mtime=time.time())
    _sidecar(p, {
        "id": "rec", "matchId": "match-a",
        "recordingState": "active", "inProgress": True,
    })
    mc = _MetaCache()
    assert mc.get(p)["inProgress"] is True

    # Recorder closes the writer and atomically replaces only the sidecar;
    # the .sqrx may not change after the cache's last observation.
    _sidecar(p, {
        "id": "rec", "matchId": "match-a",
        "recordingState": "finalized", "inProgress": False,
    })
    assert mc.get(p)["inProgress"] is False


def test_sidecar_replacement_during_load_is_retried_not_cache_poisoned(
    tmp_path, monkeypatch,
):
    p = tmp_path / "race.sqrx"
    _touch_sqrx(p, mtime=time.time())
    _sidecar(p, {
        "id": "race", "serverId": "test-server", "matchId": "match-a",
        "recordingState": "active", "inProgress": True,
    })
    mc = _MetaCache()
    real_load = mc._load
    raced = False

    def _load_then_replace(path, st):
        nonlocal raced
        meta = real_load(path, st)
        if not raced:
            raced = True
            _sidecar(p, {
                "id": "race", "serverId": "test-server",
                "matchId": "match-a",
                "recordingState": "finalized", "inProgress": False,
                "replacementMadeLarger": "force-a-distinct-signature",
            })
        return meta

    monkeypatch.setattr(mc, "_load", _load_then_replace)
    first = mc.get(p)
    second = mc.get(p)

    assert first["recordingState"] == "finalized"
    assert first["inProgress"] is False
    assert second["recordingState"] == "finalized"
    assert second["inProgress"] is False
