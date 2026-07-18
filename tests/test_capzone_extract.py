"""Pure-logic tests for the SquadCalc → geometry transform in
sqreader/squad/capzones.py. These pin the exact SquadCalc response shape the
offline fetch script depends on, so a silent upstream format change fails here
instead of producing an empty capzones.json.

Covers both response layouts (RAAS/Invasion nest under `points`; AAS/Seed are
flat), all three shape types, the tilted-object rotation correction, the
relative dx/dy math, and the skip rules (shapeless object, empty point)."""

from sqreader.squad.capzones import (
    cluster_key_from_objective,
    compute_rotation,
    extract_capzone_data,
)


# --- compute_rotation ------------------------------------------------------

def test_rotation_untilted_is_just_z():
    # Upright object: only rotation_z contributes.
    assert compute_rotation({"rotation_x": 0, "rotation_y": 0, "rotation_z": 37}) == 37


def test_rotation_tilted_positive_90_combines_axes():
    # rot_y in (89,91): total = z - (x + y) = 5 - (10 + 90) = -95.
    bx = {"rotation_x": 10, "rotation_y": 90, "rotation_z": 5}
    assert compute_rotation(bx) == -95


def test_rotation_tilted_negative_90_combines_axes():
    # rot_y = -90 → total = z - (x - y) = 5 - (10 - (-90)) = 5 - 100 = -95.
    bx = {"rotation_x": 10, "rotation_y": -90, "rotation_z": 5}
    assert compute_rotation(bx) == -95


def test_rotation_near_but_outside_tilt_band_is_untouched():
    # 88° is outside (89,91) → no correction, just z.
    assert compute_rotation({"rotation_x": 10, "rotation_y": 88, "rotation_z": 5}) == 5


def test_rotation_missing_keys_default_zero():
    assert compute_rotation({}) == 0


# --- cluster_key_from_objective -------------------------------------------

def test_cluster_key_splits_on_first_dash():
    assert cluster_key_from_objective("D1-BP_CaptureZoneCluster") == "D1"
    assert cluster_key_from_objective("A3-BP_CaptureZoneCluster") == "A3"


def test_cluster_key_no_dash_returns_whole():
    assert cluster_key_from_objective("Main") == "Main"


def test_cluster_key_empty():
    assert cluster_key_from_objective("") == ""


# --- extract_capzone_data: AAS flat format ---------------------------------

def _sphere(x, y, r):
    return {"location_x": x, "location_y": y, "isSphere": True, "sphereRadius": r}


def test_extract_aas_flat_sphere():
    # AAS: the objective value IS the point (no "points" wrapper).
    layer = {
        "objectives": {
            "Objective_01": {
                "name": "Warehouse",
                "objectName": "BP_CaptureZone_Warehouse",
                "location_x": 1000.0,
                "location_y": -2000.0,
                "objects": [_sphere(1000.0, -2000.0, 7500.0)],
            }
        }
    }
    pts = extract_capzone_data(layer)
    assert len(pts) == 1
    p = pts[0]
    assert p["name"] == "Warehouse"
    assert p["cluster"] == "Objective_01"  # no dash → whole key
    assert p["position"] == {"x": 1000.0, "y": -2000.0}
    assert p["geometry"] == [
        {"type": "sphere", "dx": 0.0, "dy": 0.0, "radius": 7500.0}
    ]


# --- extract_capzone_data: RAAS nested format ------------------------------

def test_extract_raas_nested_all_three_shapes_and_relative_offsets():
    layer = {
        "objectives": {
            "D1-BP_CaptureZoneCluster": {
                "points": [
                    {
                        "name": "Hilltop",
                        "objectName": "BP_CaptureZone_Hilltop",
                        "location_x": 5000.0,
                        "location_y": 8000.0,
                        "objects": [
                            _sphere(5000.0, 8000.0, 6000.0),
                            {  # box offset +200/-50 from anchor
                                "location_x": 5200.0, "location_y": 7950.0,
                                "isBox": True,
                                "boxExtent": {
                                    "extent_x": 4000, "scaling_x": 1.5,
                                    "extent_y": 2500, "scaling_y": 2,
                                    "rotation_x": 0, "rotation_y": 0,
                                    "rotation_z": 30,
                                },
                            },
                            {  # capsule at anchor
                                "location_x": 5000.0, "location_y": 8000.0,
                                "isCapsule": True,
                                "capsuleRadius": 2000, "capsuleLength": 9000,
                                "boxExtent": {"rotation_z": -90},
                            },
                        ],
                    }
                ]
            }
        }
    }
    pts = extract_capzone_data(layer)
    assert len(pts) == 1
    p = pts[0]
    assert p["name"] == "Hilltop"
    assert p["cluster"] == "D1"
    assert p["position"] == {"x": 5000.0, "y": 8000.0}

    geo = p["geometry"]
    assert geo[0] == {"type": "sphere", "dx": 0.0, "dy": 0.0, "radius": 6000.0}
    # box: extX = extent_x*scaling_x = 6000, extY = 2500*2 = 5000, dx/dy relative
    assert geo[1] == {
        "type": "box", "dx": 200.0, "dy": -50.0,
        "extX": 6000, "extY": 5000, "rot": 30,
    }
    assert geo[2] == {
        "type": "capsule", "dx": 0.0, "dy": 0.0,
        "radius": 2000.0, "length": 9000.0, "rot": -90,
    }


def test_extract_tilted_box_rotation_applied():
    layer = {
        "objectives": {
            "A1-BP_CaptureZoneCluster": {
                "points": [{
                    "name": "Tower", "location_x": 0.0, "location_y": 0.0,
                    "objects": [{
                        "location_x": 0.0, "location_y": 0.0, "isBox": True,
                        "boxExtent": {
                            "extent_x": 100, "scaling_x": 1,
                            "extent_y": 100, "scaling_y": 1,
                            "rotation_x": 10, "rotation_y": 90, "rotation_z": 5,
                        },
                    }],
                }]
            }
        }
    }
    pts = extract_capzone_data(layer)
    assert pts[0]["geometry"][0]["rot"] == -95  # tilted correction applied


# --- extract_capzone_data: skip rules --------------------------------------

def test_shapeless_object_is_skipped_and_empty_point_dropped():
    layer = {
        "objectives": {
            "X-BP_CaptureZoneCluster": {
                "points": [
                    {  # only an unrecognised object → no geometry → dropped
                        "name": "Ghost", "location_x": 1.0, "location_y": 1.0,
                        "objects": [{"location_x": 1.0, "location_y": 1.0}],
                    },
                    {  # valid neighbour survives
                        "name": "Real", "location_x": 2.0, "location_y": 2.0,
                        "objects": [_sphere(2.0, 2.0, 500.0)],
                    },
                ]
            }
        }
    }
    pts = extract_capzone_data(layer)
    assert [p["name"] for p in pts] == ["Real"]


def test_empty_and_malformed_input():
    assert extract_capzone_data({}) == []
    assert extract_capzone_data({"objectives": {}}) == []
    assert extract_capzone_data({"objectives": {"K": "not-a-dict"}}) == []
    assert extract_capzone_data({"objectives": {"K": {"points": ["bad"]}}}) == []
