// Important moments for the replay timeline: a flag changing hands, a vehicle
// destroyed, a FOB radio dug down, a team's tickets collapsing.
//
// Computed INCREMENTALLY. A replay arrives in chunks and is watchable from the
// first few seconds, so the markers have to arrive with the frames — this is a
// cursor over a growing array, never a pass over a finished one. The state
// carries everything that spans a chunk boundary (a capture waiting for
// confirmation, the ticket losses inside the trailing window), so feeding the
// same frames in one chunk or in ten produces the same markers.
//
// Every rule here reads only what is in the recording. Nothing is inferred
// about WHO did it — the timeline says what happened and when; the viewer is
// one click away from watching it.

import type { CaptureZone, Snapshot } from "./types";
import { destroyedVehicles } from "./ticketTimeline";
import { vehicleTicketCost } from "./ticketCosts";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";

export type MarkerKind = "cap" | "vehicle" | "radio" | "tickets";

export interface ReplayMarker {
  /** Same event, same key — in any download window. */
  key: string;
  kind: MarkerKind;
  /** On the match clock (epoch ms): the TimelineBar axis. */
  tMs: number;
  /**
   * cap: the team that took the flag, or — when it went neutral — the team
   * that lost it. vehicle / tickets: the team that LOST it, which is also how
   * the ticket chart attributes the same events.
   */
  team: 1 | 2 | null;
  /** Zone or vehicle display name; empty for a ticket collapse. */
  subject: string;
  capture?: "taken" | "lost";
  /** vehicle: its ticket cost. tickets: the largest 60 s loss in the burst. */
  amount?: number;
  /**
   * vehicle: what it was, so the timeline can draw THAT vehicle's silhouette
   * rather than a generic glyph. Kept as data — resolving it to an icon is
   * the UI's business, and this module stays free of anything DOM.
   */
  vehicle?: { classShort: string | null; kind: string | null };
  /**
   * Where it happened, in world units (cm), and how much of the map around it
   * to show when the viewer is taken there. A flag is its zone, a vehicle or a
   * radio the spot it died on, and a ticket collapse the place its side's
   * players were going down that minute. Absent when nothing places it.
   */
  at?: { x: number; y: number; r: number };
  /** 0..1, how prominently to draw it. */
  weight: number;
}

// Calibrated on two real ~110-player matches (an altai Narva RAAS and a harp
// Yehorivka RAAS): a 25-ticket loss inside 60 s marks about four collapses per
// team per match. 30 found none at all in one of them; 20 starts marking a
// single heavy vehicle on its own, which already has a marker of its own.
export const SWING_WINDOW_MS = 60_000;
export const SWING_THRESHOLD = 25;

// A flag's new owner has to hold this long before it counts. Ownership is one
// byte read from a live process; a torn read must not plant a capture on the
// timeline. Two seconds is one frame at the slowest recording rate.
export const CAP_CONFIRM_MS = 2_000;

// How much map to frame around a moment, in world cm. A zone is a few hundred
// metres across. A wreck or a radio is a point, but what killed it usually is
// not on it — an AT team or a tank fires from one to three hundred metres off —
// so a point gets enough surroundings to show the other end of the shot.
const FRAME_ZONE_CM = 12_000;
const FRAME_POINT_CM = 10_000;
const FRAME_MAX_CM = 40_000;

interface Loss { tMs: number; n: number }
interface Down { tMs: number; x: number; y: number }
interface Burst { marker: ReplayMarker; until: number }

export interface MarkerState {
  /** Frames [0, upTo) have been looked at. */
  upTo: number;
  prev: Snapshot | null;
  /** Confirmed owner per zone id. */
  owners: Map<string, number>;
  /** Confirmed bleeding state per FOB radio id. */
  radios: Map<string, boolean>;
  /** A radio state change waiting for CAP_CONFIRM_MS, per radio id. */
  radioPending: Map<string, { bleeding: boolean; tMs: number }>;
  /** A change waiting for CAP_CONFIRM_MS, per zone id. */
  pending: Map<string, { owner: number; tMs: number }>;
  losses: Record<1 | 2, Loss[]>;
  /** Where each side's players went down, inside the same trailing window. */
  downs: Record<1 | 2, Down[]>;
  /** Last health seen per player, to catch the frame they go down. */
  health: Map<string, number>;
  burst: Record<1 | 2, Burst | null>;
}

export function createMarkerState(): MarkerState {
  return {
    upTo: 0, prev: null, owners: new Map(), pending: new Map(),
    radios: new Map(), radioPending: new Map(),
    downs: { 1: [], 2: [] }, health: new Map(),
    losses: { 1: [], 2: [] }, burst: { 1: null, 2: null },
  };
}

/**
 * Whoever receives a marker decides whether it is new. It returns the marker
 * that is now canonical — the one passed in, or the copy it already holds —
 * because a ticket collapse keeps growing after it is first reported and the
 * growth has to land on the object everyone else is looking at.
 */
export type MarkerSink = (m: ReplayMarker) => ReplayMarker;

const asTeam = (t: number | null | undefined): 1 | 2 | null =>
  t === 1 ? 1 : t === 2 ? 2 : null;

const live = (s: Snapshot | null) => s?.gameState?.matchState === "InProgress";

/**
 * The same name the map draws: SquadCalc's readable one first, then the game's
 * own flag name, then the live name without its lane prefix and class suffix.
 * (Repeated rather than imported from the canvas so this module stays free of
 * anything that touches the DOM.)
 */
export function zoneName(z: Pick<CaptureZone, "name" | "staticName" | "flagName">): string {
  return z.staticName || z.flagName
    || (z.name ?? "").replace(/-BP_[A-Za-z0-9_]+$/, "").replace(/^[A-Za-z0-9]+-/, "");
}

function ticketsOf(s: Snapshot, team: 1 | 2): number | null {
  const t = (s.teams ?? []).find((x) => x.id === team)?.tickets;
  return typeof t === "number" ? t : null;
}

const xy = (p: { x?: number | null; y?: number | null } | null | undefined) =>
  p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null;

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Where a side was bleeding: the median of where its players went down, and
 * a radius that takes in most of them. Median rather than mean, so the odd
 * player shot at the other end of the map does not drag the view into an
 * empty field between two fights.
 */
function collapseSite(downs: Down[]): { x: number; y: number; r: number } | undefined {
  if (!downs.length) return undefined;
  const x = median(downs.map((d) => d.x));
  const y = median(downs.map((d) => d.y));
  const dist = downs.map((d) => Math.hypot(d.x - x, d.y - y)).sort((a, b) => a - b);
  const r80 = dist[Math.min(dist.length - 1, Math.floor(dist.length * 0.8))]!;
  return { x, y, r: Math.min(FRAME_MAX_CM, Math.max(FRAME_POINT_CM, r80 * 1.15)) };
}

/** Look at every frame from `st.upTo` to the end, reporting new moments to `emit`. */
export function extendMarkers(st: MarkerState, frames: Snapshot[], emit: MarkerSink): void {
  for (let i = st.upTo; i < frames.length; i++) {
    const cur = frames[i]!;
    const tMs = Date.parse(cur.timestamp ?? "");
    if (!Number.isFinite(tMs)) continue;
    const prev = st.prev;
    st.prev = cur;

    if (!live(cur)) {
      // Warm-up, the end of a round, a map change: nothing here is a moment of
      // play, and nothing should carry across it.
      st.pending.clear();
      st.radioPending.clear();
      st.losses = { 1: [], 2: [] };
      st.downs = { 1: [], 2: [] };
      st.burst = { 1: null, 2: null };
      continue;
    }

    // --- flags -------------------------------------------------------------
    for (const z of cur.captureZones ?? []) {
      const owner = z.owningTeam;
      if (!z.id || (owner !== 0 && owner !== 1 && owner !== 2)) continue;   // torn
      const was = st.owners.get(z.id);
      if (was === undefined) {
        // First sight of a zone — a RAAS lane revealing its next flag — is
        // not a capture.
        st.owners.set(z.id, owner);
        continue;
      }
      if (owner === was) { st.pending.delete(z.id); continue; }
      let p = st.pending.get(z.id);
      if (!p || p.owner !== owner) {
        p = { owner, tMs };
        st.pending.set(z.id, p);
      }
      if (tMs - p.tMs < CAP_CONFIRM_MS) continue;
      st.owners.set(z.id, owner);
      st.pending.delete(z.id);
      const taken = owner !== 0;
      const team = taken ? asTeam(owner) : asTeam(was);
      if (!team) continue;            // neutral to neutral: nothing happened
      const zp = xy(z.position) ?? xy(z.staticPosition as { x: number; y: number } | null);
      emit({
        key: `cap:${z.id}:${owner}:${p.tMs}`, kind: "cap", tMs: p.tMs, team,
        subject: zoneName(z), capture: taken ? "taken" : "lost", weight: 1,
        at: zp ? { ...zp, r: FRAME_ZONE_CM } : undefined,
      });
    }

    // --- FOB radios ----------------------------------------------------------
    // A radio is lost when the game says so: dug down to its floor (24 of
    // 300 HP on current builds) it starts BLEEDING and gets a death time, and
    // only much later leaves the list. That flag is the moment — not the
    // disappearance, which also happens when an owner packs up their own
    // radio, and which can come long after the fight that took it.
    for (const d of cur.deployables ?? []) {
      if (!d.isFob || !d.id) continue;
      const bleeding = d.fobBleeding === true;
      const was = st.radios.get(d.id);
      if (was === undefined) {
        // First sight — including a radio already dug down when a download
        // window opened — is not a moment.
        st.radios.set(d.id, bleeding);
        continue;
      }
      if (bleeding === was) { st.radioPending.delete(d.id); continue; }
      let p = st.radioPending.get(d.id);
      if (!p || p.bleeding !== bleeding) {
        p = { bleeding, tMs };
        st.radioPending.set(d.id, p);
      }
      if (tMs - p.tMs < CAP_CONFIRM_MS) continue;
      st.radios.set(d.id, bleeding);
      st.radioPending.delete(d.id);
      const team = asTeam(d.team);
      if (!bleeding || !team) continue;    // only the fall is a moment
      const rp = xy(d.position);
      emit({
        key: `radio:${d.id}`, kind: "radio", tMs: p.tMs, team,
        subject: "FOB radio", weight: 0.9,
        at: rp ? { ...rp, r: FRAME_POINT_CM } : undefined,
      });
    }

    // --- players going down, for placing a ticket collapse ---------------------
    for (const pl of cur.players ?? []) {
      const k = pl.eosId || (pl.playerId != null ? String(pl.playerId) : "") || pl.name || "";
      const h = pl.soldier?.health;
      if (!k || typeof h !== "number") continue;
      const was = st.health.get(k);
      st.health.set(k, h);
      const team = asTeam(pl.teamId);
      const where = xy(pl.soldier?.position);
      if (was !== undefined && was > 0 && h <= 0 && team && where) {
        st.downs[team].push({ tMs, ...where });
      }
    }
    for (const team of [1, 2] as const) {
      const w = st.downs[team];
      while (w.length && w[0]!.tMs <= tMs - SWING_WINDOW_MS) w.shift();
    }

    if (!prev || !live(prev)) continue;

    // --- vehicles ----------------------------------------------------------
    // The same rule the ticket chart prices them by, so a ▲ here and a ▲ there
    // are always the same event.
    for (const v of destroyedVehicles(prev, cur)) {
      const team = asTeam(v.team);
      if (!team) continue;
      const cost = vehicleTicketCost(v);
      emit({
        key: `veh:${v.id}:${tMs}`, kind: "vehicle", tMs, team,
        subject: vehicleDisplayName(v.classShort), amount: cost,
        vehicle: { classShort: v.classShort ?? null, kind: v.kind ?? null },
        at: (() => { const vp = xy(v.position); return vp ? { ...vp, r: FRAME_POINT_CM } : undefined; })(),
        weight: Math.max(0.35, Math.min(1, cost / 20)),
      });
    }

    // --- ticket collapses --------------------------------------------------
    for (const team of [1, 2] as const) {
      const a = ticketsOf(prev, team);
      const b = ticketsOf(cur, team);
      const window = st.losses[team];
      if (a != null && b != null && b < a) window.push({ tMs, n: a - b });
      while (window.length && window[0]!.tMs <= tMs - SWING_WINDOW_MS) window.shift();
      const lost = window.reduce((s, l) => s + l.n, 0);

      const open = st.burst[team];
      if (open && tMs <= open.until) {
        // Still the same collapse: report how bad it got, not how it began.
        if (lost > (open.marker.amount ?? 0)) {
          open.marker.amount = lost;
          open.marker.weight = Math.min(1, lost / 50);
          // Re-placed only while it deepens. Once the losing stops, the
          // trailing window keeps sliding and sheds the downs that WERE the
          // collapse, until what is left is whoever happened to fall last —
          // possibly at the other end of the map.
          open.marker.at = collapseSite(st.downs[team]) ?? open.marker.at;
        }
        continue;
      }
      st.burst[team] = null;
      if (lost < SWING_THRESHOLD || !window.length) continue;
      // Placed where the losing started, so a click lands before it, not at
      // the moment it had already gone too far to miss.
      const start = window[0]!.tMs;
      const marker = emit({
        key: `tix:${team}:${start}`, kind: "tickets", tMs: start, team,
        subject: "", amount: lost, weight: Math.min(1, lost / 50),
        at: collapseSite(st.downs[team]),
      });
      st.burst[team] = { marker, until: tMs + SWING_WINDOW_MS };
    }
  }
  st.upTo = frames.length;
}

/**
 * The copy of `m` already in `have`, if there is one.
 *
 * Flags and vehicles are exact: same key, same event. A ticket collapse is
 * looser, because where it is said to START depends on how much of the
 * window the detector had seen — a download restarted part-way into one sees
 * less of it. Within one window of each other, for the same team, it is the
 * same collapse.
 */
export function findDuplicate(have: readonly ReplayMarker[], m: ReplayMarker): ReplayMarker | null {
  for (const x of have) {
    if (x.key === m.key) return x;
    if (m.kind === "tickets" && x.kind === "tickets" && x.team === m.team
        && Math.abs(x.tMs - m.tMs) < SWING_WINDOW_MS) return x;
  }
  return null;
}

// --- drawing ------------------------------------------------------------------

/** Which of several moments in one spot gets to be the glyph. */
const PRIORITY: Record<MarkerKind, number> = { cap: 4, radio: 3, tickets: 2, vehicle: 1 };

export interface MarkerCluster {
  /** The member drawn: the most important kind, then the heaviest. */
  lead: ReplayMarker;
  /** Every moment in this spot, in time order. */
  members: ReplayMarker[];
  /** Where it sits on the axis, in px from the track's left edge. */
  px: number;
  /** For React. Stable while the members do not change. */
  key: string;
}

/**
 * Fold markers closer than `minGapPx` into one.
 *
 * Simultaneous moments are common, not an edge case: a RAAS round opens with
 * both sides taking their first flag in the same second, and a fight at a flag
 * puts a capture, a ticket collapse and two dead vehicles inside a few
 * seconds. Drawn separately they stack into one glyph whose top copy swallows
 * every click meant for the others. Measured in PIXELS because that is what
 * overlaps — the same minute is one spot on a phone and three on a monitor.
 */
export function clusterMarkers(markers: readonly ReplayMarker[],
                               toPx: (tMs: number) => number,
                               minGapPx: number): MarkerCluster[] {
  const sorted = [...markers].sort((a, b) => a.tMs - b.tMs);
  const out: MarkerCluster[] = [];
  let cur: MarkerCluster | null = null;
  for (const m of sorted) {
    const px = toPx(m.tMs);
    if (cur && px - cur.px < minGapPx) {
      cur.members.push(m);
      const l = cur.lead;
      if (PRIORITY[m.kind] > PRIORITY[l.kind]
          || (PRIORITY[m.kind] === PRIORITY[l.kind] && m.weight > l.weight)) {
        cur.lead = m;
      }
      continue;
    }
    cur = { lead: m, members: [m], px, key: m.key };
    out.push(cur);
  }
  for (const c of out) if (c.members.length > 1) c.key = c.members.map((m) => m.key).join("|");
  return out;
}
