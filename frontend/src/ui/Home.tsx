// Landing / command-panel home. Server status + "watch recordings" CTA +
// recent matches (click = watch replay) + top players (click = stats) + quick
// links. Rendered instead of the map when mode === "home". Data comes from the
// existing stats/recordings API — this build has no live stream.
import { useEffect, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import { listRecordings } from "../api/recordings";
import { fetchLeaderboard } from "../api/playerStats";
import type { RecordingMeta, LeaderRow } from "../state/types";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(+d)) return "—";
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDur(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

const showModal = (id: string) =>
  (document.getElementById(id) as HTMLDialogElement | null)?.showModal();

export function Home() {
  const canLive = useViewerStore((s) => s.canLive);
  const setMode = useViewerStore((s) => s.setMode);
  const setReplay = useViewerStore((s) => s.setReplay);

  const [recs, setRecs] = useState<RecordingMeta[] | null>(null);
  const [top, setTop] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    listRecordings().then(setRecs).catch(() => setRecs([]));
    fetchLeaderboard("kills", 6, "alltime").then(setTop).catch(() => setTop([]));
  }, []);

  const live = recs?.find((r) => r.inProgress) ?? null;
  const serverName = live?.serverId ?? recs?.[0]?.serverId ?? "sqreader";
  const finished = (recs ?? []).filter((r) => !r.inProgress).slice(0, 6);
  const online = canLive !== false; // null (still probing) or true → assume online

  const playRecording = (id: string) => {
    setReplay((r) => ({ ...r, id, frames: [], currentIdx: 0, playing: false,
                        speed: 1, baseWallMs: 0, baseSnapMs: 0 }));
    setMode("replay");
    const url = new URL(window.location.href);
    url.searchParams.set("mode", "replay");
    url.searchParams.set("id", id);
    window.history.replaceState(null, "", url.toString());
  };

  return (
    <div id="home">
      <div className="hm-wrap">
        <header className="hm-top">
          <div className="hm-brand">
            <span className="hm-logo">sqreader</span>
            <span className="chip hm-beta">BETA</span>
          </div>
          <nav className="hm-nav">
            <button className="btn btn-ghost" onClick={() => showModal("player-stats")}>Stats</button>
            <button className="btn btn-ghost" onClick={() => showModal("recording-picker")}>Recordings</button>
          </nav>
        </header>

        <section className="card hm-hero">
          <div className={"hm-status " + (live ? "is-live" : online ? "is-on" : "is-off")}>
            <span className="hm-status-dot" />
            {live ? "LIVE MATCH" : online ? "Server online" : "Recording archive"}
          </div>
          <h1 className="hm-hero-title">{serverName}</h1>
          <p className="hm-hero-sub">
            {live
              ? `${live.layerName ?? live.mapName ?? "Unknown map"} · ~${live.peakPlayers ?? "?"} players`
              : online
                ? "No active match right now — open the live map or watch recent matches."
                : "Live stream is off — you can watch recorded matches."}
          </p>
          <div className="hm-cta">
            <button className="btn btn-primary btn-lg" onClick={() => showModal("recording-picker")}>Watch Recordings →</button>
            <button className="btn btn-lg" onClick={() => showModal("player-stats")}>Stats</button>
          </div>
        </section>

        <div className="hm-cols">
          <section className="card hm-panel">
            <div className="hm-panel-h"><h2>Recent Matches</h2></div>
            <div className="hm-list">
              {recs === null && <div className="hm-empty">Loading…</div>}
              {recs !== null && finished.length === 0 && <div className="hm-empty">No recordings yet.</div>}
              {finished.map((r) => (
                <button key={r.id} className="hm-match" onClick={() => playRecording(r.id)}>
                  <span className="hm-match-map">{r.layerName ?? r.mapName ?? r.filename}</span>
                  <span className="hm-match-meta">
                    <span className="chip">{r.gameMode ?? "—"}</span>
                    <span className="hm-match-dim">{fmtDur(r.durationSec)}</span>
                    <span className="hm-match-dim">{fmtDate(r.endedAtUtc ?? r.startedAtUtc)}</span>
                  </span>
                  <span className="hm-match-go">Watch ▸</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card hm-panel">
            <div className="hm-panel-h">
              <h2>Top Players</h2>
              <button className="btn btn-ghost hm-more" onClick={() => showModal("player-stats")}>All</button>
            </div>
            <div className="hm-list">
              {top === null && <div className="hm-empty">Loading…</div>}
              {top !== null && top.length === 0 && <div className="hm-empty">No data.</div>}
              {(top ?? []).map((p, i) => (
                <button key={p.eos_id} className="hm-player" onClick={() => showModal("player-stats")}>
                  <span className="hm-rank">{i + 1}</span>
                  <span className="hm-pname">
                    {p.last_clan_tag && <span className="hm-clan">[{p.last_clan_tag}]</span>}
                    {p.last_name ?? "?"}
                  </span>
                  <span className="hm-pval">{p.value}<span className="hm-pval-k"> kill</span></span>
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="hm-foot">sqreader · live Squad server map, stats and replay</footer>
      </div>
    </div>
  );
}
