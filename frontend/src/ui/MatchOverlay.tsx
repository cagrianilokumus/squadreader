// Match-phase overlay. When the game is NOT actively in progress (end of
// round, staging for the next match, warmup, map change), the map churns
// as soldiers despawn and game state resets — which looked broken. This
// overlay reads gameState.matchState and puts a calm, explicit card over
// the map ("Maç Bitti" / "Maça Hazırlanılıyor" …) so the transition reads
// as intentional instead of a glitch.

import { useViewerStore } from "../state/viewerStore";
import type { TeamState } from "../state/types";

type Kind = "prep" | "post";
const PHASES: Record<string, { title: string; kind: Kind }> = {
  EnteringMap:      { title: "Loading Map",           kind: "prep" },
  WaitingToStart:   { title: "Preparing for Match",   kind: "prep" },
  Warmup:           { title: "Warmup",                kind: "prep" },
  WaitingPostMatch: { title: "Match Over",            kind: "post" },
  PostMatch:        { title: "Match Over",            kind: "post" },
  EndState:         { title: "Match Over",            kind: "post" },
  LeavingMap:       { title: "Changing Map",          kind: "post" },
  Aborted:          { title: "Match Cancelled",       kind: "post" },
};

function shortFaction(id: string | null | undefined): string {
  if (!id) return "—";
  return id.split("_")[0] || id;
}

// Optional ?previewPhase=WaitingPostMatch (or any state string) forces the
// overlay so it can be inspected without waiting for a real round change.
const PREVIEW = typeof window !== "undefined"
  ? new URLSearchParams(window.location.search).get("previewPhase")
  : null;

export function MatchOverlay() {
  const curSnap = useViewerStore((s) => s.curSnap);
  const lastInProgressTeams = useViewerStore((s) => s.lastInProgressTeams);
  const gs = curSnap?.gameState ?? null;
  const state = PREVIEW ?? gs?.matchState ?? null;

  // No data yet, or a live match: nothing to show. A transiently-null
  // matchState on a populated server is a read blip, not a real phase —
  // treat null as "live" so the overlay never flickers mid-round.
  if ((!curSnap && !PREVIEW) || state == null || state === "InProgress") {
    return null;
  }

  const phase = PHASES[state] ?? { title: "Match Transition", kind: "prep" as Kind };
  // Post-match result: show the tickets frozen at the last InProgress tick (the
  // win-instant values). Squad keeps bleeding the winner's Tickets field a few
  // points into WaitingPostMatch, so live reads drift below the game's final
  // (e.g. game 196 vs live 194). Fall back to live teams if we never observed
  // an InProgress tick (joined during post-match / replay tail).
  const teams = (phase.kind === "post" && lastInProgressTeams?.length
    ? lastInProgressTeams
    : curSnap?.teams) ?? [];
  const t1: TeamState | undefined = teams.find((t) => t.id === 1) ?? teams[0];
  const t2: TeamState | undefined = teams.find((t) => t.id === 2) ?? teams[1];
  const nextLine = [gs?.mapName, gs?.gameModeName].filter(Boolean).join(" · ");

  // Winner (post-match): the team with more tickets. Null-safe; if tickets
  // are unavailable/equal we just show both without a crown.
  const a = t1?.tickets ?? null;
  const b = t2?.tickets ?? null;
  const winner = (a != null && b != null && a !== b) ? (a > b ? 1 : 2) : null;

  return (
    <div className={"match-overlay mo-" + phase.kind}>
      <div className="mo-card">
        <div className="mo-eyebrow">{state}</div>
        <div className="mo-title">{phase.title}</div>

        {phase.kind === "post" ? (
          <div className="mo-result">
            <TeamResult team={t1} align="left" win={winner === 1} />
            <div className="mo-vs">–</div>
            <TeamResult team={t2} align="right" win={winner === 2} />
          </div>
        ) : (
          nextLine && (
            <div className="mo-next">
              <span className="mo-next-lbl">Next</span>
              <span className="mo-next-map">{nextLine}</span>
            </div>
          )
        )}

        <div className="mo-sub">
          {phase.kind === "post"
            ? "New match starting soon…"
            : "Players deploying soon…"}
        </div>
        <div className="mo-dots"><span /><span /><span /></div>
      </div>
    </div>
  );
}

function TeamResult({ team, align, win }: {
  team: TeamState | undefined; align: "left" | "right"; win: boolean;
}) {
  const id = team?.id ?? (align === "left" ? 1 : 2);
  return (
    <div className={"mo-team mo-" + align + (win ? " mo-win" : "")}
         style={{ ["--tc" as string]: `var(--team${id})` }}>
      {win && <div className="mo-crown">WINNER</div>}
      <div className="mo-faction">{shortFaction(team?.factionId)}</div>
      <div className="mo-tickets">{team?.tickets ?? "—"}</div>
      <div className="mo-tlabel">ticket</div>
    </div>
  );
}
