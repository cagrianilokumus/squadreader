// Full-screen scoreboard overlay — opens on Tab (Squad convention).
// Two columns, one per team. Each player row: SL/FTL badge + role icon
// + name + 9 stat cells (Rev / Heal / Wnd / K / D / VK / Obj / TW / Combat).
// Squads are grouped + collapsible; squad header shows aggregate scores.
// Ported from the legacy vanilla-JS scoreboard module; SL/FTL derived
// from squad.leaderStateAddr + stats.fireTeamPosition since the backend
// doesn't ship explicit isSquadLeader / isFTL flags yet.

import { useMemo } from "react";
import { teamColor } from "../canvas/draw";
import { roleIconUrl } from "../canvas/icons";
import { useViewerStore } from "../state/viewerStore";
import type { Player, SquadState, TeamState } from "../state/types";
import { playerKey } from "./PlayerPanel";

interface SbStats {
  rev: number; heal: number; wnd: number;
  k: number;   d: number;    vk: number;
  obj: number; tw: number;   cs: number;
  sc: number;  tk: number;
}

function num(v: unknown): number {
  const n = Number(v); return Number.isFinite(n) ? n : 0;
}

function pickStats(p: Player): SbStats {
  const s = p.stats ?? {};
  const obj = num(s["objectiveScore"]);
  const tw  = num(s["teamWorkScore"]);
  const sc  = num(p.score);
  const cs  = s["combatScore"] != null
    ? num(s["combatScore"])
    : Math.max(0, sc - obj - tw);
  return {
    rev:  num(s["revivedPoints"]),
    heal: num(s["healPoints"]),
    // CRITICAL semantic: NumWoundeds = enemies YOU incapacitated.
    // NumWounds = times YOU got wounded. Squad's in-game "INCAPS"
    // column maps to NumWoundeds, not NumWounds.
    wnd:  num(s["woundeds"]),
    k:    num(s["kills"]),
    d:    num(s["deaths"]),
    vk:   num(s["vehicleKills"]),
    obj, tw, cs, sc,
    tk:   num(s["teamKills"]),
  };
}

function fmt(v: number): string {
  if (v === 0) return "0";
  return String(Math.round(v));
}

interface ColumnProps {
  team: 1 | 2;
  teamState: TeamState | null;
  players: Player[];
  squads: SquadState[];
  closed: number[];
  toggleSquad: (team: 1 | 2, id: number) => void;
  selectPlayer: (key: string) => void;
}

const COL_TITLES = ["REV", "HEAL", "INCAPS", "K", "D", "VK", "OBJ", "TW", "CS"];
const COL_KEYS: (keyof SbStats)[] = ["rev","heal","wnd","k","d","vk","obj","tw","cs"];

function TeamColumn({ team, teamState, players, squads, closed, toggleSquad, selectPlayer }: ColumnProps) {
  const tc = teamColor(team);
  // SL detection: each squad has `leaderStateAddr` (the player state
  // pointer of its leader). Build addr → squadId map then per-player
  // bool. FTL detection: stats.fireTeamPosition == 0 within a non-zero
  // fireTeamIndex tends to be the FTL — best effort without explicit
  // backend flag.
  const slAddrs = useMemo(() => {
    const s = new Set<string>();
    for (const sq of squads) {
      if (sq.teamId === team && sq.leaderStateAddr) s.add(sq.leaderStateAddr);
    }
    return s;
  }, [squads, team]);

  const aggregate = useMemo(() => {
    const a: SbStats = { rev:0, heal:0, wnd:0, k:0, d:0, vk:0, obj:0, tw:0, cs:0, sc:0, tk:0 };
    for (const p of players) {
      const s = pickStats(p);
      (Object.keys(a) as (keyof SbStats)[]).forEach((k) => { a[k] += s[k]; });
    }
    return a;
  }, [players]);

  // Group by squad. squadId < 1 (or undefined) → unassigned bucket (0).
  const grouped = useMemo(() => {
    const map = new Map<number, Player[]>();
    for (const p of players) {
      const raw = num(p.squadId);
      const sid = raw < 1 ? 0 : raw;
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(p);
    }
    return map;
  }, [players]);

  const squadIds = useMemo(() => {
    const ids = Array.from(grouped.keys());
    ids.sort((a, b) => {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return a - b;
    });
    return ids;
  }, [grouped]);

  const factionCode = teamState?.factionId ?? `TEAM ${team}`;
  const tickets = teamState?.tickets ?? null;
  const playerCount = teamState?.playerCount ?? players.length;

  return (
    <div className="sb-col">
      <div className="sb-banner" style={{ borderLeftColor: tc }}>
        <div className="sb-banner-text">
          <div className="sb-faction" style={{ color: tc }}>{factionCode}</div>
          <div className="sb-meta">
            <b>Tickets</b> {tickets ?? "—"}
            {" · "}
            <b>Players</b> {playerCount}
          </div>
        </div>
      </div>
      <div className="sb-agg-row">
        {COL_KEYS.map((k, i) => (
          <div key={k} className="sb-agg-cell" title={COL_TITLES[i]}>
            <span className="sb-agg-k">{COL_TITLES[i]}</span>
            <span className="sb-agg-v">{fmt(aggregate[k])}</span>
          </div>
        ))}
      </div>
      <div className="sb-body">
        {squadIds.length === 0 && (
          <div className="sb-empty">no players on this team</div>
        )}
        {squadIds.map((sid) => {
          const sqPlayers = grouped.get(sid)!;
          const isUnassigned = sid === 0;
          const isOpen = isUnassigned || !closed.includes(sid);
          // Sort within squad: SL first → fireteam A/B/C → FTL on top of each
          if (isUnassigned) {
            sqPlayers.sort((a, b) => num(b.score) - num(a.score));
          } else {
            sqPlayers.sort((a, b) => {
              const aSL = a._addr && slAddrs.has(a._addr) ? 1 : 0;
              const bSL = b._addr && slAddrs.has(b._addr) ? 1 : 0;
              if (aSL !== bSL) return bSL - aSL;
              const aFT = num(a.stats?.["fireTeamIndex"]) || 99;
              const bFT = num(b.stats?.["fireTeamIndex"]) || 99;
              if (aFT !== bFT) return aFT - bFT;
              const aFTL = num(a.stats?.["fireTeamPosition"]) === 0 ? 1 : 0;
              const bFTL = num(b.stats?.["fireTeamPosition"]) === 0 ? 1 : 0;
              if (aFTL !== bFTL) return bFTL - aFTL;
              return num(b.score) - num(a.score);
            });
          }
          const sqAgg = sqPlayers.reduce<SbStats>((acc, p) => {
            const s = pickStats(p);
            (Object.keys(acc) as (keyof SbStats)[]).forEach((k) => { acc[k] += s[k]; });
            return acc;
          }, { rev:0, heal:0, wnd:0, k:0, d:0, vk:0, obj:0, tw:0, cs:0, sc:0, tk:0 });
          const sqName = isUnassigned
            ? `Unassigned (${sqPlayers.length})`
            : (sqPlayers.find((p) => p.squadName)?.squadName ?? `Squad ${sid}`);
          return (
            <div key={sid} className={"sb-squad" + (isOpen ? " open" : "")}>
              <div className={"sb-squad-row" + (isUnassigned ? " sb-unassigned" : "")}
                   onClick={!isUnassigned ? () => toggleSquad(team, sid) : undefined}>
                <span className="sb-chev">{isUnassigned ? "!" : (isOpen ? "▾" : "▸")}</span>
                <span className="sb-sqid" style={{ color: tc, borderColor: tc }}>
                  {isUnassigned ? "—" : sid}
                </span>
                <span className="sb-sqname">{sqName}</span>
                <span className="sb-sqscore">{fmt(sqAgg.obj)}</span>
                <span className="sb-sqscore">{fmt(sqAgg.tw)}</span>
                <span className="sb-sqscore">{fmt(sqAgg.cs)}</span>
              </div>
              {isOpen && (
                <div className="sb-players">
                  {sqPlayers.map((p) => {
                    const s = pickStats(p);
                    const isSL = !!(p._addr && slAddrs.has(p._addr));
                    const isFTL = !isSL && num(p.stats?.["fireTeamPosition"]) === 0
                                       && num(p.stats?.["fireTeamIndex"]) > 0;
                    const dead = num(p.soldier?.health) <= 0;
                    const roleUrl = roleIconUrl(p);
                    const badge = isSL ? "SL" : isFTL ? "FTL" : "";
                    const badgeCls = isSL ? "is-sl" : isFTL ? "is-ftl" : "";
                    return (
                      <div key={playerKey(p)} className={"sb-row" + (dead ? " dead" : "")}
                           onClick={() => selectPlayer(playerKey(p))}>
                        <span className={"sb-badge " + badgeCls}
                              title={isSL ? "Squad Leader" : isFTL
                                ? "Fire Team Leader (estimated — no definitive backend flag)" : undefined}>
                          {badge}</span>
                        <span className="sb-pname">
                          {roleUrl && <img className="sb-role" src={roleUrl} alt="" />}
                          <span>{p.clanTag ? `[${p.clanTag}] ` : ""}{p.name ?? "?"}</span>
                        </span>
                        {COL_KEYS.map((k) => {
                          const v = s[k];
                          const cls = "sb-cell"
                            + (v === 0 ? " sb-zero" : "")
                            + (k === "tk" && v > 0 ? " sb-danger" : "");
                          return <span key={k} className={cls}>{fmt(v)}</span>;
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Scoreboard() {
  const visible       = useViewerStore((s) => s.scoreboardVisible);
  const close         = useViewerStore((s) => s.setScoreboardVisible);
  const closedSquads  = useViewerStore((s) => s.scoreboardClosedSquads);
  const toggleSquad   = useViewerStore((s) => s.toggleScoreboardSquad);
  const snap          = useViewerStore((s) => s.curSnap);
  const setSelectedPlayerKey = useViewerStore((s) => s.setSelectedPlayerKey);
  const setSelectedVehicleId = useViewerStore((s) => s.setSelectedVehicleId);

  if (!visible) return null;

  const players = snap?.players ?? [];
  const squads  = snap?.squads ?? [];
  const teams   = snap?.teams ?? [];
  const team1   = teams.find((t) => t.id === 1) ?? null;
  const team2   = teams.find((t) => t.id === 2) ?? null;
  const p1 = players.filter((p) => p.teamId === 1);
  const p2 = players.filter((p) => p.teamId === 2);

  const selectPlayer = (k: string) => {
    setSelectedPlayerKey(k);
    setSelectedVehicleId(null);
    close(false);
  };

  return (
    <div id="scoreboard-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) close(false);
    }}>
      <div id="scoreboard">
        <header>
          <span>Scoreboard</span>
          <span className="sb-hint">Tab to close</span>
          <button onClick={() => close(false)} title="close (Tab / Esc)">✕</button>
        </header>
        <div className="sb-cols">
          <TeamColumn team={1} teamState={team1} players={p1} squads={squads}
                      closed={closedSquads[1]} toggleSquad={toggleSquad}
                      selectPlayer={selectPlayer} />
          <TeamColumn team={2} teamState={team2} players={p2} squads={squads}
                      closed={closedSquads[2]} toggleSquad={toggleSquad}
                      selectPlayer={selectPlayer} />
        </div>
      </div>
    </div>
  );
}
