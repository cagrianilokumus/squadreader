// Replay loader. When `id` becomes non-null while in replay mode, stream the
// NDJSON recording and publish frames into the store AS THEY ARRIVE.
//
// Lifetime: mounted from App.tsx. Reads `mode` + `replay.id` from the store;
// when the pair (live → replay+id) flips, it runs once.
//
// It used to wait for the last byte before anything reached the screen — one
// `.then()` that sorted, published, and pre-computed the kill feed over the
// whole match. On a 168 MB recording that is a long stare at a loading card
// while the data needed to show the first second was already in memory. Now:
//
//   * frames are flushed into the store about four times a second;
//   * the viewer installs once ~4 s of match exists (REPLAY_PREBUFFER_MS) and
//     is immediately playable, with the rest arriving behind the playhead;
//   * the kill feed is diffed forward in the same chunks, which is exactly the
//     order the one-shot pass used, so its output is unchanged;
//   * the whole-recording duration is fetched separately so the timeline axis
//     is right from the first frame instead of growing all download long.
//
// On switch back to live, the loader DROPS frames to free memory.

import { useEffect } from "react";
import { fetchRecordingFrames, fetchReplayTiming } from "./recordings";
import { useViewerStore } from "../state/viewerStore";
import {
  replayLoad, REPLAY_PREBUFFER_MS, REPLAY_PREBUFFER_MIN_FRAMES,
} from "../state/replayLoad";
import { createDiffState, diffSnapshot, flushPendingDeaths } from "../killfeed/diff";
import {
  createMarkerState, extendMarkers, findDuplicate, type ReplayMarker,
} from "../state/replayMarkers";
import type { KillFeedEntry, Snapshot } from "../state/types";

/** First frame at or after `ms`, by binary search. */
function indexAtMs(frames: Snapshot[], ms: number): number {
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(frames[mid]!.timestamp ?? "") < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function useReplayLoader() {
  const mode = useViewerStore((s) => s.mode);
  const id = useViewerStore((s) => s.replay.id);
  const loadNonce = useViewerStore((s) => s.replay.loadNonce);
  const windowFromMs = useViewerStore((s) => s.replay.windowFromMs);
  const setReplay = useViewerStore((s) => s.setReplay);
  const ingestLive = useViewerStore((s) => s.ingestLive);
  const setStatus = useViewerStore((s) => s.setStatus);
  const setReplayKillTimeline = useViewerStore((s) => s.setReplayKillTimeline);
  const appendReplayFrames = useViewerStore((s) => s.appendReplayFrames);
  const setReplayTiming = useViewerStore((s) => s.setReplayTiming);
  const finishReplayLoad = useViewerStore((s) => s.finishReplayLoad);
  const addReplayMarkers = useViewerStore((s) => s.addReplayMarkers);

  useEffect(() => {
    // Drop frames when leaving replay mode — keeps the heap free.
    if (mode !== "replay") {
      setReplay((r) => r.frames.length
        ? { ...r, frames: [], frameCount: 0, currentIdx: 0, playing: false,
            loading: false, stalled: false, startMs: 0, bufferedMs: 0 }
        : r);
      return;
    }
    if (!id) return;

    let cancelled = false;
    // Not optional. React StrictMode mounts this effect twice in development,
    // and switching recordings mid-download used to leave the old stream
    // running — with progressive flushes BOTH would publish, racing two
    // different arrays into a store field whose whole design rests on identity.
    const ac = new AbortController();

    setStatus("connecting");
    replayLoad.active = true;
    replayLoad.loaded = 0;
    replayLoad.total = 0;
    replayLoad.error = false;
    setReplay((r) => ({ ...r, loading: true, stalled: false, truncated: false }));

    // Fire-and-forget: the frames must not wait on it. It usually lands within
    // the first prebuffer, so the axis is correct before anything is drawn.
    void fetchReplayTiming(id, ac.signal).then((t) => {
      if (cancelled) return;
      setReplayTiming({ startMs: t.startMs, durationMs: t.durationMs });
      replayLoad.total = t.ticks;
      replayLoad.totalMs = t.durationMs;
    });

    // Per-load incremental state. The kill feed is a forward-only diff, so it
    // extends naturally — this is the same `createDiffState` fed the same
    // frames in the same order as the old whole-match loop, just in chunks.
    const dstate = createDiffState();
    const timeline: (KillFeedEntry & { frameIdx: number })[] = [];
    let diffedUpTo = 0;
    let installed = false;

    // Timeline markers, found in the same chunks. They outlive this load (a seek
    // that restarts the download keeps them), so a marker is new only if neither
    // the store nor this flush already holds it — see `findDuplicate`.
    const mstate = createMarkerState();
    let fresh: ReplayMarker[] = [];
    const sink = (m: ReplayMarker): ReplayMarker =>
      findDuplicate(useViewerStore.getState().replay.markers, m)
        ?? findDuplicate(fresh, m)
        ?? (fresh.push(m), m);

    const extendKills = (frames: Snapshot[], final: boolean) => {
      for (let i = diffedUpTo; i < frames.length; i++) {
        const res = diffSnapshot(dstate, frames[i]!);
        for (const e of res.newEntries) timeline.push({ ...e, frameIdx: i });
      }
      diffedUpTo = frames.length;
      // A death in the last seconds may still be waiting for a late event that
      // will now never come; settle it on the last frame.
      if (final && frames.length) {
        const last = frames.length - 1;
        for (const e of flushPendingDeaths(dstate, frames[last]!))
          timeline.push({ ...e, frameIdx: last });
      }
    };

    const spans = (frames: Snapshot[]) => {
      const a = Date.parse(frames[0]?.timestamp ?? "");
      const b = Date.parse(frames[frames.length - 1]?.timestamp ?? "");
      return Number.isFinite(a) && Number.isFinite(b) ? b - a : 0;
    };

    const onFlush = (frames: Snapshot[], final = false) => {
      if (cancelled || !frames.length) return;
      // Kills first, so a frame and the kills it carries become visible in the
      // same store update — never a frame whose kill row arrives a tick later.
      extendKills(frames, final);
      extendMarkers(mstate, frames, sink);
      if (fresh.length) { addReplayMarkers(fresh); fresh = []; }
      replayLoad.loaded = frames.length;
      replayLoad.bufferedMs = spans(frames);

      if (!installed) {
        // Time, not frame count: the same recording may be 0.5 Hz or 4 Hz, and
        // what makes playback feel ready is seconds of match, not rows.
        const ready = final
          || (spans(frames) >= REPLAY_PREBUFFER_MS
              && frames.length >= REPLAY_PREBUFFER_MIN_FRAMES);
        if (!ready) return;
        installed = true;
        // Twice, so prev == cur — no lerp glitch on the first rendered frame.
        ingestLive(frames[0]!);
        ingestLive(frames[0]!);
        setReplayKillTimeline(timeline);
        appendReplayFrames(frames);
        // Where the playhead lands after a seek-restart. Normally frame 0 IS
        // the requested point, so this finds 0 and does nothing. It earns its
        // keep against a server that does not know `from` and streams from the
        // beginning anyway: without it the viewer would quietly start playing
        // the match from minute zero after the user clicked minute twenty.
        if (windowFromMs > 0) {
          const at = indexAtMs(frames, windowFromMs);
          if (at > 0) setReplay((r) => ({ ...r, currentIdx: at,
                                          baseWallMs: 0, baseSnapMs: 0 }));
        }
        replayLoad.active = false;
        setStatus("replay");
        return;
      }
      appendReplayFrames(frames);
    };

    fetchRecordingFrames(id, (n) => { replayLoad.loaded = n; }, {
      signal: ac.signal,
      fromMs: windowFromMs,
      onFlush: (frames) => onFlush(frames),
    }).then((frames) => {
      if (cancelled) return;
      onFlush(frames, true);          // install even a recording shorter than the prebuffer
      replayLoad.active = false;
      if (!installed) {               // genuinely empty: nothing playable at all
        setReplay((r) => ({ ...r, loading: false, stalled: false }));
        replayLoad.error = true;
        setStatus("idle");
        return;
      }
      finishReplayLoad();
    }).catch((err) => {
      if (cancelled || ac.signal.aborted) return;
      replayLoad.active = false;
      if (installed) {
        // Keep what arrived. Half a match you can watch beats an error card
        // over frames that are already in memory.
        console.warn("[replay-loader] stream ended early:", err);
        finishReplayLoad({ truncated: true });
        return;
      }
      // Clear `loading` as well: left set, every rule that asks "is this the
      // end of the match or just the end of the download?" answers wrongly
      // for the rest of the session.
      setReplay((r) => ({ ...r, loading: false, stalled: false }));
      replayLoad.error = true;
      console.error("[replay-loader] failed:", err);
      setStatus("idle");
    });

    return () => { cancelled = true; ac.abort(); };
    // loadNonce in the deps lets a retry re-run this for the same id.
    // windowFromMs is read, not depended on: `restartReplayAt` bumps the nonce
    // in the same update, and listing both would run this effect twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, id, loadNonce, setReplay, ingestLive, setStatus,
      setReplayKillTimeline, appendReplayFrames, setReplayTiming,
      finishReplayLoad, addReplayMarkers]);
}
