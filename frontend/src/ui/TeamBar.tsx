// Top-center match strip: both teams (faction, tickets, K/D, players)
// flanking a centre block (map · mode + match timer + state). The single
// highest-value at-a-glance addition for a tactical map — tickets and
// who's ahead without opening the scoreboard.

import { useViewerStore } from "../state/viewerStore";
import type { TeamState } from "../state/types";

function fmtClock(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// "USMC_LO_Motorized" -> "USMC"; "PLA_LO_Motorized" -> "PLA".
function shortFaction(id: string | null | undefined): string {
  if (!id) return "—";
  return id.split("_")[0] || id;
}

function TeamCol({ team, align }: { team: TeamState | undefined; align: "left" | "right" }) {
  const id = team?.id ?? (align === "left" ? 1 : 2);
  const tickets = team?.tickets;
  const kd = `${team?.kills ?? 0} / ${team?.deaths ?? 0}`;
  return (
    <div className={"tb-team " + (align === "left" ? "tb-left" : "tb-right")}
         style={{ ["--tc" as string]: `var(--team${id})` }}>
      <div className="tb-team-main">
        <span className="tb-faction">{shortFaction(team?.factionId)}</span>
        <span className="tb-tickets">{tickets ?? "—"}</span>
      </div>
      <div className="tb-team-sub">
        <span className="tb-players">{team?.playerCount ?? "—"}👤</span>
        <span className="tb-kd">{kd}</span>
      </div>
    </div>
  );
}

export function TeamBar() {
  const curSnap = useViewerStore((s) => s.curSnap);
  const gs = curSnap?.gameState ?? null;
  const teams = curSnap?.teams ?? [];
  const t1 = teams.find((t) => t.id === 1) ?? teams[0];
  const t2 = teams.find((t) => t.id === 2) ?? teams[1];

  // Relative ticket share for the split bar under the centre block.
  const a = Math.max(0, t1?.tickets ?? 0);
  const b = Math.max(0, t2?.tickets ?? 0);
  const total = a + b;
  const pct1 = total > 0 ? (a / total) * 100 : 50;

  const mapLine = [gs?.mapName, gs?.gameModeName].filter(Boolean).join(" · ") || "—";
  const state = gs?.matchState ?? "";
  const live = state === "InProgress";

  return (
    <div id="team-bar">
      <TeamCol team={t1} align="left" />
      <div className="tb-centre">
        <div className="tb-map">{mapLine}</div>
        <div className="tb-clock">{fmtClock(gs?.elapsedSec)}
          {state && <span className={"tb-state " + (live ? "on" : "")}>{state}</span>}
        </div>
        <div className="tb-ticketbar">
          <div className="tb-tb-fill tb-tb-1" style={{ width: `${pct1}%` }} />
          <div className="tb-tb-fill tb-tb-2" style={{ width: `${100 - pct1}%` }} />
        </div>
      </div>
      <TeamCol team={t2} align="right" />
    </div>
  );
}
