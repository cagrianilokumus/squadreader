"""Structured reader-health check — the machine-readable "did a Squad update
break us?" signal.

`cmd_doctor` (cli.py) is the rich, human-facing command; this module is its
programmatic sibling. `run_doctor()` returns a plain dict that the fleet/update
system reports to central (Phase 0 telemetry) and, later, uses as the
post-offset-apply verification gate (Phase 1).

Both derive their expectations from the SAME module-level offset constants in
`squad.snapshot` via `hardcoded_offset_tables()`, so the human command and the
machine signal can never silently disagree about what "correct" means.

The core signal is cheap: for each Squad class we hardcode offsets for, walk its
live UClass layout by reflection and compare. A drifted or vanished field is the
fingerprint of a Squad patch that moved a struct. Reads are never fabricated
(the reader nulls bad reads), so drift shows up here as a mismatch, not a crash.
"""
from __future__ import annotations

from typing import Any


def hardcoded_offset_tables() -> list[tuple[str, dict[str, int]]]:
    """The (Squad class name -> {reflected field: hardcoded offset}) tables that
    both `cmd_doctor` and `run_doctor` verify against live reflection.

    Every value is imported from the single-source constants in `squad.snapshot`,
    so this function only names WHICH fields to check — never their values."""
    from .squad.snapshot import (
        DEPLOYABLE_OFFSETS, VEHICLE_SPAWNER_OFFSETS, MARKER_OFFSETS,
        PROJECTILE_OFFSETS, RALLY_OFFSETS,
        SQ_SEATCOMP_SEAT_PAWN_OFFSET, SQ_SEATCOMP_SEATED_PLAYER_OFFSET,
        SQ_SEATCOMP_SEATED_SOLDIER_OFFSET, SQ_VEHICLESEAT_SEAT_HEALTH_OFFSET,
        SQ_VEHCOMP_HEALTH_OFFSET, SQ_VEHCOMP_MAX_HEALTH_OFFSET,
        SQ_VEHCOMP_NORMALIZED_HEALTH_OFFSET,
        SQ_VWEAPON_MAGAZINES_OFFSET, SQ_VWEAPON_VEHICLE_TURRET_OFFSET,
    )
    return [
        ("SQDeployable",            dict(DEPLOYABLE_OFFSETS)),
        ("SQVehicleSpawner",        dict(VEHICLE_SPAWNER_OFFSETS)),
        ("SQMapMarker",             dict(MARKER_OFFSETS)),
        ("SQProjectile",            dict(PROJECTILE_OFFSETS)),
        ("SQSquadRallyPoint",       dict(RALLY_OFFSETS)),
        ("SQVehicleSeatComponent", {
            "SeatPawn":      SQ_SEATCOMP_SEAT_PAWN_OFFSET,
            "SeatedPlayer":  SQ_SEATCOMP_SEATED_PLAYER_OFFSET,
            "SeatedSoldier": SQ_SEATCOMP_SEATED_SOLDIER_OFFSET,
        }),
        ("SQVehicleSeat",          {"SeatHealth": SQ_VEHICLESEAT_SEAT_HEALTH_OFFSET}),
        ("SQVehicleComponent", {
            "Health":           SQ_VEHCOMP_HEALTH_OFFSET,
            "MaxHealth":        SQ_VEHCOMP_MAX_HEALTH_OFFSET,
            "NormalizedHealth": SQ_VEHCOMP_NORMALIZED_HEALTH_OFFSET,
        }),
        ("SQVehicleWeapon", {
            "Magazines":     SQ_VWEAPON_MAGAZINES_OFFSET,
            "VehicleTurret": SQ_VWEAPON_VEHICLE_TURRET_OFFSET,
        }),
    ]


def check_offset_drift(pm: Any, arr: Any, alloc: Any) -> list[dict[str, Any]]:
    """Compare every hardcoded offset table against live reflection.

    Returns a list of drift records (empty == all offsets still valid). Each
    record is {class, field, expected, live, problem}. A class that is missing
    while the core classes ARE present is itself a drift signal (renamed/removed).
    """
    from .ue.reflection import get_class_layout
    drift: list[dict[str, Any]] = []
    for cls, table in hardcoded_offset_tables():
        hits = arr.find_by_name(cls, class_name="Class", alloc=alloc, limit=1)
        if not hits:
            drift.append({"class": cls, "field": "*", "expected": None,
                          "live": None, "problem": "class not found"})
            continue
        live = get_class_layout(pm, hits[0][1], alloc)
        for fname, off in table.items():
            p = live.get(fname)
            if p is None:
                drift.append({"class": cls, "field": fname, "expected": off,
                              "live": None, "problem": "not reflected"})
            elif p.offset != off:
                drift.append({"class": cls, "field": fname, "expected": off,
                              "live": p.offset, "problem": "offset drift"})
    return drift


def run_doctor(pm: Any, arr: Any, alloc: Any) -> dict[str, Any]:
    """Machine-readable health of the reader against the LIVE process.

    Caller passes already-resolved anchors (arr=GUObjectArray, alloc=FNamePool)
    — in the serve loop these are the pipeline's own handles, so a check-in costs
    a reflection walk, not a rediscovery.

    Returns {state, ok, drift, checks, reason?} where state is:
      * "ok"      — every hardcoded offset still matches live reflection
      * "drift"   — at least one offset moved / a class vanished (Squad patched us)
      * "unknown" — the core class can't be resolved yet (server empty / map
                    loading); NOT reported as drift, so a loading server never
                    triggers a false "broken" alarm.
    """
    checks: list[dict[str, Any]] = []

    # Anchors must be usable before any reflection is meaningful.
    try:
        anchors_ok = (0 < int(arr.num_elements) < (1 << 26)
                      and alloc.fname_to_str(0, 0) == "None")
    except Exception:
        anchors_ok = False
    if not anchors_ok:
        return {"state": "unknown", "ok": True, "drift": [], "checks": checks,
                "reason": "anchors not resolvable (GUObjectArray/FNamePool)"}

    # Core class gate: if SQPlayerState's UClass isn't resolvable, the server is
    # between maps / empty. Treat as unknown, never drift (plan risk #3).
    if not arr.find_by_name("SQPlayerState", class_name="Class", alloc=alloc, limit=1):
        return {"state": "unknown", "ok": True, "drift": [], "checks": checks,
                "reason": "SQPlayerState unresolved (server empty / map loading)"}

    drift = check_offset_drift(pm, arr, alloc)
    return {
        "state": "ok" if not drift else "drift",
        "ok": not drift,
        "drift": drift,
        "checks": checks,
    }
