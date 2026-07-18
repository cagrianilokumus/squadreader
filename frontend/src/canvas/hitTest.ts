// Cursor → entity hit testing, in world coordinates so it scales with zoom.

import type { CaptureZone, Deployable, Marker, Player, Projectile,
  RallyPoint, Snapshot, Vec3, Vehicle, VehicleSpawner } from "../state/types";
import { visibleCaps } from "./capVisibility";

export type HitType =
  | "player" | "vehicle" | "deployable" | "spawner"
  | "marker" | "projectile" | "capzone" | "rally";

export type HitEntity =
  | { type: "player"; e: Player }
  | { type: "vehicle"; e: Vehicle }
  | { type: "deployable"; e: Deployable }
  | { type: "spawner"; e: VehicleSpawner }
  | { type: "marker"; e: Marker }
  | { type: "projectile"; e: Projectile }
  | { type: "capzone"; e: CaptureZone }
  | { type: "rally"; e: RallyPoint };

export interface Hit { d2: number; hit: HitEntity; }

export function hitTest(snap: Snapshot | null, wx: number, wy: number,
                        worldRadius: number): Hit | null {
  if (!snap) return null;
  const r2 = worldRadius * worldRadius;
  const czR2 = (worldRadius * 3) * (worldRadius * 3);
  let best: Hit | null = null;

  const consider = (hit: HitEntity, pos: Vec3 | null | undefined, hitR2: number) => {
    if (!pos) return;
    const dx = pos.x - wx, dy = pos.y - wy;
    const d2 = dx * dx + dy * dy;
    if (d2 > hitR2) return;
    if (best === null || d2 < best.d2) best = { d2, hit };
  };

  for (const p of snap.players ?? []) {
    // Skip mounted soldiers — the vehicle they're inside should win the hover.
    if (!p.soldier || p.soldier.stale || p.soldier.attached) continue;
    consider({ type: "player", e: p }, p.soldier.position, r2);
  }
  for (const pr of snap.projectiles ?? []) consider({ type: "projectile", e: pr }, pr.position, r2);
  for (const m of snap.markers ?? [])       consider({ type: "marker", e: m }, m.position, r2);
  for (const v of snap.vehicles ?? [])      consider({ type: "vehicle", e: v }, v.position, r2 * 1.5);
  for (const d of snap.deployables ?? [])   consider({ type: "deployable", e: d }, d.position, r2);
  for (const sp of snap.vehicleSpawners ?? []) consider({ type: "spawner", e: sp }, sp.position, r2);
  for (const rp of snap.rallyPoints ?? [])  consider({ type: "rally", e: rp }, rp.position, r2);
  // Only hover caps that are actually drawn (hidden pre-roll cloud excluded).
  for (const cz of visibleCaps(snap.captureZones ?? [])) consider({ type: "capzone", e: cz }, cz.position, czR2);
  return best;
}
