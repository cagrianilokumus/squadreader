// Standalone unit test for RAAS cap-zone visibility (fog of war). Bundled with
// esbuild and run under node — no test framework needed.
import {
  isMainZone, capInPlay, isPreRollCloud, capVisible, visibleCaps,
} from "./capVisibility.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}
function eq(a: any, b: any, msg: string) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

// Zone factory. Defaults = a dormant RAAS candidate (locked, neutral, 0%).
// Non-nullish overrides pass through; pass explicit nulls inline (not here).
function cz(o: any = {}): any {
  return {
    name: o.name ?? "A1-Something",
    flagName: o.flagName ?? "Something",
    isLocked: o.isLocked ?? true,
    owningTeam: o.owningTeam ?? 0,
    capturingTeam: o.capturingTeam ?? 0,
    capturePercent: o.capturePercent ?? 0,
    position: o.position ?? { x: 0, y: 0 },
    staticPosition: o.staticPosition ?? null,
  };
}

// --- isMainZone ---
ok(isMainZone(cz({ name: "00-Team1Main" })), "name ending Main is a main");
ok(isMainZone(cz({ name: null, flagName: "Team2 Main" })), "flagName ending Main is a main");
ok(!isMainZone(cz({ name: "A1-Shamal", flagName: "Shamal" })), "regular objective is not a main");

// --- capInPlay ---
ok(!capInPlay(cz()), "locked+neutral+0% is dormant (not in play)");
ok(capInPlay(cz({ isLocked: false })), "unlocked is in play");
ok(capInPlay(cz({ owningTeam: 1 })), "owned by a team is in play (even if locked)");
ok(capInPlay(cz({ capturingTeam: 2 })), "being captured is in play");
ok(capInPlay(cz({ capturePercent: 0.4 })), "partial capture is in play");
ok(capInPlay({ isLocked: null, owningTeam: null, capturingTeam: null, capturePercent: null } as any),
   "missing lock data fails open (treated as in play)");

// --- capVisible (given a cloud flag) ---
ok(capVisible(cz(), false), "dormant shown when NOT a cloud (resolved-lane upcoming flag)");
ok(!capVisible(cz(), true), "dormant hidden during the cloud");
ok(capVisible(cz({ name: "X-Team1Main" }), true), "main always shown, even during the cloud");
ok(capVisible(cz({ owningTeam: 1 }), true), "owned always shown, even during the cloud");

// --- isPreRollCloud: size + duplicate tiebreak ---
{
  const many = Array.from({ length: 40 }, (_, i) =>
    cz({ name: `L${i}-Obj`, position: { x: i * 10000, y: 0 } }));
  ok(isPreRollCloud(many), "40 dormant candidates = pre-roll cloud (by size)");
}
{
  const few = Array.from({ length: 5 }, (_, i) =>
    cz({ name: `B${i}-Obj`, flagName: `Obj${i}`, position: { x: i * 10000, y: 0 } }));
  ok(!isPreRollCloud(few), "5 dormant at unique spots = resolved lane, not a cloud");
}
{
  // small-map cloud: 6 dormant but the same objective replicated at one spot
  const dup = Array.from({ length: 6 }, (_, i) =>
    cz({ name: `L${i}-Shamal`, position: { x: 500, y: 500 } }));
  ok(isPreRollCloud(dup), "duplicate positions among mid-count dormant = cloud");
}
ok(!isPreRollCloud([]), "no zones = no cloud");
ok(!isPreRollCloud([cz({ name: "M-Team1Main", isLocked: false, owningTeam: 1 })]),
   "just a main = no cloud");

// --- isPreRollCloud: lane-depth signal (small-map pre-roll under CLOUD_MIN) ---
{
  // Real Mestia RAAS pre-roll: 8 dormant total (< CLOUD_MIN 12), unique names +
  // positions (count/dup heuristics miss it), but depth "04" carries 4 lanes.
  const preRoll = [
    cz({ name: "01-Quarry", position: { x: 39438, y: -39931 } }),
    cz({ name: "02-CrucibleGamma", position: { x: 28854, y: 561 } }),
    cz({ name: "02-TunnelEntrance", position: { x: 32590, y: 24278 } }),
    cz({ name: "04-CrucibleAlpha", position: { x: 10836, y: -2104 } }),
    cz({ name: "04-CrucibleBravo", position: { x: 8294, y: 15049 } }),
    cz({ name: "04-ShtugraWaterfall", position: { x: -12731, y: 37260 } }),
    cz({ name: "04-Warehouse", position: { x: -38961, y: 66551 } }),
    cz({ name: "05-Fortification", position: { x: -33693, y: -7902 } }),
  ];
  ok(isPreRollCloud(preRoll), "3+ dormant at one lane-depth = pre-roll (small map)");
}
{
  // Resolved lane that genuinely branches 2-way at one depth → NOT pre-roll.
  const resolved = [
    cz({ name: "01-Farmstead", owningTeam: 1, isLocked: false }),
    cz({ name: "02-TunnelEntrance", isLocked: false, capturePercent: 0.3 }),
    cz({ name: "04-CrucibleAlpha" }),
    cz({ name: "04-ShtugraWaterfall" }),      // 2-way branch, both dormant
    cz({ name: "05-Armory", isLocked: false, capturePercent: 0.9 }),
  ];
  ok(!isPreRollCloud(resolved), "<=2 dormant per depth (real branch) is not a cloud");
}

// --- visibleCaps end-to-end ---
{
  // 2 mains + 40 locked-neutral candidates → only the 2 mains survive
  const mains = [
    cz({ name: "00-Team1Main", isLocked: false, owningTeam: 1 }),
    cz({ name: "ZZ-Team2Main", isLocked: false, owningTeam: 2 }),
  ];
  const cloud = Array.from({ length: 40 }, (_, i) =>
    cz({ name: `L${i}-Obj`, position: { x: i * 10000, y: 0 } }));
  eq(visibleCaps([...mains, ...cloud]).length, 2,
     "pre-roll: only the 2 mains render; the 40-candidate cloud is hidden");
}
{
  // THE OLD BUG: one candidate unlocking must NOT un-hide the rest.
  const mains = [cz({ name: "00-Team1Main", isLocked: false, owningTeam: 1 })];
  const cloud = Array.from({ length: 40 }, (_, i) =>
    cz({ name: `L${i}-Obj`, position: { x: i * 10000, y: 0 } }));
  cloud[3].isLocked = false;  // first shared objective unlocks at ~0:06
  eq(visibleCaps([...mains, ...cloud]).length, 2,
     "one unlocked flag reveals only itself + main, not all 40 (laneDecided bug fixed)");
}
{
  // Resolved lane: 2 captured + 1 contested + 2 upcoming-locked → all 5 show.
  const lane = [
    cz({ name: "B1-A", flagName: "A", owningTeam: 1, capturePercent: 1 }),
    cz({ name: "B2-B", flagName: "B", owningTeam: 1, capturePercent: 1 }),
    cz({ name: "B3-C", flagName: "C", isLocked: false, capturePercent: 0.1 }),
    cz({ name: "B4-D", flagName: "D", position: { x: 40000, y: 0 } }),
    cz({ name: "B5-E", flagName: "E", position: { x: 50000, y: 0 } }),
  ];
  eq(visibleCaps(lane).length, 5,
     "resolved lane: captured + contested + upcoming-locked all visible");
}

console.log(`\ncap visibility tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
