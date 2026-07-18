// Replay loader. When `id` becomes non-null while in replay mode,
// fetch the full NDJSON stream once, parse it into Snapshot[], and
// populate the store's `replay` slice. Cancellable across rapid
// switches.
//
// Lifetime: mounted from App.tsx. Reads `mode` + `replay.id` from the
// store; when the pair (live → replay+id) flips, it runs once. On
// successful load it sets:
//   - replay.frames = [...]
//   - replay.currentIdx = 0   ("playhead at start" — watch from the beginning)
//   - replay.playing = false
//   - replay.baseWallMs = 0, replay.baseSnapMs = 0
//   - also ingestLive(firstFrame) so the canvas renders immediately
//
// On switch back to live, the loader DROPS frames to free memory.

import { useEffect } from "react";
import { fetchRecordingFrames, fetchRecordingMeta } from "./recordings";
import { useViewerStore } from "../state/viewerStore";
import { replayLoad } from "../state/replayLoad";

export function useReplayLoader() {
  const mode = useViewerStore((s) => s.mode);
  const id = useViewerStore((s) => s.replay.id);
  const loadNonce = useViewerStore((s) => s.replay.loadNonce);
  const setReplay = useViewerStore((s) => s.setReplay);
  const ingestLive = useViewerStore((s) => s.ingestLive);
  const setStatus = useViewerStore((s) => s.setStatus);

  useEffect(() => {
    // Drop frames when leaving replay mode — keeps the heap free.
    if (mode !== "replay") {
      setReplay((r) => r.frames.length
        ? { ...r, frames: [], currentIdx: 0, playing: false }
        : r);
      return;
    }
    if (!id) return;
    let cancelled = false;
    setStatus("connecting");
    // Loading UI state (read by BufferOverlay). Reset, then fetch the frame
    // count from the tiny meta sidecar so the progress bar has a denominator.
    replayLoad.active = true;
    replayLoad.loaded = 0;
    replayLoad.total = 0;
    replayLoad.error = false;
    fetchRecordingMeta(id)
      .then((m) => { if (!cancelled) replayLoad.total = m.ticks ?? 0; })
      .catch(() => { /* denominator is best-effort; bar falls back to count */ });
    fetchRecordingFrames(id, (n) => { replayLoad.loaded = n; }).then((rawFrames) => {
      replayLoad.active = false;
      if (cancelled) return;
      // Playback (and the timeline bracket) assumes frames ascend by
      // timestamp. Recordings are written in order, but be robust: if any
      // frame carries a valid timestamp, drop the unplaceable ones (a
      // stray unparseable timestamp otherwise sorts to epoch 0 and
      // corrupts the bracket around it) and sort ascending. If none parse,
      // fall back to stream order.
      // Parse each timestamp exactly ONCE (the old code re-parsed inside a
      // .some(), a .filter(), AND the .sort() comparator — ~2·n·log₂n Date.parse
      // calls on data that is virtually always already time-ordered). Keep only
      // placeable frames; only sort if the stream isn't already ascending.
      let frames = rawFrames;                     // fallback: stream order
      const withT: { f: (typeof rawFrames)[number]; t: number }[] = [];
      for (const f of rawFrames) {
        const t = Date.parse(f?.timestamp ?? "");
        if (Number.isFinite(t)) withT.push({ f, t });
      }
      if (withT.length) {
        let ascending = true;
        for (let i = 1; i < withT.length; i++) {
          if (withT[i]!.t < withT[i - 1]!.t) { ascending = false; break; }
        }
        if (!ascending) withT.sort((a, b) => a.t - b.t);
        frames = withT.map((x) => x.f);
        if (frames.length !== rawFrames.length) {
          console.warn(`[replay] dropped ${rawFrames.length - frames.length} `
            + `frame(s) with an unusable timestamp`);
        }
      }
      if (!frames.length) {
        replayLoad.error = true;
        setStatus("idle");
        return;
      }
      setReplay((r) => ({
        ...r,
        frames,
        currentIdx: 0,
        playing: false,
        speed: r.speed || 1,
        baseWallMs: 0,
        baseSnapMs: 0,
      }));
      // Open at the FIRST frame so a replay starts at the beginning of the
      // match (was frames.length-1 = the end). Push it into curSnap twice so
      // prev == cur — no lerp glitch on the very first rendered frame.
      ingestLive(frames[0]!);
      ingestLive(frames[0]!);
      setStatus("replay");
    }).catch((err) => {
      replayLoad.active = false;
      replayLoad.error = true;
      if (cancelled) return;
      console.error("[replay-loader] failed:", err);
      setStatus("idle");
    });
    return () => { cancelled = true; };
    // loadNonce in the deps lets a retry re-run this for the same id.
  }, [mode, id, loadNonce, setReplay, ingestLive, setStatus]);
}
