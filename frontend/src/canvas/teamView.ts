// One team's view of the map: what that team saw on its own in-game map.
//
// The point is to check a team's map work — were the markers where they should
// be, which FOBs and rallies did they have — so a team view keeps everything the
// team itself owns and drops the other side's: players, vehicles, FOBs/HABs,
// markers, rallies, vehicle spawns and rounds fired. Objectives and lanes are
// shared by both teams and stay as they are.
//
// An entity whose team is unknown is dropped too: it cannot be shown as part of
// a team's map without guessing which team it belongs to. (Projectiles carry no
// team in current recordings, so a team view shows none.)
//
// The filter is applied to the frame the map draws and hit-tests, so nothing
// hidden can be hovered or clicked either.
import type { Snapshot } from "../state/types";

/** 0 = both teams. */
export type TeamView = 0 | 1 | 2;

export function teamViewSnapshot(snap: Snapshot, team: TeamView): Snapshot {
  if (team === 0) return snap;
  const own = <T>(rows: T[] | undefined, teamOf: (r: T) => number | null | undefined) =>
    (rows ?? []).filter((r) => teamOf(r) === team);
  return {
    ...snap,
    players: own(snap.players, (p) => p.teamId),
    vehicles: own(snap.vehicles, (v) => v.team),
    deployables: own(snap.deployables, (d) => d.team),
    vehicleSpawners: own(snap.vehicleSpawners, (v) => v.team),
    rallyPoints: own(snap.rallyPoints, (r) => r.team),
    markers: own(snap.markers, (m) => m.team),
    projectiles: own(snap.projectiles, (p) => p.team),
  };
}
