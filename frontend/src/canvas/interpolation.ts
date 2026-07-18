// Inter-tick interpolation: backend produces snaps at ~3 Hz, browser
// repaints at 60 fps. Without smoothing entities snap every 20 frames.
// _lerpSnap returns a shallow-cloned `cur` with positions/yaw/cap%
// linearly interpolated from `prev` for any entity matchable by ID.

import type { CaptureZone, Player, Projectile, Snapshot, Vec3, Vehicle, VehicleTurret } from "../state/types";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function lerpAngle(a: number | null | undefined,
                          b: number | null | undefined, t: number): number | null {
  if (a == null && b == null) return null;
  if (a == null) return b!;
  if (b == null) return a;
  const d = ((b - a) % 360 + 540) % 360 - 180;
  return a + d * t;
}

export function lerpPos(pa: Vec3 | null | undefined,
                        pb: Vec3 | null | undefined, t: number): Vec3 | null {
  if (!pa && !pb) return null;
  if (!pa) return pb!;
  if (!pb) return pa;
  return {
    x: lerp(pa.x, pb.x, t),
    y: lerp(pa.y, pb.y, t),
    z: pa.z != null && pb.z != null ? lerp(pa.z, pb.z, t) : (pb.z ?? pa.z),
  };
}

// Squad world units are cm. A jump farther than the entity's max
// plausible speed × the actual tick interval cannot be locomotion —
// it's a respawn / destroy-and-respawn / admin teleport, and lerping
// across it would draw the entity sliding across the map.
//
// The threshold MUST scale with the real tick interval: the original
// fixed 50 m constant assumed 2 Hz ticks, but prod serves at 1 Hz —
// a helicopter cruising 50-70 m/s covers 50-70 m *per tick*, so it
// tripped the "teleport" guard on fast ticks and snapped instead of
// lerping. Result: the stutter-glide-stutter motion reported for
// helis. Max speeds below carry generous headroom (heli dive ~90 m/s).
const SOLDIER_MAX_CMS = 1_200;   // 12 m/s — sprint + knockback headroom
const VEHICLE_MAX_CMS = 10_000;  // 100 m/s — helicopter dive headroom
const TELEPORT_SAFETY = 1.5;     // late-tick jitter margin

function teleportThresholdSq(maxCms: number, tickMs: number,
                             minCm: number): number {
  const d = Math.max(minCm, maxCms * (tickMs / 1000) * TELEPORT_SAFETY);
  return d * d;
}

function isTeleport(a: Vec3, b: Vec3, thresholdSq: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  return (dx * dx + dy * dy) > thresholdSq;
}

// Smooth each turret's traverse yaw between ticks. Turrets are matched by
// index (the backend emits VehicleTurrets in a stable order for a given
// vehicle). lerpAngle takes the shortest arc, so a turret sweeping past ±180°
// still animates the short way. Missing prev/cur yaw → keep the current value.
function lerpTurrets(prev: VehicleTurret[] | undefined,
                     cur: VehicleTurret[] | undefined,
                     t: number): VehicleTurret[] | undefined {
  if (!cur || !prev) return cur;
  return cur.map((ct, i) => {
    const pt = prev[i];
    if (!pt || ct.yaw == null || pt.yaw == null) return ct;
    return { ...ct, yaw: lerpAngle(pt.yaw, ct.yaw, t) };
  });
}

function indexBy<T, K>(arr: T[] | undefined | null, key: (e: T) => K | null | undefined): Map<K, T> {
  const m = new Map<K, T>();
  if (!arr) return m;
  for (const e of arr) {
    const k = key(e);
    if (k != null) m.set(k, e);
  }
  return m;
}

// The prev→cur pair is stable for the whole span between two frames — the render
// clock only crosses a frame boundary every ~2s, but lerpSnap runs at 60fps, so
// the four lookup Maps below (built purely from `prev`) were being rebuilt ~120×
// per frame pair for nothing. They're read-only, so cache them by `prev` object
// identity and rebuild only when the pair actually advances.
interface PrevMaps {
  players: Map<string | null, Player>;
  vehicles: Map<string, Vehicle>;
  projectiles: Map<string, Projectile>;
  caps: Map<string, CaptureZone>;
}
let cachedPrev: Snapshot | null = null;
let cachedMaps: PrevMaps | null = null;

function prevMaps(prev: Snapshot): PrevMaps {
  if (cachedPrev === prev && cachedMaps) return cachedMaps;
  cachedMaps = {
    players: indexBy<Player, string | null>(prev.players, (p) => p.eosId ?? p.name),
    vehicles: indexBy<Vehicle, string>(prev.vehicles, (v) => v.id),
    projectiles: indexBy<Projectile, string>(prev.projectiles, (p) => p.id),
    caps: indexBy<CaptureZone, string>(prev.captureZones, (c) => c.id),
  };
  cachedPrev = prev;
  return cachedMaps;
}

export function lerpSnap(prev: Snapshot | null, cur: Snapshot | null,
                         alpha: number, tickMs: number = 500): Snapshot | null {
  if (!cur) return null;
  if (!prev || !(alpha > 0)) return cur;
  const t = Math.min(1, alpha);
  // Per-entity-class teleport thresholds, scaled to the measured tick
  // interval. Floors keep the guard sane if tickMs is momentarily tiny.
  const soldierThrSq = teleportThresholdSq(SOLDIER_MAX_CMS, tickMs, 3_000);
  const vehicleThrSq = teleportThresholdSq(VEHICLE_MAX_CMS, tickMs, 6_000);

  const { players: prevPlayers, vehicles: prevVehicles,
          projectiles: prevProjectiles, caps: prevCaps } = prevMaps(prev);

  const players = (cur.players ?? []).map((c) => {
    const p = prevPlayers.get(c.eosId ?? c.name);
    if (!p) return c;
    const cs = c.soldier, ps = p.soldier;
    if (!cs || !ps || !cs.position || !ps.position) return c;
    // Respawn / teleport guard. Two independent signals:
    //   (a) soldier.addr changed → backend allocated a new pawn for
    //       this player (death + respawn, same EOS id)
    //   (b) position jump > TELEPORT_SQ_THRESHOLD (50m) over one
    //       tick → impossible under normal locomotion
    // Either fires → snap to current position instead of lerping
    // across the map, which would draw the "sliding corpse" the
    // user reported.
    //
    // A soldier riding a vehicle moves at VEHICLE speed, which at a slow
    // (0.5 Hz) tick easily exceeds the on-foot teleport threshold — that
    // made lerpSnap snap the mounted soldier's position every tick, so
    // the SL→marker command lines (which use the soldier position) jerked
    // even though the vehicle icon glided. Use the vehicle threshold when
    // the soldier is attached so those positions lerp smoothly too.
    const thr = cs.attached ? vehicleThrSq : soldierThrSq;
    if (cs.addr !== ps.addr || isTeleport(ps.position, cs.position, thr)) {
      return c;
    }
    return {
      ...c,
      soldier: {
        ...cs,
        position: lerpPos(ps.position, cs.position, t),
        yaw: lerpAngle(ps.yaw, cs.yaw, t),
      },
    };
  });

  const vehicles = (cur.vehicles ?? []).map((c) => {
    const p = prevVehicles.get(c.id);
    if (!p || !p.position || !c.position) return c;
    // Same teleport guard for vehicles — covers destroy + spawn from
    // depot (same vehicle id is rare but radial teleport from rejoin
    // physics ticks happens occasionally).
    if (isTeleport(p.position, c.position, vehicleThrSq)) return c;
    return {
      ...c,
      position: lerpPos(p.position, c.position, t),
      yaw: lerpAngle(p.yaw, c.yaw, t),
      // Interpolate each turret's traverse yaw too, so the turret icon
      // glides to its new facing instead of snapping every ~2s tick.
      turrets: lerpTurrets(p.turrets, c.turrets, t),
    };
  });

  const projectiles = (cur.projectiles ?? []).map((c) => {
    const p = prevProjectiles.get(c.id);
    if (!p || !p.position || !c.position) return c;
    // Projectiles can legitimately travel >50m/tick (mortar, rocket,
    // tank shell). The mortar-tracker module owns its own jump
    // detection on top of lerped positions, so it's safe to lerp
    // here unconditionally — too-fast-to-track projectiles will just
    // appear as a streak.
    return { ...c, position: lerpPos(p.position, c.position, t) };
  });

  const captureZones = (cur.captureZones ?? []).map((c) => {
    const p = prevCaps.get(c.id);
    if (!p) return c;
    return {
      ...c,
      capturePercent: (c.capturePercent != null && p.capturePercent != null)
        ? lerp(p.capturePercent, c.capturePercent, t)
        : c.capturePercent,
    };
  });

  return {
    ...cur,
    players, vehicles, projectiles, captureZones,
  };
}
