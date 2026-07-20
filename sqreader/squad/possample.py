"""4 Hz position sampler — the fast tier of the two-tier recording.

Given the entity set from the last full snapshot (player-state addresses + stable
keys, vehicle addresses), re-read ONLY each entity's world position + health at
4 Hz — NO GUObjectArray walk, NO reflection, NO name resolution, NO components /
deployables / markers. O(players+vehicles) small reads (~20-50 ms at 100 players),
so the recorder gets smooth 4 Hz movement while the heavy full build runs at ~1 Hz
in the background.

Every read is validated per-entity with the SAME freshness gates the full build
trusts (`_read_soldier`: ClassPrivate must point into the heap; Health in range),
plus a coordinate-magnitude sanity gate. A freed / reused pointer fails a gate and
that entity is silently OMITTED from the position frame; the viewer interpolates
across the <=250 ms gap and the next full snapshot (<=1 s) corrects the roster. No
fabricated positions — omission, never a guess.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any

from ..mem import ProcessMemory
from ..ue.uobject import UOBJ_CLASS_PRIVATE
from .snapshot import SnapshotPaths, read_root_pos_yaw

SCHEMA_POS = "sqr-pos-1"
_MAX_COORD_CM = 5_000_000.0     # 50 km — matches the actor-position sanity gate


@dataclass(frozen=True, slots=True)
class SampledEntities:
    """Stable entity pointers + keys, derived for free from a full snapshot.

    `ps_addr` is stable for a player's whole session; `vh_addr` for a vehicle's
    life. The key is the same identity the viewer matches on (eosId, else name)."""
    full_tick: int
    players: tuple[tuple[int, str], ...]     # (ps_addr, key)
    vehicles: tuple[tuple[int, str], ...]    # (vh_addr, id_hex)

    @classmethod
    def from_snapshot(cls, snap: dict[str, Any]) -> SampledEntities:
        players: list[tuple[int, str]] = []
        for p in snap.get("players") or []:
            addr = _hex_to_int(p.get("_addr"))
            key = p.get("eosId") or p.get("name")
            if addr and key:
                players.append((addr, str(key)))
        vehicles: list[tuple[int, str]] = []
        for v in snap.get("vehicles") or []:
            vid = v.get("id")
            addr = _hex_to_int(vid)
            if addr and vid:
                vehicles.append((addr, str(vid)))
        return cls(full_tick=int(snap.get("tick") or 0),
                   players=tuple(players), vehicles=tuple(vehicles))


def _hex_to_int(h: Any) -> int | None:
    if not isinstance(h, str):
        return None
    try:
        return int(h, 16)
    except ValueError:
        return None


def _class_ok(pm: ProcessMemory, addr: int) -> bool:
    """The full build's freshness gate: ClassPrivate must be a non-null heap
    pointer (a freed slot reads back null / unmapped)."""
    cp = pm.try_read(addr + UOBJ_CLASS_PRIVATE, 8)
    return bool(cp and len(cp) == 8 and struct.unpack("<Q", cp)[0])


def _read_health(pm: ProcessMemory, addr: int, off: int | None,
                 lo: float, hi: float) -> float | None:
    if off is None:
        return None
    b = pm.try_read(addr + off, 4)
    if not b or len(b) != 4:
        return None
    h = struct.unpack("<f", b)[0]
    return h if lo <= h <= hi else None      # out-of-range → freed/overwritten


def _soldier_addr(pm: ProcessMemory, ps_addr: int,
                  pso: dict[str, int]) -> int | None:
    for k in ("Soldier", "CurrentPawn"):     # same chain as read_player
        off = pso.get(k)
        if off is not None:
            b = pm.try_read(ps_addr + off, 8)
            if b and len(b) == 8:
                cand = struct.unpack("<Q", b)[0]
                if cand:
                    return cand
    return None


def _sane_pos(pos: dict[str, Any] | None) -> dict[str, Any] | None:
    if not pos:
        return None
    x, y = pos.get("x"), pos.get("y")
    if (x is None or y is None
            or abs(x) > _MAX_COORD_CM or abs(y) > _MAX_COORD_CM):
        return None
    return pos


def sample_positions(pm: ProcessMemory, paths: SnapshotPaths,
                     entities: SampledEntities, tick: int,
                     ts: str) -> dict[str, Any]:
    """A compact 4 Hz position frame for the known entity set. Fast + gated."""
    pso = paths.ps_offsets
    so = paths.soldier_offsets
    vo = paths.vehicle_offsets
    health_off = so.get("Health")

    players_out: list[dict[str, Any]] = []
    for ps_addr, key in entities.players:
        sa = _soldier_addr(pm, ps_addr, pso)
        if not sa or not _class_ok(pm, sa):          # dead / unspawned / freed
            continue
        if health_off is not None:
            h = _read_health(pm, sa, health_off, -10.0, 1000.0)
            if h is None:                            # out-of-range health = stale
                continue
        else:
            h = None
        rpy = read_root_pos_yaw(pm, sa, paths)
        pos = _sane_pos(rpy.get("position"))
        if pos is None:
            continue
        rec: dict[str, Any] = {"id": key, "x": pos["x"], "y": pos["y"],
                               "z": pos.get("z"), "h": h}
        if "yaw" in rpy:
            rec["yaw"] = rpy["yaw"]
        players_out.append(rec)

    vo_health = vo.get("Health")
    team_off = paths.sq_pawn_team_off
    vehicles_out: list[dict[str, Any]] = []
    for vh_addr, vid in entities.vehicles:
        if not _class_ok(pm, vh_addr):               # freed vehicle
            continue
        # Vehicles: gate staleness on ClassPrivate + position, not health (a
        # wreck legitimately has 0/negative HP but is still on the map).
        rpy = read_root_pos_yaw(pm, vh_addr, paths)
        pos = _sane_pos(rpy.get("position"))
        if pos is None:
            continue
        rec = {"id": vid, "x": pos["x"], "y": pos["y"],
               "h": _read_health(pm, vh_addr, vo_health, -1000.0, 100000.0)}
        if "yaw" in rpy:
            rec["yaw"] = rpy["yaw"]
        if team_off is not None:
            tb = pm.try_read(vh_addr + team_off, 1)
            if tb:
                rec["team"] = tb[0]
        vehicles_out.append(rec)

    return {
        "t": "pos",
        "tick": tick,
        "timestamp": ts,
        "fullTick": entities.full_tick,
        "players": players_out,
        "vehicles": vehicles_out,
    }
