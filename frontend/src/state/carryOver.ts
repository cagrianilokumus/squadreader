// Last-known-state carry-over for live snapshots.
//
// The backend follows a strict no-guess policy: any field it cannot
// read on a given tick ships as null, and an entity it cannot see at
// all drops out of the arrays entirely. Transient /proc read failures
// (EIO during Squad GC, memory-pressure spikes) therefore surface on
// the map as players/vehicles blinking out for a tick or two and then
// popping back — the "players randomly disappear" report.
//
// This module patches each incoming live snapshot against a short
// memory of the last GOOD observation per entity:
//   - a player whose soldier is missing/stale/positionless gets its
//     last good soldier position (and, if the whole soldier read
//     failed, the full last good soldier block) for up to CARRY_TTL_MS
//   - a player missing from players[] entirely is re-injected from its
//     last good observation for up to CARRY_TTL_MS
//   - a vehicle with a null position gets its last good position;
//     a vehicle missing from vehicles[] is re-injected for a shorter
//     VEHICLE_CARRY_TTL_MS (destroyed vehicles legitimately leave)
//
// TTLs are short on purpose: a genuine leave/death stops producing
// good observations, so the carried ghost expires within seconds.
// Kill-feed logic is unaffected — it diffs stats.deaths counters, and
// carried entries keep their last counters (no fake transitions).
//
// All state lives at module level (not in React/zustand) because it
// is a pure data-repair step keyed by entity identity, not UI state.

import type { Player, Snapshot, Soldier, Vehicle } from "./types";

export const CARRY_TTL_MS = 5000;
export const VEHICLE_CARRY_TTL_MS = 3000;

interface PlayerMemory {
  player: Player;        // last observation with a good soldier
  lastGoodMs: number;
}

interface VehicleMemory {
  vehicle: Vehicle;      // last observation with a position
  lastGoodMs: number;
}

const playerMemo = new Map<string, PlayerMemory>();
const vehicleMemo = new Map<string, VehicleMemory>();

function playerKey(p: Player): string | null {
  return p.eosId ?? p.name;
}

function soldierIsGood(s: Soldier | null | undefined): s is Soldier {
  return !!(s && !s.stale && s.position);
}

// "Alive" = a good read AND health > 0. We only ever CARRY (bridge a
// failed read / re-inject a vanished player) for ALIVE players. A downed
// body (health <= 0) is shown by the renderer while its real soldier
// exists, but is NEVER carried: the moment its soldier read goes null
// (give-up / bleed-out) the player is dropped from the map immediately,
// which is the desired "gave up -> remove" behaviour. Downed bodies are
// still memoized (so a revive back to health>0 resumes carrying), just
// not eligible to be carried while down.
function soldierAlive(s: Soldier | null | undefined): s is Soldier {
  return soldierIsGood(s) && (s.health ?? 0) > 0;
}

/** Repair one soldier block from the last good observation. */
function carrySoldier(cur: Soldier | null, lastGood: Soldier): Soldier {
  if (!cur || cur.stale) {
    // Whole read failed (null pointer / freed-memory garbage) — the
    // current tick has nothing trustworthy, reuse the last good block
    // wholesale. addr stays the old one so the interpolator's
    // same-pawn check keeps lerping smoothly when the real data
    // returns.
    return { ...lastGood };
  }
  // Soldier read partially succeeded but position/yaw dropped out —
  // keep the fresh fields (health, stance, weapon), fill in motion
  // state from the last good tick.
  return {
    ...cur,
    position: cur.position ?? lastGood.position,
    yaw: cur.yaw ?? lastGood.yaw,
  };
}

/**
 * Patch a live snapshot in place of gaps, using (and updating) the
 * carry-over memory. Returns a new Snapshot object; never mutates the
 * input. Call once per incoming tick with a monotonic timestamp.
 */
export function patchSnapshot(snap: Snapshot, nowMs: number): Snapshot {
  // ---- players -----------------------------------------------------------
  const seenKeys = new Set<string>();
  const players: Player[] = [];
  for (const p of snap.players ?? []) {
    const key = playerKey(p);
    if (!key) { players.push(p); continue; }
    seenKeys.add(key);
    if (soldierIsGood(p.soldier)) {
      playerMemo.set(key, { player: p, lastGoodMs: nowMs });
      players.push(p);
      continue;
    }
    const memo = playerMemo.get(key);
    // Only bridge a failed read for a player who was ALIVE last we saw
    // them. If the memo is a downed body, a null read means they gave up
    // / bled out -> let them drop (push as-is, undrawn) instead of
    // resurrecting a corpse.
    if (memo && nowMs - memo.lastGoodMs < CARRY_TTL_MS
        && soldierAlive(memo.player.soldier)) {
      players.push({ ...p, soldier: carrySoldier(p.soldier, memo.player.soldier) });
    } else {
      players.push(p);
    }
  }
  // Players that vanished from the array entirely (transient scan gap):
  // re-inject ONLY if the last observation was alive — a downed body that
  // left the array has been cleaned up (gave up), so it should stay gone.
  for (const [key, memo] of playerMemo) {
    if (nowMs - memo.lastGoodMs >= CARRY_TTL_MS) {
      playerMemo.delete(key);
      continue;
    }
    if (!seenKeys.has(key) && soldierAlive(memo.player.soldier)) {
      players.push(memo.player);
    }
  }

  // ---- vehicles ----------------------------------------------------------
  const seenVehicles = new Set<string>();
  const vehicles: Vehicle[] = [];
  for (const v of snap.vehicles ?? []) {
    seenVehicles.add(v.id);
    if (v.position) {
      vehicleMemo.set(v.id, { vehicle: v, lastGoodMs: nowMs });
      vehicles.push(v);
      continue;
    }
    const memo = vehicleMemo.get(v.id);
    if (memo && nowMs - memo.lastGoodMs < VEHICLE_CARRY_TTL_MS) {
      vehicles.push({
        ...v,
        position: memo.vehicle.position,
        yaw: v.yaw ?? memo.vehicle.yaw,
      });
    } else {
      vehicles.push(v);
    }
  }
  for (const [id, memo] of vehicleMemo) {
    if (nowMs - memo.lastGoodMs >= VEHICLE_CARRY_TTL_MS) {
      vehicleMemo.delete(id);
      continue;
    }
    if (!seenVehicles.has(id)) vehicles.push(memo.vehicle);
  }

  return { ...snap, players, vehicles };
}

/** Drop all carried state (mode switch, map change, tests). */
export function resetCarryOver(): void {
  playerMemo.clear();
  vehicleMemo.clear();
}
