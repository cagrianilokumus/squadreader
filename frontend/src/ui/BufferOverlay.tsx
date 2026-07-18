// Buffering / loading overlay for both the live and replay paths.
//
// LIVE — the map renders a fixed RENDER_DELAY_MS in the PAST between two
// already-arrived snapshots (see viewerStore / MapCanvas). That's what makes
// the map stable, but it has two visible "waiting" moments that would otherwise
// look like a hang:
//   1. COLD START (warmup): for the first ~DELAY seconds after connecting, the
//      render clock is still behind the oldest buffered frame → full centered
//      card with a progress bar.
//   2. GENUINE STALL: no new frame for > RENDER_DELAY_MS (reader restart / SSE
//      drop) → compact top banner; last-known map stays visible beneath.
//
// REPLAY — fetching + parsing a recording (tens of MB) takes a few seconds with
// a blank map. Show a loading card with a real frame-count progress bar, and an
// error card if the fetch fails.
//
// Self-contained: polls state on a light 100ms timer (no per-frame store
// writes) and mirrors the phase logic the canvas uses, so the overlay appears
// iff the map is actually waiting.

import { useEffect, useState } from "react";
import { useViewerStore, RENDER_DELAY_MS } from "../state/viewerStore";
import { replayLoad } from "../state/replayLoad";

type Phase = "connecting" | "warmup" | "stalled"
           | "replayload" | "replayerror" | "live";

interface BufState {
  phase: Phase;
  pct: number;       // warmup fill / replay-load fraction 0..1
  staleSec: number;  // stalled: seconds since last frame
  loaded: number;    // replayload: frames parsed so far
  total: number;     // replayload: total frames (0 = unknown)
  reconnecting: boolean;
}

// ?previewBuffer=warmup|stalled|connecting|replayload|replayerror
const PREVIEW = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("previewBuffer")
  : null;

function computeState(): BufState {
  const s = useViewerStore.getState();
  const reconnecting = s.status === "reconnecting";
  const base = { staleSec: 0, loaded: 0, total: 0, reconnecting };

  if (s.mode === "replay") {
    if (replayLoad.active) {
      const pct = replayLoad.total > 0
        ? Math.max(0, Math.min(1, replayLoad.loaded / replayLoad.total)) : 0;
      return { phase: "replayload", pct, staleSec: 0,
               loaded: replayLoad.loaded, total: replayLoad.total, reconnecting };
    }
    if (replayLoad.error) {
      return { phase: "replayerror", pct: 0, ...base };
    }
    return { phase: "live", pct: 1, ...base };  // replay running → hidden
  }

  const buf = s.snapBuffer;
  const now = performance.now();
  if (buf.length === 0) {
    return { phase: "connecting", pct: 0, ...base };
  }
  const renderClock = now - RENDER_DELAY_MS;
  const first = buf[0]!.t;
  const last = buf[buf.length - 1]!.t;
  if (renderClock < first) {
    const pct = Math.max(0, Math.min(1, (now - first) / RENDER_DELAY_MS));
    return { phase: "warmup", pct, ...base };
  }
  if (renderClock > last) {
    return { phase: "stalled", pct: 1, ...base,
             staleSec: Math.floor((now - last) / 1000) };
  }
  return { phase: "live", pct: 1, ...base };
}

export function BufferOverlay() {
  const [st, setSt] = useState<BufState>(
    { phase: "connecting", pct: 0, staleSec: 0, loaded: 0, total: 0,
      reconnecting: false });

  useEffect(() => {
    if (PREVIEW) return;  // frozen preview; skip the poll
    const id = window.setInterval(() => {
      const next = computeState();
      setSt((prev) =>
        (prev.phase === next.phase
          && Math.abs(prev.pct - next.pct) < 0.005
          && prev.staleSec === next.staleSec
          && prev.loaded === next.loaded
          && prev.total === next.total
          && prev.reconnecting === next.reconnecting)
          ? prev : next);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  const phase: Phase = PREVIEW ? (PREVIEW as Phase) : st.phase;
  if (phase === "live") return null;

  // ---- Compact top banner for a mid-session stall (map stays visible) ----
  if (phase === "stalled") {
    const secs = PREVIEW ? 12 : st.staleSec;
    return (
      <div className="buf-banner" role="status">
        <span className="buf-spin" />
        <span className="buf-banner-txt">
          {st.reconnecting ? "Reconnecting" : "Waiting for data stream"}
          <span className="buf-banner-sub">
            {" · last update "}{secs}s ago
          </span>
        </span>
      </div>
    );
  }

  // ---- Replay load failed ----
  if (phase === "replayerror") {
    const openPicker = () =>
      (document.getElementById("recording-picker") as HTMLDialogElement | null)?.showModal();
    return (
      <div className="buf-overlay" role="status">
        <div className="buf-card">
          <div className="buf-title">Recording failed to load</div>
          <div className="buf-sub">
            Something went wrong fetching the recording. Check your connection
            and try again, or choose another recording.
          </div>
          <div className="buf-actions">
            <button className="buf-ok"
                    onClick={() => useViewerStore.getState().retryReplayLoad()}>
              Try again
            </button>
            <button className="buf-ghost" onClick={openPicker}>
              Another recording
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Replay loading (frame-count progress) ----
  if (phase === "replayload") {
    const loaded = PREVIEW ? 430 : st.loaded;
    const total = PREVIEW ? 1074 : st.total;
    const pct = PREVIEW === "replayload" ? 0.4
              : total > 0 ? Math.max(0, Math.min(1, loaded / total)) : 0;
    return (
      <div className="buf-overlay" role="status">
        <div className="buf-card">
          <div className="buf-ring" />
          <div className="buf-title">Loading recording</div>
          <div className="buf-sub">
            Downloading and preparing the match recording…
          </div>
          <div className="buf-bar">
            <div className={"buf-bar-fill" + (total > 0 ? "" : " buf-bar-indet")}
                 style={total > 0 ? { width: `${Math.round(pct * 100)}%` } : undefined} />
          </div>
          <div className="buf-meta">
            <span>{total > 0 ? `${Math.round(pct * 100)}%` : "…"}</span>
            <span>{loaded}{total > 0 ? ` / ${total}` : ""} frames</span>
          </div>
        </div>
      </div>
    );
  }

  // ---- Full centered card for cold-start connect / warmup ----
  const isWarmup = phase === "warmup";
  const pct = PREVIEW === "warmup" ? 0.45 : st.pct;
  const remainSec = Math.max(0, Math.ceil(RENDER_DELAY_MS / 1000 * (1 - pct)));
  return (
    <div className="buf-overlay" role="status">
      <div className="buf-card">
        <div className="buf-ring" />
        <div className="buf-title">
          {isWarmup ? "Preparing live map"
                    : st.reconnecting ? "Reconnecting…"
                                      : "Connecting to server…"}
        </div>
        <div className="buf-sub">
          {isWarmup
            ? "Filling the data buffer for smooth, uninterrupted playback"
            : "Waiting for live data stream"}
        </div>
        {isWarmup && (
          <>
            <div className="buf-bar"><div className="buf-bar-fill"
                 style={{ width: `${Math.round(pct * 100)}%` }} /></div>
            <div className="buf-meta">
              <span>{Math.round(pct * 100)}%</span>
              <span>~{remainSec}s left</span>
            </div>
          </>
        )}
        {!isWarmup && <div className="buf-dots"><span /><span /><span /></div>}
      </div>
    </div>
  );
}
