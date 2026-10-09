// A team view keeps what that team owns and nothing of the other side's.
// Framework-free, as the tests beside it are.
import { teamViewSnapshot } from "./teamView.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}

const snap: any = {
  timestamp: "t", server: "s", schemaVersion: "v",
  gameState: { mapName: "Narva" },
  teams: [{ id: 1 }, { id: 2 }],
  squads: [{ teamId: 1 }, { teamId: 2 }],
  players: [{ name: "a", teamId: 1 }, { name: "b", teamId: 2 }, { name: "c", teamId: null }],
  vehicles: [{ id: "v1", team: 1 }, { id: "v2", team: 2 }],
  deployables: [{ id: "d1", team: 1 }, { id: "d2", team: 2 }, { id: "d0", team: 0 }],
  vehicleSpawners: [{ id: "s1", team: 1 }, { id: "s2", team: 2 }],
  rallyPoints: [{ id: "r1", team: 1 }, { id: "r2", team: 2 }],
  markers: [{ id: "m1", team: 1 }, { id: "m2", team: 2 }],
  projectiles: [{ id: "p1", team: 1 }, { id: "p?" }],
  captureZones: [{ name: "01-Farm", owningTeam: 2 }],
  damageEvents: [{ victim: "a" }],
};

// --- both teams: the frame itself, untouched --------------------------------
ok(teamViewSnapshot(snap, 0) === snap, "both teams returns the same frame");

// --- one team -----------------------------------------------------------------
{
  const t1 = teamViewSnapshot(snap, 1);
  const ids = (rows: any[]) => rows.map((r) => r.name ?? r.id).join(",");
  ok(ids(t1.players) === "a", "players: own team only");
  ok(ids(t1.vehicles) === "v1", "vehicles: own team only");
  ok(ids(t1.deployables) === "d1", "FOBs/HABs: own team only, neutral dropped");
  ok(ids(t1.vehicleSpawners) === "s1", "vehicle spawns: own team only");
  ok(ids(t1.rallyPoints) === "r1", "rallies: own team only");
  ok(ids(t1.markers) === "m1", "markers: own team only");
  ok(ids(t1.projectiles) === "p1", "rounds: own team only, unknown team dropped");
  ok(t1.captureZones === snap.captureZones, "objectives are shared and kept");
  ok(t1.gameState === snap.gameState, "game state is kept");
  ok(t1.damageEvents === snap.damageEvents, "events are not the map's to filter");
  ok(ids(teamViewSnapshot(snap, 2).players) === "b", "team 2 sees team 2");
}

// --- the source frame is never mutated ----------------------------------------
{
  teamViewSnapshot(snap, 1);
  ok(snap.players.length === 3 && snap.markers.length === 2,
     "the recorded frame is left as it was");
}

// --- a frame missing a family does not throw -----------------------------------
{
  const bare: any = { ...snap, rallyPoints: undefined, projectiles: undefined };
  const t = teamViewSnapshot(bare, 2);
  ok(Array.isArray(t.rallyPoints) && t.rallyPoints.length === 0,
     "an absent family comes back empty");
}

console.log(`teamView: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
