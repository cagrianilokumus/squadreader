// Top-left HUD: server, status, map/mode, tick + rate + latency.
// Top-right: zoom indicator + fit / scoreboard / Live·Rewind toggle
// + Open Recordings dialog.

import { useEffect, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import { ClipRecorder } from "./ClipRecorder";
import { SettingsMenu } from "./SettingsMenu";

export function TopBar() {
  const status = useViewerStore((s) => s.status);
  const curSnap = useViewerStore((s) => s.curSnap);
  const view = useViewerStore((s) => s.view);
  const resetView = useViewerStore((s) => s.resetView);
  const avgTickMs = useViewerStore((s) => s.avgTickMs);
  const toggleScoreboard = useViewerStore((s) => s.toggleScoreboard);
  const mode = useViewerStore((s) => s.mode);
  const replayId = useViewerStore((s) => s.replay.id);
  const timelineVisible = useViewerStore((s) => s.timelineVisible);
  const toggleTimeline = useViewerStore((s) => s.toggleTimeline);

  // Rate + latency are derived display state, recomputed cheaply on each
  // store tick (player viewer is desktop, no need for memoization).
  const gs = curSnap?.gameState ?? null;
  const serverName = gs?.serverName ?? curSnap?.server ?? "—";
  const rate = avgTickMs > 0 ? (1000 / avgTickMs).toFixed(2) + " Hz" : "— Hz";

  // How long since data last ARRIVED. Measured on our own clock (arrival time,
  // not the snapshot's server timestamp) so it can't be thrown off by clock skew.
  //
  // It ticks on its own interval rather than off curSnap: when the producer
  // freezes, curSnap stops changing, so an age derived from it would freeze too —
  // the staleness indicator would be the last thing to notice the data went stale.
  const [ageSec, setAgeSec] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const s = useViewerStore.getState();
      setAgeSec(s.curSnap && s.curArrivalMs
        ? Math.max(0, (performance.now() - s.curArrivalMs) / 1000)
        : null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  // At 0.5 Hz a healthy age oscillates 0-2 s. 8 s is four missed ticks (odd), 30 s
  // is fifteen (the producer is wedged, not merely slow).
  const ageClass = ageSec == null ? ""
                 : ageSec > 30 ? "bad"
                 : ageSec > 8  ? "warn" : "";

  const statusClass = status === "live" ? "live"
                    : status === "reconnecting" ? "bad"
                    : status === "replay" ? "warn"
                    : "warn";
  const STATUS_TR: Record<string, string> = {
    connecting: "connecting", live: "live", reconnecting: "reconnecting",
    replay: "recording", idle: "idle",
  };

  const openPicker = () => {
    const dlg = document.getElementById("recording-picker") as
      HTMLDialogElement | null;
    dlg?.showModal();
  };

  // Exit the replay back to where the viewer was opened from. Deep-links (from
  // /stats, /servers, the homepage — same or new tab) carry a same-origin
  // referrer, so return there; a direct/bookmarked replay has none → site home.
  const goBack = () => {
    const ref = document.referrer;
    try {
      const u = ref ? new URL(ref) : null;
      if (u && u.origin === window.location.origin
          && !u.pathname.startsWith("/replay")) {
        window.location.href = ref;
        return;
      }
    } catch { /* malformed referrer → fall through to home */ }
    window.location.href = "/";
  };

  return (
    <>
      <div id="hud">
        <div><b>{serverName}</b>
          <span className="pill beta-pill"
                title="System is in beta — feedback: reach out to your server admin">
            BETA
          </span>
          <span className={"pill " + statusClass}>
            {mode === "replay" ? "recording" : (STATUS_TR[status] ?? status)}
          </span></div>
        <div>tick <b>{curSnap?.tick ?? "—"}</b>
          {" · "}<span>{rate}</span>
          {" · "}
          {mode === "replay"
            ? <span>{replayId ?? "—"}</span>
            : <span className={"age " + ageClass}
                    title="time since last data">
                {ageSec == null ? "No data" : `data ${ageSec.toFixed(0)}s`}
              </span>}
        </div>
      </div>
      <div id="controls">
        {/* Exit-replay: return to the page the replay was opened from (site
            home as a fallback). Shown only while watching a recording. */}
        {mode === "replay" && (
          <button className="tb-back" onClick={goBack}
                  title="back to previous page / site">← Back</button>
        )}
        <button onClick={openPicker} title="watch past matches">
          Past Matches
        </button>
        <span>zoom <b>{view.zoom.toFixed(1)}x</b></span>
        <button onClick={() => resetView()} title="reset view (F)">Fit</button>
        <button onClick={() => toggleScoreboard()}
                title="scoreboard (Tab)">score</button>
        {mode === "replay" && (
          <button className={timelineVisible ? "on" : ""}
                  onClick={() => toggleTimeline()}
                  title="ticket-loss timeline (G)">Tickets</button>
        )}
        <ClipRecorder />
        <SettingsMenu />
      </div>
    </>
  );
}
