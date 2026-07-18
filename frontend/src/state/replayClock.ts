// Continuous replay playhead time (ms since epoch, matching Snapshot.timestamp).
// Written by the playback engine every animation frame and read by the canvas
// to interpolate between the two recorded frames bracketing it — so replay is
// smooth at 60fps instead of snapping every ~2s recorded frame.
//
// Deliberately NOT in the zustand store: updating a store field at 60fps would
// re-render every subscribed component (TimelineBar, panels, …). `valid` is
// false whenever replay isn't actively driving the canvas (live mode, or no
// frames loaded yet) so the canvas falls back to its normal path.
export const replayClock = { ms: 0, valid: false };
