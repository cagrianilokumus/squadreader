// Bottom-fixed timeline scrubber. Shown only in replay mode after
// frames have been loaded. Drives `replay.currentIdx` /
// `replay.playing` / `replay.speed` on the viewer store; the rAF
// playback engine (`useReplayPlayback`) reads those and advances the
// playhead. Seeks ±30 s walk the frames[] timestamp list rather than
// the index alone — a 5-min gap (e.g. paused recorder) wouldn't be
// fairly represented by a fixed step count.

import { useViewerStore } from "../state/viewerStore";
import type { Snapshot } from "../state/types";

function fmtMMSS(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function snapMs(s: Snapshot | undefined | null): number {
  if (!s || !s.timestamp) return 0;
  const t = Date.parse(s.timestamp);
  return Number.isFinite(t) ? t : 0;
}

const SPEEDS = [1, 2, 4, 8] as const;

export function TimelineBar() {
  const mode    = useViewerStore((s) => s.mode);
  const frames  = useViewerStore((s) => s.replay.frames);
  // `frames` is mutated in place while downloading, so it cannot be the signal
  // that it grew. These scalars are.
  const frameCount  = useViewerStore((s) => s.replay.frameCount);
  const loading     = useViewerStore((s) => s.replay.loading);
  const bufferedMs  = useViewerStore((s) => s.replay.bufferedMs);
  const totalMs     = useViewerStore((s) => s.replay.totalMs);
  const startMsStore = useViewerStore((s) => s.replay.startMs);
  const matchStartMs = useViewerStore((s) => s.replay.matchStartMs);
  const restartReplayAt = useViewerStore((s) => s.restartReplayAt);
  const idx     = useViewerStore((s) => s.replay.currentIdx);
  const playing = useViewerStore((s) => s.replay.playing);
  const stalled = useViewerStore((s) => s.replay.stalled);
  const speed   = useViewerStore((s) => s.replay.speed);
  const setReplay = useViewerStore((s) => s.setReplay);

  if (mode !== "replay" || frameCount === 0) return null;

  const lastIdx = frameCount - 1;
  // Two different starts, and the difference matters. `windowStart` is the first
  // frame we HOLD; `startMs` is where the MATCH begins. They diverge once a seek
  // has restarted the download part-way in — and drawing the axis from the
  // window would rescale the whole bar around whichever piece is in memory.
  const windowStart = startMsStore || snapMs(frames[0]);
  const startMs = matchStartMs || windowStart;
  const curMs   = snapMs(frames[idx]);
  // The denominator comes from the SERVER, not from the frames in hand. Derived
  // from the frames it would grow for the whole download — the total time and
  // the thumb would both crawl rightwards under the user's cursor. It falls back
  // to what we hold only when the server told us nothing.
  const durationMs = totalMs > 0
    ? totalMs : Math.max(1, (bufferedMs || snapMs(frames[lastIdx])) - startMs);
  const elapsedMs  = Math.max(0, curMs - startMs);

  // Seek to a specific frame index. Rebases playback anchors so play
  // resumes from the new position cleanly.
  const seekToIdx = (newIdx: number) => {
    const clamped = Math.max(0, Math.min(lastIdx, newIdx));
    setReplay((r) => ({ ...r, currentIdx: clamped,
                        baseWallMs: 0, baseSnapMs: 0 }));
  };

  /**
   * Seek to a point on the MATCH clock.
   *
   * Inside what is held, that is a binary search. Outside it there is nothing to
   * search: the server has no Range support and the stream has no index, so the
   * only way to reach an unheld point is to ask the stream to start there. That
   * is the behaviour asked for — click ahead and it begins there, with the rest
   * arriving behind it.
   *
   * The 1 s slack on the lower bound is for the ±30 s button landing a hair
   * before the first held frame; restarting the download for that would be a
   * silly way to spend a request.
   */
  const seekToMs = (target: number) => {
    const held = target >= windowStart - 1000 && target <= bufferedMs;
    if (!held) { restartReplayAt(Math.max(startMs, target)); return; }
    let lo = 0, hi = lastIdx;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (snapMs(frames[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    seekToIdx(lo);
  };

  // ±N-second jump along the timestamp axis (not the index axis).
  const seekDeltaMs = (deltaMs: number) => { seekToMs(curMs + deltaMs); };

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekToMs(startMs + (parseFloat(e.target.value) / 100) * durationMs);
  };

  const togglePlay = () => {
    setReplay((r) => ({
      ...r,
      playing: !r.playing,
      // Rebase anchors so resume starts from the current playhead.
      baseWallMs: 0,
      baseSnapMs: 0,
      // If at the END OF THE MATCH, pressing play rewinds to the start. Not
      // merely at the end of what has downloaded: that would throw away the
      // half-hour you just watched every time playback caught the frontier.
      currentIdx: (r.currentIdx >= lastIdx && !r.loading) ? 0 : r.currentIdx,
    }));
  };

  const setSpeed = (sp: number) => {
    setReplay((r) => ({ ...r, speed: sp, baseWallMs: 0, baseSnapMs: 0 }));
  };

  const pct = Math.max(0, Math.min(100, (elapsedMs / durationMs) * 100));
  const asPct = (ms: number) =>
    Math.max(0, Math.min(100, ((ms - startMs) / durationMs) * 100));
  // How much of the match is in hand, on the same axis. The band runs from where
  // the window begins — not from zero, because after a seek the earlier part of
  // the match genuinely is not held any more. On a finished recording it starts
  // at 0 and ends at 100, so the bar renders as it did before this existed.
  //
  // One special case, for the common case: a recording that finished loading
  // from the start holds everything, so the band would cover the entire track
  // and recolour a bar nobody asked to change. Collapsing it to the playhead
  // makes that render byte-identical to before any of this existed. After a
  // seek it does NOT collapse — there the missing head is real information.
  const whollyHeld = !loading && asPct(windowStart) <= 0.01;
  const bufFrom = whollyHeld ? pct : asPct(windowStart);
  const bufTo = whollyHeld ? pct : Math.max(pct, asPct(bufferedMs));

  return (
    <div id="timeline-bar"
         title="Space: play/pause · F: Fit map · Tab: scoreboard">
      <button className={`tb-btn${stalled ? " tb-buffering" : ""}`}
              onClick={togglePlay}
              title={stalled ? "buffering — waiting for the download"
                             : playing ? "pause (space)" : "play (space)"}>
        {playing ? "⏸" : "▶"}
      </button>
      <button className="tb-btn" onClick={() => seekDeltaMs(-30_000)}
              title="back 30s">⏮ 30s</button>
      <button className="tb-btn" onClick={() => seekDeltaMs(30_000)}
              title="forward 30s">30s ⏭</button>
      <input className="tb-scrub" type="range"
             min={0} max={100} step={0.05}
             value={pct} onChange={onScrub}
             title="timeline (drag)"
             style={{ "--pct": `${pct}%`,
                      "--buf0": `${bufFrom}%`,
                      "--buf": `${bufTo}%` } as React.CSSProperties} />
      <span className="tb-clock">
        {fmtMMSS(elapsedMs)} / {fmtMMSS(durationMs)}
      </span>
      <div className="tb-speeds">
        {SPEEDS.map((sp) => (
          <button key={sp}
                  className={"tb-spd " + (speed === sp ? "active" : "")}
                  onClick={() => setSpeed(sp)}>
            {sp}×
          </button>
        ))}
      </div>
    </div>
  );
}
