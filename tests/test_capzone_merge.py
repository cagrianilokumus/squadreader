"""Tests for the no-guess runtime merge in sqreader/squad/capzones.py —
attach_static_capzones (AAS) and attach_static_to_lane (RAAS). The whole point
of these is that an ambiguous or too-far match attaches NOTHING, so most tests
assert the refusal path as hard as the success path."""

from sqreader.squad.capzones import (
    DEFAULT_MATCH_THRESHOLD_CM,
    attach_static_capzones,
    attach_static_to_lane,
)


def _static(name, x, y, cluster="D1"):
    return {
        "name": name, "cluster": cluster, "position": {"x": x, "y": y},
        "geometry": [{"type": "sphere", "dx": 0, "dy": 0, "radius": 5000}],
    }


def _live(x, y, **extra):
    z = {"position": {"x": x, "y": y}}
    z.update(extra)
    return z


# --- AAS: attach_static_capzones ------------------------------------------

def test_exact_position_attaches_all_fields():
    live = [_live(1000.0, 2000.0, name="LiveWarehouse", owningTeam=1)]
    static = [_static("Warehouse", 1000.0, 2000.0, cluster="A1")]
    n = attach_static_capzones(live, static)
    assert n == 1
    z = live[0]
    assert z["geometry"] == static[0]["geometry"]
    assert z["staticName"] == "Warehouse"
    assert z["staticCluster"] == "A1"
    assert z["staticPosition"] == {"x": 1000.0, "y": 2000.0}
    # live fields preserved
    assert z["owningTeam"] == 1 and z["name"] == "LiveWarehouse"


def test_within_threshold_attaches():
    # ~30 m away, threshold is 50 m, only one candidate → clean match.
    live = [_live(0.0, 0.0)]
    static = [_static("Near", 3000.0, 0.0)]
    assert attach_static_capzones(live, static) == 1
    assert live[0].get("geometry")


def test_outside_threshold_refuses():
    # 60 m away, beyond the 50 m threshold → nothing attached.
    live = [_live(0.0, 0.0)]
    static = [_static("Far", 6000.0, 0.0)]
    assert attach_static_capzones(live, static) == 0
    assert "geometry" not in live[0]


def test_ambiguous_two_near_equidistant_candidates_refuses():
    # Live zone sits between two static points ~equidistant (both ~within
    # threshold, difference < ambiguity margin) → no clear winner → refuse.
    live = [_live(0.0, 0.0)]
    static = [_static("A", 1000.0, 0.0), _static("B", -1200.0, 0.0)]
    assert attach_static_capzones(live, static) == 0
    assert "geometry" not in live[0]


def test_clear_winner_among_two_attaches():
    # One candidate very close, the other far enough that the gap exceeds the
    # ambiguity margin → the near one wins.
    live = [_live(0.0, 0.0)]
    static = [_static("Near", 200.0, 0.0), _static("Far", 4800.0, 0.0)]
    n = attach_static_capzones(live, static)
    assert n == 1
    assert live[0]["staticName"] == "Near"


def test_colocated_duplicate_statics_do_not_block_match():
    # RAAS lists the same objective under multiple lanes → identical position.
    # A distance-0 twin must NOT count as an ambiguous second candidate (this
    # is the Gorodok RAAS v2 live regression: exact match wrongly refused).
    live = [_live(1000.0, 2000.0)]
    static = [
        _static("Warehouse", 1000.0, 2000.0, cluster="D1"),
        _static("Warehouse", 1000.0, 2000.0, cluster="E2"),  # dup, other lane
        _static("FarAway", 500000.0, 500000.0, cluster="Z9"),
    ]
    n = attach_static_capzones(live, static)
    assert n == 1
    assert live[0].get("geometry")


def test_near_duplicate_within_epsilon_collapsed():
    # Within 1 m counts as the same flag (sub-metre coord jitter), still matches.
    live = [_live(0.0, 0.0)]
    static = [
        _static("A", 0.0, 0.0, cluster="D1"),
        _static("A", 50.0, 50.0, cluster="E2"),  # ~0.7 m away → same objective
        _static("B", 40000.0, 0.0, cluster="F3"),
    ]
    assert attach_static_capzones(live, static) == 1


def test_genuinely_close_distinct_objectives_still_ambiguous():
    # Two DIFFERENT objectives ~12 m apart (beyond the 1 m dedupe epsilon, within
    # the 30 m ambiguity margin) must still refuse — dedupe must not swallow them.
    live = [_live(0.0, 0.0)]
    static = [
        _static("A", 1000.0, 0.0, cluster="D1"),
        _static("B", -1200.0, 0.0, cluster="E2"),
    ]
    assert attach_static_capzones(live, static) == 0


def test_static_point_consumed_only_once():
    # Two live zones, one static point near the first: the first claims it,
    # the second finds nothing left → not double-attached.
    live = [_live(0.0, 0.0), _live(50000.0, 0.0)]
    static = [_static("Solo", 0.0, 0.0)]
    n = attach_static_capzones(live, static)
    assert n == 1
    assert live[0].get("geometry") and "geometry" not in live[1]


def test_colocated_live_zones_share_the_match():
    # Al Basrah "Al-Khadra" is the final objective of every lane → several live
    # zones at the SAME position but only one static point survives dedupe. All
    # copies must show the same name + shape (position identity, not a guess).
    live = [_live(1000.0, 2000.0, name="A7-AlKhadra"),
            _live(1000.0, 2000.0, name="B7-AlKhadra"),
            _live(1000.0, 2000.0, name="C7-AlKhadra")]
    static = [_static("Al-Khadra", 1000.0, 2000.0)]
    n = attach_static_capzones(live, static)
    assert n == 3
    assert all(z.get("staticName") == "Al-Khadra" for z in live)
    assert all(z.get("geometry") for z in live)


def test_zone_without_position_skipped():
    live = [{"name": "NoPos"}]
    static = [_static("X", 0.0, 0.0)]
    assert attach_static_capzones(live, static) == 0


def test_empty_inputs_are_noops():
    assert attach_static_capzones([], [_static("X", 0, 0)]) == 0
    assert attach_static_capzones([_live(0, 0)], []) == 0


# --- RAAS: attach_static_to_lane ------------------------------------------

def _lane(*edges):
    return {"edges": list(edges)}


def _edge(a, apos, b, bpos):
    return {"from": a, "fromPos": {"x": apos[0], "y": apos[1]},
            "to": b, "toPos": {"x": bpos[0], "y": bpos[1]}}


def test_lane_nodes_matched_to_static_emit_objectives():
    lane = _lane(
        _edge("D1", (0.0, 0.0), "D2", (10000.0, 0.0)),
        _edge("D2", (10000.0, 0.0), "D3", (20000.0, 0.0)),
    )
    static = [
        _static("Alpha", 0.0, 0.0, cluster="D1"),
        _static("Bravo", 10000.0, 0.0, cluster="D2"),
        _static("Charlie", 20000.0, 0.0, cluster="D3"),
        _static("OffRoute", 99000.0, 99000.0, cluster="Z9"),  # not on lane
    ]
    n = attach_static_to_lane(lane, static)
    assert n == 3
    objs = lane["staticObjectives"]
    names = {o["name"]: o for o in objs}
    assert set(names) == {"D1", "D2", "D3"}          # node names, deduped
    assert names["D1"]["cluster"] == "D1"
    assert names["D1"]["staticName"] == "Alpha"       # SquadCalc readable name
    assert names["D2"]["geometry"]                    # shape carried over
    # The off-route static point was never on a lane node → not emitted.
    assert all(o["cluster"] != "Z9" for o in objs)


def test_lane_colocated_duplicates_match():
    # Same objective listed under two lanes (dup position) → still matches once.
    lane = _lane(
        _edge("D1", (0.0, 0.0), "D2", (10000.0, 0.0)),
    )
    static = [
        _static("Alpha", 0.0, 0.0, cluster="D1"),
        _static("Alpha", 0.0, 0.0, cluster="X9"),      # dup other lane
        _static("Bravo", 10000.0, 0.0, cluster="D2"),
        _static("Bravo", 10000.0, 0.0, cluster="Y9"),  # dup other lane
    ]
    n = attach_static_to_lane(lane, static)
    assert n == 2
    assert {o["name"] for o in lane["staticObjectives"]} == {"D1", "D2"}


def test_lane_no_edges_is_noop():
    assert attach_static_to_lane({"edges": []}, [_static("X", 0, 0)]) == 0
    assert attach_static_to_lane({}, [_static("X", 0, 0)]) == 0


def test_lane_no_static_is_noop():
    lane = _lane(_edge("D1", (0.0, 0.0), "D2", (10000.0, 0.0)))
    assert attach_static_to_lane(lane, []) == 0
    assert "staticObjectives" not in lane


def test_lane_far_node_refused():
    # Lane node nowhere near any static point → nothing for it.
    lane = _lane(_edge("D1", (0.0, 0.0), "D2", (1_000_000.0, 0.0)))
    static = [_static("Alpha", 0.0, 0.0)]
    n = attach_static_to_lane(lane, static)
    assert n == 1  # D1 matches, D2 (1e6 cm = 10km away) refused
    assert {o["name"] for o in lane["staticObjectives"]} == {"D1"}


def test_threshold_constant_is_sane():
    # Guard against an accidental edit making the threshold huge/tiny.
    assert 1000.0 <= DEFAULT_MATCH_THRESHOLD_CM <= 20000.0
