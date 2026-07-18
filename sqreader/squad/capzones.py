"""Static cap-zone geometry layer, sourced from SquadCalc.

The live memory reader gives us a capture zone's *state* (who owns it, capture %,
lock) and a single anchor position, but NOT its *shape* — the sphere / box /
capsule that defines the actual capturable area. SquadCalc publishes that layout
per layer. This module is the pure, stdlib-only core that:

  1. Transforms a raw SquadCalc layer response into a compact per-zone geometry
     list (`extract_capzone_data`) — run offline by scripts/fetch_capzones.py to
     produce data/static/capzones.json.
  2. Merges that static geometry onto the live snapshot at read time
     (`attach_static_capzones` for AAS, `attach_static_to_lane` for RAAS), under
     a strict no-guess rule: an ambiguous or too-far match attaches nothing.

SquadCalc coordinates are the same world-cm space the live reader emits (see
data/static/map_config.json `"source": "squadcalc"`), so the merge is a plain 2D
nearest-neighbour — no coordinate conversion.

Ported from the Squad-Replay project's `squad_map_server.py`
(`_compute_rotation`, `_cluster_key_from_objective`, `_extract_capzone_data`,
`_to_raw_layer_key`). No pymem, no urllib, no I/O here — that keeps it unit-
testable and lets both the offline script and build_snapshot import it.
"""
from __future__ import annotations

import math
from typing import Any, Optional

# Match tolerances, in world centimetres. A correctly-read zone lands within a
# few metres of its SquadCalc anchor; distinct objectives sit hundreds of metres
# apart. 50 m is far below inter-zone spacing yet far above expected match error;
# the 30 m ambiguity margin guarantees two near-equidistant candidates never
# silently mis-attach — the no-guess rule.
DEFAULT_MATCH_THRESHOLD_CM = 5000.0
DEFAULT_AMBIGUITY_MARGIN_CM = 3000.0


# ---------------------------------------------------------------------------
# Offline transform (SquadCalc response -> compact geometry)
# ---------------------------------------------------------------------------

def compute_rotation(box_extent: dict) -> float:
    """Effective rotation of a box/capsule, handling objects on their side.

    SquadCalc applies a correction when rotation_y is near ±90° (the shape is
    tilted onto its side), combining all three rotation axes. Verbatim port.
    """
    rot_x = box_extent.get("rotation_x", 0)
    rot_y = box_extent.get("rotation_y", 0)
    rot_z = box_extent.get("rotation_z", 0)
    total = rot_z
    if 89 < abs(rot_y) < 91:
        total -= (rot_x + rot_y) if rot_y > 0 else (rot_x - rot_y)
    return total


def cluster_key_from_objective(objective_key: str) -> str:
    """`"D1-BP_CaptureZoneCluster"` -> `"D1"`. The RAAS lane+depth address."""
    if not objective_key:
        return ""
    return objective_key.split("-", 1)[0].strip()


def extract_capzone_data(layer_data: dict) -> list[dict]:
    """Flatten a raw SquadCalc layer response into per-objective points.

    Each point: `{name, cluster, position:{x,y}, geometry:[...]}`. Geometry
    shapes carry `dx,dy` = offset in world-cm FROM the point anchor (not absolute
    coords, unlike the Squad-Replay original) so the frontend can draw them
    relative to the live badge centre and they stay glued even if the live
    position differs slightly from the static anchor.
    """
    points: list[dict] = []
    objectives = layer_data.get("objectives") or {}
    for obj_key, entry_val in objectives.items():
        if not isinstance(entry_val, dict):
            continue
        cluster = cluster_key_from_objective(obj_key)
        # Two SquadCalc shapes: RAAS/Invasion nest under `points`; AAS/Seed/
        # Skirmish are flat (the objective IS the point).
        point_list = entry_val["points"] if "points" in entry_val else [entry_val]
        for pt in point_list:
            if not isinstance(pt, dict):
                continue
            anchor_x = pt.get("location_x", 0)
            anchor_y = pt.get("location_y", 0)
            geometry: list[dict] = []
            for obj in pt.get("objects") or []:
                dx = obj.get("location_x", 0) - anchor_x
                dy = obj.get("location_y", 0) - anchor_y
                if obj.get("isSphere"):
                    geometry.append({
                        "type": "sphere", "dx": dx, "dy": dy,
                        "radius": float(obj.get("sphereRadius") or 0)})
                elif obj.get("isBox"):
                    bx = obj.get("boxExtent") or {}
                    geometry.append({
                        "type": "box", "dx": dx, "dy": dy,
                        "extX": bx.get("extent_x", 0) * bx.get("scaling_x", 1),
                        "extY": bx.get("extent_y", 0) * bx.get("scaling_y", 1),
                        "rot": compute_rotation(bx)})
                elif obj.get("isCapsule"):
                    bx = obj.get("boxExtent") or {}
                    geometry.append({
                        "type": "capsule", "dx": dx, "dy": dy,
                        "radius": float(obj.get("capsuleRadius") or 0),
                        "length": float(obj.get("capsuleLength") or 0),
                        "rot": compute_rotation(bx)})
                # Any object with no recognised shape flag is skipped.
            if geometry:
                points.append({
                    "name": pt.get("name", ""),
                    "cluster": cluster,
                    "position": {"x": anchor_x, "y": anchor_y},
                    "geometry": geometry,
                })
    return points


def to_raw_layer_key(layer: str, layer_bounds: dict) -> str:
    """Readable layer name -> SquadCalc key. `"Al Basrah RAAS v1"` ->
    `"AlBasrah_RAAS_v1"`.

    Flattens `layer_bounds` into a `mapName -> mapId` table, longest-prefix
    matches the layer name, swaps the prefix for the id, underscore-joins the
    rest. Plain space->underscore when no map matches. Verbatim port — this
    only runs offline in the fetch script; runtime never needs it.
    """
    if not layer:
        return ""
    name_to_id: dict[str, str] = {}
    for entry in layer_bounds.values():
        if not isinstance(entry, dict):
            continue
        map_name = entry.get("mapName")
        map_id = entry.get("mapId")
        if map_name and map_id and map_name not in name_to_id:
            name_to_id[map_name] = map_id

    best_prefix = ""
    best_id = ""
    for readable, map_id in name_to_id.items():
        if isinstance(readable, str) and layer.startswith(readable) \
                and len(readable) > len(best_prefix):
            best_prefix = readable
            best_id = map_id
    if best_id:
        suffix = layer[len(best_prefix):].strip().replace(" ", "_")
        return f"{best_id}_{suffix}" if suffix else best_id
    return layer.replace(" ", "_")


# ---------------------------------------------------------------------------
# Runtime merge (static geometry -> live snapshot), no-guess
# ---------------------------------------------------------------------------

def _xy(entry: Any) -> Optional[tuple[float, float]]:
    pos = entry.get("position") if isinstance(entry, dict) else None
    if not isinstance(pos, dict):
        return None
    x, y = pos.get("x"), pos.get("y")
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    return (float(x), float(y))


def _two_nearest(px: float, py: float, static_pts: list[dict],
                 consumed: set[int]) -> tuple[Optional[int], float, float]:
    """(best_index, best_dist2, second_dist2) over unconsumed static points."""
    best_i: Optional[int] = None
    best_d2 = math.inf
    second_d2 = math.inf
    for i, sp in enumerate(static_pts):
        if i in consumed:
            continue
        sxy = _xy(sp)
        if sxy is None:
            continue
        d2 = (px - sxy[0]) ** 2 + (py - sxy[1]) ** 2
        if d2 < best_d2:
            second_d2 = best_d2
            best_d2, best_i = d2, i
        elif d2 < second_d2:
            second_d2 = d2
    return best_i, best_d2, second_d2


def _dedupe_by_position(static_pts: list[dict],
                        epsilon_cm: float = 100.0) -> list[dict]:
    """Collapse static points that share a world position (within epsilon).

    RAAS lists the same objective under EVERY lane it belongs to, so
    capzones.json can carry several entries with identical coords + geometry,
    differing only in their `cluster` lane tag. Left alone, such a co-located
    twin looks like a genuine second candidate to the ambiguity guard and makes
    it refuse a live zone that actually has an exact match (observed live on
    Gorodok RAAS v2: B1/B6/B7 each had a distance-0 duplicate). They're the
    same flag with the same shape, so keep the first and drop the rest.
    """
    out: list[dict] = []
    kept: list[tuple[float, float]] = []
    e2 = epsilon_cm * epsilon_cm
    for sp in static_pts:
        xy = _xy(sp)
        if xy is None:
            continue
        if any((xy[0] - kx) ** 2 + (xy[1] - ky) ** 2 <= e2 for kx, ky in kept):
            continue
        kept.append(xy)
        out.append(sp)
    return out


def _clean_match(px: float, py: float, static_pts: list[dict],
                 consumed: set[int], threshold_cm: float,
                 ambiguity_margin_cm: float) -> Optional[int]:
    """Index of the one static point that clearly matches (px,py), or None.

    No-guess: refuse if nothing is within `threshold_cm`, OR if the two nearest
    candidates are closer together than `ambiguity_margin_cm` (no clear winner).
    """
    best_i, best_d2, second_d2 = _two_nearest(px, py, static_pts, consumed)
    if best_i is None or best_d2 > threshold_cm ** 2:
        return None
    if second_d2 < math.inf:
        if (math.sqrt(second_d2) - math.sqrt(best_d2)) < ambiguity_margin_cm:
            return None   # ambiguous — two candidates too close to separate
    return best_i


def attach_static_capzones(
        capture_zones: list[dict], static_pts: list[dict], *,
        threshold_cm: float = DEFAULT_MATCH_THRESHOLD_CM,
        ambiguity_margin_cm: float = DEFAULT_AMBIGUITY_MARGIN_CM) -> int:
    """AAS merge: attach static geometry onto live capture zones by position.

    Mutates `capture_zones` in place, returns the number matched. Each static
    point is consumed once in the primary pass, then the match is propagated to
    any co-located live twins (see below).
    """
    if not capture_zones or not static_pts:
        return 0
    static_pts = _dedupe_by_position(static_pts)
    consumed: set[int] = set()
    matched = 0
    for cz in capture_zones:
        cxy = _xy(cz)
        if cxy is None:
            continue
        i = _clean_match(cxy[0], cxy[1], static_pts, consumed,
                         threshold_cm, ambiguity_margin_cm)
        if i is None:
            continue
        sp = static_pts[i]
        cz["geometry"] = sp.get("geometry")
        cz["staticName"] = sp.get("name")
        cz["staticCluster"] = sp.get("cluster")
        cz["staticPosition"] = sp.get("position")
        consumed.add(i)
        matched += 1

    # A shared objective (one flag reachable from several lanes — e.g. Al
    # Basrah "Al-Khadra", the last objective of every lane) shows up as several
    # live zones at the SAME position, but dedupe left only one static point, so
    # only one twin matched above. Propagate that match to its co-located twins.
    # This is position IDENTITY (same flag, same spot), not a proximity guess.
    eps2 = 100.0 * 100.0   # 1 m
    done = [cz for cz in capture_zones if cz.get("geometry")]
    for cz in capture_zones:
        if cz.get("geometry"):
            continue
        cxy = _xy(cz)
        if cxy is None:
            continue
        for mz in done:
            mxy = _xy(mz)
            if mxy and (cxy[0] - mxy[0]) ** 2 + (cxy[1] - mxy[1]) ** 2 <= eps2:
                cz["geometry"] = mz.get("geometry")
                cz["staticName"] = mz.get("staticName")
                cz["staticCluster"] = mz.get("staticCluster")
                cz["staticPosition"] = mz.get("staticPosition")
                matched += 1
                break
    return matched


def _lane_nodes(lane: dict) -> dict[str, tuple[float, float]]:
    """Deduped {node_name: (x,y)} from a lane graph's edge endpoints — the same
    node set the frontend's drawLaneNodeCaps builds."""
    nodes: dict[str, tuple[float, float]] = {}
    for e in (lane.get("edges") or []):
        for name_key, pos_key in (("from", "fromPos"), ("to", "toPos")):
            name = e.get(name_key)
            pos = e.get(pos_key)
            if name and isinstance(pos, dict):
                x, y = pos.get("x"), pos.get("y")
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    nodes.setdefault(name, (float(x), float(y)))
    return nodes


def attach_static_to_lane(
        lane: dict, static_pts: list[dict], *,
        threshold_cm: float = DEFAULT_MATCH_THRESHOLD_CM,
        ambiguity_margin_cm: float = DEFAULT_AMBIGUITY_MARGIN_CM) -> int:
    """RAAS merge: for a match whose live captureZones[] is empty, reconcile the
    static layout against the live lane graph so only objectives ON THE ACTIVE
    ROUTE get a shape.

    Emits `lane["staticObjectives"] = [{name, cluster, position, geometry}]`.
    Returns the count. NOTE: static data is LAYOUT ONLY — this attaches shape +
    position, never ownership. True RAAS per-flag ownership needs a separate
    SQCaptureZoneComponent memory read (out of scope).
    """
    if not static_pts:
        return 0
    nodes = _lane_nodes(lane)
    if not nodes:
        return 0
    static_pts = _dedupe_by_position(static_pts)
    consumed: set[int] = set()
    objectives: list[dict] = []
    for name, (nx, ny) in nodes.items():
        i = _clean_match(nx, ny, static_pts, consumed,
                         threshold_cm, ambiguity_margin_cm)
        if i is None:
            continue
        sp = static_pts[i]
        objectives.append({
            "name": name,
            "staticName": sp.get("name"),   # SquadCalc readable name for display
            "cluster": sp.get("cluster"),
            "position": sp.get("position"),
            "geometry": sp.get("geometry"),
        })
        consumed.add(i)
    if objectives:
        lane["staticObjectives"] = objectives
    return len(objectives)


__all__ = [
    "DEFAULT_MATCH_THRESHOLD_CM", "DEFAULT_AMBIGUITY_MARGIN_CM",
    "compute_rotation", "cluster_key_from_objective", "extract_capzone_data",
    "to_raw_layer_key", "attach_static_capzones", "attach_static_to_lane",
]
