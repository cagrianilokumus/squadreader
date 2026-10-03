// Thin fetch helpers for /api/recordings + /api/recording/<id>.

import type { RecordingMeta, Snapshot } from "../state/types";
import { ReplayReconstructor, type RecordingLine } from "../state/replayReconstruct";
import {
  isPackedHeader,
  REPLAY_FORMAT_VERSION,
  ReplayUnpacker,
} from "../state/replayUnpack";

export async function listRecordings(): Promise<RecordingMeta[]> {
  const r = await fetch("./api/recordings", { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as RecordingMeta[];
}

export async function fetchRecordingMeta(id: string): Promise<RecordingMeta> {
  const r = await fetch(`./api/recording/${encodeURIComponent(id)}/meta`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as RecordingMeta;
}

export interface ReplayTiming {
  /** Match start, epoch ms. 0 when unknown. */
  startMs: number;
  /** Whole-recording duration in ms. 0 when unknown. */
  durationMs: number;
  /** Full-frame count, for the old frame-ratio readout. 0 when unknown. */
  ticks: number;
}

/**
 * How long the whole recording is, asked BEFORE the frames arrive.
 *
 * The timeline needs a denominator that does not move: derived from the frames
 * themselves it would grow for the entire download, so the total time and the
 * thumb would slide around under the user.
 *
 * Two sources because neither is universal. The agent build serves `/meta`;
 * central mounts that route only under its SPA prefix, so from `/` — which is
 * what the dev server and the deployed viewer both use — it 404s. The match row
 * is reachable from both and carries `duration_sec`.
 *
 * Never throws: a missing total is a cosmetic loss (the axis falls back to the
 * frames), not a reason to fail a load.
 */
export async function fetchReplayTiming(
  id: string, signal?: AbortSignal,
): Promise<ReplayTiming> {
  const empty: ReplayTiming = { startMs: 0, durationMs: 0, ticks: 0 };
  const path = encodeURIComponent(id);
  try {
    const r = await fetch(`./api/recording/${path}/meta`, { signal });
    if (r.ok) {
      const m = (await r.json()) as RecordingMeta & { startedAtUtc?: string };
      const start = Date.parse(m.startedAtUtc ?? "");
      return {
        startMs: Number.isFinite(start) ? start : 0,
        durationMs: Math.max(0, Math.round((m.durationSec ?? 0) * 1000)),
        ticks: m.ticks ?? 0,
      };
    }
  } catch {
    /* fall through to the match row */
  }
  try {
    const r = await fetch(`./api/match/${path}`, { signal });
    if (!r.ok) return empty;
    const row = (await r.json()) as {
      started_at?: number; ended_at?: number;
      duration_sec?: number; tick_count?: number;
    };
    const seconds = row.duration_sec
      ?? ((row.ended_at ?? 0) - (row.started_at ?? 0));
    return {
      // The row is in epoch SECONDS.
      startMs: row.started_at ? row.started_at * 1000 : 0,
      durationMs: Math.max(0, Math.round((seconds || 0) * 1000)),
      ticks: row.tick_count ?? 0,
    };
  } catch {
    return empty;
  }
}

// Fetches the full NDJSON stream and parses to Snapshot[] in memory.
// For a typical 30 min match this is ~14 MB raw → ~50 MB parsed JS objects.
//
// Streamed + parsed line-by-line as chunks arrive, so (a) `onProgress` can
// report a live frame count for the loading UI, and (b) the parse cost is
// spread across the download instead of one main-thread-freezing pass at the
// end. `onProgress` is called with the running parsed-frame count.
export interface FetchFramesOptions {
  /**
   * Called with the frames parsed SO FAR, while the download continues.
   *
   * It is handed the same array object every time — the one the promise
   * eventually resolves with — so the store can adopt it once and let it grow.
   * Copying per flush would be O(n²) over a download, and a fresh array each
   * time would re-run every `useMemo` keyed on frame identity.
   */
  onFlush?: (frames: Snapshot[]) => void;
  signal?: AbortSignal;
  /** Minimum gap between onFlush calls. */
  flushEveryMs?: number;
  /**
   * Start the stream at this point on the match clock (epoch ms) instead of at
   * the beginning. The server walks its own copy and sends from the first full
   * frame at or after it, so clicking ahead costs one request rather than the
   * whole download. A server that does not know the parameter ignores it and
   * sends everything, which the caller detects and treats as a plain load.
   */
  fromMs?: number;
}

export async function fetchRecordingFrames(
  id: string,
  onProgress?: (framesLoaded: number) => void,
  opts: FetchFramesOptions = {},
): Promise<Snapshot[]> {
  const { onFlush, signal, flushEveryMs = 250, fromMs = 0 } = opts;
  // Ask for the compact format. A server that does not know it ignores the
  // parameter and sends the original, so this is safe to request always.
  const seek = fromMs > 0 ? `&from=${Math.floor(fromMs)}` : "";
  const r = await fetch(
    `./api/recording/${encodeURIComponent(id)}?v=${REPLAY_FORMAT_VERSION}${seek}`,
    signal ? { signal } : undefined);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const out: Snapshot[] = [];
  // Ordering is enforced HERE, as frames are produced, because publishing them
  // progressively means an index is spoken for the moment it exists: the kill
  // timeline tags entries by frame index and the timeline bar has already drawn
  // that frontier. A later sort would renumber frames out from under both. So a
  // frame that cannot be placed after its predecessor is dropped, not moved —
  // recordings are written in order, and this is the defensive case.
  let lastMs = -Infinity;
  let dropped = 0;
  // Two-tier recordings interleave full frames with compact "t":"pos" position
  // frames; the reconstructor folds them into one increasing Snapshot[]. A
  // full-only .sqrx (no "t") passes straight through unchanged.
  const recon = new ReplayReconstructor();
  // The compact format announces itself on its first line. Until then this
  // reads exactly as it always did, so an older server — or a recording whose
  // compact form has not been built yet — is not a special case anywhere.
  const unpacker = new ReplayUnpacker();
  let packed: boolean | null = null;
  const pushLine = (line: string) => {
    if (!line) return;
    let parsed: RecordingLine;
    try {
      parsed = JSON.parse(line) as RecordingLine;
    } catch {
      // Bad line; skip — partial-write tail is rare but possible.
      return;
    }
    if (packed === null) packed = isPackedHeader(parsed);
    // Two layers, and they compose: the unpacker undoes the WIRE format, the
    // reconstructor undoes two-tier recording. Pushing an unpacked frame
    // straight out skipped the second one, so a `"t":"pos"` line — present in
    // most recent recordings — reached the viewer as if it were a snapshot.
    const frame = packed
      ? (unpacker.push(parsed as unknown as Record<string, unknown>) as
          RecordingLine | null)
      : parsed;
    if (!frame) return;
    const snap = recon.push(frame);
    if (!snap) return;
    const t = Date.parse(snap.timestamp ?? "");
    if (!Number.isFinite(t) || t < lastMs) { dropped++; return; }
    lastMs = t;
    out.push(snap);
  };
  const finish = () => {
    if (dropped) {
      console.warn(`[replay] dropped ${dropped} frame(s) that could not be `
        + `placed in time order`);
    }
    onProgress?.(out.length);
    onFlush?.(out);
    return out;
  };

  const reader = r.body?.getReader();
  if (!reader) {
    // No streaming support — fall back to a single blocking read.
    for (const line of (await r.text()).split("\n")) pushLine(line);
    return finish();
  }

  const decoder = new TextDecoder();
  let buf = "";
  let lastReport = 0;
  let lastFlush = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      pushLine(buf.slice(0, nl));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
    if (out.length - lastReport >= 10) {
      onProgress?.(out.length);
      lastReport = out.length;
    }
    // Time-based, not frame-based: the same recording may arrive at 0.5 Hz or
    // 4 Hz, and what the viewer wants is a steady pulse, not a steady count.
    const now = performance.now();
    if (onFlush && out.length && now - lastFlush >= flushEveryMs) {
      lastFlush = now;
      onFlush(out);
    }
  }
  buf += decoder.decode();
  pushLine(buf.trim());
  return finish();
}
