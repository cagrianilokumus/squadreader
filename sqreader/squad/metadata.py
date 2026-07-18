"""
Static metadata loader for Squad display-name enrichment.

Pulls four JSON files from squadreplay.com (cached locally under
sqreader/data/static/). The reader uses them to attach small
display-friendly hints onto each snapshot WITHOUT bloating the
NDJSON line — most metadata tables are sent to the frontend once
separately, only per-entity lookups land in the per-tick output.

Source URLs (downloaded once, hand-refresh on Squad updates):
  https://cota.squadreplay.com/squad_pools.json
  https://cota.squadreplay.com/static/data/vehicle_factions.json
  https://cota.squadreplay.com/api/map-config
  https://cota.squadreplay.com/api/layer-bounds

A fifth table, capzones.json (static cap-zone geometry), is produced locally
by scripts/fetch_capzones.py from SquadCalc rather than downloaded here.

This module is intentionally read-only and side-effect free at import
time. Callers do `meta = load_metadata()` once at startup.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "static"


def _load_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


@dataclass
class Metadata:
    # Raw tables (kept around so callers can pass them to the frontend
    # once at session start; never re-emitted per snapshot).
    vehicle_factions: dict[str, list[str]] = field(default_factory=dict)
    squad_pools: dict[str, Any] = field(default_factory=dict)
    map_config: dict[str, Any] = field(default_factory=dict)
    layer_bounds: dict[str, Any] = field(default_factory=dict)
    # Static cap-zone geometry per layer, produced offline by
    # scripts/fetch_capzones.py from SquadCalc. Keyed by full display layer
    # name (same keys as layer_bounds). Missing file → {} → merge is a no-op.
    capzones: dict[str, Any] = field(default_factory=dict)

    # Derived reverse indices, built once at construction:
    _role_keyword_to_pool: dict[str, tuple[str, str]] = field(default_factory=dict)
    # vehicle_pools sub-table: { short_key: kind } e.g. {"2A6_Desert": "MBT"}
    _vehicle_pools: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, data_dir: Path | None = None) -> "Metadata":
        d = data_dir or DEFAULT_DATA_DIR
        m = cls(
            vehicle_factions=_load_json(d / "vehicle_factions.json") or {},
            squad_pools=_load_json(d / "squad_pools.json") or {},
            map_config=_load_json(d / "map_config.json") or {},
            layer_bounds=_load_json(d / "layer_bounds.json") or {},
            capzones=_load_json(d / "capzones.json") or {},
        )
        # Build derived indices
        for pool_key, pool in (m.squad_pools.get("infantryPools") or {}).items():
            label = pool.get("label") or pool_key
            for role_kw in pool.get("roles", []):
                m._role_keyword_to_pool[role_kw.lower()] = (pool_key, label)
        # Also fold the pool key itself in lowercase as a fallback
        # (so "LAT" in "USMC_LAT_01" matches infantryPools["LAT"] directly).
        for pool_key, pool in (m.squad_pools.get("infantryPools") or {}).items():
            m._role_keyword_to_pool.setdefault(
                pool_key.lower(), (pool_key, pool.get("label") or pool_key))
        m._vehicle_pools = m.squad_pools.get("vehiclePools") or {}
        return m

    # ---- per-entity lookups (used at snapshot time) -----------------------

    def vehicle_faction(self, class_short: str | None) -> list[str] | None:
        if not class_short:
            return None
        # vehicle_factions is keyed by exact BP class name including _C suffix
        return self.vehicle_factions.get(class_short)

    def vehicle_kind(self, class_short: str | None) -> str | None:
        """Returns the high-level kind ('MBT', 'APC', 'Transport', ...)."""
        if not class_short:
            return None
        # vehiclePools is keyed by short name: BP_<short>_C
        if class_short.startswith("BP_") and class_short.endswith("_C"):
            short = class_short[3:-2]
            kind = self._vehicle_pools.get(short)
            if kind:
                return kind
        return None

    def role_pool(self, role_id: str | None) -> dict[str, str] | None:
        """
        Map a Squad role FName (e.g. 'USMC_LAT_01' / 'USMC_Rifleman_01')
        to its infantry pool ({key, label}). Returns None if unrecognized.

        Strategy: tokenize by '_' and check each token (lowercased) against
        the reverse index built from infantryPools.{roles, key-as-self}.
        """
        if not role_id or role_id == "None":
            return None
        for tok in role_id.split("_"):
            hit = self._role_keyword_to_pool.get(tok.lower())
            if hit:
                key, label = hit
                return {"key": key, "label": label}
        return None

    def map_bounds(self, map_id: str | None) -> dict[str, Any] | None:
        if not map_id:
            return None
        return self.map_config.get(map_id)

    def layer_bounds_for(self, layer_name: str | None) -> dict[str, Any] | None:
        if not layer_name:
            return None
        return self.layer_bounds.get(layer_name)

    def capzones_for(self, layer_name: str | None) -> list[dict[str, Any]]:
        """Static cap-zone points for a layer, or [] if none/unknown.

        Keyed identically to layer_bounds (full display layer name), so the
        caller passes the same game_state["mapName"] it uses for bounds — no
        RawLayerKey conversion at runtime (that happens once, offline).
        """
        if not layer_name:
            return []
        pts = self.capzones.get(layer_name)
        return pts if isinstance(pts, list) else []


__all__ = ["Metadata", "DEFAULT_DATA_DIR"]
