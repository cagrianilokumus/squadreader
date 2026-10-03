// Both teams' tickets over the match, thinned out for drawing.
//
// The timeline's "ticket race" view draws two lines across a few hundred
// pixels; a 40-minute recording at 4 Hz holds ten thousand frames. This keeps
// a few hundred evenly spaced points plus the last one, so the line always
// reaches the download frontier. It runs on every flush while a replay
// downloads, which is why it samples by index instead of walking every frame.

import type { Snapshot } from "./types";

export interface TicketPoint {
  tMs: number;
  t1: number | null;
  t2: number | null;
}

/** At most about this many points, whatever the recording's rate. */
export const SERIES_POINTS = 600;

function ticketsOf(s: Snapshot, team: 1 | 2): number | null {
  const t = (s.teams ?? []).find((x) => x.id === team)?.tickets;
  return typeof t === "number" ? t : null;
}

export function sampleTickets(frames: readonly Snapshot[], count = frames.length,
                              maxPoints = SERIES_POINTS): TicketPoint[] {
  const n = Math.min(count, frames.length);
  if (!n) return [];
  const stride = Math.max(1, Math.floor(n / maxPoints));
  const out: TicketPoint[] = [];
  const take = (i: number) => {
    const f = frames[i]!;
    // Warm-up and the round's end carry reset or meaningless counts.
    if (f.gameState?.matchState !== "InProgress") return;
    const tMs = Date.parse(f.timestamp ?? "");
    if (!Number.isFinite(tMs)) return;
    const t1 = ticketsOf(f, 1), t2 = ticketsOf(f, 2);
    if (t1 == null && t2 == null) return;
    if (out.length && tMs <= out[out.length - 1]!.tMs) return;
    out.push({ tMs, t1, t2 });
  };
  for (let i = 0; i < n; i += stride) take(i);
  if ((n - 1) % stride !== 0) take(n - 1);
  return out;
}

/** A team's tickets at `tMs`: the last sampled point at or before it. */
export function ticketsAt(series: readonly TicketPoint[], team: 1 | 2, tMs: number): number | null {
  let lo = 0, hi = series.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]!.tMs <= tMs) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best < 0) return series.length ? (team === 1 ? series[0]!.t1 : series[0]!.t2) : null;
  const p = series[best]!;
  return team === 1 ? p.t1 : p.t2;
}
