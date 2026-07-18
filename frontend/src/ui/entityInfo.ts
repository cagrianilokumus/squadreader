// Shared, pure formatting helpers for map-entity info — used by both the
// hover Tooltip and the click InfoPanel so the two never drift apart.

import type { Marker, Player } from "../state/types";

// Friendly label for a marker's BP asset name. Examples:
//   "BP_MapMarker_Action_MoveSL"          → "Move (SL)"
//   "BP_MapMarker_Support_FOB"            → "FOB request"
//   "BP_MapMarker_GridHeader_Spotted_Inf" → "Spotted · Infantry"
//   "BP_MapMarker_POI_CO"                 → "Commander POI"
// Squad marker names stay in ENGLISH — they're the in-game terminology
// players already know (Attack/Defend/Move/FOB request/…); translating them
// makes the map unreadable to Squad players even though the rest of the UI
// is Turkish.
export function markerLabel(type: string | null | undefined): string {
  if (!type) return "marker";
  const raw = type.replace(/^BP_MapMarker_/, "");

  const action = raw.match(/^Action_(Move|Attack|Defend|Observe|Build)(SL|FT)$/i);
  if (action) {
    const verb = action[1]!.charAt(0).toUpperCase() + action[1]!.slice(1).toLowerCase();
    return `${verb} (${action[2]!.toUpperCase()})`;
  }
  if (/^Support_FOB/i.test(raw))            return "FOB request";
  if (/^Support_Construction/i.test(raw))   return "Build request";
  if (/^Support_Ammo/i.test(raw))           return "Ammo request";
  if (/^Support_Reinforcement/i.test(raw))  return "Reinforcements request";
  if (/^Support_Pickup/i.test(raw))         return "Pickup request";

  const opt = raw.match(/^Option_(.+)$/i);
  if (opt) {
    const v = opt[1]!
      .replace(/Track(IFV|APC)/i, "Tracked $1")
      .replace(/Wheel(IFV|APC)/i, "$1")
      .replace(/([a-z])([A-Z])/g, "$1 $2");
    return `Spotted · ${v}`;
  }
  const spotted = raw.match(/^GridHeader_Spotted_(.+)$/i);
  if (spotted) {
    const v = spotted[1]!.replace(/([a-z])([A-Z])/g, "$1 $2");
    return `Spotted · ${v}`;
  }
  if (/^POI_CO$/i.test(raw))                return "Commander POI";
  if (/^POI$/i.test(raw))                   return "POI";
  if (/FriendlyDirector/i.test(raw))        return "Direction (friendly)";
  if (/EnemyDirector/i.test(raw))           return "Direction (enemy)";
  if (/^Frontline/i.test(raw))              return "Frontline";

  // Fallback: strip the BP prefix and split CamelCase.
  return raw.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

// Find who placed a marker. Squad convention:
//   fireTeamId === -1 → that squad's Squad Leader
//   fireTeamId ===  1 → Bravo fireteam leader
//   fireTeamId ===  2 → Charlie fireteam leader
// A player is the SL when their stats encode (fireTeamIndex == 0 &&
// fireTeamPosition == 0); an FTL is (fireTeamIndex > 0 && pos == 0).
// Falls back to null when we can't resolve (player off-server, etc.).
export function findPlacer(m: Marker, players: Player[]): Player | null {
  const team = m.team;
  const squad = m.squad;
  const ft = m.fireTeamId;
  if (team == null || squad == null) return null;
  const inSquad = players.filter(
    (p) => p.teamId === team && p.squadId === squad
  );
  if (!inSquad.length) return null;
  const stats = (p: Player) => p.stats ?? {};
  const idx = (p: Player) => stats(p)["fireTeamIndex"];
  const pos = (p: Player) => stats(p)["fireTeamPosition"];
  if (ft === -1 || ft == null) {
    return inSquad.find((p) => idx(p) === 0 && pos(p) === 0) ?? null;
  }
  return inSquad.find((p) => idx(p) === ft && pos(p) === 0) ?? null;
}

export function ftLabel(ft: number | null | undefined): string {
  if (ft === 1) return "Bravo FTL";
  if (ft === 2) return "Charlie FTL";
  if (ft === -1 || ft == null) return "SL";
  return `FT ${ft}`;
}

export function fmtInt(v: number | null | undefined): string {
  return v == null ? "—" : Math.round(v).toString();
}
