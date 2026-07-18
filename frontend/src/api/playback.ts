// Replay playback engine. While `mode === "replay"` and
// `replay.playing` is true, a rAF loop advances `currentIdx` at
// `speed × real-tick-rate`. Each new index pushes its frame into
// `ingestLive` so the canvas (which is mode-agnostic) just renders.
//
// Speed handling: we don't multiply the tick budget. Instead we use
// wall-clock anchors:
//   At play / seek / speed-change we capture:
//     baseWallMs  = performance.now()
//     baseSnapMs  = frames[currentIdx].timestamp (ms since epoch)
//   On each rAF:
//     wallElapsed = (now - baseWallMs) * speed
//     targetSnapMs = baseSnapMs + wallElapsed
//     advance currentIdx to the largest frame with timestamp <= target
//
// Pausing → freeze idx. Seeking → set idx then rebase anchors. Speed
// change → rebase anchors (so the new speed starts from the current
// playhead, not double-counting elapsed time).

import { useEffect, useRef } from "react";
import { useViewerStore } from "../state/viewerStore";
import { replayClock } from "../state/replayClock";

function snapMs(snap: { timestamp?: string | null } | undefined | null): number {
  if (!snap || !snap.timestamp) return 0;
  const t = Date.parse(snap.timestamp);
  return Number.isFinite(t) ? t : 0;
}

export function useReplayPlayback() {
  const rafRef = useRef<number | null>(null);
  // Local mirrors so the rAF tick reads fresh state without rebinding.
  const lastIdxRef = useRef(-1);

  useEffect(() => {
    const tick = () => {
      const s = useViewerStore.getState();
      if (s.mode !== "replay" || !s.replay.frames.length) {
        replayClock.valid = false;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const r = s.replay;
      const N = r.frames.length;
      const lastIdx = N - 1;

      // Pause: FREEZE the playhead exactly where playback stopped (possibly
      // mid-way between two frames) so pausing never rewinds the picture to
      // the frame boundary — that was the "pause jumps back a few frames"
      // bug. Only a seek (currentIdx changed externally) moves it.
      if (!r.playing) {
        if (lastIdxRef.current !== r.currentIdx) {
          // Seek while paused — jump the playhead to the picked frame.
          replayClock.ms = snapMs(r.frames[r.currentIdx]);
          s.ingestLive(r.frames[r.currentIdx]!);
          lastIdxRef.current = r.currentIdx;
        } else if (!replayClock.valid) {
          // First paused tick with no playhead yet (fresh load).
          replayClock.ms = snapMs(r.frames[r.currentIdx]);
        }
        replayClock.valid = true;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Playing. Compute the target frame by wall-clock × speed.
      const now = performance.now();
      let baseWallMs = r.baseWallMs;
      let baseSnapMs = r.baseSnapMs;
      // First tick of play, or seek/speed-change rebase needed.
      if (baseWallMs === 0 || baseSnapMs === 0
          || lastIdxRef.current !== r.currentIdx) {
        const fa = snapMs(r.frames[r.currentIdx]);
        const fb = r.currentIdx < lastIdx
          ? snapMs(r.frames[r.currentIdx + 1]) : Infinity;
        // Resume/speed-change: continue from the FROZEN mid-span playhead
        // when it still falls inside the current frame pair, so play→pause→
        // play (or a speed switch) never replays the piece you already
        // watched. A real seek moves currentIdx, which puts the frozen clock
        // outside [fa, fb) — then we start from the seeked frame instead.
        baseWallMs = now;
        baseSnapMs = (replayClock.valid
                      && replayClock.ms >= fa && replayClock.ms < fb)
          ? replayClock.ms : fa;
        s.setReplay((rr) => ({ ...rr, baseWallMs, baseSnapMs }));
      }
      const wallElapsed = (now - baseWallMs) * r.speed;
      const targetSnap = baseSnapMs + wallElapsed;

      // Publish the continuous playhead (clamped to the recording) for the
      // canvas to interpolate against. Updated every frame, even between
      // idx boundaries, which is what makes replay motion smooth.
      replayClock.ms = Math.min(targetSnap, snapMs(r.frames[lastIdx]));
      replayClock.valid = true;

      // Advance idx forward to the largest frame <= targetSnap.
      let idx = r.currentIdx;
      while (idx + 1 <= lastIdx
             && snapMs(r.frames[idx + 1]) <= targetSnap) {
        idx++;
      }
      if (idx >= lastIdx) {
        // Reached the end → pause + clamp at last frame.
        s.setReplay((rr) => ({
          ...rr,
          currentIdx: lastIdx,
          playing: false,
          baseWallMs: 0,
          baseSnapMs: 0,
        }));
        s.ingestLive(r.frames[lastIdx]!);
        lastIdxRef.current = lastIdx;
      } else if (idx !== r.currentIdx) {
        s.setReplay((rr) => ({ ...rr, currentIdx: idx }));
        s.ingestLive(r.frames[idx]!);
        lastIdxRef.current = idx;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);
}
