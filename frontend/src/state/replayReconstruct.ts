// Two-tier replay reconstruction (load-time).
//
// A two-tier .sqrx interleaves ~1 Hz full rich Snapshots with 4 Hz compact
// `{"t":"pos",...}` position frames. This module folds them back into a single
// increasing `Snapshot[]` at load time: each position frame becomes a full
// Snapshot by carrying the *last full frame's discrete state forward by
// reference* and splicing in the fresh positions/health. The existing render
// path (MapCanvas frame interpolation) then plays it as smooth 4 Hz movement
// with zero changes — all the work is here.
//
// Heap: only `players` / `vehicles` get new arrays (with shallow-cloned entries
// for the ones that moved); every other array (markers, deployables, zones,
// projectiles, …) is shared by reference with the base full frame, so a
// position frame costs ~its moved entities, not a full-snapshot clone.

import type {
  PositionFrame,
  PositionPlayer,
  PositionVehicle,
  Snapshot,
} from "./types";

// A parsed .sqrx line is either a full Snapshot or a compact position frame.
export type RecordingLine = Snapshot | PositionFrame;

export function isPositionFrame(line: RecordingLine): line is PositionFrame {
  return (line as PositionFrame).t === "pos";
}

// The identity a position frame's `id` matches against — must mirror the
// agent-side key (possample.py: eosId else name) and interpolation.ts.
function playerKey(p: { eosId: string | null; name: string | null }): string | null {
  return p.eosId ?? p.name;
}

// Build one full Snapshot from a position frame + the last full frame.
export function reconstructFromPosition(
  base: Snapshot,
  pos: PositionFrame,
): Snapshot {
  const pByKey = new Map<string, PositionPlayer>();
  for (const p of pos.players) pByKey.set(p.id, p);
  const vById = new Map<string, PositionVehicle>();
  for (const v of pos.vehicles) vById.set(v.id, v);

  // Splice fresh positions onto the base roster. A player/vehicle absent from
  // the position frame (dead / not sampled this slot) carries its last full
  // position — no blink; the next full frame (<=1 s) corrects the roster.
  const players = base.players.map((p) => {
    const key = playerKey(p);
    const u = key != null ? pByKey.get(key) : undefined;
    if (!u || !p.soldier) return p;
    return {
      ...p,
      soldier: {
        ...p.soldier,
        position: { x: u.x, y: u.y, z: u.z ?? p.soldier.position?.z ?? null },
        health: u.h ?? p.soldier.health,
        yaw: u.yaw ?? p.soldier.yaw,
      },
    };
  });

  const vehicles = base.vehicles.map((v) => {
    const u = vById.get(v.id);
    if (!u) return v;
    return {
      ...v,
      position: { x: u.x, y: u.y, z: v.position?.z ?? null },
      health: u.h ?? v.health,
      yaw: u.yaw ?? v.yaw,
      team: u.team ?? v.team,
    };
  });

  return {
    ...base, // shares gameState/teams/squads/zones/markers/deployables/… by ref
    timestamp: pos.timestamp,
    tick: pos.tick ?? base.tick,
    players,
    vehicles,
    // Kills are per-tick deltas already delivered on the full frame that
    // precedes these position frames; re-emitting them here would double-count
    // in the kill feed. Empty is correct — no new kills in a position frame.
    damageEvents: [],
  };
}

// Stateful reducer that turns the raw line stream into the reconstructed
// Snapshot[]. Feed lines in order; a position frame before the first full
// frame is dropped (nothing to carry). Returns the produced snapshot (or null
// when the line was dropped) so callers can count progress.
export class ReplayReconstructor {
  private lastFull: Snapshot | null = null;

  push(line: RecordingLine): Snapshot | null {
    if (isPositionFrame(line)) {
      if (!this.lastFull) return null;
      return reconstructFromPosition(this.lastFull, line);
    }
    this.lastFull = line;
    return line;
  }
}
