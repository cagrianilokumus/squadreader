// React glue for the diff module. Subscribes to curSnap, runs the diff
// when the tick id changes, pushes any new entries into the store.
// useRef holds the cross-tick state so React reloads don't lose it.

import { useEffect, useRef } from "react";
import { useViewerStore } from "../state/viewerStore";
import { createDiffState, diffSnapshot, type DiffState } from "./diff";

export function useKillFeed() {
  const stateRef = useRef<DiffState>();
  if (!stateRef.current) stateRef.current = createDiffState();
  const push = useViewerStore((s) => s.pushKillFeed);

  // Subscribe outside React render cycle — we don't want the
  // component using this hook to re-render on every tick. Zustand's
  // `subscribe` returns an unsubscribe fn.
  useEffect(() => {
    let lastTick: number | null | undefined = -1;
    let lastMode = useViewerStore.getState().mode;
    const unsub = useViewerStore.subscribe((s) => {
      // A mode flip means the next snapshot belongs to a different match, so the
      // cross-tick state has to go with it. Diffing a replay's first frame against
      // the live match's kill/death counters manufactures kills that never
      // happened (every counter looks like it jumped), and the reverse on the way
      // back. A fresh DiffState seeds on its first snapshot instead of emitting —
      // see `inited` in diff.ts — which is exactly what we want here.
      if (s.mode !== lastMode) {
        lastMode = s.mode;
        stateRef.current = createDiffState();
        lastTick = -1;
      }
      const snap = s.curSnap;
      if (!snap) return;
      // Avoid double-processing the same snapshot if the store
      // re-emits without a tick advance.
      const tick = snap.tick ?? snap.timestamp as unknown as number;
      if (tick === lastTick) return;
      lastTick = tick as number;
      const result = diffSnapshot(stateRef.current!, snap);
      if (result.newEntries.length) push(result.newEntries);
    });
    return unsub;
  }, [push]);
}
