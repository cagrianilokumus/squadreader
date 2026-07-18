"""HTTP-level tests for the stats endpoints added in schema v2.

Drives a real server over a real socket (same approach as test_metacache.py), so
routing, query-string parsing and the JSON shape are all exercised — not just the
SQL underneath them.
"""
from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request

from sqreader.httpsrv import _TickBeat, serve_in_background
from sqreader.stats import StatsStore

# A REAL key from data/static/layer_bounds.json. Layer names there carry spaces
# ("Yehorivka AAS v1", not "Yehorivka_AAS_v1") — a made-up name silently resolves
# its bounds to null, and a test that only asserts the `bounds` key exists would
# pass while the map never draws.
LAYER = "Yehorivka AAS v1"


def _q(s: str) -> str:
    return urllib.parse.quote(s)


def _seed(db):
    """One match: three positioned rifle kills, plus an unpositioned knife kill.

    Three rifle kills is deliberate — it is exactly the default `min_kills` floor,
    so the weapon board shows the rifle and drops the one-off knife.
    """
    store = StatsStore(db, server_id="test-server")

    def snap(tick, ts, players, events):
        return {
            "timestamp": ts, "tick": tick,
            "gameState": {"matchState": "InProgress", "matchId": "m1",
                          "mapName": "Yehorivka",
                          "layer": {"name": LAYER},
                          "gameModeName": "RAAS"},
            "teams": [{"id": 1, "factionId": "USA", "tickets": 300},
                      {"id": 2, "factionId": "RUS", "tickets": 280}],
            "players": players, "damageEvents": events,
        }

    def p(eos, name, team, x=None, y=None, kills=0):
        sol = ({"addr": "0x1", "position": {"x": x, "y": y, "z": 0.0}}
               if x is not None else None)
        return {"eosId": eos, "name": name, "teamId": team, "soldier": sol,
                "stats": {"kills": kills}}

    store.record_tick(snap(
        1, "2026-07-15T10:00:00+00:00",
        [p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0.0, 0.0, kills=1),
         p("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Bob", 2, 25_000.0, 0.0)],
        [{"attacker": "Alice", "victim": "Bob", "causerWeapon": "BP_M4A1",
          "killed": 1, "ts": 1.0}]))
    store.record_tick(snap(
        2, "2026-07-15T10:00:02+00:00",
        [p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0.0, 0.0, kills=2),
         p("cccccccc-cccc-cccc-cccc-cccccccccccc", "Carol", 2, 0.0, 15_000.0)],
        [{"attacker": "Alice", "victim": "Carol", "causerWeapon": "BP_M4A1",
          "killed": 1, "ts": 2.0}]))
    store.record_tick(snap(
        3, "2026-07-15T10:00:04+00:00",
        [p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0.0, 0.0, kills=3),
         p("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", "Erin", 2, 20_000.0, 0.0)],
        [{"attacker": "Alice", "victim": "Erin", "causerWeapon": "BP_M4A1",
          "killed": 1, "ts": 3.0}]))
    store.record_tick(snap(
        4, "2026-07-15T10:00:06+00:00",
        [p("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "Alice", 1, 0.0, 0.0, kills=4),
         p("dddddddd-dddd-dddd-dddd-dddddddddddd", "Dave", 2)],                       # no position
        [{"attacker": "Alice", "victim": "Dave", "causerWeapon": "BP_Knife",
          "killed": 1, "ts": 4.0}]))
    # Finalize the match: the stats API serves only FINISHED matches (the
    # in-progress one is hidden, mirroring the finalized-only recording gate), so
    # a seed left 'open' would be invisible to every by-match / aggregate read.
    store.finalize_open_match(reason="test")
    store.close()


def _get(port, path):
    with urllib.request.urlopen(
            f"http://127.0.0.1:{port}{path}", timeout=3) as r:
        return json.load(r)


def _server(tmp_path, *, with_stats=True):
    db = tmp_path / "stats.db"
    if with_stats:
        _seed(db)
    srv = serve_in_background(
        "127.0.0.1", 0, _TickBeat(),
        stats_db=db if with_stats else None)
    return srv, srv.server_address[1]


def test_weapon_meta_endpoint(tmp_path):
    srv, port = _server(tmp_path)
    try:
        rows = {r["weapon"]: r for r in _get(port, "/api/weapons?period=alltime")}
        assert rows["BP_M4A1"]["kills"] == 3
        assert rows["BP_M4A1"]["users"] == 1
        assert rows["BP_M4A1"]["matches"] == 1
        # 250 m, 150 m, 200 m
        assert abs(rows["BP_M4A1"]["avg_distance_m"] - 200.0) < 0.01
        assert abs(rows["BP_M4A1"]["max_distance_m"] - 250.0) < 0.01
    finally:
        srv.shutdown()


def test_weapon_meta_drops_one_off_weapons_under_the_default_floor(tmp_path):
    """The knife has a single kill; the default floor (3) keeps it off the board."""
    srv, port = _server(tmp_path)
    try:
        weapons = [r["weapon"] for r in _get(port, "/api/weapons")]
        assert "BP_M4A1" in weapons
        assert "BP_Knife" not in weapons
    finally:
        srv.shutdown()


def test_match_heatmap_endpoint_carries_points(tmp_path):
    srv, port = _server(tmp_path)
    try:
        hm = _get(port, "/api/heatmap?match=m1")
        assert hm["matchId"] == "m1"
        assert hm["layerName"] == LAYER
        assert len(hm["points"]) == 3          # Dave was unpositioned
    finally:
        srv.shutdown()


def test_layer_heatmap_endpoint_returns_a_grid(tmp_path):
    srv, port = _server(tmp_path)
    try:
        hm = _get(port, f"/api/heatmap?layer={_q(LAYER)}&cell=5000")
        assert hm["layerName"] == LAYER
        assert hm["cellCm"] == 5000
        assert hm["maxCount"] == 1
        assert len(hm["cells"]) == 3           # three deaths, three distinct cells
    finally:
        srv.shutdown()


def test_bounds_resolve_for_a_real_layer(tmp_path):
    """The whole heatmap hangs on this: with no bounds there is nothing to draw
    against, and a fake layer name would hand back null while every other
    assertion still passed."""
    srv, port = _server(tmp_path)
    try:
        for path in (f"/api/heatmap?layer={_q(LAYER)}", "/api/heatmap?match=m1"):
            b = _get(port, path)["bounds"]
            assert b is not None, f"{path} resolved no bounds for a real layer"
            assert b["topLeft"] and b["bottomRight"]
            assert b.get("texture"), "no texture — the client has nothing to fetch"
    finally:
        srv.shutdown()


def test_every_cell_lands_inside_the_layer_bounds(tmp_path):
    """Geometry check. A cell outside the map extent draws off-canvas or squashed
    into a corner: visibly broken, but nothing throws and no test would notice."""
    srv, port = _server(tmp_path)
    try:
        hm = _get(port, f"/api/heatmap?layer={_q(LAYER)}&cell=5000")
        b = hm["bounds"]
        xs = (b["topLeft"]["x"], b["bottomRight"]["x"])
        ys = (b["topLeft"]["y"], b["bottomRight"]["y"])
        assert hm["cells"], "no cells to check"
        for c in hm["cells"]:
            assert min(xs) <= c["cell_x"] <= max(xs), f"cell_x {c['cell_x']} off-map"
            assert min(ys) <= c["cell_y"] <= max(ys), f"cell_y {c['cell_y']} off-map"
    finally:
        srv.shutdown()


def test_layers_endpoint_only_offers_layers_that_can_be_drawn(tmp_path):
    srv, port = _server(tmp_path)
    try:
        rows = _get(port, "/api/layers")
        assert len(rows) == 1
        assert rows[0]["layer_name"] == LAYER
        assert rows[0]["deaths"] == 3     # the unpositioned knife kill is not one
        assert rows[0]["matches"] == 1
    finally:
        srv.shutdown()


def test_heatmap_without_a_selector_is_a_400(tmp_path):
    srv, port = _server(tmp_path)
    try:
        try:
            _get(port, "/api/heatmap")
            raise AssertionError("expected 400 for a heatmap with no selector")
        except urllib.error.HTTPError as e:
            assert e.code == 400
    finally:
        srv.shutdown()


def test_heatmap_for_unknown_match_is_a_404(tmp_path):
    srv, port = _server(tmp_path)
    try:
        try:
            _get(port, "/api/heatmap?match=nope")
            raise AssertionError("expected 404 for an unknown match")
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        srv.shutdown()


def test_leaderboard_period_is_plumbed_through(tmp_path):
    srv, port = _server(tmp_path)
    try:
        alltime = _get(port, "/api/leaderboard?stat=kills&period=alltime")
        assert [r["last_name"] for r in alltime][:1] == ["Alice"]
        # The seeded match is stamped 2026-07-15; a daily board computed against
        # the real clock will not contain it once that day has passed. Assert the
        # parameter is accepted and the shape holds, not a wall-clock outcome.
        daily = _get(port, "/api/leaderboard?stat=kills&period=daily")
        assert isinstance(daily, list)
    finally:
        srv.shutdown()


def test_stats_endpoints_404_when_stats_are_disabled(tmp_path):
    srv, port = _server(tmp_path, with_stats=False)
    try:
        for path in ("/api/weapons", "/api/heatmap?match=m1", "/api/matches"):
            try:
                _get(port, path)
                raise AssertionError(f"{path} should 404 without --stats-db")
            except urllib.error.HTTPError as e:
                assert e.code == 404
    finally:
        srv.shutdown()


def test_matches_list_endpoint(tmp_path):
    srv, port = _server(tmp_path)
    try:
        rows = _get(port, "/api/matches")
        assert len(rows) == 1
        assert rows[0]["match_id"] == "m1"
        assert rows[0]["players"] == 5          # Alice/Bob/Carol/Erin/Dave
        assert rows[0]["map_name"] == "Yehorivka"
    finally:
        srv.shutdown()


def test_match_detail_endpoint(tmp_path):
    srv, port = _server(tmp_path)
    try:
        md = _get(port, "/api/match/m1")
        assert md["match_id"] == "m1"
        assert len(md["players"]) == 5
        # Alice is on team 1 and did the killing in the seed.
        alice = next(p for p in md["players"] if p["name"] == "Alice")
        assert alice["team_id"] == 1
    finally:
        srv.shutdown()


def test_match_detail_unknown_is_404(tmp_path):
    srv, port = _server(tmp_path)
    try:
        try:
            _get(port, "/api/match/nope")
            raise AssertionError("expected 404 for an unknown match")
        except urllib.error.HTTPError as e:
            assert e.code == 404
    finally:
        srv.shutdown()
