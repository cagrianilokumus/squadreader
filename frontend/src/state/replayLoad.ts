// Non-reactive replay-load progress, mirrored from useReplayLoader while a
// recording is being fetched + parsed. Read by BufferOverlay (which polls on a
// timer) to show a loading card — kept out of the zustand store so the frequent
// progress ticks don't re-render subscribed UI.
//
// `loaded`/`total` are FRAME counts and `total` counts only the full frames a
// recording announces, so on a two-tier (4 Hz) recording the reconstructed
// stream is several times longer than the denominator and the ratio runs past
// 100%. `loadedMs`/`totalMs` are the honest pair and are what the bar uses;
// the counts are kept for the detail line.
export const replayLoad = {
  active: false,
  loaded: 0,
  total: 0,
  /** Match time held so far, ms. */
  bufferedMs: 0,
  /** Whole-recording duration, ms. 0 until the server says. */
  totalMs: 0,
  error: false,
};

/**
 * How much match must exist before the viewer opens the recording.
 *
 * Measured in TIME rather than frames because the same recording can arrive at
 * 0.5 Hz (full frames only) or 4 Hz (two-tier): four seconds of match is four
 * seconds either way, where "twenty frames" is anything from five seconds to
 * five.
 */
export const REPLAY_PREBUFFER_MS = 4000;
/** ...and never open on a single frame, however long it claims to span. */
export const REPLAY_PREBUFFER_MIN_FRAMES = 4;
