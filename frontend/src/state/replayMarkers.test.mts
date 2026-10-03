// Timeline markers: flags, vehicles, ticket collapses — and the property the
// progressive loader depends on, that chunked input gives the same answer as
// one pass.

import {
  CAP_CONFIRM_MS, SWING_THRESHOLD, clusterMarkers, createMarkerState, extendMarkers,
  findDuplicate, type ReplayMarker,
} from "./replayMarkers.ts";
import type { Snapshot } from "./types.ts";

let passed = 0, failed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else { failed++; console.error("FAIL:", msg); }
}

const T0 = Date.parse("2026-10-03T18:00:00Z");

interface F {
  zones?: [string, number][];
  t1?: number; t2?: number;
  veh?: { id: string; team: number; health: number; kind?: string; classShort?: string }[];
  state?: string;
}
function frame(sec: number, f: F = {}): Snapshot {
  return {
    timestamp: new Date(T0 + sec * 1000).toISOString(),
    gameState: { matchState: f.state ?? "InProgress" },
    teams: [{ id: 1, tickets: f.t1 ?? 250 }, { id: 2, tickets: f.t2 ?? 250 }],
    captureZones: (f.zones ?? []).map(([id, owner]) => ({
      id, name: `B1-${id}`, flagName: `Flag ${id}`, owningTeam: owner,
    })),
    vehicles: (f.veh ?? []).map((v) => ({ ...v })),
  } as unknown as Snapshot;
}

function run(frames: Snapshot[], chunks = 1): ReplayMarker[] {
  const st = createMarkerState();
  const out: ReplayMarker[] = [];
  const sink = (m: ReplayMarker) => {
    const dup = findDuplicate(out, m);
    if (dup) return dup;
    out.push(m);
    return m;
  };
  const step = Math.max(1, Math.ceil(frames.length / chunks));
  for (let end = step; ; end += step) {
    extendMarkers(st, frames.slice(0, Math.min(end, frames.length)), sink);
    if (end >= frames.length) break;
  }
  return out;
}

// --- flags -------------------------------------------------------------------
{
  // A neutral flag taken by team 1 at t=10 and held.
  const fr = [0, 2, 4, 6, 8].map((s) => frame(s, { zones: [["a", 0]] }))
    .concat([10, 12, 14].map((s) => frame(s, { zones: [["a", 1]] })));
  const m = run(fr).filter((x) => x.kind === "cap");
  ok(m.length === 1, "one capture");
  ok(m[0]?.capture === "taken" && m[0]?.team === 1, "taken by team 1");
  ok(m[0]?.tMs === T0 + 10_000, "placed where the new owner first appears, not where it was confirmed");
  ok(m[0]?.subject === "Flag a", "named the way the game names it");
}
{
  // Team 2 loses a flag to neutral: marked as LOST, in team 2's colour.
  const fr = [0, 2].map((s) => frame(s, { zones: [["a", 2]] }))
    .concat([4, 6, 8].map((s) => frame(s, { zones: [["a", 0]] })));
  const m = run(fr).filter((x) => x.kind === "cap");
  ok(m.length === 1 && m[0]?.capture === "lost" && m[0]?.team === 2, "neutralised = lost by the old owner");
}
{
  // One frame of a different owner, then back: a torn read, not a capture.
  const fr = [frame(0, { zones: [["a", 0]] }), frame(2, { zones: [["a", 1]] }),
              frame(2 + CAP_CONFIRM_MS / 1000 - 1, { zones: [["a", 0]] }),
              frame(8, { zones: [["a", 0]] })];
  ok(run(fr).filter((x) => x.kind === "cap").length === 0, "a blip shorter than the confirm window is ignored");
  const garbage = [frame(0, { zones: [["a", 0]] }), frame(2, { zones: [["a", 7]] }),
                   frame(4, { zones: [["a", 7]] }), frame(6, { zones: [["a", 7]] })];
  ok(run(garbage).filter((x) => x.kind === "cap").length === 0, "an owner that is not 0/1/2 is never a capture");
}
{
  // A RAAS lane revealing its next flag already owned is not a capture.
  const fr = [frame(0, { zones: [["a", 1]] }),
              frame(2, { zones: [["a", 1], ["b", 2]] }),
              frame(4, { zones: [["a", 1], ["b", 2]] })];
  ok(run(fr).length === 0, "first sight of a zone is not a moment");
}
{
  // Outside a running match nothing counts — a round reset is not a capture.
  const fr = [frame(0, { zones: [["a", 1]] }),
              frame(2, { zones: [["a", 0]], state: "WaitingPostMatch" }),
              frame(4, { zones: [["a", 0]], state: "WaitingPostMatch" })];
  ok(run(fr).length === 0, "post-match changes are ignored");
}

// --- vehicles ----------------------------------------------------------------
{
  const v = (h: number, team = 2) => [{ id: "v1", team, health: h, kind: "MBT", classShort: "BP_T72B3_C" }];
  const fr = [frame(0, { veh: v(800) }), frame(2, { veh: v(300) }),
              frame(4, { veh: v(0) }), frame(6, { veh: v(0) })];
  const m = run(fr).filter((x) => x.kind === "vehicle");
  ok(m.length === 1, "one destruction, not one per wreck frame");
  ok(m[0]?.tMs === T0 + 4000 && m[0]?.team === 2, "at the crossing, against the team that lost it");
  ok(m[0]?.amount === 20 && m[0]?.weight === 1, "an MBT is priced and drawn as an MBT");
  const noTeam = [frame(0, { veh: v(500, 0) }), frame(2, { veh: v(0, 0) })];
  ok(run(noTeam).length === 0, "a vehicle with no team is skipped");
}

// --- ticket collapses --------------------------------------------------------
{
  // Team 1 bleeds 1 ticket every 5 s: 12 a minute, never a collapse.
  const fr: Snapshot[] = [];
  for (let s = 0, t = 250; s <= 600; s += 5, t--) fr.push(frame(s, { t1: t }));
  ok(run(fr).length === 0, "a steady bleed is not a collapse");
}
{
  // Team 2 loses 30 tickets between t=100 and t=130, then 20 more by t=150.
  const fr: Snapshot[] = [];
  let t2 = 250;
  for (let s = 0; s <= 300; s += 2) {
    if (s > 100 && s <= 130) t2 -= 2;
    if (s > 130 && s <= 150) t2 -= 2;
    fr.push(frame(s, { t2 }));
  }
  const m = run(fr).filter((x) => x.kind === "tickets");
  ok(m.length === 1, `one collapse, not one per frame over the line (got ${m.length})`);
  ok(m[0]?.team === 2 && m[0]?.tMs === T0 + 102_000, "placed where the losing began");
  ok((m[0]?.amount ?? 0) >= 50, `reports how bad it got (${m[0]?.amount}), not the ${SWING_THRESHOLD} it crossed at`);
}

// --- chunked == one pass -----------------------------------------------------
{
  // A long synthetic match with everything in it, fed whole and in pieces.
  const fr: Snapshot[] = [];
  let t1 = 250, t2 = 250;
  for (let s = 0; s <= 1200; s += 2) {
    const zones: [string, number][] = [["a", s < 300 ? 0 : 1], ["b", s < 700 ? 2 : 0]];
    if (s > 400 && s <= 440) t1 -= 2;   // 40 in 40 s: over the line
    if (s > 900 && s <= 930) t2 -= 2;
    const veh = [{ id: "v1", team: 1, health: s < 500 ? 900 : 0, kind: "Heavy IFV" }];
    fr.push(frame(s, { zones, t1, t2, veh }));
  }
  const one = JSON.stringify(run(fr, 1));
  ok(JSON.parse(one).length === 5, `the long match has its five moments (${JSON.parse(one).length})`);
  for (const chunks of [2, 7, 33, fr.length]) {
    ok(JSON.stringify(run(fr, chunks)) === one, `${chunks} chunks give the same markers as one pass`);
  }
}

// --- drawing: overlapping moments become one clickable spot -------------------
{
  const mk = (kind: ReplayMarker["kind"], sec: number, weight = 0.5): ReplayMarker =>
    ({ key: `${kind}${sec}`, kind, tMs: T0 + sec * 1000, team: 1, subject: kind, weight });
  // 1 px per second, so the gap below is easy to reason about.
  const px = (t: number) => (t - T0) / 1000;
  // Two flags in the same second (a RAAS opening), a vehicle 5 s later, and a
  // vehicle far away.
  const c = clusterMarkers([mk("vehicle", 105, 1), mk("cap", 100), mk("cap", 100), mk("vehicle", 400)],
                           px, 12);
  ok(c.length === 2, `simultaneous moments share a spot, distant ones do not (${c.length})`);
  ok(c[0]!.members.length === 3, "every moment in the spot is kept for the tooltip");
  ok(c[0]!.lead.kind === "cap", "a flag outranks a vehicle for the glyph, however heavy the vehicle");
  ok(c[0]!.members[0]!.tMs <= c[0]!.members[2]!.tMs, "members are in time order");
  ok(c[0]!.px === 100, "the spot sits at its earliest moment");
  const again = clusterMarkers([mk("cap", 100), mk("cap", 100), mk("vehicle", 105, 1), mk("vehicle", 400)], px, 12);
  ok(again[0]!.key === c[0]!.key, "the same members give the same React key in any input order");
  ok(clusterMarkers([], px, 12).length === 0, "no markers, no spots");
}

console.log(`replay markers: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
