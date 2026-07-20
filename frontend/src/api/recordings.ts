// Thin fetch helpers for /api/recordings + /api/recording/<id>.

import type { RecordingMeta, Snapshot } from "../state/types";
import { ReplayReconstructor, type RecordingLine } from "../state/replayReconstruct";

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

// Fetches the full NDJSON stream and parses to Snapshot[] in memory.
// For a typical 30 min match this is ~14 MB raw → ~50 MB parsed JS objects.
//
// Streamed + parsed line-by-line as chunks arrive, so (a) `onProgress` can
// report a live frame count for the loading UI, and (b) the parse cost is
// spread across the download instead of one main-thread-freezing pass at the
// end. `onProgress` is called with the running parsed-frame count.
export async function fetchRecordingFrames(
  id: string,
  onProgress?: (framesLoaded: number) => void,
): Promise<Snapshot[]> {
  const r = await fetch(`./api/recording/${encodeURIComponent(id)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const out: Snapshot[] = [];
  // Two-tier recordings interleave full frames with compact "t":"pos" position
  // frames; the reconstructor folds them into one increasing Snapshot[]. A
  // full-only .sqrx (no "t") passes straight through unchanged.
  const recon = new ReplayReconstructor();
  const pushLine = (line: string) => {
    if (!line) return;
    let parsed: RecordingLine;
    try {
      parsed = JSON.parse(line) as RecordingLine;
    } catch {
      // Bad line; skip — partial-write tail is rare but possible.
      return;
    }
    const snap = recon.push(parsed);
    if (snap) out.push(snap);
  };

  const reader = r.body?.getReader();
  if (!reader) {
    // No streaming support — fall back to a single blocking read.
    for (const line of (await r.text()).split("\n")) pushLine(line);
    onProgress?.(out.length);
    return out;
  }

  const decoder = new TextDecoder();
  let buf = "";
  let lastReport = 0;
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
  }
  buf += decoder.decode();
  pushLine(buf.trim());
  onProgress?.(out.length);
  return out;
}
