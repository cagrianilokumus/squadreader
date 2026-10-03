// The ticket-race view's data: thinned, ordered, live-only, and reaching the end.

import { SERIES_POINTS, sampleTickets, ticketsAt } from "./ticketSeries.ts";
import type { Snapshot } from "./types.ts";

let passed = 0, failed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) passed++;
  else { failed++; console.error("FAIL:", msg); }
}

const T0 = Date.parse("2026-10-03T18:00:00Z");
const frame = (sec: number, t1: number, t2: number, state = "InProgress") => ({
  timestamp: new Date(T0 + sec * 1000).toISOString(),
  gameState: { matchState: state },
  teams: [{ id: 1, tickets: t1 }, { id: 2, tickets: t2 }],
}) as unknown as Snapshot;

{
  // A 40-minute match at 4 Hz: ten thousand frames.
  const fr: Snapshot[] = [];
  for (let i = 0; i < 9600; i++) fr.push(frame(i / 4, 250 - Math.floor(i / 60), 250 - Math.floor(i / 90)));
  const s = sampleTickets(fr);
  ok(s.length <= SERIES_POINTS + 2, `thinned to a drawable size (${s.length})`);
  ok(s[s.length - 1]!.tMs === T0 + (9599 / 4) * 1000, "reaches the last frame held — the download frontier");
  ok(s.every((p, i) => i === 0 || p.tMs > s[i - 1]!.tMs), "strictly in time order");
  ok(ticketsAt(s, 1, T0 + 1200_000) === s.filter((p) => p.tMs <= T0 + 1200_000).pop()!.t1,
     "reads a team's tickets at a time from the last point before it");
}
{
  // Warm-up and post-match frames carry counts that are not the match.
  const fr = [frame(0, 0, 0, "PreMatch"), frame(2, 250, 250), frame(4, 240, 250),
              frame(6, 0, 0, "WaitingPostMatch")];
  const s = sampleTickets(fr);
  ok(s.length === 2 && s[0]!.t1 === 250 && s[1]!.t1 === 240, "only frames of a running match are drawn");
}
{
  ok(sampleTickets([]).length === 0, "no frames, no line");
  // While downloading, the store's count can trail the array by a flush.
  const fr = [frame(0, 250, 250), frame(2, 249, 250), frame(4, 248, 250)];
  ok(sampleTickets(fr, 2).length === 2, "stops at the count it was given");
}

console.log(`ticket series: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
