// Non-reactive replay-load progress, mirrored from useReplayLoader while a
// recording is being fetched + parsed. Read by BufferOverlay (which polls on a
// timer) to show a loading card — kept out of the zustand store so the frequent
// progress ticks don't re-render subscribed UI. `total` is the frame count from
// the recording's meta (0 until known); `loaded` is frames parsed so far.
export const replayLoad = {
  active: false,
  loaded: 0,
  total: 0,
  error: false,
};
