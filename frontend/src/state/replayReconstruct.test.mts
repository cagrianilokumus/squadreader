// Standalone unit test for two-tier replay reconstruction. Bundled with
// esbuild + run under node — no framework (matches diff.test.mts).
import {
  ReplayReconstructor,
  reconstructFromPosition,
  isPositionFrame,
} from "./replayReconstruct.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}
function eq(a: any, b: any, msg: string) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

function player(eosId: string, name: string, x: number, y: number, h = 100): any {
  return {
    name, eosId, teamId: 1, roleId: null, stats: {},
    soldier: { addr: "0x1", position: { x, y, z: 5 }, health: h, yaw: 0 },
  };
}
function vehicle(id: string, x: number, y: number, h = 1000): any {
  return { id, team: 1, health: h, position: { x, y, z: 0 }, yaw: 0 };
}
function full(tick: number): any {
  return {
    timestamp: `2026-01-01T00:00:0${tick}+00:00`, tick,
    players: [player("eos-a", "Alice", 10, 20), player("eos-b", "Bob", 30, 40)],
    vehicles: [vehicle("0x3000", 50, 60)],
    markers: [{ kind: "attack" }],           // discrete state to check ref-share
    damageEvents: [{ killed: true }],
    gameState: { matchState: "InProgress" },
  };
}
function pos(tick: number, players: any[], vehicles: any[] = []): any {
  return { t: "pos", tick, timestamp: `2026-01-01T00:00:0${tick}.5+00:00`,
           fullTick: 1, players, vehicles };
}

// 1. isPositionFrame discriminates.
eq(isPositionFrame(pos(2, [])), true, "pos frame detected");
eq(isPositionFrame(full(1)), false, "full frame not a pos frame");

// 2. Full frame passes through unchanged.
{
  const r = new ReplayReconstructor();
  const f = full(1);
  eq(r.push(f), f, "full frame returned by identity");
}

// 3. Position frame before any full frame is dropped.
{
  const r = new ReplayReconstructor();
  eq(r.push(pos(1, [{ id: "eos-a", x: 1, y: 2 }])), null, "orphan pos dropped");
}

// 4. Reconstruction splices positions/health/yaw by key; carries discrete state.
{
  const base = full(1);
  const rec = reconstructFromPosition(
    base,
    pos(2, [{ id: "eos-a", x: 11, y: 21, h: 80, yaw: 90 }]),  // only Alice moved
    );
  eq(rec.players[0].soldier!.position!.x, 11, "Alice x spliced");
  eq(rec.players[0].soldier!.position!.y, 21, "Alice y spliced");
  eq(rec.players[0].soldier!.health, 80, "Alice health spliced");
  eq(rec.players[0].soldier!.yaw, 90, "Alice yaw spliced");
  // Bob absent from pos frame → carries last full position (no blink).
  eq(rec.players[1].soldier!.position!.x, 30, "Bob carries last x");
  eq(rec.players[1].soldier!.health, 100, "Bob carries last health");
  eq(rec.timestamp, "2026-01-01T00:00:02.5+00:00", "timestamp from pos frame");
  eq(rec.tick, 2, "tick from pos frame");
  eq(rec.damageEvents.length, 0, "damageEvents emptied (no double-count)");
  eq(rec.markers, base.markers, "markers shared by reference (no clone)");
  eq(rec.gameState, base.gameState, "gameState shared by reference");
}

// 5. Reconstruction never mutates the base full frame.
{
  const base = full(1);
  reconstructFromPosition(base, pos(2, [{ id: "eos-a", x: 99, y: 99, h: 1 }]));
  eq(base.players[0].soldier!.position!.x, 10, "base Alice x untouched");
  eq(base.players[0].soldier!.health, 100, "base Alice health untouched");
  eq(base.damageEvents.length, 1, "base damageEvents untouched");
}

// 6. Vehicle spliced by id; z preserved from base.
{
  const rec = reconstructFromPosition(
    full(1), pos(2, [], [{ id: "0x3000", x: 55, y: 65, h: 500, team: 2 }]));
  eq(rec.vehicles[0].position!.x, 55, "vehicle x spliced");
  eq(rec.vehicles[0].health, 500, "vehicle health spliced");
  eq(rec.vehicles[0].team, 2, "vehicle team spliced");
  eq(rec.vehicles[0].position!.z, 0, "vehicle z carried from base");
}

// 7. End-to-end stream: full, pos, pos, full → 4 increasing snapshots.
{
  const r = new ReplayReconstructor();
  const out: any[] = [];
  for (const line of [full(1),
                      pos(2, [{ id: "eos-a", x: 12, y: 22 }]),
                      pos(3, [{ id: "eos-a", x: 13, y: 23 }]),
                      full(4)]) {
    const s = r.push(line);
    if (s) out.push(s);
  }
  eq(out.length, 4, "4 snapshots reconstructed");
  eq(out[1].players[0].soldier!.position!.x, 12, "2nd frame Alice at 12");
  eq(out[2].players[0].soldier!.position!.x, 13, "3rd frame Alice at 13");
  eq(out[3].tick, 4, "4th frame is the new full frame");
}

console.log(`\nreplay reconstruct tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
