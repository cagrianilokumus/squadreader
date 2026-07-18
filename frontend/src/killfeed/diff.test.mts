// Standalone unit test for the event-first kill-feed diff. Bundled with
// esbuild and run under node — no test framework needed.
import { createDiffState, diffSnapshot } from "./diff.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}
function eq(a: any, b: any, msg: string) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); }

function P(name: string, eosId: string, team: number, kills: number, deaths: number, weapon?: string): any {
  return {
    name, eosId, teamId: team, roleId: null,
    stats: { kills, deaths },
    soldier: weapon ? { weapon: { className: weapon, name: weapon } } : null,
  };
}
function snap(players: any[], events: any[] = [], tick = 1): any {
  return { tick, players, damageEvents: events, gameState: { elapsedSec: 100 }, vehicles: [] };
}
function evt(o: any): any {
  return { victim: null, victimEosId: null, victimTeam: null, attacker: null,
           selfInflicted: null, killed: false, wounded: false, ts: null, ...o };
}

// 1. First snapshot only seeds — emits nothing even with nonzero counters.
{
  const s = createDiffState();
  const r = diffSnapshot(s, snap([P("A","a",1,3,0), P("B","b",2,0,2)]));
  eq(r.newEntries.length, 0, "seed tick emits nothing");
}

// 2. Exact kill from a killed event.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)]));
  const r = diffSnapshot(s, snap(
    [P("A","a",1,1,0), P("B","b",2,0,1)],
    [evt({ killed: true, attacker: "A", victim: "B", victimEosId: "b", victimTeam: 2, headshot: true })],
  ));
  eq(r.newEntries.length, 1, "one kill row");
  const e = r.newEntries[0];
  eq(e.killer, "A", "killer A");
  eq(e.victim, "B", "victim B");
  eq(e.headshot, true, "headshot carried");
  eq(e.wounded, false, "not a wounded row");
}

// 2b. Tier-4: a killer gunning a vehicle turret is attributed the TURRET
// weapon, not the infantry rifle they still have holstered (tier 3 skipped).
{
  const veh = (occ: string) => ({
    id: "v1", classShort: "BP_T62", team: 1,
    seats: [{ idx: 0, occupantName: occ }],
    turrets: [{ className: "BP_T62_Turret_C", name: "BP_T62_Turret_C_1" }],
  });
  const withVeh = (players: any[], events: any[], tick: number): any => ({
    tick, players, damageEvents: events,
    gameState: { elapsedSec: 100 + tick }, vehicles: [veh("Gunner")],
  });
  const s = createDiffState();
  diffSnapshot(s, withVeh([P("Gunner", "g", 1, 0, 0, "BP_AK74_C"), P("V", "v", 2, 0, 0)], [], 1));
  const r = diffSnapshot(s, withVeh(
    [P("Gunner", "g", 1, 1, 0, "BP_AK74_C"), P("V", "v", 2, 0, 1)],
    [evt({ killed: true, attacker: "Gunner", victim: "V", victimEosId: "v", victimTeam: 2 })],
    2,
  ));
  eq(r.newEntries.length, 1, "one turret kill row");
  eq(r.newEntries[0].weaponClass, "BP_T62_Turret_C", "tier-4 turret weapon (not the AK)");
  eq(r.newEntries[0].killerVehicleClass, "BP_T62", "killer vehicle class carried");
}

// 3. KEY: two kills in the same tick attribute correctly, never cross-paired.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0),P("B","b",2,0,0),P("C","c",1,0,0),P("D","d",2,0,0)]));
  const r = diffSnapshot(s, snap(
    [P("A","a",1,1,0),P("B","b",2,0,1),P("C","c",1,1,0),P("D","d",2,0,1)],
    [evt({ killed:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2 }),
     evt({ killed:true, attacker:"C", victim:"D", victimEosId:"d", victimTeam:2 })],
  ));
  eq(r.newEntries.length, 2, "two rows for two deaths");
  const byV: any = {};
  for (const e of r.newEntries) byV[e.victim] = e.killer;
  eq(byV["B"], "A", "B killed by A (not cross-paired)");
  eq(byV["D"], "C", "D killed by C (not cross-paired)");
}

// 4. Death with no event -> honest "died", no invented killer.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("B","b",2,0,0)]));
  const r = diffSnapshot(s, snap([P("B","b",2,0,1)], []));
  eq(r.newEntries.length, 1, "one died row");
  eq(r.newEntries[0].killer, null, "no killer invented");
  eq(r.newEntries[0].victim, "B", "victim B");
}

// 5. World cause pulled from an event's damageType on an unattributed death.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("B","b",2,0,0)]));
  const r = diffSnapshot(s, snap([P("B","b",2,0,1)],
    [evt({ victim:"B", victimEosId:"b", damageType:"BP_Fall_C" })]));
  eq(r.newEntries.length, 1, "one row");
  eq(r.newEntries[0].killer, null, "world cause has no killer");
  eq(r.newEntries[0].damageType, "BP_Fall_C", "damageType carried onto died row");
}

// 6. Same-name players are kept apart by eosId.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("Foo","id1",1,0,0), P("Foo","id2",2,0,0)]));
  // Only id2's Foo dies.
  const r = diffSnapshot(s, snap(
    [P("Foo","id1",1,0,0), P("Foo","id2",2,0,1)],
    [evt({ killed:true, attacker:"X", victim:"Foo", victimEosId:"id2", victimTeam:2 })],
  ));
  eq(r.newEntries.length, 1, "exactly one death detected despite name clash");
}

// 7. Suicide via selfInflicted.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("B","b",2,0,0)]));
  const r = diffSnapshot(s, snap([P("B","b",2,0,1)],
    [evt({ killed:true, attacker:"B", victim:"B", victimEosId:"b", victimTeam:2, selfInflicted:true })]));
  eq(r.newEntries.length, 1, "one row");
  eq(r.newEntries[0].suicide, true, "suicide flagged");
  eq(r.newEntries[0].killer, null, "suicide has null killer");
}

// 8. weaponApprox true when the weapon only comes from the sticky cache.
{
  const s = createDiffState();
  // Seed: A holding a rifle (populates the sticky cache) — tick 1.
  diffSnapshot(s, snap([P("A","a",1,0,0,"BP_AK74_C"), P("B","b",2,0,0)]));
  // Tick 2: A kills B, but A's soldier weapon is gone from the snapshot
  // and the event carries no causerWeapon → only the cache resolves it.
  const r = diffSnapshot(s, snap(
    [P("A","a",1,1,0), P("B","b",2,0,1)],
    [evt({ killed:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2 })],
  ));
  eq(r.newEntries.length, 1, "one row");
  eq(r.newEntries[0].weaponClass, "BP_AK74_C", "weapon from sticky cache");
  eq(r.newEntries[0].weaponApprox, true, "weapon flagged approximate");
}

// 9. A re-emitted killed event across ticks does not double-count.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)]));
  const ev = evt({ killed:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2, ts: 42 });
  const r1 = diffSnapshot(s, snap([P("A","a",1,1,0), P("B","b",2,0,1)], [ev]));
  // Same event still present next tick, but no new death increment.
  const r2 = diffSnapshot(s, snap([P("A","a",1,1,0), P("B","b",2,0,1)], [ev]));
  eq(r1.newEntries.length, 1, "kill counted once");
  eq(r2.newEntries.length, 0, "re-emitted event not double-counted");
}

// 10. REALISTIC: a wounded event attributes the death that follows it a
//     few ticks later (Squad's incap -> bleed-out; no killed event fires).
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)]));
  // Tick 2: A incapacitates B — NO row (incaps aren't surfaced), B alive.
  const r1 = diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)],
    [evt({ wounded:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2 })]));
  // Tick 3: no new events, B bleeds out (death counter rises).
  const r2 = diffSnapshot(s, snap([P("A","a",1,1,0), P("B","b",2,0,1)], []));
  eq(r1.newEntries.length, 0, "incap emits no row (kills only)");
  eq(r2.newEntries.length, 1, "death row emitted on bleed-out");
  eq(r2.newEntries[0].killer, "A", "death attributed to the wounder A");
  eq(r2.newEntries[0].wounded, false, "the death row is a kill, not wounded");
}

// 11. A wounded player who never dies (revived) yields no row at all.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)]));
  const r1 = diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)],
    [evt({ wounded:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2 })]));
  const r2 = diffSnapshot(s, snap([P("A","a",1,0,0), P("B","b",2,0,0)], []));
  eq(r1.newEntries.length, 0, "incap emits no row");
  eq(r2.newEntries.length, 0, "no kill row when the victim never dies");
}

// 12. Most-recent attacker wins: A wounds B, then C wounds B, then B dies.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0),P("B","b",2,0,0),P("C","c",1,0,0)]));
  diffSnapshot(s, snap([P("A","a",1,0,0),P("B","b",2,0,0),P("C","c",1,0,0)],
    [evt({ wounded:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2 })]));
  diffSnapshot(s, snap([P("A","a",1,0,0),P("B","b",2,0,0),P("C","c",1,0,0)],
    [evt({ wounded:true, attacker:"C", victim:"B", victimEosId:"b", victimTeam:2 })]));
  const r = diffSnapshot(s, snap([P("A","a",1,0,0),P("B","b",2,0,1),P("C","c",1,1,0)], []));
  eq(r.newEntries.length, 1, "one death row");
  eq(r.newEntries[0].killer, "C", "attributed to the most recent wounder C");
}

// 13. Round/map transition: a burst of death-counter bumps with zero damage
//     events on a collapsed roster (everyone despawned) emits nothing — no
//     "?" spam on map change. Without the guard this would emit 8 rows.
{
  const s = createDiffState();
  const roster = (dead: boolean) => Array.from({ length: 25 }, (_, i) =>
    P(`P${i}`, `e${i}`, (i % 2) + 1, 0, dead && i < 8 ? 1 : 0));
  diffSnapshot(s, snap(roster(false)));            // seed: 25 players
  const r = diffSnapshot(s, snap(roster(true), [])); // 8 deaths, 0 events
  eq(r.newEntries.length, 0, "no burst emitted during a map transition");
}

// 14. Guard is not over-broad: a normal death with an event on a full,
//     healthy server still emits (roster not collapsed, not a mass burst).
{
  const s = createDiffState();
  // 24 live bystanders (soldier with health) so the roster isn't "collapsed".
  const base = Array.from({ length: 24 }, (_, i) => ({
    name: `L${i}`, eosId: `l${i}`, teamId: (i % 2) + 1, roleId: null,
    stats: { kills: 0, deaths: 0 },
    soldier: { health: 100 },
  }));
  diffSnapshot(s, snap([...base, P("A","a",1,0,0), P("B","b",2,0,0)]));
  const r = diffSnapshot(s, snap(
    [...base, P("A","a",1,1,0), P("B","b",2,0,1)],
    [evt({ killed: true, attacker: "A", victim: "B", victimEosId: "b", victimTeam: 2 })],
  ));
  eq(r.newEntries.length, 1, "normal kill still emits on a healthy full server");
  eq(r.newEntries[0].killer, "A", "attributed normally");
}

console.log(`\nkillfeed diff tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
