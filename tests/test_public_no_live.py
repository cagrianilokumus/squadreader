"""HTTP contract for the DISTRIBUTED (open-source) build: NO live view.

Proves the live surface is gone at the SERVER, not merely hidden in the UI:
the SSE stream, the latest-snapshot endpoint, and the live-gated alerts
endpoint all 404, and only FINALIZED recordings are served — an
actively-recording, shutdown-interrupted, or sidecar-less file (each a
near-live view of the running match) is refused and never listed. No request
path consults `X-Sqr-Live`. The private `live` branch keeps the live surface
and its own gate tests.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from sqreader.httpsrv import _TickBeat, serve_in_background
from sqreader.sqrx import SqrxWriter
from sqreader.stats import StatsStore


def _serve(tmp_path):
    srv = serve_in_background("127.0.0.1", 0, _TickBeat(),
                              recordings_dir=tmp_path)
    return srv, srv.server_address[1]


def _get(port, path, headers=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                                 headers=headers or {})
    return urllib.request.urlopen(req, timeout=3)


def _status(port, path, headers=None):
    try:
        with _get(port, path, headers) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def _make_sqrx(tmp_path, rec_id, *, state, in_progress):
    """Write a real .sqrx, plus a sidecar in the given lifecycle state.

    state=None writes NO sidecar (the actively-recording, not-yet-sidecar'd
    case) — the meta cache then synthesizes an unverified stub.
    """
    p = tmp_path / f"{rec_id}.sqrx"
    with SqrxWriter(p, "srv-1") as w:
        w.write_line(json.dumps({"tick": 1, "gameState": {"matchId": rec_id}}))
        w.write_line(json.dumps({"tick": 2, "gameState": {"matchId": rec_id}}))
    if state is not None:
        meta = {
            "id": rec_id, "filename": p.name, "serverId": "srv-1",
            "matchId": rec_id, "recordingState": state,
            "inProgress": in_progress,
        }
        p.with_suffix(".meta.json").write_text(json.dumps(meta),
                                               encoding="utf-8")
    return p


LIVE_PATHS = ["/stream", "/stream/", "/latest", "/latest.json",
              "/api/alerts", "/api/alerts/"]


def test_live_endpoints_are_gone(tmp_path):
    srv, port = _serve(tmp_path)
    try:
        for path in LIVE_PATHS:
            assert _status(port, path) == 404, f"{path} should be 404"
    finally:
        srv.shutdown()
        srv.server_close()


def test_finalized_recording_is_served_and_listed(tmp_path):
    srv, port = _serve(tmp_path)
    try:
        _make_sqrx(tmp_path, "done", state="finalized", in_progress=False)

        with _get(port, "/api/recordings") as r:
            listed = json.load(r)
        assert [m["id"] for m in listed] == ["done"]

        with _get(port, "/api/recording/done/meta") as r:
            assert r.status == 200
            meta = json.load(r)
        assert meta["recordingState"] == "finalized"
        assert meta["inProgress"] is False

        with _get(port, "/api/recording/done") as r:
            assert r.status == 200
            body = r.read().decode()
        lines = [json.loads(x) for x in body.splitlines() if x]
        assert len(lines) == 2
        assert lines[0]["gameState"]["matchId"] == "done"
    finally:
        srv.shutdown()
        srv.server_close()


def test_near_live_recordings_are_refused_and_unlisted(tmp_path):
    # active = still recording; unverified = shutdown-interrupted partial;
    # nosidecar = actively-writing file with no sidecar yet (→ unverified stub).
    # Every one is a near-live view: 404 on fetch/meta AND absent from the list.
    srv, port = _serve(tmp_path)
    try:
        _make_sqrx(tmp_path, "active", state="active", in_progress=True)
        _make_sqrx(tmp_path, "unverified", state="unverified", in_progress=True)
        _make_sqrx(tmp_path, "nosidecar", state=None, in_progress=None)

        with _get(port, "/api/recordings") as r:
            listed = json.load(r)
        assert listed == []

        for rec_id in ("active", "unverified", "nosidecar"):
            assert _status(port, f"/api/recording/{rec_id}") == 404
            assert _status(port, f"/api/recording/{rec_id}/meta") == 404
    finally:
        srv.shutdown()
        srv.server_close()


def test_finalized_serving_ignores_live_header(tmp_path):
    # There is no live entitlement in this build: the finalized replay serves
    # identically with or without X-Sqr-Live, and an active file stays 404 even
    # WITH the header a proxy might once have stamped.
    srv, port = _serve(tmp_path)
    try:
        _make_sqrx(tmp_path, "done", state="finalized", in_progress=False)
        _make_sqrx(tmp_path, "active", state="active", in_progress=True)

        assert _status(port, "/api/recording/done") == 200
        assert _status(port, "/api/recording/done",
                       headers={"X-Sqr-Live": "1"}) == 200
        assert _status(port, "/api/recording/active",
                       headers={"X-Sqr-Live": "1"}) == 404
    finally:
        srv.shutdown()
        srv.server_close()


# ── The stats API must also hide the RUNNING match ──────────────────────────
# Removing the SSE live map is not enough: the stats-by-match endpoints read the
# same DB the producer writes every tick, so without a filter a curl attacker
# could poll the in-progress match's scoreboard + kill world-coordinates. The
# stats reads must exclude the open match exactly like the recording gate.

def _seed_two_matches(db):
    """One FINISHED match (finalized → status='final') and one IN-PROGRESS one
    (left 'open'). Distinct players/layer/weapon so we can assert the running
    match's data never surfaces. Returns nothing; ids are 'mfinal' / 'mopen'."""
    store = StatsStore(db, server_id="srv-1")

    def _tick(tick, ts, mid, layer, players, events):
        store.record_tick({
            "timestamp": ts, "tick": tick,
            "gameState": {"matchState": "InProgress", "matchId": mid,
                          "mapName": layer.split(" ")[0],
                          "layer": {"name": layer}, "gameModeName": "RAAS"},
            "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                      {"id": 2, "factionId": "RUS", "tickets": 280}],
            "players": players, "damageEvents": events,
        })

    def _p(eos, name, team, x=None, y=None, kills=0):
        sol = ({"addr": "0x1", "position": {"x": x, "y": y, "z": 0.0}}
               if x is not None else None)
        return {"eosId": eos, "name": name, "teamId": team, "soldier": sol,
                "stats": {"kills": kills}}

    a = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    b = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    _tick(1, "2026-07-15T10:00:00+00:00", "mfinal", "Yehorivka AAS v1",
          [_p(a, "FinalKiller", 1, 0.0, 0.0, kills=1),
           _p(b, "FinalVictim", 2, 5000.0, 0.0)],
          [{"attacker": "FinalKiller", "victim": "FinalVictim",
            "causerWeapon": "BP_M4A1", "killed": 1, "ts": 1.0}])
    store.finalize_open_match(reason="test")   # mfinal → status='final'

    live = "11111111-1111-1111-1111-111111111111"
    vic = "22222222-2222-2222-2222-222222222222"
    _tick(2, "2026-07-15T11:00:00+00:00", "mopen", "Narva RAAS v1",
          [_p(live, "LiveKiller", 1, 100.0, 0.0, kills=1),
           _p(vic, "LiveVictim", 2, 8000.0, 0.0)],
          [{"attacker": "LiveKiller", "victim": "LiveVictim",
            "causerWeapon": "BP_AK74", "killed": 1, "ts": 2.0}])
    store.close()   # close does NOT finalize → mopen stays status='open'


def test_stats_api_hides_the_in_progress_match(tmp_path):
    db = tmp_path / "stats.db"
    _seed_two_matches(db)
    srv = serve_in_background("127.0.0.1", 0, _TickBeat(), stats_db=db)
    port = srv.server_address[1]
    try:
        # /api/matches lists only the finished match.
        with _get(port, "/api/matches") as r:
            ids = [m["match_id"] for m in json.load(r)]
        assert "mfinal" in ids and "mopen" not in ids

        # by-match detail + kill-coordinate heatmap: open = 404, final = 200.
        assert _status(port, "/api/match/mopen") == 404
        assert _status(port, "/api/match/mfinal") == 200
        assert _status(port, "/api/heatmap?match=mopen") == 404
        assert _status(port, "/api/heatmap?match=mfinal") == 200

        # The running match's player never surfaces in the leaderboard.
        with _get(port, "/api/leaderboard?stat=kills") as r:
            names = [row.get("last_name") for row in json.load(r)]
        assert "FinalKiller" in names and "LiveKiller" not in names

        # The running match's weapon + layer are excluded from the aggregates.
        with _get(port, "/api/weapons?period=alltime") as r:
            weapons = [w["weapon"] for w in json.load(r)]
        assert "BP_AK74" not in weapons
        with _get(port, "/api/layers") as r:
            layers = [row["layer_name"] for row in json.load(r)]
        assert "Yehorivka AAS v1" in layers and "Narva RAAS v1" not in layers

        # The running match's layer heatmap grid carries no live points.
        with _get(port, "/api/heatmap?layer=" +
                  urllib.parse.quote("Narva RAAS v1")) as r:
            assert json.load(r)["cells"] == []
    finally:
        srv.shutdown()
        srv.server_close()


def test_player_profile_excludes_the_in_progress_match(tmp_path):
    # /api/players/<id> aggregates a player's history. It must exclude the
    # running match too: otherwise bestMatch / periodBreakdown / longestKill /
    # recentMatches would leak the live scoreboard of a player in the match
    # happening right now. (These live in helper subqueries the first pass
    # missed — see _best_match / _period_breakdown / _longest_infantry_kill.)
    db = tmp_path / "stats.db"
    _seed_two_matches(db)
    srv = serve_in_background("127.0.0.1", 0, _TickBeat(), stats_db=db)
    port = srv.server_address[1]
    live = "11111111-1111-1111-1111-111111111111"   # only in the OPEN match
    final = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"   # only in the FINISHED match
    try:
        # The live-match-only player exists but NONE of the running match's
        # scoreboard / distances / recent history surfaces.
        with _get(port, "/api/players/" + live) as r:
            prof = json.load(r)
        assert prof["bestMatch"]["byKills"] is None
        assert prof["bestMatch"]["byScore"] is None
        assert prof["longestKillInfM"] is None
        assert prof["periodBreakdown"]["alltime"]["kills"] == 0
        assert prof["periodBreakdown"]["alltime"]["matches"] == 0
        assert (prof["lifetime"].get("matches") or 0) == 0
        assert prof["recentMatches"] == []
        assert prof["topWeapons"] == []
        assert prof["activity"] == []

        # Sanity: the finished-match player's profile DOES carry their data.
        with _get(port, "/api/players/" + final) as r:
            fp = json.load(r)
        assert fp["bestMatch"]["byKills"] is not None
        assert fp["lifetime"]["matches"] == 1
        assert fp["longestKillInfM"] is not None
    finally:
        srv.shutdown()
        srv.server_close()
