// Standalone unit test for the event-first kill-feed diff. Bundled with
// esbuild and run under node — no test framework needed.
import { createDiffState, diffSnapshot, flushPendingDeaths } from "./diff.ts";

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
// A frame on a real clock, for the deaths that wait for a late event.
function tsnap(players: any[], events: any[], ms: number): any {
  return { tick: 1, players, damageEvents: events, vehicles: [],
           timestamp: new Date(ms).toISOString(),
           gameState: { elapsedSec: Math.floor(ms / 1000), matchState: "InProgress" } };
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

// 4. Death with no event -> it waits a moment for a late one, then an honest
//    "died": no invented killer, and no "?" claiming one.
{
  const s = createDiffState();
  const t0 = Date.UTC(2026, 9, 9, 13, 0, 0);
  diffSnapshot(s, tsnap([P("B","b",2,0,0)], [], t0));
  const r0 = diffSnapshot(s, tsnap([P("B","b",2,0,1)], [], t0 + 500));
  eq(r0.newEntries.length, 0, "a death nothing explains waits");
  const r1 = diffSnapshot(s, tsnap([P("B","b",2,0,1)], [], t0 + 2500));
  eq(r1.newEntries.length, 0, "still waiting inside the window");
  const r = diffSnapshot(s, tsnap([P("B","b",2,0,1)], [], t0 + 4600));
  eq(r.newEntries.length, 1, "one died row once the wait is over");
  eq(r.newEntries[0].killer, null, "no killer invented");
  eq(r.newEntries[0].victim, "B", "victim B");
  eq(r.newEntries[0].cause, "died", "says only that B died");
  eq(r.newEntries[0].gameTimeSec, Math.floor((t0 + 500) / 1000), "timed at the death, not the wait");
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

// 15. 4Hz bleed-out: a wound must still attribute a death that lands MANY ticks
//     later but within the game-time window. The old fixed 20-tick TTL aged the
//     incap out at 4 Hz (20 ticks ≈ 5 s) → "?" attacker; the game-time TTL
//     (45 s) keeps it. snap()'s constant elapsedSec=100 can't express this, so
//     use an inline snapshot with an advancing clock.
{
  const s = createDiffState();
  const at = (players: any[], events: any[], es: number): any =>
    ({ tick: 1, players, damageEvents: events, gameState: { elapsedSec: es }, vehicles: [] });
  diffSnapshot(s, at([P("A","a",1,0,0), P("B","b",2,0,0)], [], 100));            // seed
  diffSnapshot(s, at([P("A","a",1,0,0), P("B","b",2,0,0)],                        // A wounds B @100
    [evt({ wounded:true, attacker:"A", victim:"B", victimEosId:"b", victimTeam:2 })], 100));
  for (let i = 0; i < 30; i++)                                                    // 30 quiet ticks (>20:
    diffSnapshot(s, at([P("A","a",1,0,0), P("B","b",2,0,0)], [], 101 + i));       //   old tick-TTL dead)
  const r = diffSnapshot(s, at([P("A","a",1,1,0), P("B","b",2,0,1)], [], 131));   // B bleeds out @131 (31s<45s)
  eq(r.newEntries.length, 1, "bleed-out death emitted after many quiet ticks");
  eq(r.newEntries[0].killer, "A", "attacker survives the game-time TTL at 4 Hz");
}

// 16. A player stuck reconnecting: the old player state (deaths 1, team 1) and
//     the new one still loading (deaths 0, team 0), neither with an eosId.
//     Recorded on skira 6cf1f93f, where this printed "? > MaG" 17 ticks running.
{
  const s = createDiffState();
  const others = [P("A","a",1,0,0), P("B","b",2,0,0)];
  diffSnapshot(s, snap([...others, P("MaG","m",1,2,1)]));             // seed, eos known
  let rows = 0;
  for (let i = 0; i < 17; i++) {
    const r = diffSnapshot(s, snap([...others, P("MaG","",1,2,1), P("MaG","",0,0,0)]));
    rows += r.newEntries.length;
  }
  eq(rows, 0, "a stuck reconnect is not a death per tick");
  // The same pair seen with no eosId ever recorded for the name.
  const t = createDiffState();
  diffSnapshot(t, snap([...others, P("MaG","",1,2,1), P("MaG","",0,0,0)]));
  let rows2 = 0;
  for (let i = 0; i < 5; i++)
    rows2 += diffSnapshot(t, snap([...others, P("MaG","",0,0,0), P("MaG","",1,2,1)])).newEntries.length;
  eq(rows2, 0, "nor when the name never had an eosId, in either row order");
}

// 17. The loading copy alone for a while, then the old one again: the baseline
//     must not drop to the loading copy's zero in between.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0), P("X","",1,0,3)]));
  diffSnapshot(s, snap([P("A","a",1,0,0), P("X","",0,0,0)]));
  const r = diffSnapshot(s, snap([P("A","a",1,0,0), P("X","",1,0,3)]));
  eq(r.newEntries.length, 0, "the old copy coming back is not a death");
}

// 18. The eosId drops out on the tick the player dies (harp 1f628ad2, FIRFIR):
//     the death must still be seen then, attributed — not later, as a "?".
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",2,0,0), P("F","f",1,0,3)]));
  const r = diffSnapshot(s, snap([P("A","a",2,1,0), P("F","",1,0,4)],
    [evt({ killed:true, attacker:"A", victim:"F", victimTeam:1 })]));
  eq(r.newEntries.length, 1, "death seen on the tick it happened");
  eq(r.newEntries[0]?.killer, "A", "and attributed to its killer");
  let later = 0;
  for (let i = 0; i < 14; i++)
    later += diffSnapshot(s, snap([P("A","a",2,1,0), P("F","",1,0,4), P("F","",0,0,0)])).newEntries.length;
  later += diffSnapshot(s, snap([P("A","a",2,1,0), P("F","f",1,0,4)])).newEntries.length;
  eq(later, 0, "nothing more while reconnecting, nor when the eosId returns");
}

// 19. Not over-broad: a reconnected player whose counters restarted still has
//     their next real death counted.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",2,0,0), P("R","r",1,0,4)]));
  diffSnapshot(s, snap([P("A","a",2,0,0), P("R","r",1,0,0)]));
  const r = diffSnapshot(s, snap([P("A","a",2,1,0), P("R","r",1,0,1)],
    [evt({ killed:true, attacker:"A", victim:"R", victimEosId:"r", victimTeam:1 })]));
  eq(r.newEntries.length, 1, "first death after a counter restart is counted");
  eq(r.newEntries[0]?.killer, "A", "and attributed");
}

// 20. The killer's event lands a frame AFTER the death counter moved (altai
//     1ffaead9: pau > TheKatrika, and one IED > pasha032 + berkefenci, each
//     0.2 s late). The death waits for it and is credited, not "?".
{
  const s = createDiffState();
  const t0 = Date.UTC(2026, 9, 9, 13, 42, 0);
  const roster = (d: number) => [P("pau","pa",1,d,0), P("TheKatrika","tk",2,0,d),
                                 P("sevket","sk",1,0,0), P("pasha","ps",2,0,d), P("berk","bk",2,0,d)];
  diffSnapshot(s, tsnap(roster(0), [], t0));
  const r0 = diffSnapshot(s, tsnap(roster(1), [], t0 + 250));
  eq(r0.newEntries.length, 0, "nothing printed while the killer is unknown");
  const r1 = diffSnapshot(s, tsnap(roster(1), [
    evt({ killed:true, attacker:"pau", victim:"TheKatrika", victimEosId:"tk", victimTeam:2, causerWeapon:"BP_AKM_C" }),
    evt({ killed:true, attacker:"sevket", victim:"pasha", victimEosId:"ps", victimTeam:2, causerWeapon:"BP_Deployable_IED_C" }),
    evt({ killed:true, attacker:"sevket", victim:"berk", victimEosId:"bk", victimTeam:2, causerWeapon:"BP_Deployable_IED_C" }),
  ], t0 + 450));
  eq(r1.newEntries.length, 3, "all three credited as soon as their events land");
  const by: any = {};
  for (const e of r1.newEntries) by[e.victim] = e;
  eq(by["TheKatrika"]?.killer, "pau", "pau credited");
  eq(by["pasha"]?.killer, "sevket", "IED credited");
  eq(by["berk"]?.weaponClass, "BP_Deployable_IED_C", "with its weapon");
  eq(by["TheKatrika"]?.gameTimeSec, Math.floor((t0 + 250) / 1000), "timed at the death");
}

// 21. Bleeding out / giving up: the game records the victim's own soldier as
//     the cause and no killer. That is not a suicide.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("K","k",2,0,0)]));
  const r = diffSnapshot(s, snap([P("K","k",2,0,1)], [evt({ killed:true, attacker:null, victim:"K",
    victimEosId:"k", selfInflicted:true, causerWeapon:"BP_Soldier_AFU_Marksman01_C" })]));
  eq(r.newEntries.length, 1, "settled at once — the event already says it");
  eq(r.newEntries[0].suicide, false, "not a suicide");
  eq(r.newEntries[0].cause, "bledout", "bled out");
  eq(r.newEntries[0].killer, null, "no killer");
}

// 21b. Self-inflicted with no cause at all: after a wound it is the bleed-out;
//      with no wound before it (a redeploy at spawn, two of them in the first
//      minutes of altai 1ffaead9) it says only that the player died.
{
  const selfK = evt({ killed:true, attacker:null, victim:"R", victimEosId:"r", selfInflicted:true });
  const s = createDiffState();
  diffSnapshot(s, snap([P("R","r",1,0,0)]));
  const r = diffSnapshot(s, snap([P("R","r",1,0,1)], [selfK]));
  eq(r.newEntries[0]?.cause, "died", "no wound before it: died, not 'bled out'");
  eq(r.newEntries[0]?.suicide, false, "and not a suicide either");

  const s2 = createDiffState();
  diffSnapshot(s2, snap([P("R","r",1,0,0)]));
  diffSnapshot(s2, snap([P("R","r",1,0,0)], [evt({ wounded:true, attacker:null, victim:"R",
    victimEosId:"r", selfInflicted:true })]));
  const r2 = diffSnapshot(s2, snap([P("R","r",1,0,1)], [selfK]));
  eq(r2.newEntries[0]?.cause, "bledout", "after a wound: bled out");
}

// 21c. A fall is a fall, even when the game blames the faller.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("F","f",1,0,0)]));
  const r = diffSnapshot(s, snap([P("F","f",1,0,1)], [evt({ killed:true, attacker:null, victim:"F",
    victimEosId:"f", selfInflicted:true, damageType:"BP_Fall_C" })]));
  eq(r.newEntries[0]?.damageType, "BP_Fall_C", "world cause kept");
  eq(r.newEntries[0]?.cause ?? null, null, "not 'died'");
}

// 22. A self-inflicted round from a real weapon still is a suicide.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("G","g",1,0,0)]));
  const r = diffSnapshot(s, snap([P("G","g",1,0,1)], [evt({ killed:true, attacker:null, victim:"G",
    victimEosId:"g", selfInflicted:true, causerWeapon:"BP_RGD5Frag_Brown_C" })]));
  eq(r.newEntries[0]?.suicide, true, "grenade on oneself is a suicide");
  eq(r.newEntries[0]?.cause ?? null, null, "and not 'bled out'");
}

// 23. A weapon with no known hand keeps the weapon: "? <weapon> > victim".
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("V","v",1,0,0)]));
  const r = diffSnapshot(s, snap([P("V","v",1,0,1)], [evt({ killed:true, attacker:null, victim:"V",
    victimEosId:"v", causerWeapon:"BP_AKM_C" })]));
  eq(r.newEntries[0]?.killer, null, "no killer invented");
  eq(r.newEntries[0]?.weaponClass, "BP_AKM_C", "the weapon is kept");
  eq(r.newEntries[0]?.cause ?? null, null, "not 'died' — someone did this");
}

// 24. A torn read with a team that is no team (1216741536, 108 deaths at match
//     end) is not a death.
{
  const s = createDiffState();
  diffSnapshot(s, snap([P("A","a",1,0,0), P("S","",1,0,0)]));
  const r = diffSnapshot(s, snap([P("A","a",1,0,0), P("S","",1216741536,0,108)]));
  eq(r.newEntries.length, 0, "no row from a garbage team");
}

// 25. Deaths still waiting when the recording ends, or when play stops, come out.
{
  const s = createDiffState();
  const t0 = Date.UTC(2026, 9, 9, 14, 0, 0);
  diffSnapshot(s, tsnap([P("B","b",2,0,0)], [], t0));
  const last = tsnap([P("B","b",2,0,1)], [], t0 + 300);
  eq(diffSnapshot(s, last).newEntries.length, 0, "waiting");
  const out = flushPendingDeaths(s, last);
  eq(out.length, 1, "flushed at the end of the stream");
  eq(out[0]?.cause, "died", "as it would have been after the wait");
  eq(flushPendingDeaths(s, last).length, 0, "and only once");

  const s2 = createDiffState();
  diffSnapshot(s2, tsnap([P("B","b",2,0,0)], [], t0));
  diffSnapshot(s2, tsnap([P("B","b",2,0,1)], [], t0 + 300));
  const ended = { ...tsnap([P("B","b",2,0,1)], [], t0 + 600) };
  ended.gameState.matchState = "WaitingPostMatch";
  eq(diffSnapshot(s2, ended).newEntries.length, 1, "settled when the match stops");
}

console.log(`\nkillfeed diff tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
