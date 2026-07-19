// Ticket-loss timeline analysis for the replay viewer. Reconstructs, from the
// full frame array, each team's ticket count over time and attributes every
// LOSS to a cause (death / vehicle / FOB radio / bleed).
//
// HONESTY: the ticket lines and each team's TOTAL loss are EXACT ground truth —
// teams[].tickets is read straight from every frame. The split of a loss ACROSS
// causes is best-effort: Squad emits no "destroyed" event, so vehicle / radio
// kills are inferred from an actor id disappearing between frames (~0.5 Hz) and
// priced from an approximate cost table. Every emitted chunk is clamped so the
// per-step amounts sum EXACTLY to the observed drop; the unexplained remainder
// becomes "bleed". Over-detected kills that never match a real drop are dropped,
// so false positives can never inflate a total.

import type { Snapshot, Vehicle } from "./types";
import { vehicleTicketCost, DEATH_COST } from "./ticketCosts";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";

// The real ticket-costing causes. Note FOB/HAB radio destruction is deliberately
// NOT here: verified against replays, losing a radio deducts the owner ZERO
// tickets (the squad_pools `fobDestroy` value is the destroyer's SCORE, not an
// owner ticket cost). The ticket damage from a lost FOB shows up indirectly as
// the deaths / bleed that follow, which are already counted.
export type Cause = "death" | "vehicle" | "bleed";

export interface LossEvent {
  frameIdx: number;      // frame where the drop was detected
  tMs: number;           // Date.parse(timestamp) — same x-domain as TimelineBar
  tickTimeSec: number;   // match elapsed seconds
  team: 1 | 2;
  cause: Cause;
  amount: number;        // tickets lost (> 0)
  label: string;
  detail?: string;
}

export interface Breakdown {
  death: number; vehicle: number; bleed: number; total: number;
}

export interface TeamTimeline {
  team: 1 | 2;
  tickets: (number | null)[];   // per frame, ground truth (null = bad read → gap)
  events: LossEvent[];
  breakdown: Breakdown;
  startTickets: number | null;
  endTickets: number | null;
}

export interface TicketAnalysis {
  frameCount: number;
  tMs: number[];
  timeSec: number[];
  maxTickets: number;
  t1: TeamTimeline;
  t2: TeamTimeline;
  events: LossEvent[];      // merged, time-sorted (for markers)
}

// The ticket deduction lands on the SAME tick the vehicle/FOB health crosses to
// <=0 (verified against real replays: the drop is the crossing tick, not spread).
// So bill a structural candidate only on its birth tick (TTL 0); carrying it
// further would let a light vehicle's leftover cost cap leak into later bleed
// ticks and both inflate its total and spawn stray follow-up rows.
const STRUCT_TTL_STEPS = 0;

interface StructCand {
  amount: number; cause: Cause; label: string; detail?: string; bornStep: number;
}

function teamOf(snap: Snapshot, id: 1 | 2) {
  return (snap.teams ?? []).find((t) => t.id === id) ?? null;
}

function vehMap(snap: Snapshot): Map<string, Vehicle> {
  const m = new Map<string, Vehicle>();
  for (const v of snap.vehicles ?? []) if (v.id) m.set(v.id, v);
  return m;
}

const asTeam = (t: number | null | undefined): 1 | 2 | null =>
  t === 1 ? 1 : t === 2 ? 2 : null;

export function computeTicketAnalysis(frames: Snapshot[]): TicketAnalysis {
  const n = frames.length;
  const tMs: number[] = new Array(n);
  const timeSec: number[] = new Array(n);
  const t1tix: (number | null)[] = new Array(n).fill(null);
  const t2tix: (number | null)[] = new Array(n).fill(null);

  const t0 = n ? Date.parse(frames[0].timestamp) : 0;
  let maxTickets = 1;
  for (let i = 0; i < n; i++) {
    const f = frames[i];
    const ms = Date.parse(f.timestamp);
    tMs[i] = Number.isFinite(ms) ? ms : (i ? tMs[i - 1] : 0);
    timeSec[i] = f.gameState?.elapsedSec ?? Math.max(0, (tMs[i] - t0) / 1000);
    const a = teamOf(f, 1)?.tickets ?? null;
    const b = teamOf(f, 2)?.tickets ?? null;
    t1tix[i] = a; t2tix[i] = b;
    if (a != null) maxTickets = Math.max(maxTickets, a);
    if (b != null) maxTickets = Math.max(maxTickets, b);
  }

  const ev1: LossEvent[] = [];
  const ev2: LossEvent[] = [];
  const bk1: Breakdown = { death: 0, vehicle: 0, bleed: 0, total: 0 };
  const bk2: Breakdown = { death: 0, vehicle: 0, bleed: 0, total: 0 };

  const structQ: Record<1 | 2, StructCand[]> = { 1: [], 2: [] };
  const deathAccum: Record<1 | 2, number> = { 1: 0, 2: 0 };

  const push = (team: 1 | 2, e: LossEvent) => {
    (team === 1 ? ev1 : ev2).push(e);
    const bk = team === 1 ? bk1 : bk2;
    bk[e.cause] += e.amount;
    bk.total += e.amount;
  };

  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1];
    const cur = frames[i];
    const inProg = prev.gameState?.matchState === "InProgress"
                && cur.gameState?.matchState === "InProgress";
    if (!inProg) {
      // Match not running between these frames — drop carry state so an end-of-
      // round reset or warmup is never billed as a loss.
      structQ[1] = []; structQ[2] = [];
      deathAccum[1] = 0; deathAccum[2] = 0;
      continue;
    }

    // --- structural candidates: destroyed vehicles ---
    // Destruction = health crossing >0 -> <=0. That is the tick the game deducts
    // the vehicle's tickets; the wreck then lingers in the list for a few seconds
    // before it despawns, so a disappearance diff fires too late and the cost
    // would land on bleed instead. (Confirmed against real replays.)
    const pv = vehMap(prev);
    for (const v of cur.vehicles ?? []) {
      const p = v.id ? pv.get(v.id) : undefined;
      if (!p) continue;
      if (!(p.health != null && p.health > 0 && v.health != null && v.health <= 0)) continue;
      const team = asTeam(v.team);
      if (!team) continue;
      const name = vehicleDisplayName(v.classShort);
      structQ[team].push({
        amount: vehicleTicketCost(v), cause: "vehicle",
        label: `${name} destroyed`, detail: name, bornStep: i,
      });
    }
    // --- per team: accumulate deaths, then reconcile the ticket drop ---
    for (const team of [1, 2] as const) {
      const dPrev = teamOf(prev, team)?.deaths;
      const dCur = teamOf(cur, team)?.deaths;
      if (dPrev != null && dCur != null && dCur > dPrev) {
        deathAccum[team] += (dCur - dPrev) * DEATH_COST;
      }

      const tixPrev = team === 1 ? t1tix[i - 1] : t2tix[i - 1];
      const tixCur = team === 1 ? t1tix[i] : t2tix[i];
      if (tixPrev == null || tixCur == null) continue;
      const delta = tixCur - tixPrev;
      if (delta >= 0) continue;   // gain (flag cap) or flat — nothing to attribute
      let remaining = -delta;

      // 1) structural candidates first (FIFO, within TTL). A vehicle / FOB that
      // vanished with lethal health is a high-confidence, known-cost event — bill
      // it before the fuzzy death accumulator, which would otherwise swallow every
      // drop and starve these.
      const q = structQ[team];
      while (remaining > 0 && q.length) {
        const cand = q[0];
        if (i - cand.bornStep > STRUCT_TTL_STEPS) { q.shift(); continue; }
        const a = Math.min(remaining, cand.amount);
        remaining -= a;
        cand.amount -= a;
        push(team, {
          frameIdx: i, tMs: tMs[i], tickTimeSec: timeSec[i], team,
          cause: cand.cause, amount: a, label: cand.label, detail: cand.detail,
        });
        if (cand.amount <= 0) q.shift();
      }
      // 2) deaths (counter-synchronous, but each death's exact ticket cost is
      // fuzzier than a vehicle's — so it fills in after the discrete events)
      if (remaining > 0 && deathAccum[team] > 0) {
        const d = Math.min(remaining, deathAccum[team]);
        deathAccum[team] -= d;
        remaining -= d;
        const deaths = Math.max(1, Math.round(d / DEATH_COST));
        push(team, {
          frameIdx: i, tMs: tMs[i], tickTimeSec: timeSec[i], team,
          cause: "death", amount: d,
          label: deaths > 1 ? `${deaths} deaths` : "death",
        });
      }
      // 3) residual => bleed (continuous flag-hold drain)
      if (remaining > 0) {
        push(team, {
          frameIdx: i, tMs: tMs[i], tickTimeSec: timeSec[i], team,
          cause: "bleed", amount: remaining, label: "bleed",
        });
      }
    }

    // expire structural candidates that never matched a drop (left range, not killed)
    for (const team of [1, 2] as const) {
      structQ[team] = structQ[team].filter((c) => i - c.bornStep <= STRUCT_TTL_STEPS);
    }
  }

  const firstNonNull = (arr: (number | null)[]) => arr.find((x) => x != null) ?? null;
  const lastNonNull = (arr: (number | null)[]) => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return null;
  };

  const t1: TeamTimeline = {
    team: 1, tickets: t1tix, events: ev1, breakdown: bk1,
    startTickets: firstNonNull(t1tix), endTickets: lastNonNull(t1tix),
  };
  const t2: TeamTimeline = {
    team: 2, tickets: t2tix, events: ev2, breakdown: bk2,
    startTickets: firstNonNull(t2tix), endTickets: lastNonNull(t2tix),
  };
  const events = [...ev1, ...ev2].sort((a, b) => a.tMs - b.tMs);

  return { frameCount: n, tMs, timeSec, maxTickets, t1, t2, events };
}
