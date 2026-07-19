// Standalone unit test for the ticket-timeline attribution. Bundled with
// esbuild and run under node — no test framework needed.
import { computeTicketAnalysis } from "./ticketTimeline.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}
function eq(a: any, b: any, msg: string) {
  ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}

const BASE = 1700000000000;
function frame(i: number, t1: number | null, t2: number | null, opts: any = {}): any {
  return {
    timestamp: new Date(BASE + i * 2000).toISOString(),
    gameState: { matchState: opts.state ?? "InProgress", elapsedSec: i * 2 },
    teams: [
      { id: 1, tickets: t1, deaths: opts.d1 ?? 0 },
      { id: 2, tickets: t2, deaths: opts.d2 ?? 0 },
    ],
    vehicles: opts.vehicles ?? [],
    deployables: opts.deployables ?? [],
    players: [],
  };
}
const alive = (id: string, kind: string, team: number) =>
  ({ id, classShort: `BP_${kind}_C`, kind, team, health: 100, maxHealth: 100 });
const dead = (v: any) => ({ ...v, health: -50 });

const sum = (evs: any[]) => evs.reduce((s, e) => s + e.amount, 0);
const gross = (arr: (number | null)[]) => {
  let g = 0;
  for (let i = 1; i < arr.length; i++) {
    const x = arr[i], y = arr[i - 1];
    if (x != null && y != null && x - y < 0) g += y - x;
  }
  return g;
};

// 1. Single frame — nothing to diff.
{
  const a = computeTicketAnalysis([frame(0, 200, 200)]);
  eq(a.t1.events.length, 0, "single frame emits no events");
}

// 2. Steady bleed — every drop is bleed, total exact.
{
  const a = computeTicketAnalysis([
    frame(0, 200, 200), frame(1, 199, 200), frame(2, 198, 200), frame(3, 197, 200),
  ]);
  eq(sum(a.t1.events), 3, "team1 lost 3 total");
  ok(a.t1.events.every((e) => e.cause === "bleed"), "all losses attributed to bleed");
  eq(a.t2.events.length, 0, "team2 lost nothing");
}

// 3. Vehicle destroyed (health crosses >0 -> <=0) explains a matching drop;
//    the claim is clamped to the ACTUAL tick delta, capped by the kind cost.
{
  const v = alive("v1", "MBT", 1);
  const a = computeTicketAnalysis([
    frame(0, 200, 200, { vehicles: [v] }),
    frame(1, 185, 200, { vehicles: [dead(v)] }),   // MBT dies, team1 drops 15
    frame(2, 185, 200, { vehicles: [] }),           // wreck despawns later (no cost)
  ]);
  const vEv = a.t1.events.filter((e) => e.cause === "vehicle");
  eq(vEv.length, 1, "one vehicle loss event");
  eq(vEv[0].amount, 15, "claims the actual 15-ticket drop (capped by MBT=20)");
  eq(sum(a.t1.events), 15, "team1 total loss = 15 (exact)");
}

// 4. A vehicle that vanished without ever crossing to <=0 = left range, not a kill.
{
  const a = computeTicketAnalysis([
    frame(0, 200, 200, { vehicles: [alive("v1", "MBT", 1)] }),
    frame(1, 185, 200, { vehicles: [] }),
  ]);
  eq(a.t1.events.filter((e) => e.cause === "vehicle").length, 0,
     "vanished-but-never-dead vehicle is NOT a kill");
  eq(sum(a.t1.events), 15, "loss still fully accounted (as bleed)");
}

// 5. Deaths counter explains a matching drop.
{
  const a = computeTicketAnalysis([
    frame(0, 200, 200, { d1: 0 }),
    frame(1, 197, 200, { d1: 3 }),
  ]);
  const dEv = a.t1.events.filter((e) => e.cause === "death");
  eq(dEv.length, 1, "one death event");
  eq(dEv[0].amount, 3, "3 deaths = 3 tickets");
  eq(dEv[0].label, "3 deaths", "plural label");
}

// 6. Rising tickets (flag cap gain) is never a loss.
{
  const a = computeTicketAnalysis([frame(0, 200, 200), frame(1, 210, 200)]);
  eq(a.t1.events.length, 0, "a ticket GAIN emits no loss event");
}

// 8. matchState gate — non-InProgress steps (end-of-round reset) are ignored.
{
  const a = computeTicketAnalysis([
    frame(0, 200, 200, { state: "WonTeam2" }),
    frame(1, 1, 200, { state: "WonTeam2" }),
  ]);
  eq(a.t1.events.length, 0, "reset outside InProgress is not billed");
}

// 9. Structural billed BEFORE deaths — a vehicle death tick isn't swallowed by
//    the death accumulator.
{
  const v = alive("v1", "APC", 1);
  const a = computeTicketAnalysis([
    frame(0, 200, 200, { d1: 0, vehicles: [v] }),
    frame(1, 188, 200, { d1: 2, vehicles: [dead(v)] }), // drop 12: APC(cap10)+2 deaths
  ]);
  eq(a.t1.breakdown.vehicle, 10, "vehicle takes its cap first (10)");
  eq(a.t1.breakdown.death, 2, "remaining 2 -> deaths");
  eq(sum(a.t1.events), 12, "exact total");
}

// 10. Sum invariant on a mixed match: Σ(event amounts) === gross loss per team.
{
  const apc = alive("v1", "APC", 1);
  const cobra = alive("v2", "Scout", 2);
  const frames = [
    frame(0, 300, 300, { d1: 0, d2: 0, vehicles: [apc, cobra] }),
    frame(1, 297, 300, { d1: 3, vehicles: [apc, cobra] }),                    // 3 t1 deaths
    frame(2, 287, 300, { d1: 3, vehicles: [dead(apc), cobra] }),              // APC dies (t1)
    frame(3, 285, 292, { d1: 3, d2: 4, vehicles: [dead(apc), cobra] }),       // t2 deaths
    frame(4, 285, 284, { d1: 3, d2: 4, vehicles: [dead(apc), dead(cobra)] }), // Cobra dies (t2)
    frame(5, 295, 279, { d1: 3, d2: 4, vehicles: [] }),                       // t1 gain (ignored)
  ];
  const a = computeTicketAnalysis(frames);
  eq(sum(a.t1.events), gross(a.t1.tickets), "team1: Σ events === gross loss (exact)");
  eq(sum(a.t2.events), gross(a.t2.tickets), "team2: Σ events === gross loss (exact)");
  eq(a.t1.breakdown.total, sum(a.t1.events), "breakdown total matches events");
  ok(a.t1.breakdown.vehicle > 0, "team1 has a vehicle loss");
  ok(a.t2.breakdown.vehicle > 0, "team2 has a vehicle loss");
}

console.log(`\nticket timeline tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
