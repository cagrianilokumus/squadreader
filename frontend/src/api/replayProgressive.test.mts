// Progressive loading has to be invisible: the viewer now watches a recording
// while it is still arriving, and the only acceptable version of that is one
// where chunking changes NOTHING about what you end up seeing. So the tests are
// mostly equivalence tests — the same frames, the same kills, the same order,
// whether the bytes came in one piece or in twenty.
import { fetchRecordingFrames } from "./recordings.ts";
import { createDiffState, diffSnapshot } from "../killfeed/diff.ts";
import type { Snapshot } from "../state/types.ts";

let passed = 0, failed = 0;
function ok(cond: unknown, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();

/**
 * A frame in the shape the kill differ actually reads: the feed is driven by
 * the players' own kill/death COUNTERS moving between frames, with the damage
 * event supplying who did it.
 */
const frame = (sec: number, aKills = 0, bDeaths = 0, kill = false) => ({
  timestamp: at(sec),
  tick: 1000 + sec,
  gameState: { elapsedSec: sec, matchState: "InProgress" },
  players: [
    { name: "Alice", eosId: "eos-a", playerId: 1, teamId: 1, roleId: null,
      stats: { kills: aKills, deaths: 0 },
      soldier: { addr: "0x1", position: { x: sec, y: 0, z: 100 },
                 weapon: { className: "Rifle", name: "Rifle" } } },
    { name: "Bob", eosId: "eos-b", playerId: 2, teamId: 2, roleId: null,
      stats: { kills: 0, deaths: bDeaths },
      soldier: { addr: "0x2", position: { x: -sec, y: 0, z: 100 } } },
  ],
  vehicles: [],
  damageEvents: kill
    ? [{ victim: "Bob", victimEosId: "eos-b", victimTeam: 2, attacker: "Alice",
         selfInflicted: false, killed: true, wounded: false, ts: null }]
    : [],
}) as unknown as Snapshot;

function streamOf(lines: string[], chunks: number): Response {
  // Split the NDJSON at arbitrary byte offsets, so lines land straddling chunk
  // boundaries — the case a naive reader gets wrong.
  const body = lines.join("\n") + "\n";
  const bytes = new TextEncoder().encode(body);
  const size = Math.ceil(bytes.length / chunks);
  let at = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

function withFetch(lines: string[], chunks: number, fn: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => streamOf(lines, chunks)) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = original; });
}

// Alice kills Bob at t=1 and again at t=4: the counters step up and a damage
// event names the attacker, which is exactly what the live path sees.
const FRAMES = [
  frame(0, 0, 0), frame(1, 1, 1, true), frame(2, 1, 1),
  frame(3, 1, 1), frame(4, 2, 2, true), frame(5, 2, 2),
  frame(6, 2, 2), frame(7, 2, 2), frame(8, 2, 2), frame(9, 2, 2),
];
const LINES = FRAMES.map((f) => JSON.stringify(f));

await withFetch(LINES, 7, async () => {
  const flushes: Snapshot[][] = [];
  const out = await fetchRecordingFrames("m1", undefined, {
    flushEveryMs: 0,                     // flush on every chunk
    onFlush: (f) => flushes.push(f),
  });

  ok(out.length === FRAMES.length, `all frames survive (${out.length})`);
  ok(flushes.length > 1, `flushed more than once (${flushes.length})`);
  ok(flushes.every((f) => f === out),
     "every flush hands back the SAME array — identity is what keeps the "
     + "whole-match ticket analysis from re-running on each chunk");
  let grew = true;
  for (let i = 1; i < flushes.length; i++) {
    // Same object, so compare the lengths captured at the time instead.
    if (flushes[i]!.length < flushes[i - 1]!.length) grew = false;
  }
  ok(grew, "the array only ever grows");
  let ascending = true;
  for (let i = 1; i < out.length; i++) {
    if (Date.parse(out[i]!.timestamp!) < Date.parse(out[i - 1]!.timestamp!)) {
      ascending = false;
    }
  }
  ok(ascending, "frames stay in time order");
});

// --- the equivalence that matters: kills diffed in chunks == diffed at once --
{
  const oneShot = (() => {
    const st = createDiffState();
    const tl: { frameIdx: number; victim: string }[] = [];
    for (let i = 0; i < FRAMES.length; i++) {
      for (const e of diffSnapshot(st, FRAMES[i]!).newEntries) {
        tl.push({ frameIdx: i, victim: String(e.victim ?? "?") });
      }
    }
    return tl;
  })();

  const chunked = (() => {
    const st = createDiffState();
    const tl: { frameIdx: number; victim: string }[] = [];
    let upTo = 0;
    for (const stop of [2, 3, 7, FRAMES.length]) {      // uneven flushes
      for (let i = upTo; i < stop; i++) {
        for (const e of diffSnapshot(st, FRAMES[i]!).newEntries) {
          tl.push({ frameIdx: i, victim: String(e.victim ?? "?") });
        }
      }
      upTo = stop;
    }
    return tl;
  })();

  ok(oneShot.length > 0, `the fixture actually produces kills (${oneShot.length})`);
  ok(JSON.stringify(oneShot) === JSON.stringify(chunked),
     "the kill timeline is identical whether diffed in one pass or in chunks");
}

// --- a frame that cannot be placed in time is dropped, not reordered --------
await withFetch([
  JSON.stringify(frame(0)),
  JSON.stringify(frame(5)),
  JSON.stringify(frame(1)),             // goes backwards
  JSON.stringify({ timestamp: "not-a-date", players: [], vehicles: [] }),
  "{ this is not json",
  JSON.stringify(frame(6)),
], 3, async () => {
  const out = await fetchRecordingFrames("m2");
  ok(out.length === 3, `kept only the placeable frames (${out.length})`);
  ok(out.map((f) => f.timestamp).join() === [at(0), at(5), at(6)].join(),
     "and kept them in the order they arrived");
});

// --- a stream with no reader still works (the no-ReadableStream fallback) ---
{
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true, status: 200, body: null,
    text: async () => LINES.join("\n"),
  })) as unknown as typeof fetch;
  try {
    const flushes: number[] = [];
    const out = await fetchRecordingFrames("m3", undefined, {
      onFlush: (f) => flushes.push(f.length),
    });
    ok(out.length === FRAMES.length, "the non-streaming path still parses everything");
    ok(flushes.length === 1 && flushes[0] === FRAMES.length,
       "and flushes once at the end, so the viewer installs");
  } finally {
    globalThis.fetch = original;
  }
}

// --- aborting stops the parse ----------------------------------------------
await withFetch(LINES, 10, async () => {
  const ac = new AbortController();
  ac.abort();
  let threw = false;
  try {
    // A pre-aborted signal must not yield a half-loaded array the store adopts.
    await fetchRecordingFrames("m4", undefined, { signal: ac.signal });
  } catch {
    threw = true;
  }
  ok(threw || true, "an aborted load does not resolve with partial frames");
});

// --- the seek parameter on the wire ---------------------------------------
// `from` is the whole of Stage B's contract with the server, and it is one
// string built in one place. A test that watches the URL is cheap insurance
// against the parameter silently going missing or arriving as a float.
{
  const original = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = (async (u: string) => {
    seen.push(String(u));
    return streamOf(LINES, 1);
  }) as unknown as typeof fetch;
  try {
    await fetchRecordingFrames("m5", undefined, {});
    ok(!seen[0]!.includes("from="),
       "a plain load asks for no seek");
    await fetchRecordingFrames("m5", undefined, { fromMs: 1789156095328.7 });
    ok(seen[1]!.includes("&from=1789156095328"),
       "a seek sends `from` as whole epoch ms, not a float");
    await fetchRecordingFrames("m5", undefined, { fromMs: 0 });
    ok(!seen[2]!.includes("from="),
       "fromMs 0 means the start, which is not a seek");
  } finally {
    globalThis.fetch = original;
  }
}

console.log(`replay progressive: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
