// A recording with no `layer` block is framed from its entities. One garbage
// read by the recorder — a projectile at x ≈ 5e151 — used to stretch that frame
// to ~1e151, and drawGrid then looped forever. Framework-free, as the tests
// beside it are.
import { autoFit } from "./worldToScreen.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}

// --- garbage positions do not widen the entity fallback ---------------------
{
  const snap = {
    gameState: {},
    players: [{ soldier: { position: { x: 1000, y: 2000 } } }],
    vehicles: [{ position: { x: -3000, y: 500 } }],
    projectiles: [
      { position: { x: 4.9851259298819877e+151, y: 0 } },
      { position: { x: NaN, y: 0 } },
    ],
  } as any;
  const v = autoFit(snap, { width: 1000, height: 1000 });
  ok(v.minX >= -10000 && v.maxX <= 10000, `minX..maxX within ±10000 (got ${v.minX}..${v.maxX})`);
  ok(Number.isFinite(v.minY) && Number.isFinite(v.maxY), `minY/maxY finite (got ${v.minY}..${v.maxY})`);
}

console.log(`worldToScreen: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
