// RAAS pre-roll fog-of-war for capture zones.
//
// At match start Squad replicates EVERY lane's objectives as capture-zone
// actors, all locked + neutral. The lane "rolls" ~30-60 s in and the server
// despawns the off-lane objectives, leaving only the chosen lane's chain
// (confirmed live: a resolved Mutaha RAAS lane exposes ~7 zones, pre-roll ~40).
// Drawing the pre-roll cloud buries the map under ~40 grey "?" flags.
//
// We hide the DORMANT candidates (locked + neutral + uncontested + 0 %) while a
// whole cloud of them is present, and reveal each zone the instant it is
// genuinely in play. Once the lane has resolved, the handful of upcoming
// (still-dormant) flags on the active route stay visible — matching real Squad
// / Squad-Replay. The signal is memory-verified per-zone state plus the cloud
// size: no time hack, no guessed lane membership.

type ZoneLike = {
  name?: string | null;
  flagName?: string | null;
  isLocked?: boolean | null;
  owningTeam?: number | null;
  capturingTeam?: number | null;
  capturePercent?: number | null;
  position?: { x: number; y: number } | null;
  staticPosition?: { x: number; y: number } | null;
};

// A zone whose name ends in "Main" is a team HQ — always shown, never a
// candidate (covers both the legacy "Main" label and "00-Team1Main" renames).
export function isMainZone(cz: ZoneLike): boolean {
  return /Main$/i.test(cz.name ?? "") || /Main$/i.test(cz.flagName ?? "");
}

// "In play" = memory says the zone is live: unlocked, held by a team, being
// captured, or partially captured. A locked + neutral + uncontested + 0 % zone
// is a dormant RAAS candidate. Fail-open: a missing/false lock ⇒ in play, so a
// bad read never hides a real objective.
export function capInPlay(cz: ZoneLike): boolean {
  if (!cz.isLocked) return true;
  if ((cz.owningTeam ?? 0) > 0) return true;
  if ((cz.capturingTeam ?? 0) > 0) return true;
  if ((cz.capturePercent ?? 0) > 0) return true;
  return false;
}

// The pre-roll cloud is many dormant candidates from every lane at once; a
// resolved lane leaves only a handful of upcoming dormant flags. Detect the
// cloud by size, with a duplicate-position tiebreak for small maps (the same
// objective is replicated at one spot under several lanes pre-roll, so dormant
// positions collide; a resolved lane's upcoming flags each sit at a unique
// spot). Robust to whether the server has despawned the off-lane actors yet.
const CLOUD_MIN = 12;     // this many dormant zones is unambiguously the cloud
const CLOUD_DUP_MIN = 4;  // at/above this, a duplicate position also means cloud
const CLOUD_DEPTH_MIN = 3; // this many dormant candidates sharing one lane-depth
                           // prefix ("04-…") means the lane hasn't rolled

// Squad names objectives "<depth>-<Name>" (e.g. "04-CrucibleAlpha"); the depth
// prefix is shared by every lane's objective at that depth. Pre-roll replicates
// ALL lanes, so a contested depth carries 3-4 candidates; a resolved lane leaves
// one (occasionally two, when it genuinely branches).
function depthPrefix(cz: ZoneLike): string | null {
  const n = cz.name ?? "";
  const dash = n.indexOf("-");
  return dash > 0 ? n.slice(0, dash) : null;
}

export function isPreRollCloud(zones: ZoneLike[]): boolean {
  const dormant = zones.filter((z) => !isMainZone(z) && !capInPlay(z));
  if (dormant.length >= CLOUD_MIN) return true;
  // Multi-lane replication by depth: 3+ dormant candidates at one "<depth>-"
  // prefix means several lanes are still replicated there — pre-roll, not a
  // resolved 2-way branch. Catches small maps whose whole cloud is under
  // CLOUD_MIN (e.g. Mestia RAAS: 10 zones, 8 dormant, but depth "04" has 4).
  const byDepth = new Map<string, number>();
  for (const z of dormant) {
    const d = depthPrefix(z);
    if (!d) continue;
    const n = (byDepth.get(d) ?? 0) + 1;
    if (n >= CLOUD_DEPTH_MIN) return true;
    byDepth.set(d, n);
  }
  if (dormant.length < CLOUD_DUP_MIN) return false;
  const seen = new Set<string>();
  for (const z of dormant) {
    const p = z.staticPosition ?? z.position;
    if (!p) continue;
    const key = `${Math.round(p.x / 100)},${Math.round(p.y / 100)}`;
    if (seen.has(key)) return true;  // same objective under >1 lane ⇒ pre-roll
    seen.add(key);
  }
  return false;
}

export function capVisible(cz: ZoneLike, cloud: boolean): boolean {
  if (isMainZone(cz)) return true;  // HQs always
  if (capInPlay(cz)) return true;   // owned / contested / unlocked / partial
  return !cloud;                    // dormant: hidden only during the cloud
}

// Convenience: the caps that should actually render / hit-test this frame.
// Generic so callers keep their concrete CaptureZone element type.
export function visibleCaps<T extends ZoneLike>(zones: T[]): T[] {
  const cloud = isPreRollCloud(zones);
  return zones.filter((z) => capVisible(z, cloud));
}
