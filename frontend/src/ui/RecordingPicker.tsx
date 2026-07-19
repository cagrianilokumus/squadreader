// Modal dialog listing every recording from /api/recordings.
// Triggered by:
//   - TopBar "Recordings…" button (showModal called by document.getElementById)
//   - URL ?mode=replay without an &id= param (App.tsx auto-opens)
//
// Clicking a row loads that recording in replay mode: sets
// replay.id, frames cleared (useReplayLoader picks up the new id and
// fetches), mode → "replay", URL rewritten with ?mode=replay&id=…

import { useEffect, useRef, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import { listRecordings } from "../api/recordings";
import type { RecordingMeta } from "../state/types";

function fmtDateParts(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  const pad = (n: number) => n.toString().padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function fmtDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

// Per-game-mode accent so the mode column reads at a glance.
const MODE_HUE: Record<string, string> = {
  RAAS: "#5cb0ff", AAS: "#7ee0c8", INVASION: "#ff8f5b",
  SKIRMISH: "#c08cff", SEED: "#8b98ab", DESTRUCTION: "#ffb454",
  TC: "#ffd76a", TERRITORYCONTROL: "#ffd76a", INSURGENCY: "#ff6b8a",
};
function modeHue(mode: string | null): string {
  if (!mode) return "#8b98ab";
  return MODE_HUE[mode.toUpperCase().replace(/[^A-Z]/g, "")] ?? "#8b98ab";
}
// Faction setup ids look like "USA_LO_CombinedArms" / "RGF_LO_Armored" — the
// team's faction is the first token. Show that short code instead of "Team 1/2".
function facAbbr(f: string | null | undefined): string | null {
  const s = (f ?? "").split("_")[0].trim();
  return s || null;
}

export function RecordingPicker() {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  const recs        = useViewerStore((s) => s.recordings);
  const loading     = useViewerStore((s) => s.recordingsLoading);
  const error       = useViewerStore((s) => s.recordingsError);
  const setRecordings        = useViewerStore((s) => s.setRecordings);
  const setRecordingsLoading = useViewerStore((s) => s.setRecordingsLoading);
  const setRecordingsError   = useViewerStore((s) => s.setRecordingsError);
  const setReplay = useViewerStore((s) => s.setReplay);
  const setMode   = useViewerStore((s) => s.setMode);

  const [q, setQ] = useState("");

  // Lazy-load recordings the first time the dialog opens, and refresh
  // every open (it's cheap and the list grows in real time as matches
  // end / new ones start).
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    const handler = () => {
      setRecordingsLoading(true);
      setRecordingsError(null);
      listRecordings()
        .then((list) => { setRecordings(list); })
        .catch((e) => setRecordingsError(String(e)))
        .finally(() => setRecordingsLoading(false));
    };
    // MutationObserver on the `open` attribute is the cross-browser way to
    // know when a <dialog> opens (Chrome/Firefox don't reliably emit 'open').
    const obs = new MutationObserver(() => { if (dlg.open) handler(); });
    obs.observe(dlg, { attributes: true, attributeFilter: ["open"] });
    return () => obs.disconnect();
  }, [setRecordings, setRecordingsLoading, setRecordingsError]);

  const pick = (rec: RecordingMeta) => {
    setReplay((r) => ({
      ...r,
      id: rec.id,
      frames: [],
      currentIdx: 0,
      playing: false,
      speed: 1,
      baseWallMs: 0,
      baseSnapMs: 0,
    }));
    setMode("replay");
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "replay");
    url.searchParams.set("id", rec.id);
    window.history.replaceState(null, "", url.toString());
    dlgRef.current?.close();
  };

  const canLive = useViewerStore((s) => s.canLive);
  const query = q.trim().toLowerCase();
  // Recordings-only users (no live access) must not see the in-progress match —
  // that would be near-live access to the current game. They only get FINISHED
  // matches. (A server-side gate on /api/recording/<id> backs this up.)
  const base = (recs ?? []).filter((r) => !(canLive === false && r.inProgress));
  const filtered = base.filter((r) => {
    if (!query) return true;
    return [r.mapName, r.gameMode, r.layerName]
      .some((v) => (v ?? "").toLowerCase().includes(query));
  });

  return (
    <dialog id="recording-picker" ref={dlgRef}>
      <header className="rp-head">
        <div className="rp-head-title">
          <h2>Recordings</h2>
          <span className="pill beta-pill"
                title="System is in beta — feedback: reach out to your server admin">
            BETA
          </span>
          {recs && (
            <span className="rp-count">
              {query ? `${filtered.length} / ${base.length}` : base.length} matches
            </span>
          )}
        </div>
        <div className="rp-head-actions">
          <label className="rp-search">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor"
                      strokeWidth="2" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search map or mode…" spellCheck={false} />
            {q && <button className="rp-search-clear" title="clear"
                          onClick={() => setQ("")}>✕</button>}
          </label>
          <button className="rp-close"
                  onClick={() => dlgRef.current?.close()}
                  title="close (Esc)">✕</button>
        </div>
      </header>

      <div className="rp-body">
        {loading && (
          <div className="rp-msg"><span className="rp-spin" />Loading recordings…</div>
        )}
        {error && <div className="rp-msg rp-err">Error: {error}</div>}
        {recs && recs.length === 0 && !loading && (
          <div className="rp-msg">No recordings yet.</div>
        )}
        {recs && recs.length > 0 && filtered.length === 0 && (
          <div className="rp-msg">No results for “{q}”.</div>
        )}

        {filtered.length > 0 && (
          <table className="rp-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Teams</th>
                <th>Mode</th>
                <th>Tickets</th>
                <th className="rp-num">Duration</th>
                <th className="rp-num">Players</th>
                <th className="rp-num">Size</th>
                <th className="rp-status-col">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const { date, time } = fmtDateParts(r.startedAtUtc);
                const hue = modeHue(r.gameMode);
                return (
                  <tr key={r.id}
                      className={r.inProgress ? "rp-row rp-live" : "rp-row"}
                      onClick={() => pick(r)}>
                    <td className="rp-match">
                      <span className="rp-map">{r.mapName ?? "Unknown map"}</span>
                      <span className="rp-when">
                        {date}{time && <span className="rp-time"> · {time}</span>}
                      </span>
                    </td>
                    <td className="rp-teams">
                      {(r.team1Faction || r.team2Faction)
                        ? <span className="rp-vs">
                            <span className={"rp-fac" + (r.winnerTeam === 1 ? " rp-fac-win" : "")}>
                              {facAbbr(r.team1Faction) ?? "?"}</span>
                            <span className="rp-vs-x">vs</span>
                            <span className={"rp-fac" + (r.winnerTeam === 2 ? " rp-fac-win" : "")}>
                              {facAbbr(r.team2Faction) ?? "?"}</span>
                          </span>
                        : <span className="rp-dash">—</span>}
                    </td>
                    <td>
                      {r.gameMode
                        ? <span className="rp-mode"
                                style={{ ["--hue" as string]: hue }}>
                            {r.gameMode}
                          </span>
                        : <span className="rp-dash">—</span>}
                    </td>
                    <td className="rp-tickets">
                      {(r.team1Tickets != null || r.team2Tickets != null)
                        ? <span className="rp-scoreline">
                            <span className={"rp-tix" + (r.winnerTeam === 1 ? " rp-tix-win" : "")}>
                              {r.team1Tickets ?? "–"}</span>
                            <span className="rp-tix-sep">–</span>
                            <span className={"rp-tix" + (r.winnerTeam === 2 ? " rp-tix-win" : "")}>
                              {r.team2Tickets ?? "–"}</span>
                          </span>
                        : <span className="rp-dash">—</span>}
                    </td>
                    <td className="rp-num">{fmtDuration(r.durationSec)}</td>
                    <td className="rp-num">
                      {r.peakPlayers != null
                        ? <><b>{r.peakPlayers}</b></>
                        : <span className="rp-dash">—</span>}
                    </td>
                    <td className="rp-num rp-size">{fmtBytes(r.sizeBytes)}</td>
                    <td className="rp-status-col">
                      {r.inProgress
                        ? <span className="rp-tag-live"><i />LIVE</span>
                        : <span className="rp-tag-done">done</span>}
                    </td>
                    <td className="rp-action-col">
                      <button className="rp-load"
                              onClick={(e) => { e.stopPropagation(); pick(r); }}>
                        Watch
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </dialog>
  );
}
