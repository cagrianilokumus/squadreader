"""
Produce one snapshot of the current Squad game state, as a JSON-friendly
Python dict that follows (a subset of) the kickoff schema.

Phase 3 scope (first cut):
- one entry per live SQPlayerState (skipping the CDO):
    playerId, name, team, role, eosId, score, ping, isBot,
    soldier: { classShort, health, breathHoldStamina }
- counts of singletons (SQGameState/Mode/Instance) and class histograms
  for diagnostic purposes
- timestamp + server identifier

Position, vehicles, game/map state, kills/deaths come in subsequent
iterations (Phase 3d/3e and beyond).

Design notes:
- We walk GUObjectArray ONCE per snapshot, classifying each UObject by
  its class name. This is ~0.5 s for 227k UObjects on this hardware.
  At 3 Hz that's 1.5 s of CPU per second — too high for production but
  fine for the one-shot mode. The continuous mode will cache class
  pointers and filter by class on subsequent passes.
- All field reads use no-guess policy: failed reads become null in the
  output, never fabricated.
"""
from __future__ import annotations

import math as _math
import struct
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from ..mem import ProcessMemory
from ..ue.fname import FNameEntryAllocator
from ..ue.reflection import (
    bool_property_mask, get_class_layout, struct_layout_for_field,
    walk_super_chain,
)
from ..ue.uobject import (
    GUObjectArray,
    UOBJ_CLASS_PRIVATE,
    UOBJ_NAME_PRIVATE,
)
from ..ue.value import (
    iter_tarray_pointers, read_fstring, read_frotator, read_ftext,
    read_fvector, read_fweak_object_ptr, read_tarray_header,
)
from .capzones import attach_static_capzones, attach_static_to_lane
from .metadata import Metadata


def _read_fname(pm: ProcessMemory, addr: int,
                alloc: FNameEntryAllocator) -> str | None:
    raw = pm.try_read(addr, 8)
    if raw is None or len(raw) < 8:
        return None
    cmp_idx, number = struct.unpack("<II", raw)
    return alloc.fname_to_str(cmp_idx, number)


def _uobject_name(pm: ProcessMemory, addr: int,
                  alloc: FNameEntryAllocator) -> str | None:
    if addr == 0:
        return None
    return _read_fname(pm, addr + UOBJ_NAME_PRIVATE, alloc)


def _uobject_class_name(pm: ProcessMemory, addr: int,
                        alloc: FNameEntryAllocator,
                        cache: dict[int, str | None] | None = None) -> str | None:
    if addr == 0:
        return None
    cp = pm.try_read(addr + UOBJ_CLASS_PRIVATE, 8)
    if cp is None or len(cp) < 8:
        return None
    class_addr = struct.unpack("<Q", cp)[0]
    if cache is not None and class_addr in cache:
        return cache[class_addr]
    name = _uobject_name(pm, class_addr, alloc)
    if cache is not None:
        cache[class_addr] = name
    return name


def _tag_char_is_junk(o: int) -> bool:
    """A codepoint a torn/stale PlayerNamePrefix read produces but a real clan
    tag never uses: control chars, private-use, replacement char, and
    misread-UTF-16 garbage (CJK/Hangul/Kana ideographs, block elements ▇, zalgo
    combining marks). Genuine stylized tags use symbols, brackets (『』〖〗),
    fullwidth and Latin/Greek/Cyrillic — none of which are here. MUST stay in
    sync with stats._tag_char_is_junk (and central's clean_clan_tag)."""
    return (
        o < 0x20 or o == 0x7F
        or 0x0300 <= o <= 0x036F              # combining diacritics (zalgo)
        or 0x1100 <= o <= 0x11FF              # Hangul Jamo
        or 0x2580 <= o <= 0x259F              # block elements
        or 0x3040 <= o <= 0x30FF              # Hiragana + Katakana
        or 0x3130 <= o <= 0x318F              # Hangul Compatibility Jamo
        or 0x3400 <= o <= 0x4DBF              # CJK Extension A
        or 0x4E00 <= o <= 0x9FFF              # CJK Unified Ideographs
        or 0xA960 <= o <= 0xA97F              # Hangul Jamo Extended-A
        or 0xAC00 <= o <= 0xD7FF              # Hangul Syllables (+ Jamo Ext-B)
        or 0xE000 <= o <= 0xF8FF              # private-use area
        or 0xF900 <= o <= 0xFAFF              # CJK Compatibility Ideographs
        or o == 0xFFFD                        # UTF-16 replacement char
        or 0x20000 <= o <= 0x3FFFF            # CJK Extension B+ (astral)
    )


def _safe(call):
    """Call a read; on any failure, return None (no-guess policy).

    Catches:
      - OSError (unmapped memory, EIO during Squad GC)
      - OverflowError (junk pointer beyond c_long range fed to os.lseek)
      - ValueError (negative offsets, malformed struct unpack)
      - TypeError (lambda received None instead of expected type — e.g.
        intermediate read returned None and got passed to a downstream
        operation)
      - struct.error (truncated buffer; we got fewer bytes than
        unpack_from expected because pm.try_read returned a short read)
      - IndexError (tuple/list lookups against truncated data)
      - AttributeError (Vec3 etc. accessed on None after a defensive
        intermediate returned None)
    These ALL fire occasionally on Squad memory pressure days; without
    catching them a single bad lambda aborts the entire snapshot build
    and starves the SSE stream until the next tick. The "real bug"
    versus "transient" distinction is meaningless inside a 700-line
    snapshot builder — log noise + per-tick recovery beats whole-snap
    failure every time.
    """
    try:
        return call()
    except (OSError, OverflowError, ValueError, TypeError,
            struct.error, IndexError, AttributeError):
        return None


def clean_nonfinite(obj):
    """
    Walk a snapshot dict and replace NaN / +Inf / -Inf floats with None.

    Python's `json.dumps` is permissive — it happily emits literal `NaN`
    and `Infinity` tokens, which Python's own `json.loads` will round-trip
    fine but every other JSON parser (browsers, jq, Go, Rust serde) will
    reject as invalid JSON. Squad fields like SQSquadState.objectiveScore
    are `totalPoints / numObjectives`, which is 0/0 = NaN at match start —
    so we *will* see these in real snapshots.

    Done as one pass at the end of build_snapshot rather than per-field
    sanitization at every read site (fewer places to forget; cheap — a
    full snapshot tree walks in single-digit ms).
    """
    if isinstance(obj, float):
        return obj if _math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: clean_nonfinite(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [clean_nonfinite(v) for v in obj]
    return obj


def _world_yaw(pm: "ProcessMemory", root: int,
               paths: "SnapshotPaths") -> float | None:
    """World-space yaw (degrees) from ComponentToWorld's FQuat.

    Position is read from ComponentToWorld.Translation (world space), so
    yaw must come from the same transform to stay consistent. For an actor
    attached to a parent — a soldier in a vehicle seat, a deployable on a
    vehicle — RelativeRotation is parent-relative and gives the wrong
    heading; the world quat is correct. For unattached actors the two are
    identical (confirmed live). Falls back to RelativeRotation.yaw if the
    quat read fails or looks non-unit (freed/garbage memory).
    """
    b = pm.try_read(root + paths.scene_component_to_world_rotation_off, 32)
    if b is not None and len(b) == 32:
        x, y, z, w = struct.unpack("<dddd", b)
        norm2 = x * x + y * y + z * z + w * w
        if 0.9 < norm2 < 1.1:  # a sane unit quaternion
            return _math.degrees(_math.atan2(
                2.0 * (w * z + x * y), 1.0 - 2.0 * (y * y + z * z)))
    r = read_frotator(pm, root + paths.scene_relative_rotation_off)
    return r.yaw if r is not None else None


MARKER_OFFSETS = {
    # SQMapMarker (and subclasses) live actors — verified via reflection
    # dump of the UClass on Squad v10.4.1.
    "Team": 0x2c0,            # uint8 (inherited from SQTeamActor)
    "OwnerPlayerState": 0x2e0,  # APlayerState*  (the SL who placed it)
    "Squad": 0x2e8,           # int32 (squad number 1..N)
    "FireTeamId": 0x2ec,      # int32 (0=Alpha, 1=Bravo, 2=Charlie)
    "PlacementEmote": 0x2f0,  # uint8 enum
}

# SQVehicleSpawner (and BP_VehicleSpawner_C subclasses) — actors that
# emit vehicles into the world per team availability rules. Verified
# via reflection dump on Squad v10.4.1.
VEHICLE_SPAWNER_OFFSETS = {
    "Team":                  0x2e4,  # uint8 enum (which team owns this pad)
    "SpawnInProgress":       0x2f8,  # bool (own byte)
    "SpawnOverlapped":       0x2f9,  # bool
    "SpawnerEnabled":        0x2fa,  # bool
    "SpawnerLockedUntil":    0x378,  # StructProperty (FTimespan-ish 8 B?
                                     # leave as raw qword for now)
    "TeamAuthority":         0x380,  # UObject* (the team that owns the pad)
    "CachedSpecificVehicle": 0x3b8,  # UObject* (cached UClass for the
                                     # vehicle this pad produces)
}

# SQDeployable (and subclasses: FOB radios, HABs, ammo crates, repair
# stations, bunkers, emplacements, ...). Verified via reflection dump
# of SQDeployable's 72 own props (Squad v10.4.1).
# SQProjectile and select subclasses we care about for in-flight tracking.
# We DO NOT track the 2980 plain SQProjectile bullets — too noisy and not
# useful for the live map. SQMortarProjectile / SQGuidedProjectile /
# SQSmokeGrenadeProjectile are the strategic ones; SQGrenadeProjectile
# is also a reasonable opt-in. Verified offsets are SQProjectile-level
# (same for every subclass since they all inherit it).
PROJECTILE_OFFSETS = {
    "bHasImpacted":            0x3d0,  # bool (own byte)
    "bAppliesSuppression":     0x3d2,  # bool
    "bIsTracer":               0x3d8,  # bool
    "bIsExplosiveProjectile":  0x439,  # bool
    "ExplosiveBaseDamage":     0x43c,  # float
    "ExplosiveKillZoneRadius": 0x444,  # float
}

# Whitelist of SQProjectile bases we track (skipping plain SQProjectile
# to filter out bullets). Frontend can sub-filter by classShort.
PROJECTILE_BASE_NAMES = (
    "SQMortarProjectile",
    "SQGuidedProjectile",
    "SQSmokeGrenadeProjectile",
)


# SQVehicle.VehicleSeats — TArray of pointers to seat *components*
# (NOT pawns — corrected after diagnosis: the array element class is
# SQVehicleSeatComponent). Verified via dump_struct_layout on Squad
# v10.4.1 (SQVehicle.VehicleSeats @+0x8c8, inner ObjectProperty).
SQ_VEHICLE_SEATS_OFFSET = 0x8c8

# SQVehicleSeatComponent layout (4-level chain: SQVehicleSeatComponent
# → USceneComponent → UActorComponent → UObject, size=800). Six own
# props identify the seat's role + occupant:
SQ_SEATCOMP_SEAT_CONFIG_OFFSET    = 0x250  # FStructProperty (seat name etc.)
SQ_SEATCOMP_ANIM_STATE_OFFSET     = 0x2d0  # int32
SQ_SEATCOMP_SEAT_PAWN_OFFSET      = 0x2d8  # SQVehicleSeat* — the seat pawn
SQ_SEATCOMP_SEATED_PLAYER_OFFSET  = 0x2e0  # APlayerState* of occupant
SQ_SEATCOMP_SEATED_SOLDIER_OFFSET = 0x2e8  # SQSoldier* of occupant
SQ_SEATCOMP_FORCE_OCCUPIED_OFFSET = 0x2f0  # bool

# SQVehicleSeat.SeatHealth — read off the SeatPawn (one indirection
# from the seat component). +0x4d0 on the SQVehicleSeat pawn.
SQ_VEHICLESEAT_SEAT_HEALTH_OFFSET = 0x4d0

# Phase 2B (2026-05-26): vehicle subsystem reads.
# SQVehicle (inherits SQVehicleSeat → SQPawn → Pawn → Actor → Object).
# Verified via dump_struct_layout against live Squad v10.4.1.
#
# - VehicleTurrets:    TArray<SQVehicleWeapon*>           @+0x0a90 on SQVehicle
# - VehicleComponents: TArray<SQVehicleComponent*>        @+0x04a0 on parent SQVehicleSeat
# - CachedVehicleEngine: SQVehicleEngine*                 @+0x04b0 on parent SQVehicleSeat
SQ_VEHICLE_TURRETS_OFFSET            = 0x0a98  # +0x8 vs v10.4.1 (drifted)
SQ_VEHICLE_COMPONENTS_OFFSET         = 0x04a0
SQ_VEHICLE_CACHED_ENGINE_OFFSET      = 0x04b0

# SQVehicleComponent (base class of SQVehicleEngine + every wheel/track/
# turret-base/ammo-rack actor that ships health). 36 own props; the two
# we need are at:
SQ_VEHCOMP_HEALTH_OFFSET             = 0x0758  # FloatProperty
SQ_VEHCOMP_MAX_HEALTH_OFFSET         = 0x0630  # FloatProperty
SQ_VEHCOMP_STATE_OFFSET              = 0x075c  # EnumProperty (Healthy/Damaged/Destroyed)
SQ_VEHCOMP_NORMALIZED_HEALTH_OFFSET  = 0x070c  # FloatProperty (0..1)

# SQVehicleWeapon inherits SQWeapon_Effects → SQWeapon → SQEquipableItem.
# Magazines TArray<int32> lives on SQWeapon @+0x848 (round counts; idx 0
# is the chambered/loaded magazine, rest are spares — verified via the
# pattern read off live BMP-2 / M1A2 turrets, matches the legacy vanilla
# viewer's mag rendering shape).
SQ_VWEAPON_MAGAZINES_OFFSET          = 0x0848
SQ_VWEAPON_VEHICLE_TURRET_OFFSET     = 0x0ec8  # ObjectProperty

# Squad v10 map markers — stored as FastArraySerializer Items inside
# SQMapMarkerManagerComponent.MarkerArray. The manager lives on the
# active game state actor. Brute-forced element stride to 104 bytes
# with FVector position at +0x20 (verified live on Narva AAS v3,
# 114-entry array, 90+ with valid coords).
#
# MarkerArray struct lives at manager+0xb8; its Items TArray header
# (ptr+count+cap) is at struct+0x108, so absolute is manager+0x1c0.
MARKER_MGR_MARKER_ARRAY_OFFSET = 0x00b8
MARKER_ARRAY_ITEMS_OFFSET      = 0x0108
MARKER_ITEMS_ABS_OFFSET        = MARKER_MGR_MARKER_ARRAY_OFFSET + MARKER_ARRAY_ITEMS_OFFSET  # 0x1c0
MARKER_ITEM_SIZE               = 104

# Per-item field offsets (within the 104-byte Items element):
MARKER_ITEM_OFFSETS = {
    "RepID":       0x00,  # int32 — replication ID counter
    "SquadId":     0x10,  # int32
    "TeamId":      0x14,  # int32
    "FireTeamId":  0x18,  # int32: -1 = SL placed, 1 = Bravo FTL, 2 = Charlie FTL
    "Position":    0x20,  # FVector (3 doubles, 24 bytes)
    "MarkerClass": 0x50,  # UObject* — BP class instance whose name is the type
}


# --------------------------------------------------------------------------
# Remote offset overrides (Phase 1: rebuild-less self-heal)
#
# When a Squad patch drifts a hardcoded offset, central serves a signed offset
# pack and the agent applies it AT RUNTIME instead of shipping new code. A pack
# is {key: int} where key is either a scalar constant NAME (e.g.
# "SQ_VEHICLE_TURRETS_OFFSET") or "DICT.KEY" (e.g. "DEPLOYABLE_OFFSETS.Team").
#
# The overridable set is derived by NAMING CONVENTION over this module's globals
# (…_OFFSET/_OFF/_SIZE ints and …_OFFSETS int-dicts), evaluated at call time —
# so every offset constant defined anywhere in this module is covered, new ones
# are covered automatically, and a pack can NEVER touch a non-offset attribute
# (functions, classes, resolved addresses). Only EXISTING dict keys can be
# patched (a pack cannot invent fields); unknown/malformed keys are ignored
# (forward-compat). Baked-in originals are captured once so a pack applies
# reversibly — a doctor-failed apply rolls back exactly.
# --------------------------------------------------------------------------
_BAKED_OFFSETS: dict[str, Any] | None = None


def _overridable_offsets() -> tuple[set[str], set[str]]:
    """(scalar constant names, offset-dict names) a signed pack may override."""
    scalars: set[str] = set()
    dicts: set[str] = set()
    for name, val in globals().items():
        if not (isinstance(name, str) and name.isupper()):
            continue
        if isinstance(val, bool):
            continue
        if isinstance(val, int) and name.endswith(("_OFFSET", "_OFF", "_SIZE")):
            scalars.add(name)
        elif (isinstance(val, dict) and name.endswith("_OFFSETS") and val
              and all(isinstance(v, int) for v in val.values())):
            dicts.add(name)
    return scalars, dicts


def _bake_offsets() -> None:
    """Snapshot the baked-in offset values once, for exact rollback."""
    global _BAKED_OFFSETS
    if _BAKED_OFFSETS is not None:
        return
    scalars, dicts = _overridable_offsets()
    g = globals()
    _BAKED_OFFSETS = {"scalars": {n: g[n] for n in scalars},
                      "dicts": {n: dict(g[n]) for n in dicts}}


def apply_offset_overrides(pack: dict[str, int]) -> list[str]:
    """Override offset constants from an ALREADY signature-verified pack. Returns
    the keys actually applied; unknown / forbidden / malformed keys are skipped
    (never raises, so a partially-recognised pack degrades gracefully)."""
    _bake_offsets()
    scalars, dicts = _overridable_offsets()
    g = globals()
    applied: list[str] = []
    for key, raw in pack.items():
        try:
            val = int(raw)
        except (TypeError, ValueError):
            continue
        if "." in key:
            dname, _, dkey = key.partition(".")
            d = g.get(dname)
            if dname in dicts and isinstance(d, dict) and dkey in d:
                d[dkey] = val
                applied.append(key)
        elif key in scalars:
            g[key] = val
            applied.append(key)
    return applied


def revert_offset_overrides() -> None:
    """Restore every offset constant to its baked-in original value."""
    if _BAKED_OFFSETS is None:
        return
    g = globals()
    for n, v in _BAKED_OFFSETS["scalars"].items():
        g[n] = v
    for n, baked in _BAKED_OFFSETS["dicts"].items():
        d = g.get(n)
        if isinstance(d, dict):
            d.clear()
            d.update(baked)


# AmmoWep_*_C — the "weapon-shaped" resource pool actors a vehicle owns.
# Logi trucks carry two of these (e.g. AmmoWep_1000_C for supply + ammo
# they can drop), combat vehicles carry one for their built-in ammo
# (AmmoWep_APC_C/Helicopter_C/LightVehicle_C/etc). All share the same
# C++ base class (BP parents of every AmmoWep_*_C), so the offsets
# below apply uniformly. Owner (+0x158) points back at the vehicle.
AMMO_WEP_OFFSETS = {
    "ResourceDropQuantity": 0x02b8,  # float — drop chunk size
    "ResourceDropRate":     0x02bc,  # float — drop tick rate
    "MaxResources":         0x02f8,  # int32
    "Resources":            0x02fc,  # int32 (current)
    "ParentInventory":      0x02d8,  # SQVehicleResourceWeaponInventory*
}
AACTOR_OWNER_OFFSET = 0x0158  # AActor.Owner — UObject* (the vehicle here)


# ---------------------------------------------------------------------------
# Squad per-player stats collectors (v10.4 SDK)
#
# Three singleton actors — Logistics, Combat, Objective — each holding a
# TArray of a per-player struct, indexed by PlayerStatsIndex (PSI, read off the
# player's SQPlayerController). These counters are memory-only: they are NOT in
# ListPlayers / RCON, which is exactly why they are worth reading.
#
# The layouts are hardcoded because the arrays are private C++ members, not
# reflected UProperties — reflection cannot resolve them, so `doctor` validates
# them instead. Ported verbatim from the Squad-Replay reader's cross-referenced
# probe (its comments carry the discovery history); the class names are Squad's
# own, including the misspelled "Logistcs".
#
# Struct field offsets are WITHIN each per-player entry.
COLLECTOR_CLASSES = {
    "logistics": "SQLogistcsStatsCollector",   # sic — Squad's spelling
    "combat":    "SQCombatStatsCollector",
    "objective": "SQObjectiveStatsCollector",
}
COLLECTOR_OFFSETS = {
    # TArray<FLogisticsPlayerStats> @ +0x28, stride 12 (3 × i32).
    "logistics": {
        "tarray": 0x28, "stride": 12,
        "fields": {
            "fobsBuilt":            ("i32", 0x00),  # FOB radios placed
            "_ammoSupplied":        ("i32", 0x04),  # cumulative ammo points
            "_constructionSupplied": ("i32", 0x08),  # cumulative cons points
        },
    },
    # TArray<FCombatPlayerStats> @ +0x38, stride 56.
    "combat": {
        "tarray": 0x38, "stride": 56,
        "fields": {
            "vehicleDamage": ("i64", 0x20),   # cumulative damage dealt to vehicles
            "fobsDestroyed": ("i32", 0x30),   # DestroyFOB counter
        },
    },
    # TArray<FObjectivePlayerStats> @ +0x38, stride 20.
    "objective": {
        "tarray": 0x38, "stride": 20,
        "fields": {
            "captures": ("i32", 0x00),
            "defenses": ("i32", 0x08),
        },
    },
}
# PlayerStatsIndex on SQPlayerController — reflection-derived at runtime
# (SQPlayerController.PlayerStatsIndex), with this as the fallback offset.
PC_PLAYER_STATS_INDEX_OFFSET = 0x08A0
# AController.PlayerState — reflection-derived (AController.PlayerState), with
# this fallback. Used to resolve a controller pointer to a player name.
PC_PLAYER_STATE_OFFSET = 0x02C0
# SQProjectile.InstigatorController — the controller that fired this round.
# Hardcoded (not cleanly reflectable); a null/wrong read fails safe to no
# firer, so a Squad-patch drift blanks the field rather than breaking anything.
PROJECTILE_INSTIGATOR_CONTROLLER_OFFSET = 0x0580

# SQPlayerController.RecentVoiceChannel — reflection-derived (see resolve_paths),
# with this as the fallback offset. uint8 ESQVoiceChannel; a wrong/torn read is
# rejected by the 0..13 sanity gate in read_player, which blanks the field
# (no-guess) rather than showing a wrong channel.
PC_RECENT_VOICE_CHANNEL_OFFSET = 0x092C
# ESQVoiceChannel enum -> channel name. 0/'none' = the player is not keying
# voice this tick; 5..13 = commander broadcasting to a specific squad.
VOICE_CHANNEL_NAMES = {
    0: "none", 1: "local", 2: "squad", 3: "command", 4: "toCommander",
    5: "commandSQ1", 6: "commandSQ2", 7: "commandSQ3", 8: "commandSQ4",
    9: "commandSQ5", 10: "commandSQ6", 11: "commandSQ7", 12: "commandSQ8",
    13: "commandSQ9",
}

# Deferred small fields — offsets known (from the Squad-Replay reader) but not
# wired up. Each is one fail-safe read away; they were cut as lowest-value /
# most-fragile, not because they can't be done:
#   leaning       — decoded from the soldier's replicated animation state; not
#                   a single field, needs the lean-angle/flags bit decode.
#   isAdminCam    — requires per-mod spectator-cam class-name patterns
#                   (mods/*/reader.json admin_cam_patterns in Squad-Replay);
#                   mod-dependent, so fragile and deferred.


# SQSquadRallyPoint (rally point actor — each squad can have one active).
# Inherits SQGameRallyPoint → SQGameSpawn → PlayerStart → NavigationObjectBase → Actor.
# Verified via dump_struct_layout on Squad v10.4.1.
RALLY_OFFSETS = {
    "Team":              0x0490,  # uint8 enum on SQGameSpawn
    "bSpawningEnabled":  0x0384,  # bool on SQGameSpawn
    "bSieged":           0x0385,  # bool on SQGameSpawn
    "NumberOfSpawns":    0x04f0,  # int32 on SQGameRallyPoint
    "AuthoritySquad":    0x04f8,  # SQSquadState* on SQSquadRallyPoint
    "SquadState":        0x0500,  # SQSquadState* (often == AuthoritySquad)
}


# Phase 2D (2026-05-26): rich damage events via SQSoldier.LastTakeHitInfo.
# That StructProperty on SQSoldier @+0x24c8 contains an FSQTakeHitInfo
# (UScriptStruct, size 464), which carries everything the killfeed needs:
# damage amount, damage type, causer actor + class, wounded/killed
# flags, ServerTimestamp (event identity), plus the embedded
# PointDamageEvent whose HitResult holds Distance + BoneName.
SQ_SOLDIER_TAKE_HIT_INFO_OFFSET      = 0x24c8

# Within SQTakeHitInfo (own props from reflection dump):
THI_ACTUAL_DAMAGE_OFFSET             = 0x0000  # float
THI_SERVER_TIMESTAMP_OFFSET          = 0x0004  # float — event trigger
THI_DAMAGE_TYPE_CLASS_OFFSET         = 0x0008  # UClass* (UDamageType subclass)
THI_PAWN_INSTIGATOR_OFFSET           = 0x0010  # FWeakObjectPtr (attacker pawn)
THI_DAMAGE_CAUSER_OFFSET             = 0x0018  # FWeakObjectPtr (weapon/projectile/vehicle)
THI_FLAGS_OFFSET                     = 0x0024  # bit0=bKilled, bit1=bWounded, bit2=bEjected
THI_POINT_DAMAGE_EVENT_OFFSET        = 0x0038  # FPointDamageEvent (size 304)

# Within FPointDamageEvent (own +0x30 HitInfo, inherits FDamageEvent 16B):
PDE_HIT_INFO_OFFSET                  = 0x0030  # nested FHitResult

# Within FHitResult (20 props, size 256):
HR_DISTANCE_OFFSET                   = 0x0008  # float (cm)
HR_BONE_NAME_OFFSET                  = 0x00f0  # FName (8 bytes)


# NOTE: these are only a FALLBACK now — read_deployable prefers
# paths.deployable_offsets (reflection). Kept accurate as the "last
# known good" values so the fallback path still works if reflection
# ever misses a field. Updated 2026-07-06 after a Squad update shifted
# the health block +0x18 (BuildState/Cost/MaxHealth/InitialHealth/Health);
# the low fields (0x2c8-0x2e5) were unaffected. Re-derive via reflection
# (scripts/dump_struct_layout.py SQDeployable) if they drift again.
DEPLOYABLE_OFFSETS = {
    "InitialTeam":   0x2c8,    # uint8 enum
    "OwningFob":     0x2d0,    # SQDeployable* (the FOB this object belongs to)
    "Team":          0x2e0,    # int32 (current team owner)
    "bIsFob":        0x2e4,    # bool — own byte, no bitmask
    "bPlaced":       0x2e5,    # bool
    "BuildState":    0x408,    # uint8 enum (Unbuilt/HalfBuilt/Completed)
    "Cost":          0x438,    # int32
    "MaxHealth":     0x43c,    # float
    "InitialHealth": 0x440,    # float
    "Health":        0x444,    # float
}

# FOB radio resource pool. These offsets are on BP_BaseFobCreator_C —
# the base for every FOB radio variant (BP_FOBRadio_AFU_C, _TLF_C, …).
# We only read these when the deployable's bIsFob flag is true; on a
# non-FOB deployable (HAB, ammo crate, sandbag, …) the same offsets
# point at unrelated memory. FALLBACK ONLY — read_deployable prefers
# paths.fob_resource_offsets (reflection). Updated 2026-07-06; the same
# Squad update shifted most of these +0x38 (but bIsSpawningEnabled only
# +0x18 — the non-uniform drift is exactly why reflection is primary).
FOB_RESOURCE_OFFSETS = {
    "InitialConstructionPoints": 0x0604,  # float
    "MaxConstructionPoints":     0x0608,  # float
    "InitialAmmo":               0x060c,  # float
    "MaxAmmo":                   0x0610,  # float
    "CPPerSecond":               0x0614,  # float (regen rate)
    "AmmoPerSecond":             0x0618,  # float
    "Ammo":                      0x0624,  # float — current ammo
    "ConstructionPoints":        0x0628,  # float — current construction material
    "NearbyEnemies":             0x062c,  # int32
    "bSieged":                   0x05c0,  # bool
    "bIsSpawningEnabled":        0x0518,  # bool
    "bIsBleeding":               0x0680,  # bool
    "bHasBeenOverrun":           0x0770,  # bool
    "EstimatedWorldTimeOfDeath": 0x0690,  # float
}


# AAS/RAAS lane graph. SQGraphInitializerComponent is the base; SQGraph
# AASInitializerComponent + SQGraphRAASInitializerComponent both inherit
# it. The DesignOutgoingLinks TArray holds the static lane topology as
# FSQDesignLink elements (16 B each: two UObject* to capture-zone actors).
# Verified by reflection (ArrayProperty inner at FProperty+0x78, inner
# is a StructProperty with Struct == 'SQDesignLink').
LANE_GRAPH_OFFSETS = {
    "DesignOutgoingLinks": 0xb8,
}
LANE_LINK_NODEA_OFF = 0x00   # UObject* — typically BP_CaptureZone_C
LANE_LINK_NODEB_OFF = 0x08   # UObject* — typically BP_CaptureZone_C
LANE_LINK_SIZE = 0x10
# SQGraphRAASVisualizerComponent.RouteIndex (int) — selects which lane
# is active at match start. RAAS only; AAS visualizer lacks this field.
LANE_VISUALIZER_ROUTE_INDEX_OFF = 0xd8


# What the subclass caches below actually hold. New writes are
# (generation, is_subclass) tuples; bare bools are legacy entries from
# before the generation field and are still honoured on read — see
# `_is_subclass_of`. The dicts were previously annotated `dict[int, bool]`,
# which was simply untrue: only the `dict[int, Any]` parameter on
# `_is_subclass_of` kept the type checker from noticing.
SubclassCacheValue = tuple[int, bool] | bool


@dataclass
class SnapshotCaches:
    """
    Mutable per-snapshot lookup caches that stay valid across ticks
    of the same process (UClass pointers don't move within a process's
    lifetime). Pass the same instance to every build_snapshot() call in
    a continuous-mode run to skip the expensive FName-resolution and
    super-chain-walk on objects we've already classified.
    """
    # Generation counter for subclass caches. Bumped by `reset()`;
    # entries with an older generation are treated as misses on the
    # next lookup. Lets us invalidate suspected poisoning without
    # actually clearing the cache (no allocation, no per-class re-walk
    # cost up-front — re-walk happens lazily as classes are touched).
    # Subclass cache entries are stored as (generation, is_subclass)
    # tuples instead of raw bools so callers can detect stale data.
    subclass_gen: int = 0
    # Reset bookkeeping — surfaces in periodic log + /api/health/deep
    # so we can answer "is the cache thrashing?" from one curl.
    reset_count: int = 0
    last_reset_tick: int | None = None
    last_reset_reason: str | None = None
    # Lifetime counters for obj_class hit rate. Survive reset() so we
    # can compute hit-rate over multi-hour windows. A sudden drop is
    # the early-warning signal for a Squad mid-match memory remap.
    obj_class_hits: int = 0
    obj_class_misses: int = 0
    obj_class_serial_bumps: int = 0
    # class_addr -> resolved class name FName (or None on read fail)
    class_name: dict[int, str | None] = field(default_factory=dict)
    # class_addr -> (gen, is-subclass-of-SQGameState?)
    is_subgs: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQVehicle?
    is_vehicle: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQMapMarker?
    is_marker: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQDeployable?
    is_deployable: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQVehicleSpawner?
    is_vehicle_spawner: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQSquadRallyPoint?
    is_rally: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQSquadStateDataMapMarker?
    is_squad_data_marker: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-any-projectile-base-we-track?
    is_tracked_projectile: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQGraphInitializerComponent?
    is_lane_initializer: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # class_addr -> is-subclass-of-SQGraphRAASVisualizerComponent?
    is_raas_visualizer: dict[int, SubclassCacheValue] = field(default_factory=dict)
    # Lane graph BP_CaptureZoneCluster actor address → world position.
    # Static for the lifetime of a map; populated once per map and
    # reused — saves ~12 syscalls/tick on lane-aware modes (AAS/RAAS).
    lane_node_positions: dict[int, dict[str, float] | None] = field(
        default_factory=dict)
    # Turret actor address → resolved class name. Turret base actors
    # are persistent on a vehicle (don't churn between respawns), so
    # the cache hit rate is ~95 % on a stable server. Saves the
    # _uobject_class_name read (~2 syscalls) per turret per tick.
    turret_class_names: dict[int, str | None] = field(default_factory=dict)
    # Same idea for weapon actors that hang off a turret. Most stick
    # around for the lifetime of the vehicle.
    weapon_class_names: dict[int, str | None] = field(default_factory=dict)
    weapon_uobj_names:  dict[int, str | None] = field(default_factory=dict)
    # Player identity caches — name + EOS id never change after the
    # player joins the server. PlayerState UObject addresses are
    # stable for the player's whole session, so cache hit on a
    # populated server is ~95 %.
    player_names:   dict[int, str | None] = field(default_factory=dict)
    player_eos_ids: dict[int, str | None] = field(default_factory=dict)
    # Deployable placer: actorName -> {"name", "eos", "ep"}. Captured the first
    # tick the placer link is live and replayed after it goes stale (the
    # Instigator / direct-PS pointer nulls once the placer despawns / disconnects).
    # Keyed by the game actor's STABLE instance name (e.g. BP_FOBRadio_RGF_C_2111986534)
    # — NOT our memory address — so cli.py can persist it to disk and re-attach
    # placers after a reader restart. `ep` = last-seen placer_epoch; entries aged
    # out after ~1000 ticks unseen. NOT cleared by _light_reset (a captured FOB
    # placer can't be re-read once its link is stale).
    placer_cache: dict[str, dict[str, Any]] = field(default_factory=dict)
    placer_epoch: int = 0
    # slot_idx -> (serial_number, class_addr). When a GUObjectArray slot
    # is reused (UObject freed, slot allocated to a different object),
    # the serial bumps — we detect the bump and re-read class_addr;
    # otherwise we skip the per-object pm.try_read for CLASS_PRIVATE.
    # Single-largest snapshot perf win (~400 ms / tick on a 187k-object
    # server with mostly-stable churn).
    obj_class: dict[int, tuple[int, int]] = field(default_factory=dict)

    def _light_reset(self, *, tick: int | None = None,
                     reason: str = "manual") -> None:
        """Everything reset() does EXCEPT dropping obj_class.

        Cheap: subclass caches refresh lazily via the generation bump
        (~200 classes re-walk over the next tick), name/identity
        caches re-read on demand (~a few hundred extra syscalls on the
        next tick, low single-digit ms).
        """
        # Subclass caches: bump generation (no clear, lazy refresh).
        self.subclass_gen += 1
        self.reset_count += 1
        self.last_reset_tick = tick
        self.last_reset_reason = reason
        # Prune stale (gen < current) tuples. _is_subclass_of treats
        # them as misses anyway, but un-touched entries from a previous
        # match (different map's class set) would otherwise linger
        # indefinitely — small leak (50-200 KB / map transition) that
        # compounds over multi-day uptime. Legacy bool entries from
        # before the (gen, bool) migration are left alone — they're
        # accepted once on next lookup, then replaced with a tuple.
        cur_gen = self.subclass_gen
        for cache_attr in (
            "is_subgs", "is_vehicle", "is_marker", "is_deployable",
            "is_vehicle_spawner", "is_rally", "is_squad_data_marker",
            "is_tracked_projectile", "is_lane_initializer",
            "is_raas_visualizer",
        ):
            sub_cache = getattr(self, cache_attr)
            stale_keys = [k for k, v in sub_cache.items()
                          if isinstance(v, tuple) and v[0] < cur_gen]
            for k in stale_keys:
                del sub_cache[k]
        # Name + identity caches: cheap to rebuild, drop them so
        # stale resolved names from a previous match transition can't
        # leak into the new snapshot.
        self.class_name.clear()
        self.lane_node_positions.clear()
        self.turret_class_names.clear()
        self.weapon_class_names.clear()
        self.weapon_uobj_names.clear()
        self.player_names.clear()
        self.player_eos_ids.clear()

    def reset(self, *, tick: int | None = None,
              reason: str = "manual") -> None:
        self._light_reset(tick=tick, reason=reason)
        # obj_class: while (serial, class_addr) detects UObject SLOT
        # reuse, it does NOT catch the case where a transient bad
        # /proc read (EIO mid-walk before our defensive hardening was
        # in place) stored a GARBAGE class_addr against a stable
        # serial. That poisoning is invisible to the serial check —
        # we trust the garbage forever. Symptom: probe with fresh
        # cache shows 37 deployables but live backend emits 20; HABs
        # / FOB radios / sandbags silently missing.
        # Cost: ~187k pm.try_read calls on next tick (~1-2 s spike).
        # Use this full reset for recovery paths only; continuous mode
        # should call partial_invalidate() every tick instead, which
        # gives the same anti-poisoning guarantee without the spike.
        self.obj_class.clear()

    def partial_invalidate(self, tick: int, *, window: int = 60,
                           total_slots: int | None = None) -> None:
        """Rolling cache hygiene for continuous mode — call every tick.

        Replaces the old "full reset() every `window` ticks" strategy,
        whose obj_class.clear() forced ~187k re-reads in ONE tick and
        produced a 1-2 s build spike every ~30 s. On the live map that
        spike rendered as everybody freezing mid-run and then jumping.

        Instead, each call drops the 1/window slice of obj_class whose
        slot index is congruent to the current tick (idx % window ==
        tick % window). Every slot is re-verified once per `window`
        ticks — the same poisoning bound as the old full clear — but
        the re-read cost (~3k objects, ~10-20 ms) is spread evenly, so
        no tick ever spikes. Once per cycle the cheap name/subclass
        caches get the old light reset too.

        Pass `total_slots` (= arr.num_elements) to probe the slice
        directly via range() over the dense slot indices — O(slice)
        instead of scanning all ~187k cache keys every tick (~10 ms of
        pure Python saved). Entries at indices >= total_slots (array
        shrank — rare) are never read by the snapshot loop, so leaving
        them until the next deep reset() is harmless.
        """
        phase = tick % window
        if phase == 0:
            self._light_reset(tick=tick, reason=f"rolling (tick {tick})")
        oc = self.obj_class
        # total_slots is a raw live read of GUObjectArray.num_elements. A
        # torn/garbage read can hand back a huge positive int; range() over it
        # would do tens of millions of pure-Python pops and wedge the producer
        # for seconds. If it's implausible, fall back to the bounded key scan.
        if total_slots is not None and not (0 < total_slots < (1 << 26)):
            total_slots = None
        if total_slots is not None:
            for idx in range(phase, total_slots, window):
                oc.pop(idx, None)
        else:
            stale = [idx for idx in oc if idx % window == phase]
            for idx in stale:
                del oc[idx]

    def sizes(self) -> dict[str, int]:
        """Per-cache entry counts for /api/health/deep and logs."""
        return {
            "class_name":              len(self.class_name),
            "is_subgs":                len(self.is_subgs),
            "is_vehicle":              len(self.is_vehicle),
            "is_marker":               len(self.is_marker),
            "is_deployable":           len(self.is_deployable),
            "is_vehicle_spawner":      len(self.is_vehicle_spawner),
            "is_rally":                len(self.is_rally),
            "is_squad_data_marker":    len(self.is_squad_data_marker),
            "is_tracked_projectile":   len(self.is_tracked_projectile),
            "is_lane_initializer":     len(self.is_lane_initializer),
            "is_raas_visualizer":      len(self.is_raas_visualizer),
            "lane_node_positions":     len(self.lane_node_positions),
            "turret_class_names":      len(self.turret_class_names),
            "weapon_class_names":      len(self.weapon_class_names),
            "weapon_uobj_names":       len(self.weapon_uobj_names),
            "player_names":            len(self.player_names),
            "player_eos_ids":          len(self.player_eos_ids),
            "obj_class":               len(self.obj_class),
        }


@dataclass
class DamageTracker:
    """
    Cross-tick state for computing damage events from APawn.LastHitBy
    deltas. Pass a single instance into every build_snapshot() call in
    continuous mode; it remembers each soldier's previous LastHitBy
    pointer and emits an event whenever a new attacker shows up.

    Notes:
      - LastHitBy is the *controller* of the last attacker, not a
        weapon class. We resolve it to a player name via the
        controller -> player map built within build_snapshot.
      - A soldier dying and respawning is detected at the snapshot
        level (soldier addr changes); we key by EOS user id when
        possible to survive respawns.
    """
    # eos_id -> last seen LastHitBy controller addr
    last_seen: dict[str, int] = field(default_factory=dict)
    # eos_id -> last seen FSQTakeHitInfo.ServerTimestamp (Phase 2D — fires
    # an event when ts moves forward even if LastHitBy didn't change,
    # which catches same-attacker repeat hits the lhb delta missed).
    last_ts: dict[str, float] = field(default_factory=dict)

    def reset(self) -> None:
        self.last_seen.clear()
        self.last_ts.clear()


@dataclass
class SnapshotPaths:
    """Resolved class pointers + per-class field offsets we need."""
    sq_player_state_class: int
    sq_soldier_class: int
    sq_game_state_class: int
    sq_team_state_class: int
    sq_vehicle_class: int
    sq_pawn_class: int
    sq_squad_state_class: int
    bp_capture_zone_class: int    # BP_CaptureZone_C (BlueprintGeneratedClass)
    sq_capture_zone_component_class: int  # SQCaptureZoneComponent
    sq_map_marker_class: int       # SQMapMarker (base; 65 BP subclasses)
    sq_deployable_class: int       # SQDeployable (base; FOBs/HABs/ammo/etc)
    sq_vehicle_spawner_class: int  # SQVehicleSpawner (base; BP_VehicleSpawner_C)
    sq_squad_rally_point_class: int  # SQSquadRallyPoint (the per-squad rally actor)
    sq_squad_state_data_map_marker_class: int  # legacy, kept for compat (unused in v10)
    sq_map_marker_manager_component_class: int  # owns MarkerArray.Items (the live markers)
    # Set of SQProjectile-derived base UClasses we track in-flight
    # (mortar/guided/smoke — verified PROJECTILE_BASE_NAMES at runtime).
    tracked_projectile_class_addrs: frozenset[int]
    # SQGraphInitializerComponent — base for AAS+RAAS lane initializers.
    # Holds DesignOutgoingLinks (the static lane-graph edges).
    sq_graph_initializer_class: int
    # SQGraphRAASVisualizerComponent — RAAS-only; holds RouteIndex
    # (which lane is chosen at match start). 0 when class is absent.
    sq_graph_raas_visualizer_class: int
    # Squad's per-player stats-collector singletons (Logistics/Combat/
    # Objective). 0 when the class isn't loaded — the collectors spawn once
    # per map, so an early tick may see none. Keyed by COLLECTOR_CLASSES key.
    collector_classes: dict[str, int]
    # SQPlayerController.PlayerStatsIndex offset (reflection-derived; the
    # module constant is the fallback). None if unresolved.
    pc_stats_index_off: int | None
    # AController.PlayerState offset (reflection-derived; module fallback).
    # Used to turn a controller pointer into a player name (projectile firer).
    pc_playerstate_off: int | None
    # SQPlayerController.RecentVoiceChannel offset (reflection-derived; module
    # constant is the fallback). None if unresolved. uint8 ESQVoiceChannel.
    pc_voice_channel_off: int | None
    ps_offsets: dict[str, int]
    soldier_offsets: dict[str, int]
    gs_offsets: dict[str, int]
    ts_offsets: dict[str, int]
    vehicle_offsets: dict[str, int]
    squad_offsets: dict[str, int]
    psd_offsets: dict[str, int]   # PlayerStateDataObject UScriptStruct fields
    capzone_actor_offsets: dict[str, int]    # BP_CaptureZone_C own props
    capzone_comp_offsets: dict[str, int]     # SQCaptureZoneComponent props
    sq_pawn_team_off: int | None        # SQPawn.Team byte enum
    # raw offset (not necessarily reflected the same way): TeamStates TArray
    gs_team_states_off: int | None
    # AActor / USceneComponent — used for position lookup
    actor_root_component_off: int       # AActor.RootComponent
    scene_relative_location_off: int    # USceneComponent.RelativeLocation
    scene_relative_rotation_off: int    # USceneComponent.RelativeRotation
    scene_attach_parent_off: int        # USceneComponent.AttachParent
    # ComponentToWorld.Translation (cached world FVector). Empirically
    # at SceneComponent + 0x210 (the FTransform starts at +0x1f0 with
    # the FQuat Rotation; Translation is +0x20 into FTransform).
    # ComponentToWorld is not reflected so we hardcode the offset.
    scene_component_to_world_translation_off: int
    # ComponentToWorld.Rotation (world FQuat), 0x20 before Translation.
    # World yaw — correct even for actors attached to a parent, whose
    # RelativeRotation is parent-relative. Confirmed live: for unattached
    # actors this quat's yaw equals RelativeRotation.yaw exactly.
    scene_component_to_world_rotation_off: int
    # FBoolProperty bit masks: {field_name: (effective_byte_offset, byte_mask)}
    # — consumers do `(byte & mask) != 0` rather than guessing bit 0.
    # Placed at the end of the dataclass so default_factory doesn't trip
    # field-ordering on the required `_off` fields above.
    ps_bool_masks: dict[str, tuple[int, int]] = field(default_factory=dict)
    gs_bool_masks: dict[str, tuple[int, int]] = field(default_factory=dict)
    soldier_bool_masks: dict[str, tuple[int, int]] = field(default_factory=dict)
    # Reflection-derived SQDeployable field offsets (Team / bIsFob /
    # BuildState / MaxHealth / Health / …). Reflection instead of the
    # hardcoded DEPLOYABLE_OFFSETS because those drift on Squad updates
    # (v10.4.1 → the health block shifted +0x18), which silently broke
    # the deployable freshness gate and made FOB radios / HABs / mines
    # blink in and out. read_deployable falls back to the module
    # constant for any field reflection can't resolve.
    deployable_offsets: dict[str, int] = field(default_factory=dict)
    # ----- Placer attribution (who placed a deployable / mine / FOB) -----
    # AActor.Instigator (reflected) + SQPawn.PlayerState (reflected) resolve the
    # transient pawn path; pc_playerstate_off resolves the controller path.
    actor_instigator_off: int | None = None
    pawn_playerstate_off: int | None = None
    # The direct placer slots on SQDeployable are UNNAMED private fields —
    # reflection can't see them (the named neighbours end at +0x500 ErrorTable),
    # so they're hardcoded from a live probe (current Squad build): +0x0518 =
    # SQPlayerState* (durable), +0x0510 = its APlayerController*. If a Squad
    # update drifts them, re-derive with a read-only memory probe: scan a live
    # deployable's fields for a pointer that resolves (directly, or via
    # actor_instigator/pawn_playerstate) to a current player's name.
    deployable_placer_ps_off: int = 0x0518
    deployable_placer_ctrl_off: int = 0x0510
    # Reflection-derived FOB resource-pool offsets (Ammo / Construction /
    # MaxAmmo / bSieged / …) off BP_BaseFobCreator_C. Also drifted (by a
    # DIFFERENT amount than the SQDeployable block — +0x38 vs +0x18),
    # which is exactly why hardcoding these was unmaintainable.
    fob_resource_offsets: dict[str, int] = field(default_factory=dict)
    # Reflection-derived SQVehicle TArray offsets (VehicleSeats /
    # VehicleTurrets / VehicleComponents / CachedVehicleEngine). The same
    # Squad update that shifted deployables also moved VehicleTurrets
    # (+0x8), so vehicle turret magazines / yaw read from junk. Reflection
    # keeps them correct across updates; read helpers fall back to the
    # module SQ_VEHICLE_*_OFFSET constants for any field not resolved.
    vehicle_array_offsets: dict[str, int] = field(default_factory=dict)
    # Reflection-derived SQSoldierMovement offsets (Stamina / StaminaMax). The
    # movement component is a two-hop read off the soldier; these offsets live
    # ON that component's class. Reflected by name because the Squad-Replay
    # reader's hardcoded 0x03FC/0x1024 point at a config float on this build.
    soldier_movement_offsets: dict[str, int] = field(default_factory=dict)


def resolve_paths(pm: ProcessMemory, arr: GUObjectArray,
                  alloc: FNameEntryAllocator) -> SnapshotPaths:
    # One shared walk resolves every class we need. The previous
    # one-find_by_name-per-class version walked the full ~187k-entry
    # GUObjectArray ~20 times (~3.7M reads) — on every startup AND
    # every self-heal restart, which stretched the downtime window.
    required = {
        "SQPlayerState": "Class",
        "SQSoldier": "Class",
        "SQGameState": "Class",
        "SQTeamState": "Class",
        "Actor": "Class",
        "SceneComponent": "Class",
        "SQVehicle": "Class",
        "SQPawn": "Class",
        "SQSquadState": "Class",
    }
    optional = {
        # BP_CaptureZone_C is a BlueprintGeneratedClass, not a Class — use
        # that filter or it won't be found. We tolerate absence (some maps
        # / modes have no cap zones at all; snapshot emits an empty array).
        "BP_CaptureZone_C": "BlueprintGeneratedClass",
        "SQCaptureZoneComponent": "Class",
        "SQMapMarker": "Class",
        "SQDeployable": "Class",
        # BP_BaseFobCreator_C is the BP base that defines the FOB radio
        # resource pool (Ammo/Construction/…). BlueprintGeneratedClass,
        # not Class. Layed out for reflection-derived fob_resource_offsets.
        "BP_BaseFobCreator_C": "BlueprintGeneratedClass",
        "SQVehicleSpawner": "Class",
        "SQSquadRallyPoint": "Class",
        "SQSquadStateDataMapMarker": "Class",
        "SQMapMarkerManagerComponent": "Class",
        # Lane-graph classes. SQGraphInitializerComponent always present
        # (AAS+RAAS share it). SQGraphRAASVisualizerComponent only on RAAS
        # builds — RouteIndex is RAAS-only anyway.
        "SQGraphInitializerComponent": "Class",
        "SQGraphRAASVisualizerComponent": "Class",
        # Whitelisted projectile bases (mortar / guided / smoke); their
        # subclass-of check is unioned into the projectile filter.
        **{name: "Class" for name in PROJECTILE_BASE_NAMES},
        # Squad's per-player stats-collector singletons. Their per-player
        # counters (captures/defenses/fobsBuilt/fobsDestroyed/vehicleDamage/
        # suppliesDelivered) are memory-only — not in RCON.
        **{name: "Class" for name in COLLECTOR_CLASSES.values()},
        # SQPlayerController — for the PlayerStatsIndex that keys the
        # collector arrays. BlueprintGeneratedClass on a dedicated server
        # (BP_PlayerController_C), so accept both meta-classes.
        "SQPlayerController": "Class",
        "BP_PlayerController_C": "BlueprintGeneratedClass",
        # SQSoldierMovement — the character movement component that holds the
        # real sprint Stamina/StaminaMax floats (two-hop off the soldier).
        "SQSoldierMovement": "Class",
    }
    found = arr.find_all_by_names({**required, **optional}, alloc=alloc)
    missing = [n for n in required if n not in found]
    if missing:
        raise RuntimeError(
            f"classes not found in GUObjectArray: {', '.join(missing)}")

    def _addr(name: str) -> int:
        return found[name][1] if name in found else 0

    sq_player_state_class_addr = _addr("SQPlayerState")
    sq_soldier_class_addr = _addr("SQSoldier")
    sq_game_state_class_addr = _addr("SQGameState")
    sq_team_state_class_addr = _addr("SQTeamState")
    actor_class_addr = _addr("Actor")
    scene_class_addr = _addr("SceneComponent")
    sq_vehicle_class_addr = _addr("SQVehicle")
    sq_pawn_class_addr = _addr("SQPawn")
    sq_squad_state_class_addr = _addr("SQSquadState")
    bp_capture_zone_class_addr = _addr("BP_CaptureZone_C")
    sq_capture_zone_component_class_addr = _addr("SQCaptureZoneComponent")
    sq_map_marker_class_addr = _addr("SQMapMarker")
    sq_deployable_class_addr = _addr("SQDeployable")
    sq_vehicle_spawner_class_addr = _addr("SQVehicleSpawner")
    sq_squad_rally_point_class_addr = _addr("SQSquadRallyPoint")
    sq_squad_state_data_map_marker_class_addr = _addr("SQSquadStateDataMapMarker")
    sq_map_marker_manager_component_class_addr = _addr("SQMapMarkerManagerComponent")
    sq_graph_initializer_class_addr = _addr("SQGraphInitializerComponent")
    sq_graph_raas_visualizer_class_addr = _addr("SQGraphRAASVisualizerComponent")
    tracked_proj_bases: set[int] = {
        _addr(n) for n in PROJECTILE_BASE_NAMES if n in found}

    ps_layout = get_class_layout(pm, sq_player_state_class_addr, alloc)
    sd_layout = get_class_layout(pm, sq_soldier_class_addr, alloc)
    gs_layout = get_class_layout(pm, sq_game_state_class_addr, alloc)
    ts_layout = get_class_layout(pm, sq_team_state_class_addr, alloc)
    actor_layout = get_class_layout(pm, actor_class_addr, alloc)
    scene_layout = get_class_layout(pm, scene_class_addr, alloc)
    vh_layout = get_class_layout(pm, sq_vehicle_class_addr, alloc)
    pawn_layout = get_class_layout(pm, sq_pawn_class_addr, alloc)
    sqs_layout = get_class_layout(pm, sq_squad_state_class_addr, alloc)
    cz_layout = (get_class_layout(pm, bp_capture_zone_class_addr, alloc)
                 if bp_capture_zone_class_addr else {})
    czc_layout = (get_class_layout(pm, sq_capture_zone_component_class_addr, alloc)
                  if sq_capture_zone_component_class_addr else {})
    dep_layout = (get_class_layout(pm, sq_deployable_class_addr, alloc)
                  if sq_deployable_class_addr else {})
    bp_base_fob_creator_class_addr = _addr("BP_BaseFobCreator_C")
    fob_layout = (get_class_layout(pm, bp_base_fob_creator_class_addr, alloc)
                  if bp_base_fob_creator_class_addr else {})
    # SQSoldierMovement holds the real sprint Stamina/StaminaMax floats. We
    # reflect their offsets off the class here; _read_soldier does the two-hop
    # (soldier -> SoldierMovement ptr -> Stamina). Reflection is essential: the
    # Squad-Replay reader's hardcoded 0x03FC/0x1024 read a config float on this
    # build (verified live: 1.875 constant), while the real Stamina is @0x10c0.
    sq_soldier_movement_class_addr = _addr("SQSoldierMovement")
    smv_layout = (get_class_layout(pm, sq_soldier_movement_class_addr, alloc)
                  if sq_soldier_movement_class_addr else {})

    def grab(layout, names):
        return {n: layout[n].offset for n in names if n in layout}

    gs_offsets = grab(gs_layout, [
        "ServerName", "MessageOfTheDay", "MaxPlayers", "ServerTickRate",
        "MatchID", "MatchState", "ElapsedTime", "bIsTicketBasedGame",
        "GameModeId", "AuthorityNumTeams", "MaxFireTeamCount",
        "MaxFireTeamSize", "TimeOfCompletion", "ServerStartTimeStamp",
        "ReplicatedWorldTimeSecondsDouble", "MapName", "GameModeName",
    ])
    # We discovered TeamStates lives at +0x3e0 by dumping SQGameState live;
    # also check the reflected layout in case the offset is exposed there.
    team_states_off = (gs_layout["TeamStates"].offset
                       if "TeamStates" in gs_layout else None)

    # Stats-collector singleton classes, keyed by COLLECTOR_CLASSES key.
    collector_class_addrs = {
        key: _addr(cls_name) for key, cls_name in COLLECTOR_CLASSES.items()}
    # PlayerStatsIndex offset: reflection off SQPlayerController, else the
    # hardcoded fallback. Prefer whichever PC variant resolved.
    pc_class_addr = _addr("SQPlayerController") or _addr("BP_PlayerController_C")
    pc_layout = (get_class_layout(pm, pc_class_addr, alloc)
                 if pc_class_addr else {})
    pc_stats_index_off = (pc_layout["PlayerStatsIndex"].offset
                          if "PlayerStatsIndex" in pc_layout
                          else PC_PLAYER_STATS_INDEX_OFFSET)
    pc_playerstate_off = (pc_layout["PlayerState"].offset
                          if "PlayerState" in pc_layout
                          else PC_PLAYER_STATE_OFFSET)
    # RecentVoiceChannel — reflect it off the same SQPlayerController layout
    # that already yielded PlayerStatsIndex/PlayerState; fall back to the
    # module constant so a Squad patch that renames the field blanks the
    # indicator rather than breaking the read.
    pc_voice_channel_off = (pc_layout["RecentVoiceChannel"].offset
                            if "RecentVoiceChannel" in pc_layout
                            else PC_RECENT_VOICE_CHANNEL_OFFSET)
    return SnapshotPaths(
        sq_player_state_class=sq_player_state_class_addr,
        sq_soldier_class=sq_soldier_class_addr,
        sq_game_state_class=sq_game_state_class_addr,
        sq_team_state_class=sq_team_state_class_addr,
        sq_vehicle_class=sq_vehicle_class_addr,
        sq_pawn_class=sq_pawn_class_addr,
        sq_squad_state_class=sq_squad_state_class_addr,
        bp_capture_zone_class=bp_capture_zone_class_addr,
        sq_capture_zone_component_class=sq_capture_zone_component_class_addr,
        sq_map_marker_class=sq_map_marker_class_addr,
        sq_deployable_class=sq_deployable_class_addr,
        sq_vehicle_spawner_class=sq_vehicle_spawner_class_addr,
        sq_squad_rally_point_class=sq_squad_rally_point_class_addr,
        sq_squad_state_data_map_marker_class=sq_squad_state_data_map_marker_class_addr,
        sq_map_marker_manager_component_class=sq_map_marker_manager_component_class_addr,
        tracked_projectile_class_addrs=frozenset(tracked_proj_bases),
        sq_graph_initializer_class=sq_graph_initializer_class_addr,
        sq_graph_raas_visualizer_class=sq_graph_raas_visualizer_class_addr,
        collector_classes=collector_class_addrs,
        pc_stats_index_off=pc_stats_index_off,
        pc_playerstate_off=pc_playerstate_off,
        pc_voice_channel_off=pc_voice_channel_off,
        sq_pawn_team_off=(pawn_layout["Team"].offset
                          if "Team" in pawn_layout else None),
        ps_offsets=grab(ps_layout, [
            "PlayerNamePrivate", "TeamId", "Score", "CompressedPing",
            "bIsABot", "OnlineUserId", "SquadState", "TeamState",
            "Soldier", "CurrentPawn", "CurrentRoleId", "CurrentRole",
            "PlayerId", "PlayerStateData",
        ]),
        soldier_offsets=grab(sd_layout, [
            "Health", "BreathHoldStamina", "CurrentHeldWeapon",
            # SQSoldierMovement component pointer — the two-hop base for the
            # real sprint Stamina (offsets in soldier_movement_offsets).
            "SoldierMovement",
            # Inherited from APawn: needed for damage event tracking.
            "LastHitBy", "Controller",
            # bIsProne is SQSoldier-own (+0x1ebc) and gets its own byte,
            # so a plain `& 1` read suffices. bIsCrouched is Character-
            # inherited and shares its byte with several other bools —
            # that one needs an FBoolProperty mask (in soldier_bool_masks).
            "bIsProne",
        ]),
        gs_offsets=gs_offsets,
        ts_offsets=grab(ts_layout, [
            "ID", "Tickets", "Score", "ObjectiveScore",
            "NumKills", "NumDeaths", "NumWoundeds",
            "FactionSetupId", "FactionSetup",
            "IndexedSquadStates", "PlayerStates", "RoleAvailabilities",
            "VehicleAvailabilities", "DeployableAvailabilities",
            "CommanderState",
        ]),
        vehicle_offsets=grab(vh_layout, [
            "Health", "MaxHealth", "LastDamageInstigator",
        ]),
        squad_offsets=grab(sqs_layout, [
            "ID", "TeamId", "MaxSize", "NumKills", "NumDeaths",
            "NumWoundeds", "Score", "TeamWorkScore", "ObjectiveScore",
            "CombatScore", "RevivedPoints", "PlayerStates", "LeaderState",
            "Name", "SquadCreatorName", "SquadCreatorSteamID",
            "CreationTimeStamp",
        ]),
        # BP_CaptureZone_C is the actor; its key field is SQCaptureZone
        # (a pointer to the SQCaptureZoneComponent that holds all the
        # actual capture state).
        capzone_actor_offsets=grab(cz_layout, ["SQCaptureZone"]),
        # SQCaptureZoneComponent — holds owningTeam, capturingTeam,
        # capturePercent, bIsLocked, FlagName (FText), and various
        # team-capturability bitmasks. Verified empirically on the
        # 5 named cap zones on the live Pacific Proving Grounds Seed
        # map (01-Warehouse / 02-OldCamp / ... / 05-OldHQ).
        capzone_comp_offsets=grab(czc_layout, [
            "InitialTeam", "FlagName", "CapturingTeam", "OwningTeam",
            "LastOwningTeam", "BonusCaptureMultiplier",
            "CapturePercentDelta", "CapturePercent",
            "CapturePercentDirection", "bIsLocked",
            "TeamCapturabilities", "TeamKnowledge",
            # Live capture-rate advantage (which side is winning the flag now).
            # Reflection-derived: absent, not wrong, if the SDK name differs.
            "PlayerAdvantage",
        ]),
        # Reflection-derived layout of PlayerStateDataObject UScriptStruct
        # (the 128-byte struct embedded in SQPlayerState at PlayerStateData).
        # Found by reading the FStructProperty.Struct ptr (+0x70 from the
        # FField). 25 fields — Lives, NumKills/Deaths/TeamKills/Vehicle
        # Kills/Woundeds/Wounds, HealPoints, RevivedPoints, scores,
        # bAdmin/bDev/bCommander, FireTeamIndex, etc.
        psd_offsets={
            n: p.offset for n, p in
            struct_layout_for_field(pm, sq_player_state_class_addr,
                                    "PlayerStateData", alloc).items()
        },
        # Bool fields packed as bitfields: read via byte AND mask instead
        # of `& 1`. Without these masks bIsABot etc. randomly looked
        # `true` because they share byte 0x2c2 with 5 other bools.
        ps_bool_masks={
            n: m for n in ["bIsABot", "bIsSpectator", "bOnlySpectator",
                           "bIsInactive", "bFromPreviousLevel"]
            for m in [bool_property_mask(pm, sq_player_state_class_addr, n, alloc)]
            if m is not None
        },
        gs_bool_masks={
            n: m for n in ["bIsTicketBasedGame"]
            for m in [bool_property_mask(pm, sq_game_state_class_addr, n, alloc)]
            if m is not None
        },
        soldier_bool_masks={
            # bIsCrouched (stance) + the replicated life-state flags. Each is
            # resolved independently; a name the SDK doesn't expose simply
            # isn't in the dict and its read is skipped (fail-safe null) — so
            # no life-state is ever inferred from a wrong offset (no-guess).
            n: m for n in ["bIsCrouched", "bIsWounded", "bIsBleeding",
                           "bIsDying"]
            for m in [bool_property_mask(pm, sq_soldier_class_addr, n, alloc)]
            if m is not None
        },
        soldier_movement_offsets=grab(smv_layout, ["Stamina", "StaminaMax"]),
        gs_team_states_off=team_states_off,
        actor_root_component_off=actor_layout["RootComponent"].offset,
        actor_instigator_off=(actor_layout["Instigator"].offset
                              if "Instigator" in actor_layout else None),
        pawn_playerstate_off=(pawn_layout["PlayerState"].offset
                              if "PlayerState" in pawn_layout else None),
        scene_relative_location_off=scene_layout["RelativeLocation"].offset,
        scene_relative_rotation_off=scene_layout["RelativeRotation"].offset,
        scene_attach_parent_off=scene_layout["AttachParent"].offset,
        scene_component_to_world_translation_off=0x210,
        scene_component_to_world_rotation_off=0x210 - 0x20,
        # Reflection-derived deployable + FOB offsets (see dataclass docs).
        deployable_offsets=grab(dep_layout, [
            "InitialTeam", "OwningFob", "Team", "bIsFob", "bPlaced",
            "BuildState", "Cost", "MaxHealth", "InitialHealth", "Health",
        ]),
        fob_resource_offsets=grab(fob_layout, [
            "InitialConstructionPoints", "MaxConstructionPoints",
            "InitialAmmo", "MaxAmmo", "CPPerSecond", "AmmoPerSecond",
            "Ammo", "ConstructionPoints", "NearbyEnemies", "bSieged",
            "bIsSpawningEnabled", "bIsBleeding", "bHasBeenOverrun",
            "EstimatedWorldTimeOfDeath",
        ]),
        # SQVehicle TArray offsets (chain-walk picks up the ones defined
        # on the SQVehicleSeat parent too — VehicleComponents / Cached).
        vehicle_array_offsets=grab(vh_layout, [
            "VehicleSeats", "VehicleTurrets", "VehicleComponents",
            "CachedVehicleEngine",
        ]),
    )


def _is_subclass_of(pm: ProcessMemory, class_addr: int,
                    base_class_addr: int,
                    cache: dict[int, Any],
                    current_gen: int = 0) -> bool:
    """True if `class_addr`'s SuperStruct chain includes `base_class_addr`.

    Caches BOTH true and false answers, but only when:
      (a) the chain walk completed (len >= 2 entries) — truncated
          walks from transient EIO would otherwise poison the cache,
      (b) the stored generation matches `current_gen` — `caches.reset()`
          bumps the generation so older entries are treated as misses
          on the next lookup. Memory stays bounded because the new
          entry overwrites the stale one in place.

    Backward-compatible: legacy `bool` cache values (from before the
    generation field) are still respected. New writes use
    `(generation, bool)` tuples.
    """
    if class_addr == base_class_addr:
        return True
    cached = cache.get(class_addr)
    if cached is not None:
        if isinstance(cached, tuple):
            gen, val = cached
            if gen == current_gen:
                return val
            # stale → fall through to re-walk, will overwrite
        elif isinstance(cached, bool):
            # legacy entry — accept once, will be replaced with
            # (gen, bool) on first refresh after a reset
            return cached
    chain = walk_super_chain(pm, class_addr)
    is_sub = base_class_addr in chain
    # Heuristic: chain shorter than 2 entries is almost certainly
    # truncated (the call would normally return ~5-10 entries ending
    # at Object). Skip caching truncated walks so a transient EIO
    # doesn't poison the cache for the entire run.
    if len(chain) >= 2:
        cache[class_addr] = (current_gen, is_sub)
    return is_sub


def find_subclass_instance(pm: ProcessMemory, arr: GUObjectArray,
                           alloc: FNameEntryAllocator,
                           base_class_addr: int,
                           *, skip_cdo: bool = True) -> int | None:
    """
    Return the first non-CDO live UObject whose class chain derives from
    `base_class_addr`, or None. Useful for singletons (SQGameState,
    SQGameMode, SQGameInstance) where the live one is a Blueprint subclass.
    """
    is_sub_cache: dict[int, bool] = {}
    for _idx, obj_addr in arr.iter_object_addrs():
        if obj_addr == 0:
            continue
        cp = pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
        if cp is None:
            continue
        ca = struct.unpack("<Q", cp)[0]
        if not _is_subclass_of(pm, ca, base_class_addr, is_sub_cache):
            continue
        if skip_cdo:
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if nm.startswith("Default__"):
                continue
        return obj_addr
    return None


def read_game_state(pm: ProcessMemory, alloc: FNameEntryAllocator,
                    paths: SnapshotPaths, gs_addr: int) -> dict[str, Any]:
    """Read scalar/string fields from an SQGameState (or subclass) instance."""
    o = paths.gs_offsets
    out: dict[str, Any] = {"_addr": f"{gs_addr:#x}"}

    if "ServerName" in o:
        out["serverName"] = read_fstring(pm, gs_addr + o["ServerName"])
    if "MessageOfTheDay" in o:
        out["motd"] = read_fstring(pm, gs_addr + o["MessageOfTheDay"])
    if "MaxPlayers" in o:
        out["maxPlayers"] = _safe(lambda: pm.read_i32(gs_addr + o["MaxPlayers"]))
    if "ServerTickRate" in o:
        b = pm.try_read(gs_addr + o["ServerTickRate"], 4)
        out["tickRate"] = struct.unpack("<f", b)[0] if b and len(b) == 4 else None
    if "MatchID" in o:
        out["matchId"] = read_fstring(pm, gs_addr + o["MatchID"])
    if "MatchState" in o:
        out["matchState"] = _read_fname(pm, gs_addr + o["MatchState"], alloc)
    if "ElapsedTime" in o:
        out["elapsedSec"] = _safe(lambda: pm.read_i32(gs_addr + o["ElapsedTime"]))
    if "bIsTicketBasedGame" in paths.gs_bool_masks:
        eff_off, mask = paths.gs_bool_masks["bIsTicketBasedGame"]
        byte = _safe(lambda: pm.read_u8(gs_addr + eff_off))
        out["isTicketBased"] = (byte is not None) and bool(byte & mask)
    if "GameModeId" in o:
        out["gameModeId"] = _read_fname(pm, gs_addr + o["GameModeId"], alloc)
    if "AuthorityNumTeams" in o:
        out["numTeams"] = _safe(lambda: pm.read_i32(gs_addr + o["AuthorityNumTeams"]))
    if "MaxFireTeamCount" in o:
        out["maxFireTeamCount"] = _safe(lambda: pm.read_i32(gs_addr + o["MaxFireTeamCount"]))
    if "MaxFireTeamSize" in o:
        out["maxFireTeamSize"] = _safe(lambda: pm.read_i32(gs_addr + o["MaxFireTeamSize"]))
    if "TimeOfCompletion" in o:
        b = pm.try_read(gs_addr + o["TimeOfCompletion"], 4)
        out["timeOfCompletion"] = (struct.unpack("<f", b)[0]
                                   if b and len(b) == 4 else None)
    if "ServerStartTimeStamp" in o:
        out["serverStartTimestamp"] = _safe(
            lambda: pm.read_i32(gs_addr + o["ServerStartTimeStamp"]))
    if "ReplicatedWorldTimeSecondsDouble" in o:
        b = pm.try_read(gs_addr + o["ReplicatedWorldTimeSecondsDouble"], 8)
        out["worldTimeSec"] = (struct.unpack("<d", b)[0]
                               if b and len(b) == 8 else None)
    if "MapName" in o:
        # FText decode; works for FTextHistory_Base which is what Squad uses
        # for the server-set MapName / GameModeName fields.
        out["mapName"] = read_ftext(pm, gs_addr + o["MapName"])
    if "GameModeName" in o:
        out["gameModeName"] = read_ftext(pm, gs_addr + o["GameModeName"])

    # also resolve the class name of the actual instance (so users can see
    # whether it's the base class or a Blueprint subclass like BP_GameStateSquad_Seed_C)
    out["instanceClass"] = _uobject_class_name(pm, gs_addr, alloc)
    return out


def read_team_state(pm: ProcessMemory, alloc: FNameEntryAllocator,
                    paths: SnapshotPaths, ts_addr: int) -> dict[str, Any]:
    """Read scalar/string fields from a SQTeamState instance."""
    o = paths.ts_offsets
    out: dict[str, Any] = {"_addr": f"{ts_addr:#x}"}

    if "ID" in o:
        out["id"] = _safe(lambda: pm.read_i32(ts_addr + o["ID"]))
    if "Tickets" in o:
        out["tickets"] = _safe(lambda: pm.read_i32(ts_addr + o["Tickets"]))
    if "Score" in o:
        b = pm.try_read(ts_addr + o["Score"], 4)
        out["score"] = struct.unpack("<f", b)[0] if b and len(b) == 4 else None
    if "ObjectiveScore" in o:
        b = pm.try_read(ts_addr + o["ObjectiveScore"], 4)
        out["objectiveScore"] = (struct.unpack("<f", b)[0]
                                 if b and len(b) == 4 else None)
    if "NumKills" in o:
        out["kills"] = _safe(lambda: pm.read_i32(ts_addr + o["NumKills"]))
    if "NumDeaths" in o:
        out["deaths"] = _safe(lambda: pm.read_i32(ts_addr + o["NumDeaths"]))
    if "NumWoundeds" in o:
        out["woundeds"] = _safe(lambda: pm.read_i32(ts_addr + o["NumWoundeds"]))
    if "FactionSetupId" in o:
        out["factionId"] = _read_fname(pm, ts_addr + o["FactionSetupId"], alloc)
    # array sizes are useful structural diagnostics
    for arr_name, key in [
        ("PlayerStates", "playerCount"),
        ("IndexedSquadStates", "squadCount"),
        ("VehicleAvailabilities", "vehicleSlotCount"),
        ("DeployableAvailabilities", "deployableSlotCount"),
        ("RoleAvailabilities", "roleSlotCount"),
    ]:
        if arr_name in o:
            hdr = read_tarray_header(pm, ts_addr + o[arr_name])
            out[key] = hdr.count if hdr else None
    return out


def read_team_states(pm: ProcessMemory, alloc: FNameEntryAllocator,
                     paths: SnapshotPaths, gs_addr: int) -> list[dict[str, Any]]:
    """Walk SQGameState.TeamStates TArray<SQTeamState*> and read each."""
    if paths.gs_team_states_off is None:
        return []
    out: list[dict[str, Any]] = []
    for ts_addr in iter_tarray_pointers(pm, gs_addr + paths.gs_team_states_off):
        if ts_addr == 0:
            continue
        out.append(read_team_state(pm, alloc, paths, ts_addr))
    return out


def read_projectile(pm: ProcessMemory, alloc: FNameEntryAllocator,
                    paths: SnapshotPaths, p_addr: int,
                    class_name: str | None) -> dict[str, Any]:
    """Read one in-flight SQProjectile (mortar / guided / smoke)."""
    out: dict[str, Any] = {
        "id":         f"{p_addr:#x}",
        "classShort": class_name,
    }
    out["hasImpacted"] = bool(_safe(lambda: pm.read_u8(
        p_addr + PROJECTILE_OFFSETS["bHasImpacted"])) or 0)
    out["isTracer"] = bool(_safe(lambda: pm.read_u8(
        p_addr + PROJECTILE_OFFSETS["bIsTracer"])) or 0)
    out["isExplosive"] = bool(_safe(lambda: pm.read_u8(
        p_addr + PROJECTILE_OFFSETS["bIsExplosiveProjectile"])) or 0)
    for fk, ok in (("explosiveBaseDamage", "ExplosiveBaseDamage"),
                   ("explosiveKillZoneRadius", "ExplosiveKillZoneRadius")):
        b = pm.try_read(p_addr + PROJECTILE_OFFSETS[ok], 4)
        if b and len(b) == 4:
            v = struct.unpack("<f", b)[0]
            out[fk] = v if -1e9 <= v <= 1e9 else None
        else:
            out[fk] = None
    # Firer — who launched this round. Instigator controller → PlayerState →
    # name. Every step is null-guarded: a wrong instigator offset (Squad patch)
    # or a projectile with no instigator (world-spawned) leaves firer null, no
    # guess. Reuses the reflection-derived PC.PlayerState offset.
    out["firer"] = None
    if paths.pc_playerstate_off is not None and "PlayerNamePrivate" in paths.ps_offsets:
        ctrl = _safe(lambda: pm.read_u64(
            p_addr + PROJECTILE_INSTIGATOR_CONTROLLER_OFFSET))
        if ctrl:
            ps = _safe(lambda: pm.read_u64(ctrl + paths.pc_playerstate_off))
            if ps:
                out["firer"] = read_fstring(
                    pm, ps + paths.ps_offsets["PlayerNamePrivate"]) or None

    # World position via the projectile's RootComponent → ComponentToWorld
    root = _safe(lambda: pm.read_u64(p_addr + paths.actor_root_component_off))
    if root:
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}
    return out


# Seconds between the UE FDateTime epoch (1/1/0001 UTC) and the Unix epoch.
_UE_EPOCH_OFFSET_SEC = 62135596800
_FDATETIME_TICKS_PER_SEC = 10_000_000  # 100 ns ticks


def _fdatetime_seconds_until(ticks: int | None) -> int | None:
    """Seconds from now until an FDateTime tick stamp, or None if implausible.

    Positive = still on cooldown, negative/zero = ready. Gated to ±1 day: a
    freed/garbage stamp reads as a wild value and must not surface as a bogus
    countdown.
    """
    if not ticks or ticks <= 0:
        return None
    try:
        locked_unix = ticks / _FDATETIME_TICKS_PER_SEC - _UE_EPOCH_OFFSET_SEC
        now_unix = datetime.now(timezone.utc).timestamp()
        diff = locked_unix - now_unix
    except (ValueError, OverflowError, OSError):
        return None
    if -86400 < diff < 86400:
        return int(round(diff))
    return None


def read_vehicle_spawner(pm: ProcessMemory, alloc: FNameEntryAllocator,
                         paths: SnapshotPaths, sp_addr: int,
                         class_name: str | None) -> dict[str, Any]:
    """Read one SQVehicleSpawner-derived actor."""
    out: dict[str, Any] = {
        "id":         f"{sp_addr:#x}",
        "classShort": class_name,
        "actorName":  _uobject_name(pm, sp_addr, alloc),
    }
    out["team"] = _safe(lambda: pm.read_u8(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["Team"]))
    out["spawnInProgress"] = bool(_safe(lambda: pm.read_u8(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["SpawnInProgress"])) or 0)
    out["spawnOverlapped"] = bool(_safe(lambda: pm.read_u8(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["SpawnOverlapped"])) or 0)
    out["spawnerEnabled"] = bool(_safe(lambda: pm.read_u8(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["SpawnerEnabled"])) or 0)
    # SpawnerLockedUntil is an FDateTime — 8 bytes of 100 ns ticks since
    # 1/1/0001 UTC, i.e. a wall-clock timestamp (NOT world-time seconds; that
    # earlier guess was wrong). Keep the raw value for diagnostics and derive
    # `nextSpawnSec` = seconds until the pad unlocks, decoded against the
    # current wall clock so the frontend doesn't need UE's epoch. Sanity-gated
    # to ±1 day; anything outside that is a stale/garbage stamp → null.
    locked_raw = _safe(lambda: pm.read_u64(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["SpawnerLockedUntil"]))
    out["lockedUntilRaw"] = locked_raw
    out["nextSpawnSec"] = _fdatetime_seconds_until(locked_raw)
    # Cached vehicle class — read its UObject name to identify what
    # this pad spawns (e.g. 'BP_LAV25_C' / 'BP_UH60_C' / ...).
    cached = _safe(lambda: pm.read_u64(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["CachedSpecificVehicle"]))
    if cached:
        out["vehicleClass"] = _uobject_name(pm, cached, alloc)
        out["vehicleClassAddr"] = f"{cached:#x}"
    ta = _safe(lambda: pm.read_u64(
        sp_addr + VEHICLE_SPAWNER_OFFSETS["TeamAuthority"]))
    out["teamAuthorityAddr"] = f"{ta:#x}" if ta else None
    # Position via RootComponent → ComponentToWorld
    root = _safe(lambda: pm.read_u64(
        sp_addr + paths.actor_root_component_off))
    if root:
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}
    return out


def read_rally_point(pm: ProcessMemory, alloc: FNameEntryAllocator,
                     paths: SnapshotPaths, rp_addr: int,
                     class_name: str | None) -> dict[str, Any]:
    """Read one SQSquadRallyPoint actor — emits team, owning-squad addr,
    spawns-remaining, enabled/sieged flags, and world position. Frontend
    joins squadStateAddr against snapshot.squads[] to label with squad #.
    """
    out: dict[str, Any] = {
        "id":         f"{rp_addr:#x}",
        "classShort": class_name,
        "actorName":  _uobject_name(pm, rp_addr, alloc),
    }
    out["team"] = _safe(lambda: pm.read_u8(
        rp_addr + RALLY_OFFSETS["Team"]))
    out["spawningEnabled"] = bool(_safe(lambda: pm.read_u8(
        rp_addr + RALLY_OFFSETS["bSpawningEnabled"])) or 0)
    out["sieged"] = bool(_safe(lambda: pm.read_u8(
        rp_addr + RALLY_OFFSETS["bSieged"])) or 0)
    out["spawnsRemaining"] = _safe(lambda: pm.read_i32(
        rp_addr + RALLY_OFFSETS["NumberOfSpawns"]))
    auth = _safe(lambda: pm.read_u64(
        rp_addr + RALLY_OFFSETS["AuthoritySquad"]))
    sqs = _safe(lambda: pm.read_u64(
        rp_addr + RALLY_OFFSETS["SquadState"]))
    # Prefer SquadState (the replicated copy); fall back to AuthoritySquad
    # (authority-side pointer; matches on listen-host but may be null on
    # dedicated clients).
    pick = sqs or auth
    out["squadStateAddr"] = f"{pick:#x}" if pick else None
    # World position via the actor's RootComponent → ComponentToWorld.
    root = _safe(lambda: pm.read_u64(
        rp_addr + paths.actor_root_component_off))
    if root:
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}

    # Freshness gate — same shape as the deployable filter. A freed slot
    # often reads back with a junk team byte (>4) or no position.
    _team = out.get("team")
    if (_team is not None and not (0 <= _team <= 4)) or out.get("position") is None:
        out["stale"] = True
    return out


# Names the Instigator chain sometimes lands on when a deployable has no real
# placer link (e.g. TOW/Kornet emplacements whose Instigator points at an EOS
# subsystem object). Rejected so we never surface these as a "placer".
_INVALID_PLACER_NAMES = frozenset({
    "productuserid", "epicaccountid", "none", "null", "?",
})


def _valid_placer_name(nm: str | None) -> bool:
    s = (nm or "").strip()
    return bool(1 <= len(s) <= 40 and s.lower() not in _INVALID_PLACER_NAMES)


def _read_placer_ps(pm: ProcessMemory, paths: SnapshotPaths,
                    d_addr: int) -> tuple[int, str] | None:
    """Resolve a deployable's placer to (playerstate_addr, name), or None.

    Tries three slots, most-durable first: the direct SQPlayerState* (+0x0518),
    then AActor.Instigator (pawn) -> PlayerState, then the placer controller
    (+0x0510) -> PlayerState. Every step is null-guarded — a wrong offset or a
    stale/despawned placer just yields None (no guess). The caller caches the
    first live hit because these links null out once the placer despawns.
    """
    name_off = paths.ps_offsets.get("PlayerNamePrivate")
    if name_off is None:
        return None

    def try_ps(ps: int | None) -> tuple[int, str] | None:
        if not ps or ps < 0x10000 or ps > 0x7FFF_FFFF_FFFF:
            return None
        nm = _safe(lambda: read_fstring(pm, ps + name_off))
        return (ps, nm.strip()) if (nm and _valid_placer_name(nm)) else None

    r = try_ps(_safe(lambda: pm.read_u64(d_addr + paths.deployable_placer_ps_off)))
    if r:
        return r
    if paths.actor_instigator_off is not None and paths.pawn_playerstate_off is not None:
        pawn = _safe(lambda: pm.read_u64(d_addr + paths.actor_instigator_off))
        if pawn:
            r = try_ps(_safe(lambda: pm.read_u64(pawn + paths.pawn_playerstate_off)))
            if r:
                return r
    if paths.pc_playerstate_off is not None:
        ctrl = _safe(lambda: pm.read_u64(d_addr + paths.deployable_placer_ctrl_off))
        if ctrl:
            r = try_ps(_safe(lambda: pm.read_u64(ctrl + paths.pc_playerstate_off)))
            if r:
                return r
    return None


def read_deployable(pm: ProcessMemory, alloc: FNameEntryAllocator,
                    paths: SnapshotPaths, d_addr: int,
                    class_name: str | None) -> dict[str, Any]:
    """Read one SQDeployable-derived actor (FOB radio, HAB, ammo crate, …).

    Offsets come from reflection (paths.deployable_offsets /
    paths.fob_resource_offsets), falling back to the module-level
    constants for any field reflection didn't resolve. This is what
    fixes radios/HABs/mines silently vanishing: the hardcoded health
    block drifted +0x18 on a Squad update, so MaxHealth read garbage,
    and the old freshness gate — which dropped deployables whose
    maxHealth read <= 0 — culled real ones at random.
    """
    do = paths.deployable_offsets
    fo = paths.fob_resource_offsets

    def d_off(name: str) -> int:
        # reflection first, hardcoded fallback
        return do.get(name, DEPLOYABLE_OFFSETS[name])

    def f_off(name: str) -> int:
        return fo.get(name, FOB_RESOURCE_OFFSETS[name])

    out: dict[str, Any] = {
        "id":         f"{d_addr:#x}",
        "classShort": class_name,
    }
    out["team"] = _safe(lambda: pm.read_i32(d_addr + d_off("Team")))
    out["initialTeam"] = _safe(lambda: pm.read_u8(d_addr + d_off("InitialTeam")))
    out["isFob"] = bool(_safe(lambda: pm.read_u8(d_addr + d_off("bIsFob"))) or 0)
    out["isPlaced"] = bool(_safe(lambda: pm.read_u8(d_addr + d_off("bPlaced"))) or 0)
    out["buildState"] = _safe(lambda: pm.read_u8(d_addr + d_off("BuildState")))
    out["cost"] = _safe(lambda: pm.read_i32(d_addr + d_off("Cost")))
    for fk, ok in (("health", "Health"),
                   ("maxHealth", "MaxHealth"),
                   ("initialHealth", "InitialHealth")):
        b = pm.try_read(d_addr + d_off(ok), 4)
        if b and len(b) == 4:
            v = struct.unpack("<f", b)[0]
            out[fk] = v if -1000 <= v <= 1_000_000 else None
        else:
            out[fk] = None
    fob = _safe(lambda: pm.read_u64(d_addr + d_off("OwningFob")))
    out["owningFobAddr"] = f"{fob:#x}" if fob else None
    # Take uobject name too: spawned ones are e.g. "Team1PreplacedRadio"
    out["actorName"] = _uobject_name(pm, d_addr, alloc)

    # Placer — the player who placed this deployable. Fresh read only; the
    # sticky cache + eos resolution happen in build_snapshot (it holds the
    # per-run caches). `_placerPs` is stripped there before the snapshot ships.
    out["placer"] = None
    out["_placerPs"] = None
    pr = _read_placer_ps(pm, paths, d_addr)
    if pr:
        out["_placerPs"] = pr[0]
        out["placer"] = pr[1]

    # FOB resource pool — current/max ammo + construction. Only read on
    # actual FOB radios (bIsFob true); the same offsets on a non-FOB
    # deployable land in junk memory. The fields live on
    # BP_BaseFobCreator_C, which the FOB radio actor inherits in
    # addition to SQDeployable, so a single read on this same actor
    # address works.
    if out.get("isFob"):
        def _f(name: str) -> float | None:
            b = pm.try_read(d_addr + f_off(name), 4)
            if not b or len(b) != 4:
                return None
            v = struct.unpack("<f", b)[0]
            return v if -1.0 <= v <= 1e7 else None

        out["ammo"]            = _f("Ammo")
        out["maxAmmo"]         = _f("MaxAmmo")
        out["construction"]    = _f("ConstructionPoints")
        out["maxConstruction"] = _f("MaxConstructionPoints")
        out["ammoPerSecond"]   = _f("AmmoPerSecond")
        out["cpPerSecond"]     = _f("CPPerSecond")
        out["nearbyEnemies"]   = _safe(lambda: pm.read_i32(
            d_addr + f_off("NearbyEnemies")))
        out["fobSieged"]       = bool(_safe(lambda: pm.read_u8(
            d_addr + f_off("bSieged"))) or 0)
        out["fobSpawningEnabled"] = bool(_safe(lambda: pm.read_u8(
            d_addr + f_off("bIsSpawningEnabled"))) or 0)
        out["fobBleeding"]     = bool(_safe(lambda: pm.read_u8(
            d_addr + f_off("bIsBleeding"))) or 0)
        out["fobOverrun"]      = bool(_safe(lambda: pm.read_u8(
            d_addr + f_off("bHasBeenOverrun"))) or 0)
        # World-clock time this FOB is projected to die (bleed-out). Pair with
        # gameState.worldTimeSec on the client: (estimatedDeathTime - worldTime)
        # is the countdown. Only meaningful while bleeding; the raw float is
        # a stale sentinel otherwise, so the UI gates on fobBleeding. 0/negative
        # or absurd values → null (no-guess).
        _edt = _f("EstimatedWorldTimeOfDeath")
        out["estimatedDeathTime"] = (_edt if _edt is not None and _edt > 0
                                     else None)

    # World position via the actor's RootComponent → ComponentToWorld.
    # Read BEFORE the freshness gate because a valid world position is
    # the most reliable "this is a real, placed actor" signal.
    root = _safe(lambda: pm.read_u64(d_addr + paths.actor_root_component_off))
    if root:
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}
        yaw = _world_yaw(pm, root, paths)
        if yaw is not None:
            out["yaw"] = yaw

    # Freshness gate. A freed slot reused by another object reads back
    # with a junk team, an unrelated actorName (SQOnlineServicesOnlineUser
    # / SquadVoiceChannel from the reused address), or no valid world
    # position. We DELIBERATELY no longer gate on maxHealth: that read
    # was unreliable (hardcoded offset drift) AND a legit not-yet-built
    # deployable can momentarily read 0, so it produced random culls —
    # the actual "only some HABs/radios show" bug. Position + team +
    # actorName are the robust signals; the caller drops stale=True rows.
    _team = out.get("team")
    _actor = out.get("actorName") or ""
    _pos = out.get("position")
    pos_sane = (_pos is not None
                and abs(_pos["x"]) < 5_000_000
                and abs(_pos["y"]) < 5_000_000)
    is_junk = (
        not pos_sane
        or (_team is not None and not (0 <= _team <= 4))
        or _actor.startswith(("SQOnlineServices", "SquadVoiceChannel"))
    )
    if is_junk:
        out["stale"] = True
    return out


def read_marker(pm: ProcessMemory, alloc: FNameEntryAllocator,
                paths: SnapshotPaths, m_addr: int,
                class_name: str | None) -> dict[str, Any]:
    """Read one SQMapMarker (or BP subclass) actor."""
    out: dict[str, Any] = {
        "id": f"{m_addr:#x}",
        "type": class_name,                       # e.g. BP_AAS_AttackMarker_C
    }
    out["team"] = _safe(lambda: pm.read_u8(m_addr + MARKER_OFFSETS["Team"]))
    out["squad"] = _safe(lambda: pm.read_i32(m_addr + MARKER_OFFSETS["Squad"]))
    out["fireTeamId"] = _safe(lambda: pm.read_i32(
        m_addr + MARKER_OFFSETS["FireTeamId"]))
    owner = _safe(lambda: pm.read_u64(
        m_addr + MARKER_OFFSETS["OwnerPlayerState"]))
    out["ownerPlayerStateAddr"] = f"{owner:#x}" if owner else None
    # World position via the same RootComponent → ComponentToWorld chain
    # we use elsewhere.
    root = _safe(lambda: pm.read_u64(m_addr + paths.actor_root_component_off))
    if root:
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}
    return out


# NOTE: `read_squad_data_marker` was removed. It referenced an undefined
# `SQUAD_DATA_MARKER_OFFSETS` constant — a NameError timebomb. Its job
# (reading v10 SQSquadStateDataMapMarker player-placed markers) is now
# done by the marker-manager scan path. If we ever need this back, also
# define the offsets dict via dump_struct_layout SQSquadStateDataMapMarker.


def read_capture_zone(pm: ProcessMemory, alloc: FNameEntryAllocator,
                      paths: SnapshotPaths, cz_addr: int,
                      uobject_name: str | None) -> dict[str, Any]:
    """Read one BP_CaptureZone_C actor + its attached SQCaptureZoneComponent."""
    ao = paths.capzone_actor_offsets
    co = paths.capzone_comp_offsets
    out: dict[str, Any] = {
        "id": f"{cz_addr:#x}",
        "name": uobject_name,    # e.g. "01-Warehouse"
    }
    # World position via the actor's RootComponent → ComponentToWorld
    root = _safe(lambda: pm.read_u64(cz_addr + paths.actor_root_component_off))
    if root:
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}

    # Follow the actor's SQCaptureZone pointer into its component
    comp = _safe(lambda: pm.read_u64(cz_addr + ao["SQCaptureZone"])) if "SQCaptureZone" in ao else 0
    if not comp:
        out["component"] = None
        return out

    if "FlagName" in co:
        out["flagName"] = read_ftext(pm, comp + co["FlagName"])
    if "OwningTeam" in co:
        out["owningTeam"] = _safe(lambda: pm.read_u8(comp + co["OwningTeam"]))
    if "CapturingTeam" in co:
        out["capturingTeam"] = _safe(lambda: pm.read_u8(comp + co["CapturingTeam"]))
    if "LastOwningTeam" in co:
        out["lastOwningTeam"] = _safe(lambda: pm.read_u8(comp + co["LastOwningTeam"]))
    if "InitialTeam" in co:
        out["initialTeam"] = _safe(lambda: pm.read_u8(comp + co["InitialTeam"]))
    if "CapturePercent" in co:
        b = pm.try_read(comp + co["CapturePercent"], 4)
        out["capturePercent"] = (struct.unpack("<f", b)[0]
                                 if b and len(b) == 4 else None)
    if "CapturePercentDelta" in co:
        b = pm.try_read(comp + co["CapturePercentDelta"], 4)
        out["captureRate"] = (struct.unpack("<f", b)[0]
                              if b and len(b) == 4 else None)
    if "CapturePercentDirection" in co:
        out["captureDirection"] = _safe(lambda: pm.read_i32(
            comp + co["CapturePercentDirection"]))
    if "bIsLocked" in co:
        # bool — `& 1` is OK because bIsLocked is its own byte (verified
        # by the reflected own_props ordering; it's at +0x1cc, alone).
        b = _safe(lambda: pm.read_u8(comp + co["bIsLocked"]))
        out["isLocked"] = bool(b) and bool(b & 1)
    if "TeamCapturabilities" in co:
        out["teamCapturabilities"] = _safe(lambda: pm.read_u32(
            comp + co["TeamCapturabilities"]))
    if "TeamKnowledge" in co:
        out["teamKnowledge"] = _safe(lambda: pm.read_u32(
            comp + co["TeamKnowledge"]))
    if "PlayerAdvantage" in co:
        b = pm.try_read(comp + co["PlayerAdvantage"], 4)
        if b and len(b) == 4:
            v = struct.unpack("<f", b)[0]
            out["playerAdvantage"] = v if -1e6 <= v <= 1e6 else None
    return out


def read_capture_zones(pm: ProcessMemory, alloc: FNameEntryAllocator,
                       paths: SnapshotPaths,
                       arr: GUObjectArray) -> list[dict[str, Any]]:
    """Enumerate every non-CDO BP_CaptureZone_C in GUObjectArray."""
    if not paths.bp_capture_zone_class:
        return []
    target = paths.bp_capture_zone_class
    out: list[dict[str, Any]] = []
    for _idx, obj_addr in arr.iter_object_addrs():
        if obj_addr == 0:
            continue
        cp = pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
        if cp is None:
            continue
        if struct.unpack("<Q", cp)[0] != target:
            continue
        nm = _uobject_name(pm, obj_addr, alloc) or ""
        if nm.startswith("Default__"):
            continue
        out.append(read_capture_zone(pm, alloc, paths, obj_addr, nm))
    # Sort by name so "01-..." through "05-..." come out in order
    out.sort(key=lambda c: c.get("name") or "")
    return out


def read_squad_state(pm: ProcessMemory, alloc: FNameEntryAllocator,
                     paths: SnapshotPaths, sqs_addr: int) -> dict[str, Any]:
    """Read a single SQSquadState (one squad)."""
    o = paths.squad_offsets
    out: dict[str, Any] = {"_addr": f"{sqs_addr:#x}"}

    if "ID" in o:
        out["id"] = _safe(lambda: pm.read_i32(sqs_addr + o["ID"]))
    if "TeamId" in o:
        out["teamId"] = _safe(lambda: pm.read_i32(sqs_addr + o["TeamId"]))
    if "MaxSize" in o:
        out["maxSize"] = _safe(lambda: pm.read_i32(sqs_addr + o["MaxSize"]))
    if "Name" in o:
        out["name"] = read_ftext(pm, sqs_addr + o["Name"])
    if "NumKills" in o:
        out["kills"] = _safe(lambda: pm.read_i32(sqs_addr + o["NumKills"]))
    if "NumDeaths" in o:
        out["deaths"] = _safe(lambda: pm.read_i32(sqs_addr + o["NumDeaths"]))
    if "NumWoundeds" in o:
        out["woundeds"] = _safe(lambda: pm.read_i32(sqs_addr + o["NumWoundeds"]))
    for fk, ok in [("score", "Score"),
                   ("teamWorkScore", "TeamWorkScore"),
                   ("objectiveScore", "ObjectiveScore"),
                   ("combatScore", "CombatScore"),
                   ("revivedPoints", "RevivedPoints"),
                   ("creationTime", "CreationTimeStamp")]:
        if ok in o:
            b = pm.try_read(sqs_addr + o[ok], 4)
            out[fk] = (struct.unpack("<f", b)[0]
                       if b and len(b) == 4 else None)
    if "PlayerStates" in o:
        hdr = read_tarray_header(pm, sqs_addr + o["PlayerStates"])
        out["playerCount"] = hdr.count if hdr else None
    if "LeaderState" in o:
        lp = _safe(lambda: pm.read_u64(sqs_addr + o["LeaderState"]))
        out["leaderStateAddr"] = f"{lp:#x}" if lp else None
    if "SquadCreatorName" in o:
        out["creatorName"] = read_fstring(pm, sqs_addr + o["SquadCreatorName"])
    if "SquadCreatorSteamID" in o:
        out["creatorOnlineId"] = read_fstring(
            pm, sqs_addr + o["SquadCreatorSteamID"])
    return out


def read_squad_states(pm: ProcessMemory, alloc: FNameEntryAllocator,
                      paths: SnapshotPaths,
                      arr: GUObjectArray) -> list[dict[str, Any]]:
    """
    Find every non-CDO SQSquadState instance in GUObjectArray and read
    it. This is more robust than walking SQTeamState's TArray fields,
    which can be TWeakObjectPtr-shaped (8-byte index+serial pairs that
    look like garbage when read as UObject*).
    """
    sq_class = paths.sq_squad_state_class
    out: list[dict[str, Any]] = []
    for _idx, obj_addr in arr.iter_object_addrs():
        if obj_addr == 0:
            continue
        cp = pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
        if cp is None:
            continue
        if struct.unpack("<Q", cp)[0] != sq_class:
            continue
        nm = _uobject_name(pm, obj_addr, alloc) or ""
        if nm.startswith("Default__"):
            continue
        out.append(read_squad_state(pm, alloc, paths, obj_addr))
    return out


def _veh_arr_off(paths: "SnapshotPaths | None", name: str, const: int) -> int:
    """Reflection offset for a SQVehicle TArray field, module-constant
    fallback. Keeps vehicle reads correct across the same kind of Squad
    struct drift that broke deployables (VehicleTurrets moved +0x8)."""
    if paths is not None:
        return paths.vehicle_array_offsets.get(name, const)
    return const


def read_vehicle_seats(pm: ProcessMemory, alloc: FNameEntryAllocator,
                       paths: SnapshotPaths, vh_addr: int
                       ) -> list[dict[str, Any]]:
    """
    Walk SQVehicle.VehicleSeats (TArray<SQVehicleSeatComponent*>) and
    emit one entry per seat slot — populated when occupied, stub with
    just `idx` when empty. Seat order is fixed by the vehicle's BP
    config (Driver=0, Gunner=1, then turret/passenger slots) so
    consumers can map idx → role label without parsing SeatConfig.

    Per-seat fields: idx, addr, occupantName, occupantEosId,
    occupantPlayerId, occupantTeamId, seatHealth, seatComponentClass.
    """
    hdr = read_tarray_header(pm, vh_addr + _veh_arr_off(
        paths, "VehicleSeats", SQ_VEHICLE_SEATS_OFFSET))
    if hdr is None or hdr.count <= 0 or hdr.count > 32 or not hdr.data_ptr:
        return []
    seats: list[dict[str, Any]] = []
    pso = paths.ps_offsets
    for i in range(hdr.count):
        comp_addr = _safe(lambda i=i: pm.read_u64(hdr.data_ptr + i * 8))
        if not comp_addr:
            seats.append({"idx": i, "occupantName": None})
            continue
        seat: dict[str, Any] = {
            "idx": i,
            "addr": f"{comp_addr:#x}",
            "seatComponentClass": _uobject_class_name(pm, comp_addr, alloc),
        }
        # Seat pawn (SQVehicleSeat) — gives the per-seat health.
        seat_pawn_addr = _safe(lambda: pm.read_u64(
            comp_addr + SQ_SEATCOMP_SEAT_PAWN_OFFSET))
        if seat_pawn_addr:
            hb = pm.try_read(
                seat_pawn_addr + SQ_VEHICLESEAT_SEAT_HEALTH_OFFSET, 4)
            if hb and len(hb) == 4:
                sh = struct.unpack("<f", hb)[0]
                seat["seatHealth"] = sh if -1000 <= sh <= 100_000 else None
        # SeatedPlayer is the APlayerState* of whoever's in the seat —
        # null when the seat is empty. PlayerState reads use the
        # standard SQPlayerState field offsets (same as snap.players).
        ps_addr = _safe(lambda: pm.read_u64(
            comp_addr + SQ_SEATCOMP_SEATED_PLAYER_OFFSET))
        if ps_addr:
            seat["playerStateAddr"] = f"{ps_addr:#x}"
            if "PlayerNamePrivate" in pso:
                seat["occupantName"] = read_fstring(
                    pm, ps_addr + pso["PlayerNamePrivate"])
            if "OnlineUserId" in pso:
                seat["occupantEosId"] = read_fstring(
                    pm, ps_addr + pso["OnlineUserId"])
            if "PlayerId" in pso:
                seat["occupantPlayerId"] = _safe(lambda: pm.read_i32(
                    ps_addr + pso["PlayerId"]))
            if "TeamId" in pso:
                seat["occupantTeamId"] = _safe(lambda: pm.read_i32(
                    ps_addr + pso["TeamId"]))
        else:
            seat["occupantName"] = None
        seats.append(seat)
    return seats


def _resolve_weak_obj(pm: ProcessMemory, arr: GUObjectArray, addr: int) -> int:
    """
    Read a TWeakObjectPtr at `addr` and resolve it to a UObject* via
    GUObjectArray. Returns 0 if invalid (object GC'd, serial mismatch,
    index out of range, or read failure).

    UE4/5 layout: int32 ObjectIndex + int32 SerialNumber. We enforce the
    serial check: a recycled GUObjectArray slot bumps its SerialNumber, so
    a stale weak ptr whose index now points at a since-freed (and possibly
    reused) object is rejected instead of resolving to a ghost. This guards
    the killfeed causer/instigator and held-weapon reads.
    """
    wp = read_fweak_object_ptr(pm, addr)
    if wp is None or wp.object_index <= 0:
        return 0
    try:
        if wp.object_index >= arr.num_elements:
            return 0
        obj = arr.get_object_addr(wp.object_index) or 0
        if not obj:
            return 0
        live_serial = arr.get_serial_number(wp.object_index)
        if wp.serial_number and live_serial != wp.serial_number:
            return 0
        return obj
    except (OSError, OverflowError, ValueError):
        return 0


def peek_take_hit_ts(pm: ProcessMemory, soldier_addr: int) -> float | None:
    """
    Cheap 4-byte read of just the FSQTakeHitInfo.ServerTimestamp field.
    Caller uses this to decide whether to invoke the full struct read
    (~50 bytes + 2 GUObjectArray lookups) — skipping the heavy work
    when ts hasn't moved is a ~2x CPU win on a populated server.
    """
    tb = pm.try_read(
        soldier_addr + SQ_SOLDIER_TAKE_HIT_INFO_OFFSET
            + THI_SERVER_TIMESTAMP_OFFSET, 4)
    if tb is None or len(tb) < 4:
        return None
    ts = struct.unpack("<f", tb)[0]
    # ServerTimestamp is Squad's world-time elapsed seconds since match
    # start; legitimate matches always run >1s. Junk reads from freed
    # soldier slots routinely give subnormals (4e-41) or other garbage —
    # the `1.0 < ts < 1e9` range rejects those without losing real hits.
    return ts if (1.0 < ts < 1e9) else None


def read_take_hit_info(pm: ProcessMemory, alloc: FNameEntryAllocator,
                       arr: GUObjectArray, soldier_addr: int
                       ) -> dict[str, Any] | None:
    """
    Read SQSoldier.LastTakeHitInfo (FSQTakeHitInfo struct) and return a
    dict with the enriched fields the killfeed needs. Returns None if
    the struct base couldn't be read OR the timestamp is zero (soldier
    has never taken damage this life).

    Caller compares the `ts` field tick-to-tick to detect a fresh event
    (LastTakeHitInfo persists until the soldier respawns; we don't want
    to re-emit the same event every tick).
    """
    ts = peek_take_hit_ts(pm, soldier_addr)
    if ts is None:
        return None
    base = soldier_addr + SQ_SOLDIER_TAKE_HIT_INFO_OFFSET

    out: dict[str, Any] = {"ts": ts}

    db = pm.try_read(base + THI_ACTUAL_DAMAGE_OFFSET, 4)
    if db and len(db) == 4:
        d = struct.unpack("<f", db)[0]
        out["damage"] = d if -1e6 < d < 1e6 else None

    # DamageType — UClass*; the FName we want is the class own name
    # ('USQDamageType_Fall', 'BP_SmallArms_DamageType_C', etc.)
    dt_class = _safe(lambda: pm.read_u64(
        base + THI_DAMAGE_TYPE_CLASS_OFFSET))
    if dt_class:
        out["damageType"] = _uobject_name(pm, dt_class, alloc)

    # DamageCauser — the actor that delivered the damage. For bullets
    # this is the SQProjectile; for vehicle weapons the SQVehicleWeapon;
    # for collisions the SQVehicle itself. Class name is the catalog
    # key the frontend resolves to a friendly weapon label.
    causer_addr = _resolve_weak_obj(
        pm, arr, base + THI_DAMAGE_CAUSER_OFFSET)
    if causer_addr:
        cls = _uobject_class_name(pm, causer_addr, alloc)
        out["causerClass"] = cls
        out["causerWeapon"] = cls  # mirror — kept for killfeed tier-1

    # PawnInstigator — attacker's pawn addr; useful when LastHitBy
    # controller lookup fails (fast soldier death before controller
    # could replicate to victim's view).
    pawn_addr = _resolve_weak_obj(
        pm, arr, base + THI_PAWN_INSTIGATOR_OFFSET)
    if pawn_addr:
        out["pawnInstigatorAddr"] = f"{pawn_addr:#x}"

    # bKilled + bWounded bitfield (single byte, bits 0/1/2)
    fb = pm.try_read(base + THI_FLAGS_OFFSET, 1)
    if fb and len(fb) == 1:
        flags = fb[0]
        out["killed"] = bool(flags & 0x01)
        out["wounded"] = bool(flags & 0x02)
        out["ejectedFromVehicle"] = bool(flags & 0x04)

    # HitResult.Distance + BoneName from the embedded PointDamageEvent.
    # Only point-damage events (bullets, grenades, melee) populate this;
    # radial / fall / drown / collision damage leaves Distance=0 and
    # BoneName='None', which we filter out below.
    hit_base = base + THI_POINT_DAMAGE_EVENT_OFFSET + PDE_HIT_INFO_OFFSET
    dist_b = pm.try_read(hit_base + HR_DISTANCE_OFFSET, 4)
    if dist_b and len(dist_b) == 4:
        dist_cm = struct.unpack("<f", dist_b)[0]
        # Squad units are cm; killfeed wants meters. 1m..10km sanity.
        if 100 <= dist_cm < 1_000_000:
            out["hitDistance"] = dist_cm / 100.0
    bone = _read_fname(pm, hit_base + HR_BONE_NAME_OFFSET, alloc)
    if bone and bone.lower() not in ("none", ""):
        out["bone"] = bone
        out["headshot"] = bone.lower() == "head"

    return out


def read_vehicle_component(pm: ProcessMemory, alloc: FNameEntryAllocator,
                           comp_addr: int) -> dict[str, Any] | None:
    """
    Read one SQVehicleComponent-derived actor (wheel / track / ammo rack
    / turret base — anything that subclasses SQVehicleComponent gets the
    same Health/MaxHealth/State offsets).
    """
    if not comp_addr:
        return None
    cls = _uobject_class_name(pm, comp_addr, alloc) or ""
    name = _uobject_name(pm, comp_addr, alloc) or ""
    out: dict[str, Any] = {"name": name, "className": cls}
    b = pm.try_read(comp_addr + SQ_VEHCOMP_HEALTH_OFFSET, 4)
    if b and len(b) == 4:
        h = struct.unpack("<f", b)[0]
        out["health"] = h if -1000 <= h <= 100_000 else None
    b = pm.try_read(comp_addr + SQ_VEHCOMP_MAX_HEALTH_OFFSET, 4)
    if b and len(b) == 4:
        mh = struct.unpack("<f", b)[0]
        out["maxHealth"] = mh if 0 <= mh <= 100_000 else None
    out["state"] = _safe(lambda: pm.read_u8(comp_addr + SQ_VEHCOMP_STATE_OFFSET))
    return out


def read_vehicle_components(pm: ProcessMemory, alloc: FNameEntryAllocator,
                            vh_addr: int,
                            paths: SnapshotPaths | None = None,
                            ) -> list[dict[str, Any]]:
    """
    Walk SQVehicle.VehicleComponents (TArray<SQVehicleComponent*>) and
    return one descriptor per element. Filters out NULL entries from
    partially-spawned vehicles. Component names are the BP component
    names ('wheel_L1', 'TrackLeftComponent', 'TurretComponent', etc.).
    """
    hdr = read_tarray_header(pm, vh_addr + _veh_arr_off(
        paths, "VehicleComponents", SQ_VEHICLE_COMPONENTS_OFFSET))
    if hdr is None or hdr.count <= 0 or hdr.count > 64 or not hdr.data_ptr:
        return []
    out: list[dict[str, Any]] = []
    for i in range(hdr.count):
        comp_addr = _safe(lambda i=i: pm.read_u64(hdr.data_ptr + i * 8))
        if not comp_addr:
            continue
        rec = read_vehicle_component(pm, alloc, comp_addr)
        if rec:
            out.append(rec)
    return out


def read_vehicle_engine(pm: ProcessMemory, alloc: FNameEntryAllocator,
                        vh_addr: int,
                        paths: SnapshotPaths | None = None,
                        ) -> dict[str, Any] | None:
    """
    Read CachedVehicleEngine pointer + treat it as a SQVehicleComponent.
    Engine is just another component (inherits the same Health/MaxHealth)
    so the same offsets apply. Returns None when the vehicle has no
    cached engine (most boats and some helis).
    """
    eng_addr = _safe(lambda: pm.read_u64(
        vh_addr + _veh_arr_off(
            paths, "CachedVehicleEngine", SQ_VEHICLE_CACHED_ENGINE_OFFSET)))
    if not eng_addr:
        return None
    return read_vehicle_component(pm, alloc, eng_addr)


def read_vehicle_turrets(pm: ProcessMemory, alloc: FNameEntryAllocator,
                         vh_addr: int,
                         paths: SnapshotPaths | None = None,
                         caches: SnapshotCaches | None = None,
                         ) -> list[dict[str, Any]]:
    """
    Walk SQVehicle.VehicleTurrets (TArray<SQVehicleWeapon*>) and emit
    one record per turret weapon (current magazine count + spare mags
    + the weapon's class FName). Class name is the catalog key the
    frontend's VEHICLE_LOADOUTS table will resolve to a friendly name
    + caliber + icon.
    """
    hdr = read_tarray_header(pm, vh_addr + _veh_arr_off(
        paths, "VehicleTurrets", SQ_VEHICLE_TURRETS_OFFSET))
    if hdr is None or hdr.count <= 0 or hdr.count > 16 or not hdr.data_ptr:
        return []
    out: list[dict[str, Any]] = []
    for i in range(hdr.count):
        wep_addr = _safe(lambda i=i: pm.read_u64(hdr.data_ptr + i * 8))
        if not wep_addr:
            continue
        # Cache weapon class + instance names — turret weapons rarely
        # change addr (most stick for the vehicle's lifetime); ~95 %
        # hit rate, saves ~4 syscalls/turret/tick.
        if caches is not None:
            cls = caches.weapon_class_names.get(wep_addr)
            if cls is None and wep_addr not in caches.weapon_class_names:
                cls = _uobject_class_name(pm, wep_addr, alloc)
                # Only cache when the read actually produced a usable
                # name; caching None/""/"None" used to permanently
                # blank turret tooltips after one bad read (the cache
                # had no way to retry).
                if cls and cls != "None":
                    caches.weapon_class_names[wep_addr] = cls
                cls = cls or ""
            name = caches.weapon_uobj_names.get(wep_addr)
            if name is None and wep_addr not in caches.weapon_uobj_names:
                name = _uobject_name(pm, wep_addr, alloc)
                if name and name != "None":
                    caches.weapon_uobj_names[wep_addr] = name
                name = name or ""
        else:
            cls = _uobject_class_name(pm, wep_addr, alloc) or ""
            name = _uobject_name(pm, wep_addr, alloc) or ""
        rec: dict[str, Any] = {"name": name or "", "className": cls or ""}
        # Magazines TArray<int32> — element size 4, first is loaded.
        # Bulk read the whole array in one syscall + struct.unpack —
        # avoids ~20 per-element pm.read_i32 syscalls per turret.
        # (Phase 1.1 perf fix; 50 vehicles × 2 turrets × 20 mags was
        # ~2000 syscalls/tick, now ~100.)
        mag_hdr = read_tarray_header(
            pm, wep_addr + SQ_VWEAPON_MAGAZINES_OFFSET)
        if mag_hdr is not None and mag_hdr.count > 0 and mag_hdr.count <= 32 \
                and mag_hdr.data_ptr:
            raw = pm.try_read(mag_hdr.data_ptr, mag_hdr.count * 4)
            if raw is not None and len(raw) == mag_hdr.count * 4:
                rec["magazines"] = list(
                    struct.unpack(f"<{mag_hdr.count}i", raw))
        # Parent turret base actor — kept only for frontend seat correlation
        # (VEHICLE_LOADOUTS turretClass key). NOTE: this 0x0ec8 ObjectProperty
        # is populated ONLY on mortar / open-turret weapons and is null for the
        # main tank/IFV turret weapons, so it is NOT the yaw source (that was
        # the bug — turret rotation never rendered because yaw stayed null).
        vt_addr = _safe(lambda: pm.read_u64(
            wep_addr + SQ_VWEAPON_VEHICLE_TURRET_OFFSET))
        if vt_addr:
            # Turret base actor class name — also cached (same address
            # stability rationale as above).
            if caches is not None:
                tcn = caches.turret_class_names.get(vt_addr)
                if tcn is None and vt_addr not in caches.turret_class_names:
                    tcn = _uobject_class_name(pm, vt_addr, alloc)
                    # Only cache truthy non-"None" so a transient bad
                    # read doesn't blank turretBaseClass forever.
                    if tcn and tcn != "None":
                        caches.turret_class_names[vt_addr] = tcn
                rec["turretBaseClass"] = tcn
            else:
                rec["turretBaseClass"] = _uobject_class_name(pm, vt_addr, alloc)
        # Turret facing. The SQVehicleWeapon IS itself an Actor, and its
        # RootComponent.RelativeRotation.yaw is the turret's traverse angle
        # RELATIVE to the hull's attach socket (verified live: Warrior/Challenger
        # turrets read -30°/-38° while aligned turrets read 0°, cross-checked
        # against the component's world-space quaternion). The frontend adds the
        # hull yaw to recover the absolute screen facing. Read it off the weapon
        # actor's own root — the old 0x0ec8 turret-base path was null for real
        # turrets, which is why turret rotation never showed.
        if paths is not None:
            tr_root = _safe(lambda: pm.read_u64(
                wep_addr + paths.actor_root_component_off))
            if tr_root:
                r = read_frotator(
                    pm, tr_root + paths.scene_relative_rotation_off)
                if r is not None:
                    rec["yaw"] = r.yaw
        out.append(rec)
    return out


def read_vehicle(pm: ProcessMemory, alloc: FNameEntryAllocator,
                 paths: SnapshotPaths, vh_addr: int,
                 class_name: str | None,
                 caches: SnapshotCaches | None = None) -> dict[str, Any]:
    """Read a single SQVehicle-derived UObject."""
    o = paths.vehicle_offsets
    out: dict[str, Any] = {
        "id": f"{vh_addr:#x}",        # vehicle ID = hex of actor pointer
        "classShort": class_name,
    }
    if "Health" in o:
        b = pm.try_read(vh_addr + o["Health"], 4)
        if b and len(b) == 4:
            h = struct.unpack("<f", b)[0]
            out["health"] = h if -1000 <= h <= 100_000 else None
        else:
            out["health"] = None
    if "MaxHealth" in o:
        b = pm.try_read(vh_addr + o["MaxHealth"], 4)
        if b and len(b) == 4:
            mh = struct.unpack("<f", b)[0]
            out["maxHealth"] = mh if 0 <= mh <= 100_000 else None
        else:
            out["maxHealth"] = None
    # team (uint8 enum on SQPawn at +0x343)
    if paths.sq_pawn_team_off is not None:
        out["team"] = _safe(lambda: pm.read_u8(vh_addr + paths.sq_pawn_team_off))
    # position via RootComponent.ComponentToWorld.Translation (same
    # reasoning as soldier: cached world transform handles attached
    # actors correctly — e.g. a deployable mounted on a vehicle).
    root = _safe(lambda: pm.read_u64(vh_addr + paths.actor_root_component_off))
    if root:
        attach_parent = _safe(lambda: pm.read_u64(
            root + paths.scene_attach_parent_off))
        out["attached"] = bool(attach_parent)
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            out["position"] = {"x": v.x, "y": v.y, "z": v.z}
        yaw = _world_yaw(pm, root, paths)
        if yaw is not None:
            out["yaw"] = yaw
    # last damager (UObject* — chain to its name if non-null)
    if "LastDamageInstigator" in o:
        ld_addr = _safe(lambda: pm.read_u64(vh_addr + o["LastDamageInstigator"]))
        if ld_addr:
            out["lastDamager"] = {
                "addr": f"{ld_addr:#x}",
                "name": _uobject_name(pm, ld_addr, alloc),
                "class": _uobject_class_name(pm, ld_addr, alloc),
            }
    # Per-seat occupancy (Driver / Gunner / additional seats with
    # the player currently sitting in each). See read_vehicle_seats
    # for the field shapes.
    seats = read_vehicle_seats(pm, alloc, paths, vh_addr)
    if seats:
        out["seats"] = seats
    # Phase 2B subsystems — engine + per-component HP + turret weapons.
    # Each call is independently fault-tolerant (returns None / [] on
    # any read failure), so a bad pointer can't blow up the snapshot.
    eng = read_vehicle_engine(pm, alloc, vh_addr, paths)
    if eng:
        out["engine"] = eng
    comps = read_vehicle_components(pm, alloc, vh_addr, paths)
    if comps:
        out["components"] = comps
    turrets = read_vehicle_turrets(pm, alloc, vh_addr, paths, caches=caches)
    if turrets:
        out["turrets"] = turrets
    return out


def read_player(pm: ProcessMemory, alloc: FNameEntryAllocator,
                arr: GUObjectArray, paths: SnapshotPaths,
                ps_addr: int,
                caches: SnapshotCaches | None = None) -> dict[str, Any]:
    """Build the snapshot dict for one SQPlayerState UObject."""
    o = paths.ps_offsets
    out: dict[str, Any] = {
        "_addr": f"{ps_addr:#x}",
    }

    # Identity — player name + EOS id are immutable after the player
    # joins. Cache by player-state address; on a stable 100-player
    # server this is ~95 % hit and saves ~4 syscalls/player/tick =
    # ~400/tick = ~2-3 ms.
    if "PlayerNamePrivate" in o:
        if caches is not None:
            nm = caches.player_names.get(ps_addr)
            if nm is None and ps_addr not in caches.player_names:
                nm = read_fstring(pm, ps_addr + o["PlayerNamePrivate"])
                if nm:  # only cache successful reads
                    caches.player_names[ps_addr] = nm
            out["name"] = nm
        else:
            out["name"] = read_fstring(pm, ps_addr + o["PlayerNamePrivate"])
    if "OnlineUserId" in o:
        if caches is not None:
            eid = caches.player_eos_ids.get(ps_addr)
            if eid is None and ps_addr not in caches.player_eos_ids:
                eid = read_fstring(pm, ps_addr + o["OnlineUserId"])
                if eid:
                    caches.player_eos_ids[ps_addr] = eid
            out["eosId"] = eid
        else:
            out["eosId"] = read_fstring(pm, ps_addr + o["OnlineUserId"])
    if "PlayerId" in o:
        out["playerId"] = _safe(lambda: pm.read_i32(ps_addr + o["PlayerId"]))

    # Team / squad / role
    if "TeamId" in o:
        out["teamId"] = _safe(lambda: pm.read_i32(ps_addr + o["TeamId"]))
    if "CurrentRoleId" in o:
        out["roleId"] = _read_fname(pm, ps_addr + o["CurrentRoleId"], alloc)

    # Stats / network
    if "Score" in o:
        b = pm.try_read(ps_addr + o["Score"], 4)
        out["score"] = struct.unpack("<f", b)[0] if b and len(b) == 4 else None
    if "CompressedPing" in o:
        # UE stores ping compressed as milliseconds/4 (clamped to a uint8),
        # and APlayerState.GetPingInMilliseconds() — the value Squad's own
        # scoreboard shows — multiplies it back by 4. Emit ms, not the raw
        # byte. A raw 255 saturates at >=1020 ms.
        raw = _safe(lambda: pm.read_u8(ps_addr + o["CompressedPing"]))
        out["ping"] = raw * 4 if raw is not None else None
    if "bIsABot" in paths.ps_bool_masks:
        eff_off, mask = paths.ps_bool_masks["bIsABot"]
        byte = _safe(lambda: pm.read_u8(ps_addr + eff_off))
        out["isBot"] = (byte is not None) and bool(byte & mask)

    # SquadState / TeamState pointers — keep as addresses for now
    if "SquadState" in o:
        sp = _safe(lambda: pm.read_u64(ps_addr + o["SquadState"]))
        out["squadStateAddr"] = f"{sp:#x}" if sp else None
    if "TeamState" in o:
        tp = _safe(lambda: pm.read_u64(ps_addr + o["TeamState"]))
        out["teamStateAddr"] = f"{tp:#x}" if tp else None

    # ---- per-player stats from PlayerStateData (reflection-derived) ----
    if "PlayerStateData" in o and paths.psd_offsets:
        psd_base = ps_addr + o["PlayerStateData"]
        data = pm.try_read(psd_base, 128)
        if data and len(data) >= 0x30:
            psd = paths.psd_offsets
            # Sanity gates: every other numeric path in the snapshot clamps
            # to a plausible range so a freed/reused struct (e.g. the stale
            # PlayerStates that linger for a few ticks after a disconnect)
            # can't surface absurd counts/scores. Counters are non-negative
            # and never reach 1e6 in a round; scores stay well within ±1e6.
            def _i(name, lo=-1000, hi=1_000_000):
                if name in psd:
                    v = struct.unpack_from("<i", data, psd[name])[0]
                    return v if lo <= v <= hi else None
            def _f(name, lo=-1e6, hi=1e6):
                if name in psd:
                    v = struct.unpack_from("<f", data, psd[name])[0]
                    return v if (v == v and lo <= v <= hi) else None
            def _b(name):
                if name in psd:
                    return bool(data[psd[name]] & 1)
            # PlayerNamePrefix is an FString member of PlayerStateDataObject
            # at +0x40 (within the embedded struct, NOT within our 128 B
            # snapshot above; need an absolute read from psd_base+offset).
            if "PlayerNamePrefix" in psd:
                # A torn/stale read of this embedded FString decodes as CJK
                # mojibake, or its data_ptr aliases onto the player's own
                # OnlineUserId buffer (the "eos-id-as-tag" rows). Reject the
                # obvious garbage here so neither the live map nor the stats DB
                # latches it; keep short legit stylized-Unicode tags.
                try:
                    tag = read_fstring(
                        pm, psd_base + psd["PlayerNamePrefix"]) or None
                except Exception:
                    tag = None
                if tag and (tag == out.get("eosId") or len(tag) > 16
                            or any(_tag_char_is_junk(ord(c)) for c in tag)):
                    tag = None
                out["clanTag"] = tag
            out["stats"] = {
                "lives":           _i("Lives"),
                "kills":           _i("NumKills"),
                "vehicleKills":    _i("NumVehicleKills"),
                "deaths":          _i("NumDeaths"),
                "woundeds":        _i("NumWoundeds"),  # wounds dealt to others
                "wounds":          _i("NumWounds"),    # wounds taken
                "teamKills":       _i("NumTeamkills"),
                "healPoints":      _f("HealPoints"),
                "revivedPoints":   _f("RevivedPoints"),
                "teamWorkScore":   _f("TeamWorkScore"),
                "objectiveScore":  _f("ObjectiveScore"),
                "combatScore":     _f("CombatScore"),
                "isAdmin":         _b("bAdmin"),
                "isCommander":     _b("bCommander"),
                "fireTeamIndex":   _i("FireTeamIndex"),
                "fireTeamPosition": _i("FireTeamPosition"),
            }

    # Soldier chain
    soldier_addr = None
    for k in ("Soldier", "CurrentPawn"):
        if k in o:
            cand = _safe(lambda k=k: pm.read_u64(ps_addr + o[k]))
            if cand:
                soldier_addr = cand
                break

    out["soldier"] = _read_soldier(pm, alloc, arr, paths, soldier_addr)

    # PlayerStatsIndex — keys the Squad stats-collector arrays. Read off the
    # soldier's controller (APawn.Controller == this player's SQPlayerController).
    # Private (underscore): build_snapshot splices the collector counters in by
    # this index, then strips it before emit. Absent when the player has no live
    # soldier this tick — fine, the counters are cumulative and MAX-upserted, so
    # any tick the player is embodied carries the running total forward.
    sld = out.get("soldier") or {}
    ctrl = sld.get("_controllerAddr") or 0
    if ctrl and paths.pc_stats_index_off is not None:
        psi = _safe(lambda: pm.read_i32(ctrl + paths.pc_stats_index_off))
        if psi is not None and 0 <= psi < 1000:
            out["_psi"] = psi
    # Voice channel — a single replicated ESQVoiceChannel byte on this player's
    # own SQPlayerController (the same `ctrl` pointer PlayerStatsIndex uses). The
    # 0..13 sanity gate blanks a torn/patched read (no-guess). Public field, not
    # stripped: 'none' = embodied but not keying voice; absent = unreadable.
    if ctrl and paths.pc_voice_channel_off is not None:
        vc = _safe(lambda: pm.read_u8(ctrl + paths.pc_voice_channel_off))
        if vc is not None and 0 <= vc <= 13:
            out["voiceChannel"] = VOICE_CHANNEL_NAMES.get(vc)
    return out


def _read_collector_array(pm: ProcessMemory, inst_addr: int,
                          spec: dict) -> dict[int, dict] | None:
    """Read one stats-collector's per-player TArray into {index: {field: value}}.

    `spec` is a COLLECTOR_OFFSETS entry (tarray/stride/fields). Returns None on
    any read failure or an implausible header — a torn read must not send us
    reading megabytes. Sanity gates ported from the Squad-Replay reader.
    """
    tarray_off = spec["tarray"]
    stride = spec["stride"]
    data_ptr = _safe(lambda: pm.read_u64(inst_addr + tarray_off))
    num = _safe(lambda: pm.read_i32(inst_addr + tarray_off + 8))
    if data_ptr is None or num is None:
        return None
    # Valid heap pointer; 0..200 players (MaxPlayers is 100, allow headroom).
    if not (0x100000000 < data_ptr < 0x800000000000):
        return None
    if not (0 <= num <= 200):
        return None
    if num == 0:
        return {}
    raw = pm.try_read(data_ptr, num * stride)
    if raw is None or len(raw) < num * stride:
        return None
    out: dict[int, dict] = {}
    for i in range(num):
        base = i * stride
        entry: dict[str, Any] = {}
        for field_name, (kind, off) in spec["fields"].items():
            try:
                fmt = "<q" if kind == "i64" else "<i"
                entry[field_name] = struct.unpack_from(fmt, raw, base + off)[0]
            except (struct.error, IndexError):
                entry[field_name] = None
        out[i] = entry
    return out


def _read_collectors(pm: ProcessMemory, collector_addrs: dict[str, int]
                     ) -> dict[str, dict[int, dict]]:
    """Read whichever collectors we found a live instance for. Missing ones are
    simply absent from the result — an early tick before Squad spawns them, or a
    collector that failed a read, contributes nothing rather than blocking."""
    out: dict[str, dict[int, dict]] = {}
    for key, addr in collector_addrs.items():
        if not addr:
            continue
        arr = _read_collector_array(pm, addr, COLLECTOR_OFFSETS[key])
        if arr is not None:
            out[key] = arr
    return out


def _splice_collector_stats(players: list[dict],
                            collectors: dict[str, dict[int, dict]]) -> None:
    """Merge the collector counters into each player's stats by PlayerStatsIndex.

    suppliesDelivered folds the logistics collector's ammo + construction point
    totals into one number (both are "logi points delivered"). Everything else
    maps straight through. A field the collector could not read stays absent —
    no-guess: the stat is unknown, not zero.
    """
    for p in players:
        psi = p.get("_psi")
        if psi is None:
            continue
        stats = p.setdefault("stats", {})
        log = collectors.get("logistics", {}).get(psi)
        if log is not None:
            if log.get("fobsBuilt") is not None:
                stats["fobsBuilt"] = log["fobsBuilt"]
            ammo, cons = log.get("_ammoSupplied"), log.get("_constructionSupplied")
            if ammo is not None or cons is not None:
                stats["suppliesDelivered"] = (ammo or 0) + (cons or 0)
        com = collectors.get("combat", {}).get(psi)
        if com is not None:
            for k in ("vehicleDamage", "fobsDestroyed"):
                if com.get(k) is not None:
                    stats[k] = com[k]
        obj = collectors.get("objective", {}).get(psi)
        if obj is not None:
            for k in ("captures", "defenses"):
                if obj.get(k) is not None:
                    stats[k] = obj[k]


def _read_soldier(pm: ProcessMemory, alloc: FNameEntryAllocator,
                  arr: GUObjectArray, paths: SnapshotPaths,
                  soldier_addr: int | None
                  ) -> dict[str, Any] | None:
    """
    Read the SQSoldier-derived UObject at `soldier_addr`. Returns None if
    the pointer is null OR if a freshness check (ClassPrivate still
    pointing into the heap / Health in a sane range) fails — that's how
    we filter out stale pointers to already-destroyed soldiers (e.g.
    after a player dies, the SQPlayerState.PawnPrivate may briefly
    reference freed memory).
    """
    if not soldier_addr:
        return None
    # Freshness check 1: ClassPrivate must still be a heap-pointing UObject
    cp = pm.try_read(soldier_addr + UOBJ_CLASS_PRIVATE, 8)
    if cp is None or len(cp) < 8:
        return {"addr": f"{soldier_addr:#x}", "stale": True}
    class_addr = struct.unpack("<Q", cp)[0]
    if class_addr == 0:
        return {"addr": f"{soldier_addr:#x}", "stale": True}

    block: dict[str, Any] = {
        "addr": f"{soldier_addr:#x}",
        "classShort": _uobject_name(pm, class_addr, alloc),
    }
    so = paths.soldier_offsets
    if "Health" in so:
        b = pm.try_read(soldier_addr + so["Health"], 4)
        if b and len(b) == 4:
            h = struct.unpack("<f", b)[0]
            # Health sanity gate — Squad soldier HP is [0..100] in healthy
            # state. Values outside this strongly suggest the memory was
            # freed and overwritten.
            if -10 <= h <= 1000:
                block["health"] = h
            else:
                block["health"] = None
                block["stale"] = True
        else:
            block["health"] = None
    if "BreathHoldStamina" in so:
        b = pm.try_read(soldier_addr + so["BreathHoldStamina"], 4)
        if b and len(b) == 4:
            s = struct.unpack("<f", b)[0]
            block["breathHoldStamina"] = s if -10 <= s <= 1000 else None
        else:
            block["breathHoldStamina"] = None

    # Real sprint Stamina — a two-hop read: soldier -> SoldierMovement component
    # ptr -> Stamina/StaminaMax floats (offsets reflected by name in
    # soldier_movement_offsets). Distinct from BreathHoldStamina above; this is
    # the field that drops when a player sprints. On this build the range is
    # 0..StaminaMax(=100). Guarded: the ptr must be in heap range and each float
    # must pass the range gate (which also rejects NaN), else the field is left
    # absent (no-guess). Offsets are reflected, NOT the Squad-Replay reader's
    # hardcoded 0x03FC/0x1024 (which read a config float on this build).
    smo = paths.soldier_movement_offsets
    if "SoldierMovement" in so and smo:
        mv = _safe(lambda: pm.read_u64(soldier_addr + so["SoldierMovement"]))
        if mv and 0x100000000 < mv < 0x800000000000:
            if "Stamina" in smo:
                b = pm.try_read(mv + smo["Stamina"], 4)
                if b and len(b) == 4:
                    s = struct.unpack("<f", b)[0]
                    block["stamina"] = round(s, 2) if -1 <= s <= 200 else None
            if "StaminaMax" in smo:
                b = pm.try_read(mv + smo["StaminaMax"], 4)
                if b and len(b) == 4:
                    s = struct.unpack("<f", b)[0]
                    block["staminaMax"] = round(s, 2) if 0 < s <= 200 else None

    # Stance — derived from bIsProne (own byte) + bIsCrouched (bitfield
    # shared with several Character-level bools, needs FBoolProperty mask)
    is_prone = False
    if "bIsProne" in so:
        # bIsProne gets its own byte, but only bit 0 is the flag — mask it
        # rather than testing the whole byte's truthiness.
        is_prone = bool((_safe(lambda: pm.read_u8(
            soldier_addr + so["bIsProne"])) or 0) & 1)
    is_crouched = False
    if "bIsCrouched" in paths.soldier_bool_masks:
        eff_off, mask = paths.soldier_bool_masks["bIsCrouched"]
        byte = _safe(lambda: pm.read_u8(soldier_addr + eff_off))
        is_crouched = (byte is not None) and bool(byte & mask)
    block["stance"] = "prone" if is_prone else (
        "crouched" if is_crouched else "standing")

    # Life-state — the replicated bIsWounded / bIsBleeding / bIsDying flags
    # (each an FBoolProperty bitmask in soldier_bool_masks). This is the
    # server's own ground truth for "this soldier is down", replacing the
    # health<=0 correlate the frontend used to infer. Read only the masks
    # reflection actually resolved; if NONE resolved, leave lifeState absent —
    # never default to 'healthy' (that would assert a state we didn't read).
    _life: dict[str, bool] = {}
    for _fld, _key in (("bIsWounded", "isWounded"),
                       ("bIsBleeding", "isBleeding"),
                       ("bIsDying", "isDying")):
        _m = paths.soldier_bool_masks.get(_fld)
        if _m is None:
            continue
        _eff, _mask = _m
        _byte = _safe(lambda o=_eff: pm.read_u8(soldier_addr + o))
        _life[_key] = (_byte is not None) and bool(_byte & _mask)
        block[_key] = _life[_key]
    if _life:
        block["lifeState"] = (
            "incapacitated" if (_life.get("isWounded") or _life.get("isDying"))
            else "bleeding" if _life.get("isBleeding") else "healthy")

    # APawn-inherited fields used by the damage-event tracker. Stored as
    # private (underscore) so consumers don't accidentally surface them
    # — the tracker post-processes them and removes them from the block.
    if "Controller" in so:
        c = _safe(lambda: pm.read_u64(soldier_addr + so["Controller"]))
        block["_controllerAddr"] = c or 0
    if "LastHitBy" in so:
        lhb = _safe(lambda: pm.read_u64(soldier_addr + so["LastHitBy"]))
        block["_lastHitByAddr"] = lhb or 0

    # Phase 2D part 2 — currently held weapon. CurrentHeldWeapon is a
    # TWeakObjectPtr on SQSoldier @+0x307c (v10.4.1). Resolved to a UObject
    # via GUObjectArray, then we read its class FName. Magazines (if any)
    # come from SQWeapon.Magazines @+0x848 — same offset used for vehicle
    # turret weapons. Used by:
    #   - killfeed tier-3 weapon attribution fallback
    #   - player detail panel ("currently holding: <weapon name>")
    #   - admin afk / loadout sanity tools
    if "CurrentHeldWeapon" in so:
        wep_addr = _resolve_weak_obj(
            pm, arr, soldier_addr + so["CurrentHeldWeapon"])
        if wep_addr:
            wep_class = _uobject_class_name(pm, wep_addr, alloc)
            if wep_class and wep_class != "None":
                weapon: dict[str, Any] = {
                    "className": wep_class,
                    "name": _uobject_name(pm, wep_addr, alloc),
                }
                # Magazines TArray<int32>; idx 0 = chambered/loaded mag,
                # rest are spares. Same shape as the vehicle turret read.
                mag_hdr = read_tarray_header(
                    pm, wep_addr + SQ_VWEAPON_MAGAZINES_OFFSET)
                if (mag_hdr is not None and mag_hdr.count > 0
                        and mag_hdr.count <= 32 and mag_hdr.data_ptr):
                    mags: list[int] = []
                    for j in range(mag_hdr.count):
                        v = _safe(lambda j=j: pm.read_i32(
                            mag_hdr.data_ptr + j * 4))
                        if v is None:
                            break
                        mags.append(int(v))
                    if mags:
                        weapon["magazines"] = mags
                block["weapon"] = weapon

    # Position via RootComponent → ComponentToWorld.Translation.
    # ComponentToWorld is the cached world-space transform UE maintains
    # on every USceneComponent; reading it instead of RelativeLocation
    # gives us the correct world position even when the soldier is
    # attached to a vehicle seat (which would otherwise return
    # parent-relative coords). We keep the AttachParent check around
    # only as an `attached` informational flag.
    root = _safe(lambda: pm.read_u64(
        soldier_addr + paths.actor_root_component_off))
    if root:
        attach_parent = _safe(lambda: pm.read_u64(
            root + paths.scene_attach_parent_off))
        block["attached"] = bool(attach_parent)
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        if v is not None:
            block["position"] = {"x": v.x, "y": v.y, "z": v.z}
        yaw = _world_yaw(pm, root, paths)
        if yaw is not None:
            block["yaw"] = yaw
    return block


def read_lane_graph(pm: ProcessMemory, alloc: FNameEntryAllocator,
                    initializer_addr: int,
                    visualizer_addr: int | None = None,
                    paths: SnapshotPaths | None = None,
                    position_cache: dict[int, dict[str, float] | None] | None = None,
                    ) -> dict[str, Any] | None:
    """
    Read the AAS/RAAS lane graph from a SQGraphInitializerComponent
    instance. Returns None on read failure. Each edge is two cap-zone
    actor names (e.g. '01-RiversideEstates' -> '02-WaterTower'); the
    addresses are kept so consumers can join back to captureZones[].

    If `visualizer_addr` is given AND its class is SQGraphRAASVisualizer
    Component (RAAS-only), the RouteIndex field is read — that's the
    lane chosen at match start.
    """
    if not initializer_addr:
        return None
    hdr = read_tarray_header(
        pm, initializer_addr + LANE_GRAPH_OFFSETS["DesignOutgoingLinks"])
    if hdr is None:
        return None
    cls_name = _uobject_class_name(pm, initializer_addr, alloc)
    out: dict[str, Any] = {
        "_initializerAddr": f"{initializer_addr:#x}",
        "initializerClass": cls_name,
        "mode": ("RAAS" if cls_name and "RAAS" in cls_name
                 else "AAS" if cls_name and "AAS" in cls_name else None),
        "edges": [],
    }
    # Resolve each node's world position once via the standard
    # AActor.RootComponent → ComponentToWorld.Translation chain. Lane
    # nodes are usually `BP_CaptureZoneCluster` actors, NOT the
    # `BP_CaptureZone_C` instances we emit in captureZones[] — so the
    # frontend can't join by id. Embedding the position on each edge
    # lets the renderer draw the lane without that join.
    nodes: dict[int, str | None] = {}
    node_pos: dict[int, dict[str, float] | None] = {}

    def _node_position(addr: int) -> dict[str, float] | None:
        if not addr or paths is None:
            return None
        # Cache hit — cluster actors are placed in the level and don't
        # move during a match. Saves 2 syscalls per node × ~10 nodes
        # per map = ~20 syscalls/tick.
        if position_cache is not None and addr in position_cache:
            return position_cache[addr]
        root = _safe(lambda: pm.read_u64(
            addr + paths.actor_root_component_off))
        if not root:
            # Don't cache the None — re-reading 10 lane nodes per tick
            # is ~20 syscalls (trivial), and caching None forever used
            # to permanently kill lane edges on the minimap after one
            # bad read.
            return None
        v = read_fvector(
            pm, root + paths.scene_component_to_world_translation_off)
        result = {"x": v.x, "y": v.y, "z": v.z} if v is not None else None
        # Only cache successful resolutions; transient None never
        # persists in the cache.
        if position_cache is not None and result is not None:
            position_cache[addr] = result
        return result

    if hdr.count and hdr.data_ptr:
        # bound to keep us safe against corrupted headers
        cnt = min(hdr.count, 4096)
        for i in range(cnt):
            base = hdr.data_ptr + i * LANE_LINK_SIZE
            raw = pm.try_read(base, LANE_LINK_SIZE)
            if raw is None or len(raw) < LANE_LINK_SIZE:
                continue
            a, b = struct.unpack("<QQ", raw)
            if a not in nodes:
                nodes[a] = _uobject_name(pm, a, alloc) if a else None
                node_pos[a] = _node_position(a)
            if b not in nodes:
                nodes[b] = _uobject_name(pm, b, alloc) if b else None
                node_pos[b] = _node_position(b)
            out["edges"].append({
                "from":     nodes[a],
                "fromAddr": f"{a:#x}" if a else None,
                "fromPos":  node_pos.get(a),
                "to":       nodes[b],
                "toAddr":   f"{b:#x}" if b else None,
                "toPos":    node_pos.get(b),
            })
    out["nodes"] = [
        {"name": nm, "addr": f"{a:#x}", "pos": node_pos.get(a)}
        for a, nm in nodes.items() if a
    ]
    if visualizer_addr:
        out["_visualizerAddr"] = f"{visualizer_addr:#x}"
        out["visualizerClass"] = _uobject_class_name(
            pm, visualizer_addr, alloc)
        out["routeIndex"] = _safe(lambda: pm.read_i32(
            visualizer_addr + LANE_VISUALIZER_ROUTE_INDEX_OFF))
    else:
        out["routeIndex"] = None
    return out


def build_snapshot(pm: ProcessMemory, arr: GUObjectArray,
                   alloc: FNameEntryAllocator,
                   *, server_id: str = "squad",
                   include_motd: bool = False,
                   paths: SnapshotPaths | None = None,
                   metadata: Metadata | None = None,
                   caches: SnapshotCaches | None = None,
                   damage_tracker: DamageTracker | None = None,
                   ) -> dict[str, Any]:
    # Allow callers to cache `paths` across many snapshots — resolving the
    # 8 class layouts costs ~150 ms and never changes within a process run.
    if paths is None:
        paths = resolve_paths(pm, arr, alloc)

    # Walk GUObjectArray ONCE. Things to collect on this pass:
    #   - non-CDO instances whose class IS exactly SQPlayerState
    #   - a non-CDO SQGameState subclass instance (singleton)
    #   - non-CDO instances of any SQVehicle subclass
    #   - counts of SQSoldier / SQVehicleSeat for the diagnostics block
    # The three caches below stay valid for the entire process lifetime;
    # passing in a shared SnapshotCaches lets continuous-mode reuse them
    # across ticks (~150–250 ms savings after the first snapshot).
    if caches is None:
        caches = SnapshotCaches()
    # Snapshot every subclass-cache check through this generation. A
    # `caches.reset()` between snapshots bumps the gen; any stale
    # entries from the previous gen are treated as misses on next
    # lookup. Re-reading the value each tick is just a struct attribute
    # read — negligible vs the snapshot build cost.
    _subgen = caches.subclass_gen
    class_cache = caches.class_name
    is_subgs_cache = caches.is_subgs
    is_vehicle_cache = caches.is_vehicle
    is_marker_cache = caches.is_marker
    sq_player_state_class = paths.sq_player_state_class
    sq_game_state_class = paths.sq_game_state_class
    sq_vehicle_class = paths.sq_vehicle_class
    sq_map_marker_class = paths.sq_map_marker_class
    sq_deployable_class = paths.sq_deployable_class
    is_deployable_cache = caches.is_deployable
    sq_vehicle_spawner_class = paths.sq_vehicle_spawner_class
    is_vehicle_spawner_cache = caches.is_vehicle_spawner
    sq_squad_rally_point_class = paths.sq_squad_rally_point_class
    is_rally_cache = caches.is_rally
    sq_map_marker_manager_component_class = paths.sq_map_marker_manager_component_class
    tracked_proj_bases = paths.tracked_projectile_class_addrs
    is_tracked_projectile_cache = caches.is_tracked_projectile
    sq_graph_initializer_class = paths.sq_graph_initializer_class
    sq_graph_raas_visualizer_class = paths.sq_graph_raas_visualizer_class
    is_lane_initializer_cache = caches.is_lane_initializer
    is_raas_visualizer_cache = caches.is_raas_visualizer

    players_raw: list[int] = []
    game_state_addr: int | None = None
    lane_initializer_addr: int | None = None
    lane_visualizer_addr: int | None = None
    capture_zones_raw: list[int] = []
    # The live class address of BP_CaptureZone_C, captured during the walk
    # (its startup-resolved address may be stale after a map reload). Used
    # to lazily (re)derive the SQCaptureZone actor offset if the frozen
    # paths didn't have it.
    cz_class_addr = 0
    squad_states_raw: list[int] = []
    sq_squad_state_class = paths.sq_squad_state_class
    vehicles_raw: list[tuple[int, int]] = []
    markers_raw: list[tuple[int, int]] = []
    deployables_raw: list[tuple[int, int]] = []
    vehicle_spawners_raw: list[tuple[int, int]] = []
    rally_points_raw: list[tuple[int, int]] = []
    marker_manager_addr: int | None = None
    ammo_weps_raw: list[tuple[int, int]] = []
    projectiles_raw: list[tuple[int, int]] = []
    # First live (non-CDO) instance of each stats-collector singleton, by
    # COLLECTOR_CLASSES key. Reverse-mapped from class addr → key so the hot
    # loop does one dict lookup instead of three comparisons.
    collector_instances: dict[str, int] = {}
    collector_class_to_key = {
        addr: key for key, addr in paths.collector_classes.items() if addr}
    soldier_count = 0
    vehicle_seat_count = 0

    def _is_tracked_projectile(class_addr: int) -> bool:
        cached = is_tracked_projectile_cache.get(class_addr)
        if cached is not None:
            # Same (gen, bool) tuple shape as _is_subclass_of for
            # consistency / poisoning resistance.
            if isinstance(cached, tuple):
                gen, val = cached
                if gen == _subgen:
                    return val
            elif isinstance(cached, bool):
                return cached
        chain = walk_super_chain(pm, class_addr)
        ok = any(b in chain for b in tracked_proj_bases)
        if len(chain) >= 2:
            is_tracked_projectile_cache[class_addr] = (_subgen, ok)
        return ok

    obj_class_cache = caches.obj_class
    for idx, obj_addr, serial in arr.iter_object_records():
        # Defensive: under heavy GC churn on a populated server we've
        # seen extremely-rare cases where the unpacked address comes
        # back as a non-int (saw a generator slip in once on a 96-
        # player tick — could not reproduce out of the live loop).
        # Treat anything non-int the same as a null slot.
        if not isinstance(obj_addr, int) or obj_addr == 0:
            continue
        # (idx, serial) is a stable identity for "the UObject currently
        # in this slot" — if the entry matches, its ClassPrivate hasn't
        # changed since we last read it, so skip the pm.try_read.
        cached = obj_class_cache.get(idx)
        if cached is not None and cached[0] == serial:
            class_addr = cached[1]
            caches.obj_class_hits += 1
        else:
            if cached is None:
                caches.obj_class_misses += 1
            else:
                caches.obj_class_serial_bumps += 1
            cp = pm.try_read(obj_addr + UOBJ_CLASS_PRIVATE, 8)
            if cp is None:
                continue
            class_addr = struct.unpack("<Q", cp)[0]
            # Don't cache an implausible ClassPrivate. A transient bad read
            # (EIO mid-GC) can hand back a wild pointer; caching it against
            # the stable serial would hide this object — and the entity it
            # represents — until the next partial_invalidate sweep (the
            # "37 deployables but 20 emitted" poisoning). Skip it instead;
            # the next tick re-reads the real class.
            if not (0x10000 <= class_addr < 0x0000_8000_0000_0000):
                continue
            obj_class_cache[idx] = (serial, class_addr)

        if class_addr == sq_player_state_class:
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                players_raw.append(obj_addr)
            continue

        # SQSquadState (exact-class match — no subclassing in practice).
        # Collected here so we don't walk the 187k array a second time
        # in read_squad_states (was ~650 ms / tick on a 50-squad server).
        if class_addr == sq_squad_state_class:
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                squad_states_raw.append(obj_addr)
            continue

        # Capture zones — match by CLASS NAME, not a frozen class address.
        # BP_CaptureZone_C is a Blueprint class that gets a NEW class
        # object on every map reload, so the startup-resolved
        # bp_capture_zone_class goes stale and the old exact-address match
        # silently collected zero (the "caps show as lines" bug). The name
        # is stable across reloads; caches.class_name memoises it per
        # class_addr so this stays cheap.
        cn = class_cache.get(class_addr)
        if cn is None and class_addr not in class_cache:
            cn = _uobject_name(pm, class_addr, alloc)
            # Only cache a real name — as the AmmoWep / diagnostic sites below
            # already do. A transient EIO here returns None; caching it would
            # permanently blank BP_CaptureZone_C (and, since this shared cache
            # gates the later class lookups, AmmoWep + soldier/seat counts too)
            # for the whole reset window. Skip the cache so next tick re-reads.
            if cn and cn != "None":
                class_cache[class_addr] = cn
        if cn == "BP_CaptureZone_C":
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                capture_zones_raw.append(obj_addr)
                if not cz_class_addr:
                    cz_class_addr = class_addr
            continue

        # GameState singleton may be a Blueprint subclass.
        if game_state_addr is None and _is_subclass_of(
                pm, class_addr, sq_game_state_class, is_subgs_cache, _subgen):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                game_state_addr = obj_addr
            continue

        # Vehicles — any class deriving from SQVehicle, non-CDO.
        if _is_subclass_of(pm, class_addr, sq_vehicle_class, is_vehicle_cache, _subgen):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                vehicles_raw.append((obj_addr, class_addr))
            continue

        # SL/FTL map markers — any class deriving from SQMapMarker.
        if sq_map_marker_class and _is_subclass_of(
                pm, class_addr, sq_map_marker_class, is_marker_cache, _subgen):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                markers_raw.append((obj_addr, class_addr))
            continue

        # Deployables — FOB radios, HABs, ammo crates, repair stations,
        # bunkers, sandbags, emplacements (TOW/HMG/mortar baseplate).
        if sq_deployable_class and _is_subclass_of(
                pm, class_addr, sq_deployable_class, is_deployable_cache, _subgen):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                deployables_raw.append((obj_addr, class_addr))
            continue

        # Vehicle spawners — per-pad actors that emit vehicles for each
        # team's availability rules (LAVs/Bradleys/helis/trucks).
        if sq_vehicle_spawner_class and _is_subclass_of(
                pm, class_addr, sq_vehicle_spawner_class,
                is_vehicle_spawner_cache, _subgen):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                vehicle_spawners_raw.append((obj_addr, class_addr))
            continue

        # Rally points — per-squad spawn actors. We render their position +
        # owning squad number so the map shows "[Sqd 3 Rally]" type badges.
        if sq_squad_rally_point_class and _is_subclass_of(
                pm, class_addr, sq_squad_rally_point_class,
                is_rally_cache, _subgen):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                rally_points_raw.append((obj_addr, class_addr))
            continue

        # Map-marker manager component — singleton attached to the
        # active game state; its MarkerArray.Items holds every player-
        # placed marker (SL/FTL Move/Attack/Defend/Build/Observe,
        # Spotted, CommandRequest, FOB request, Director paths, …).
        # Capture the first non-default instance and walk its TArray
        # after the scan completes.
        if (marker_manager_addr is None
                and sq_map_marker_manager_component_class
                and class_addr == sq_map_marker_manager_component_class):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                op_b = pm.try_read(obj_addr + 0x20, 8)
                if op_b and len(op_b) == 8:
                    outer = struct.unpack("<Q", op_b)[0]
                    if outer:
                        outer_nm = _uobject_name(pm, outer, alloc) or ""
                        if not outer_nm.startswith("Default__"):
                            marker_manager_addr = obj_addr
            continue

        # Stats-collector singletons — one live instance of each per map.
        # Exact class match (they don't subclass); keep the first non-CDO.
        if collector_class_to_key and class_addr in collector_class_to_key:
            col_key = collector_class_to_key[class_addr]
            if col_key not in collector_instances:
                nm = _uobject_name(pm, obj_addr, alloc) or ""
                if not nm.startswith("Default__"):
                    collector_instances[col_key] = obj_addr
            continue

        # Per-vehicle resource pools. Two families, same struct layout /
        # AActor.Owner linkage, so we collect both here:
        #   * AmmoWep_*_C — combat vehicles' built-in ammo (APC/LightVehicle/
        #     Helicopter/Tank_50…) and some factions' COMBINED logi-supply
        #     crate (AmmoWep_1000_C / _technicalLogi_C).
        #   * AmmoResourceWeapon_C / ConstructionResourceWeapon_C — modern logi
        #     trucks (CTM131 / CAF Util / Ural-375 Logi…) carry these as two
        #     SEPARATE pools: ammunition and construction. Missing them was why
        #     logi trucks showed no build supply.
        # Classified by CLASS name (cached, ~free) instead of the per-object
        # name — reading _read_fname on every one of ~187k objects each tick
        # tanks frame rate.
        cls_name_cached = class_cache.get(class_addr)
        if cls_name_cached is None and class_addr not in class_cache:
            cls_name_cached = _uobject_name(pm, class_addr, alloc)
            # Only cache truthy non-"None" so one bad fname pool read
            # doesn't permanently blank AmmoWep classification (the
            # symptom was: vehicle resource pools silently missing
            # forever after a single mid-match EIO).
            if cls_name_cached and cls_name_cached != "None":
                class_cache[class_addr] = cls_name_cached
        if cls_name_cached and (cls_name_cached.startswith("AmmoWep_")
                                or cls_name_cached == "AmmoResourceWeapon_C"
                                or cls_name_cached == "ConstructionResourceWeapon_C"):
            ammo_weps_raw.append((obj_addr, class_addr))
            continue

        # In-flight projectiles — only the strategic ones (mortar shells,
        # guided missiles, smoke). Plain bullets (~3k live SQProjectile
        # instances) deliberately excluded — too noisy for the snapshot.
        if tracked_proj_bases and _is_tracked_projectile(class_addr):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__"):
                projectiles_raw.append((obj_addr, class_addr))
            continue

        # Lane-graph singletons. Both initializer (AAS+RAAS) and the
        # RAAS-only visualizer are component objects — one per map, so
        # we keep the first non-CDO match we see and stop checking.
        if (lane_initializer_addr is None and sq_graph_initializer_class
                and _is_subclass_of(pm, class_addr,
                                    sq_graph_initializer_class,
                                    is_lane_initializer_cache, _subgen)):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__") and "_GEN_VARIABLE" not in nm:
                lane_initializer_addr = obj_addr
            continue
        if (lane_visualizer_addr is None and sq_graph_raas_visualizer_class
                and _is_subclass_of(pm, class_addr,
                                    sq_graph_raas_visualizer_class,
                                    is_raas_visualizer_cache, _subgen)):
            nm = _uobject_name(pm, obj_addr, alloc) or ""
            if not nm.startswith("Default__") and "_GEN_VARIABLE" not in nm:
                lane_visualizer_addr = obj_addr
            continue

        # Class-count diagnostics
        cn = class_cache.get(class_addr)
        if cn is None:
            cn = _uobject_name(pm, class_addr, alloc)
            # Truthy-only insert: bad fname pool reads must not
            # permanently blank a class label.
            if cn and cn != "None":
                class_cache[class_addr] = cn
        if cn == "SQSoldier":
            soldier_count += 1
        elif cn == "SQVehicleSeat":
            vehicle_seat_count += 1

    players = [read_player(pm, alloc, arr, paths, addr, caches=caches)
               for addr in players_raw]

    # Squad's per-player stats collectors (memory-only counters not in RCON):
    # read each singleton once, then splice its per-player entry into the
    # matching player by PlayerStatsIndex. Wrapped in _safe-equivalent: a bad
    # collector read leaves those stats absent, never crashes the build.
    if collector_instances:
        try:
            _splice_collector_stats(
                players, _read_collectors(pm, collector_instances))
        except (OSError, struct.error, ValueError, TypeError, IndexError):
            pass

    # ---- damageEvents via LastHitBy delta ---------------------------------
    # We need this BEFORE dedupe so post-respawn duplicates are still
    # joinable to the controllers they reference. Builds a controller_addr
    # -> player map first (controller-side links survive across respawns).
    damage_events: list[dict[str, Any]] = []
    if damage_tracker is not None:
        # Build name lookup: controller_addr -> player_name
        ctrl_to_name: dict[int, str | None] = {}
        for p in players:
            sld = p.get("soldier") or {}
            c = sld.get("_controllerAddr") or 0
            if c:
                ctrl_to_name[c] = p.get("name")
        for p in players:
            sld = p.get("soldier") or {}
            if sld.get("stale") or not sld.get("classShort"):
                continue
            # Defensive: a freed soldier slot can read back as
            # classShort='None' (the literal string, set by _read_fname
            # when the FName resolves to the engine's None entry). Real
            # soldier classes are 'BP_Soldier_<Faction>_C' shaped, so
            # treat 'None' as junk and skip — emitting an event for it
            # produced garbage victim names + bogus damageType strings
            # in the wild (e.g. "SkeletalMeshSocket_13").
            if sld.get("classShort") == "None":
                continue
            # Also guard on a usable victim identity. Without a name
            # the killfeed has nothing to display anyway.
            if not p.get("name"):
                continue
            lhb = sld.get("_lastHitByAddr") or 0
            key = p.get("eosId") or sld.get("addr")  # fallback if no EOS
            if not key:
                continue
            # Phase 2D — fire on LastHitBy delta OR TakeHitInfo timestamp
            # advance. Cheap ts peek first (one 4-byte read) so we only
            # do the heavy ~50-byte struct walk + WeakObj resolves when
            # the timestamp actually changed.
            soldier_addr_str = sld.get("addr")
            soldier_addr_i = int(soldier_addr_str, 0) if soldier_addr_str else 0
            new_ts = (peek_take_hit_ts(pm, soldier_addr_i)
                      if soldier_addr_i else None)
            prev_lhb = damage_tracker.last_seen.get(key, 0)
            prev_ts = damage_tracker.last_ts.get(key, 0.0)
            damage_tracker.last_seen[key] = lhb
            if new_ts is not None:
                damage_tracker.last_ts[key] = new_ts

            lhb_event = bool(lhb) and lhb != prev_lhb
            ts_event = new_ts is not None and new_ts > prev_ts and prev_ts > 0
            first_ts = new_ts is not None and new_ts > 0 and prev_ts == 0
            if not (lhb_event or ts_event or first_ts):
                continue

            # Only NOW do the full struct walk — typically <1% of ticks.
            thi = (read_take_hit_info(pm, alloc, arr, soldier_addr_i)
                   if soldier_addr_i else None)

            attacker_name = ctrl_to_name.get(lhb) if lhb else None
            own_ctrl = sld.get("_controllerAddr") or 0
            ev: dict[str, Any] = {
                "victim":           p.get("name"),
                "victimEosId":      p.get("eosId"),
                "victimTeam":       p.get("teamId"),
                "victimSoldier":    sld.get("classShort"),
                "victimPos":        sld.get("position"),
                "attacker":         attacker_name,
                "attackerCtrlAddr": f"{lhb:#x}" if lhb else None,
                "selfInflicted":    bool(lhb and lhb == own_ctrl),
            }
            if thi is not None:
                # Splat the enriched fields — frontend killfeed already
                # consumes them via its 5-tier weapon attribution chain.
                ev["ts"]           = thi.get("ts")
                ev["damage"]       = thi.get("damage")
                ev["damageType"]   = thi.get("damageType")
                ev["causerClass"]  = thi.get("causerClass")
                ev["causerWeapon"] = thi.get("causerWeapon")
                ev["hitDistance"]  = thi.get("hitDistance")
                ev["headshot"]     = thi.get("headshot", False)
                ev["killed"]       = thi.get("killed", False)
                ev["wounded"]      = thi.get("wounded", False)
                if thi.get("bone"):
                    ev["bone"] = thi["bone"]
            damage_events.append(ev)

    # Strip the private soldier fields no consumer should see
    for p in players:
        p.pop("_psi", None)   # PlayerStatsIndex — internal collector key
        sld = p.get("soldier")
        if sld:
            sld.pop("_controllerAddr", None)
            sld.pop("_lastHitByAddr", None)

    # ---- dedupe SQPlayerStates by OnlineUserId ---------------------------
    # When a client disconnects and reconnects, both the old (about to be
    # GC'd) and new SQPlayerState briefly exist. Group by EOS user id and
    # keep the "most useful" entry — preferring one with a connected
    # soldier and non-zero score. If two are tied, the later one
    # (higher internal index, last-in-iteration) wins.
    seen: dict[str, dict[str, Any]] = {}
    no_id: list[dict[str, Any]] = []
    def _score(pp: dict[str, Any]) -> tuple:
        sld = pp.get("soldier") or {}
        return (
            int(bool(sld and sld.get("classShort") and not sld.get("stale"))),
            int(bool(pp.get("roleId") and pp.get("roleId") != "None")),
            float(pp.get("score") or 0.0),
        )
    for p in players:
        key = p.get("eosId")
        if not key:
            no_id.append(p)
            continue
        if key not in seen or _score(p) >= _score(seen[key]):
            seen[key] = p
    players = list(seen.values()) + no_id
    game_state = (read_game_state(pm, alloc, paths, game_state_addr)
                  if game_state_addr else None)
    lane = (read_lane_graph(pm, alloc, lane_initializer_addr,
                            lane_visualizer_addr, paths=paths,
                            position_cache=caches.lane_node_positions)
            if lane_initializer_addr else None)
    if game_state is not None:
        game_state["lane"] = lane
    teams = (read_team_states(pm, alloc, paths, game_state_addr)
             if game_state_addr else [])
    squads = [read_squad_state(pm, alloc, paths, a) for a in squad_states_raw]
    # If the SQCaptureZone actor offset wasn't resolved at startup (the BP
    # class wasn't loaded for the map that was active then), derive it now
    # from the live capture-zone class. BP field offsets are layout-stable
    # across reloads, so this one-time derivation sticks.
    if (capture_zones_raw and cz_class_addr
            and "SQCaptureZone" not in paths.capzone_actor_offsets):
        lay = get_class_layout(pm, cz_class_addr, alloc)
        if "SQCaptureZone" in lay:
            paths.capzone_actor_offsets = dict(paths.capzone_actor_offsets)
            paths.capzone_actor_offsets["SQCaptureZone"] = lay["SQCaptureZone"].offset
    capture_zones = [
        read_capture_zone(pm, alloc, paths, a, _uobject_name(pm, a, alloc) or "")
        for a in capture_zones_raw
    ]
    # Preserve the old ordering: by name so '01-…' through '05-…' come out
    # in their natural visual order on the live map.
    capture_zones.sort(key=lambda c: c.get("name") or "")
    markers = [
        read_marker(pm, alloc, paths, m_addr,
                    class_cache.get(cls_addr) or _uobject_name(pm, cls_addr, alloc))
        for m_addr, cls_addr in markers_raw
    ]
    # Squad v10 player-placed markers — live as 104-byte structs in the
    # SQMapMarkerManagerComponent's MarkerArray.Items TArray. Stride +
    # field offsets brute-force verified on a live 114-entry array.
    if marker_manager_addr:
        hdr_b = pm.try_read(marker_manager_addr + MARKER_ITEMS_ABS_OFFSET, 16)
        if hdr_b and len(hdr_b) == 16:
            items_ptr, items_count, items_cap = struct.unpack("<QII", hdr_b)
            if items_ptr and 0 < items_count <= 500:
                buf = pm.try_read(items_ptr,
                                  items_count * MARKER_ITEM_SIZE)
                if buf and len(buf) == items_count * MARKER_ITEM_SIZE:
                    for i in range(items_count):
                        base = i * MARKER_ITEM_SIZE
                        try:
                            px, py, pz = struct.unpack(
                                "<ddd",
                                buf[base + 0x20:base + 0x38])
                        except struct.error:
                            continue
                        # Empty / deleted slot: position all zero or NaN.
                        if (px == 0.0 and py == 0.0) or px != px:
                            continue
                        # Junk-read gate. Use the same ~50 km bound the
                        # live-actor paths use (pos_sane, 5e6 cm); the old
                        # 3e5 (3 km) cutoff silently dropped legit markers on
                        # the largest maps (Skorpo/Yehorivka reach ~3.6 km).
                        if abs(px) > 5e6 or abs(py) > 5e6:
                            continue  # junk read
                        rep_id    = struct.unpack("<i", buf[base:base+4])[0]
                        squad_id  = struct.unpack("<i", buf[base+0x10:base+0x14])[0]
                        team_id   = struct.unpack("<i", buf[base+0x14:base+0x18])[0]
                        ft_id     = struct.unpack("<i", buf[base+0x18:base+0x1c])[0]
                        # The ptr at +0x50 points to an SQMapMarkerDataAsset
                        # instance; the asset's INSTANCE NAME (not its
                        # generic class name) is the type discriminator —
                        # e.g. "DA_MapMarker_Move_SL", "Attack_FT", etc.
                        asset_ptr = struct.unpack("<Q", buf[base+0x50:base+0x58])[0]
                        asset_name = None
                        if asset_ptr:
                            asset_name = _uobject_name(pm, asset_ptr, alloc)
                        markers.append({
                            "id":          f"{rep_id}",
                            "type":        asset_name,
                            "team":        team_id if 0 <= team_id <= 4 else None,
                            "squad":       squad_id if 0 < squad_id <= 50 else None,
                            "fireTeamId":  ft_id,
                            "ownerPlayerStateAddr": None,
                            "position":    {"x": px, "y": py, "z": pz},
                        })
    deployables = [
        read_deployable(pm, alloc, paths, d_addr,
                        class_cache.get(cls_addr) or _uobject_name(pm, cls_addr, alloc))
        for d_addr, cls_addr in deployables_raw
    ]
    # Drop freed/junk slots flagged by read_deployable's freshness gate.
    deployables = [d for d in deployables if not d.get("stale")]
    # Placer stickiness. The direct-PS / Instigator link nulls out once the
    # placer despawns or disconnects, so capture the placer the first tick it
    # resolves live and replay it for the actor's lifetime. Keyed by actor
    # address; entries for deployables gone this tick are evicted (bounds the
    # cache and guards actor-pointer reuse — a reused slot re-resolves fresh).
    if caches is not None:
        pl_cache = caches.placer_cache
        pl_eos_off = paths.ps_offsets.get("OnlineUserId")
        caches.placer_epoch += 1
        ep = caches.placer_epoch
        for d in deployables:
            # Key on the actor's stable instance name (survives reader restarts
            # + a persisted cache); fall back to the addr id if it's missing.
            key = d.get("actorName") or d.get("id") or ""
            fresh_ps = d.pop("_placerPs", None)
            if key and d.get("placer") and fresh_ps:
                pl_eos = caches.player_eos_ids.get(fresh_ps)
                if (pl_eos is None and fresh_ps not in caches.player_eos_ids
                        and pl_eos_off):
                    pl_eos = _safe(lambda ps=fresh_ps: read_fstring(pm, ps + pl_eos_off))
                    caches.player_eos_ids[fresh_ps] = pl_eos
                pl_cache[key] = {"name": d["placer"], "eos": pl_eos, "ep": ep}
            pl_hit = pl_cache.get(key) if key else None
            if pl_hit:
                pl_hit["ep"] = ep       # touch so a live deployable never ages out
            d["placer"] = pl_hit["name"] if pl_hit else None
            d["placerEosId"] = pl_hit["eos"] if pl_hit else None
        # Bound the cache: drop entries not seen for ~1000 ticks (~30 min).
        # Epoch-based, so a transient empty/partial snapshot never nukes it.
        stale = ep - 1000
        if stale > 0:
            for k in [k for k, v in pl_cache.items() if v.get("ep", 0) < stale]:
                del pl_cache[k]
    else:
        for d in deployables:
            d.pop("_placerPs", None)
            d.setdefault("placerEosId", None)
    vehicle_spawners = [
        read_vehicle_spawner(pm, alloc, paths, sp_addr,
                             class_cache.get(cls_addr) or _uobject_name(pm, cls_addr, alloc))
        for sp_addr, cls_addr in vehicle_spawners_raw
    ]
    rally_points = [
        read_rally_point(pm, alloc, paths, rp_addr,
                         class_cache.get(cls_addr) or _uobject_name(pm, cls_addr, alloc))
        for rp_addr, cls_addr in rally_points_raw
    ]
    rally_points = [r for r in rally_points if not r.get("stale")]
    projectiles = [
        read_projectile(pm, alloc, paths, p_addr,
                        class_cache.get(cls_addr) or _uobject_name(pm, cls_addr, alloc))
        for p_addr, cls_addr in projectiles_raw
    ]
    vehicles = [
        read_vehicle(pm, alloc, paths, vh_addr,
                     class_cache.get(cls_addr) or _uobject_name(pm, cls_addr, alloc),
                     caches=caches)
        for vh_addr, cls_addr in vehicles_raw
    ]
    # Junk filter for vehicles — same pattern as deployables. Freed
    # vehicle slots routinely read back with:
    #   - classShort = None (class FName couldn't resolve)
    #   - maxHealth subnormal float (4e-41 etc.) or 0
    #   - position null because RootComponent freed
    # Drop these rows — the frontend's `!position` filter would skip
    # rendering anyway, but they pollute the snapshot list AND confuse
    # the "attached" hiding logic for any player whose soldier addr
    # still references a freed vehicle.
    def _is_junk_vehicle(v: dict[str, Any]) -> bool:
        if not v.get("classShort"):
            return True
        mh = v.get("maxHealth")
        if mh is None or mh <= 0 or mh > 1e6:
            return True
        if not v.get("position"):
            return True
        return False
    vehicles = [v for v in vehicles if not _is_junk_vehicle(v)]

    # AmmoWep_*_C resource pools — each holds a current+max int32. We
    # group them by their Owner (the vehicle) and attach the list onto
    # the matching vehicle dict.
    pools_by_owner: dict[int, list[dict[str, Any]]] = {}
    for ammo_addr, ammo_cls in ammo_weps_raw:
        owner_b = pm.try_read(ammo_addr + AACTOR_OWNER_OFFSET, 8)
        if not owner_b or len(owner_b) != 8:
            continue
        owner = struct.unpack("<Q", owner_b)[0]
        if not owner:
            continue
        cur_b = pm.try_read(ammo_addr + AMMO_WEP_OFFSETS["Resources"], 4)
        max_b = pm.try_read(ammo_addr + AMMO_WEP_OFFSETS["MaxResources"], 4)
        cur = struct.unpack("<i", cur_b)[0] if cur_b and len(cur_b) == 4 else None
        mx  = struct.unpack("<i", max_b)[0] if max_b and len(max_b) == 4 else None
        # Sanity: drop CDOs / junk where both are zero (no live capacity
        # at all — these are the class-default templates that show up in
        # GUObjectArray alongside the per-vehicle instances).
        if (mx is None or mx <= 0) and (cur is None or cur <= 0):
            continue
        cls_short = (class_cache.get(ammo_cls)
                     or _uobject_name(pm, ammo_cls, alloc))
        pools_by_owner.setdefault(owner, []).append({
            "className": cls_short,
            "current":   cur,
            "max":       mx,
        })
    for v in vehicles:
        addr = int(v["id"], 16) if isinstance(v.get("id"), str) else None
        if addr and addr in pools_by_owner:
            v["resourcePools"] = pools_by_owner[addr]

    # Link each player to its squad (by addr) so the frontend can join
    # players to a squad without walking the players list themselves.
    squad_by_addr = {s["_addr"]: s for s in squads}
    for p in players:
        sa = p.get("squadStateAddr")
        if sa and sa in squad_by_addr:
            sq = squad_by_addr[sa]
            p["squadId"] = sq.get("id")
            p["squadName"] = sq.get("name")
            p["squadTeamId"] = sq.get("teamId")
    # Same join for rally points — each one belongs to one squad. The
    # rally's `team` field is the SQGameSpawn enum (1=team1, 2=team2);
    # we prefer the squad's teamId when the join hits because it's the
    # canonical i32 the rest of the snapshot uses.
    for rp in rally_points:
        sa = rp.get("squadStateAddr")
        if sa and sa in squad_by_addr:
            sq = squad_by_addr[sa]
            rp["squadId"] = sq.get("id")
            rp["squadName"] = sq.get("name")
            rp["squadTeamId"] = sq.get("teamId")

    # ---- optional display-name enrichment via static metadata ------------
    if metadata is not None:
        for p in players:
            pool = metadata.role_pool(p.get("roleId"))
            if pool:
                p["rolePool"] = pool["key"]
                p["rolePoolLabel"] = pool["label"]
        for v in vehicles:
            cs = v.get("classShort")
            fac = metadata.vehicle_faction(cs)
            if fac:
                v["faction"] = fac
            kind = metadata.vehicle_kind(cs)
            if kind:
                v["kind"] = kind
        # Layer lookup from the live MapName (FText decode).
        if game_state:
            layer_name = game_state.get("mapName")
            lb = metadata.layer_bounds_for(layer_name)
            if lb:
                game_state["layer"] = {
                    "name": layer_name,
                    "mapId": lb.get("mapId"),
                    "mapName": lb.get("mapName"),
                    "gameMode": lb.get("gameMode"),
                    "texture": lb.get("texture"),
                    "topLeft": lb.get("topLeft"),
                    "bottomRight": lb.get("bottomRight"),
                }
                # Also link to the broad map_config bounds (for the
                # frontend's default minimap), keyed by best-match id.
                mc = metadata.map_bounds(lb.get("mapId")) or {}
                if mc:
                    game_state["mapConfig"] = mc

            # Attach static SquadCalc cap-zone geometry (shape + position) to
            # the live snapshot, no-guess. On AAS the live captureZones carry
            # the state and we glue a shape onto each; on RAAS captureZones is
            # usually empty (cluster actors aren't read), so we instead resolve
            # the static layout against the live lane graph and emit only the
            # objectives on the ACTIVE route. Static data is layout ONLY — it
            # never carries ownership (see capzones.py). Missing file → [] →
            # both calls are no-ops, so this is fully backward compatible.
            static_pts = metadata.capzones_for(layer_name)
            if static_pts:
                if capture_zones:
                    attach_static_capzones(capture_zones, static_pts)
                elif game_state.get("lane"):
                    attach_static_to_lane(game_state["lane"], static_pts)

    # MOTD is huge and rarely changes — opt-in for trimmer snapshots.
    if game_state and not include_motd:
        game_state.pop("motd", None)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "server": server_id,
        "schemaVersion": "phase3-draft",
        "counts": {
            "playerStatesNonCDO": len(players),
            "soldiersLive": soldier_count,
            "vehicleSeatsLive": vehicle_seat_count,
            "totalUObjects": arr.num_elements,
            # Cache health — surfaced so external monitors (or the
            # frontend "stale" pill) can flag thrash without having
            # to fetch /api/health/deep.
            "cacheResets":  caches.reset_count,
            "subclassGen":  caches.subclass_gen,
            "objCache": {
                "hits":         caches.obj_class_hits,
                "misses":       caches.obj_class_misses,
                "serialBumps":  caches.obj_class_serial_bumps,
            },
        },
        "gameState": game_state,
        "teams": teams,
        "squads": squads,
        "players": players,
        "vehicles": vehicles,
        "captureZones": capture_zones,
        "markers": markers,
        "deployables": deployables,
        "vehicleSpawners": vehicle_spawners,
        "rallyPoints": rally_points,
        "projectiles": projectiles,
        "damageEvents": damage_events,
    }


__all__ = [
    "build_snapshot", "resolve_paths", "read_player", "read_game_state",
    "read_team_state", "read_team_states",
    "read_squad_state", "read_squad_states",
    "read_vehicle", "read_vehicle_seats",
    "read_lane_graph",
    "find_subclass_instance", "SnapshotPaths", "SnapshotCaches",
    "DamageTracker", "clean_nonfinite",
    "LANE_GRAPH_OFFSETS", "LANE_LINK_NODEA_OFF", "LANE_LINK_NODEB_OFF",
    "LANE_LINK_SIZE", "LANE_VISUALIZER_ROUTE_INDEX_OFF",
    "SQ_VEHICLE_SEATS_OFFSET",
    "SQ_SEATCOMP_SEAT_CONFIG_OFFSET", "SQ_SEATCOMP_ANIM_STATE_OFFSET",
    "SQ_SEATCOMP_SEAT_PAWN_OFFSET", "SQ_SEATCOMP_SEATED_PLAYER_OFFSET",
    "SQ_SEATCOMP_SEATED_SOLDIER_OFFSET", "SQ_SEATCOMP_FORCE_OCCUPIED_OFFSET",
    "SQ_VEHICLESEAT_SEAT_HEALTH_OFFSET",
]
