// Full-screen player-statistics dashboard (a <dialog>). Opened from the TopBar
// "İstatistik" button. Landing = leaderboards (tabs by stat) + a search box;
// clicking any player opens their profile (lifetime totals + recent matches +
// top weapons + nemesis/victims + favorite maps). All data from the backend
// /api/leaderboard, /api/players, /api/players/<eos>. Turkish UI; Squad game
// terms (kill / revive / RAAS / faction names) stay English.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  searchPlayers, fetchProfile, fetchLeaderboard, fetchWeaponMeta,
  fetchLayerHeatmap, fetchHeatmapLayers, fetchMatches, fetchMatchDetail,
  fetchMatchHeatmap, fetchServers,
} from "../api/playerStats";
import { HeatmapCanvas } from "./HeatmapCanvas";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";
import type {
  LeaderRow, PlayerProfile, PlayerSummary, WeaponStat, NemesisRow,
  PlayerMatchRow, StatsPeriod, WeaponMetaRow, LayerHeatmap, EloBadge,
  HeatmapLayerOption, SquadmateRow, VehicleUsedRow, MapRecord, FactionRecord,
  ActivityCell, MatchSummaryRow, MatchDetail, MatchDetailPlayer, MatchHeatmap,
  ServerOption,
} from "../state/types";

const vehicleName = (cls: string | null) =>
  cls ? vehicleDisplayName(cls) : "?";

const kd = (k: number, d: number) => (k / Math.max(1, d)).toFixed(2);
const int = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("tr-TR"));
// Nulls stay nulls: a weapon with no positioned kill has no known range, and an
// em-dash says that. Printing 0 m would be a fact we do not have.
const metres = (m: number | null | undefined) =>
  (m == null ? "—" : `${Math.round(m)} m`);

function fmtPlaytime(sec: number | null | undefined): string {
  if (!sec || sec < 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtDate(epoch: number | null | undefined): string {
  if (!epoch) return "—";
  const d = new Date(epoch * 1000);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Weapon BP class -> readable, e.g. "BP_C7A2_C79A2_M203A1_C" -> "C7A2 C79A2 M203A1"
function humanWeapon(cls: string): string {
  return cls.replace(/^BP_/, "").replace(/_C$/, "").replace(/_/g, " ").trim() || cls;
}

const TABS: { key: string; label: string }[] = [
  { key: "elo", label: "ELO" },
  { key: "kills", label: "Kills" },
  { key: "kd", label: "K/D" },
  { key: "score", label: "Combat" },
  { key: "objective", label: "Objective" },
  { key: "revives", label: "Revives" },
  { key: "vehicle_kills", label: "Vehicle" },
  { key: "matches", label: "Matches" },
  { key: "matchlist", label: "Match List" },
  { key: "weapons", label: "Weapons" },
  { key: "heatmap", label: "Heatmap" },
];
// ELO is a running total, not a sum over matches — there is no such thing as
// "this week's ELO". Weapons, matchlist and the heatmap are their own views,
// not player leaderboards. ("matches" = the by-match-count leaderboard;
// "matchlist" = the match browser — distinct on purpose.)
const LEADER_TABS = new Set([
  "elo", "kills", "kd", "score", "objective", "revives", "vehicle_kills",
  "matches",
]);
const PERIODLESS = new Set(["elo"]);

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: "daily", label: "Today" },
  { key: "weekly", label: "This week" },
  { key: "monthly", label: "This month" },
  { key: "alltime", label: "All time" },
];

function statValue(stat: string, v: number): string {
  if (stat === "kd") return v.toFixed(2);
  return int(v);
}

/** The tier badge. Colours come from the server (sqreader/elo.py) so the bands
 *  cannot drift between the two sides. */
function EloPill({ elo, showProgress }: { elo: EloBadge; showProgress?: boolean }) {
  return (
    <span className="elo-pill" style={{ ["--elo" as string]: elo.color }}
          title={elo.nextAt
            ? `${elo.label} · next tier ${elo.nextAt}`
            : `${elo.label} · top tier`}>
      <span className="elo-dot" />
      <span className="elo-label">{elo.label}</span>
      <span className="elo-rating">{elo.rating}</span>
      {showProgress && elo.nextAt != null && (
        <span className="elo-track">
          <span className="elo-fill" style={{ width: `${elo.progress * 100}%` }} />
        </span>
      )}
    </span>
  );
}

const Magnifier = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const Name = ({ name, clan }: { name: string | null; clan?: string | null }) => (
  <span className="ps-pname">
    {clan && <span className="ps-clan">[{clan}]</span>}
    {name ?? "?"}
  </span>
);

export function PlayerStats({ inline = false }: { inline?: boolean } = {}) {
  const dlgRef = useRef<HTMLDialogElement | null>(null);
  // Inline (/stats) can be deep-linked from the /servers cards: ?server=<id>
  // pre-scopes the whole view, ?tab=<key> opens a specific board.
  const [tab, setTab] = useState(() => {
    if (!inline) return "elo";
    const t = new URLSearchParams(window.location.search).get("tab");
    return t && TABS.some((x) => x.key === t) ? t : "elo";
  });
  const [period, setPeriod] = useState<StatsPeriod>("alltime");
  const [server, setServer] = useState(() =>
    inline ? new URLSearchParams(window.location.search).get("server") || "" : "");
  const [servers, setServers] = useState<ServerOption[]>([]);
  const tabRef = useRef(tab); tabRef.current = tab;
  const periodRef = useRef(period); periodRef.current = period;
  const serverRef = useRef(server); serverRef.current = server;
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);
  const [weapons, setWeapons] = useState<WeaponMetaRow[] | null>(null);
  const [heat, setHeat] = useState<LayerHeatmap | null>(null);
  const [layer, setLayer] = useState("");
  const [ldLoading, setLdLoading] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PlayerSummary[] | null>(null);
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [pfLoading, setPfLoading] = useState(false);
  const [matches, setMatches] = useState<MatchSummaryRow[] | null>(null);
  const [matchDetail, setMatchDetail] = useState<MatchDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // One loader for all the tab kinds: they share the loading flag and the
  // error slot, and only one of them is ever on screen.
  const loadTab = useCallback((t: string, p: StatsPeriod, lyr: string,
                               sv: string) => {
    setLdLoading(true); setErr(null);
    const fail = (e: unknown) => setErr(String(e));
    const done = () => setLdLoading(false);
    if (t === "weapons") {
      fetchWeaponMeta(p, 40, sv).then(setWeapons).catch(fail).finally(done);
    } else if (t === "heatmap") {
      if (!lyr) { setHeat(null); done(); return; }
      fetchLayerHeatmap(lyr, p, 5000, sv).then(setHeat).catch(fail).finally(done);
    } else if (t === "matchlist") {
      fetchMatches(p, 60, sv).then(setMatches).catch(fail).finally(done);
    } else {
      fetchLeaderboard(t, 50, p, sv).then(setLeaders).catch(fail).finally(done);
    }
  }, []);

  // Refresh on every open — the DB grows in real time as matches play out.
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    const onOpen = () => {
      setProfile(null); setMatchDetail(null);
      setQ(""); setResults(null); setErr(null);
      loadTab(tabRef.current, periodRef.current, "", serverRef.current);
    };
    const obs = new MutationObserver(() => { if (dlg.open) onOpen(); });
    obs.observe(dlg, { attributes: true, attributeFilter: ["open"] });
    return () => obs.disconnect();
  }, [loadTab]);

  // Inline (the squadreader.com /stats page) has no dialog to observe for an
  // "open" event, so kick off the first load on mount instead — and fetch the
  // enrolled servers for the scope picker (central only; harmless if empty).
  useEffect(() => {
    if (!inline) return;
    loadTab(tabRef.current, periodRef.current, "", serverRef.current);
    fetchServers().then(setServers).catch(() => setServers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inline]);

  // Debounced search (re-runs when the server scope changes too).
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults(null); return; }
    const h = setTimeout(() => {
      searchPlayers(query, 30, server).then(setResults).catch((e) => setErr(String(e)));
    }, 250);
    return () => clearTimeout(h);
  }, [q, server]);

  const pickTab = (t: string) => {
    setTab(t); setProfile(null); setMatchDetail(null);
    loadTab(t, period, layer, server);
  };
  const openMatch = (matchId: string) => {
    setErr(null);
    fetchMatchDetail(matchId).then(setMatchDetail).catch((e) => setErr(String(e)));
  };
  const pickPeriod = (p: StatsPeriod) => {
    setPeriod(p);
    loadTab(tab, p, layer, server);
  };
  const pickLayer = (l: string) => {
    setLayer(l);
    loadTab("heatmap", period, l, server);
  };
  const pickServer = (sv: string) => {
    setServer(sv);
    loadTab(tab, period, layer, sv);               // re-scope the landing view
    if (profile) openProfile(profile.eosId, sv);   // and any open profile
  };
  const openProfile = (eos: string, sv: string = server) => {
    setPfLoading(true); setErr(null); setProfile(null);
    fetchProfile(eos, sv)
      .then(setProfile)
      .catch((e) => setErr(String(e)))
      .finally(() => setPfLoading(false));
  };
  const close = () => dlgRef.current?.close();
  const showPeriod = !PERIODLESS.has(tab);
  const landing = !profile && !pfLoading && !matchDetail && results === null;

  const inner = (
    <>
      <header className="ps-head">
        <div className="ps-head-title">
          {profile
            ? <button className="ps-back" onClick={() => setProfile(null)}>← Back</button>
            : matchDetail
            ? <button className="ps-back" onClick={() => setMatchDetail(null)}>← Back</button>
            : inline
            ? <a className="ps-brand" href="/"><img className="ps-logo" src="/logo.svg" alt="squadreader.com" /></a>
            : <h2>Player Stats</h2>}
          <span className="pill beta-pill"
                title="System in beta — send feedback to your server admin">BETA</span>
          {inline && (
            <nav className="ps-sitenav">
              <a href="/#feats">Features</a>
              <a href="/#nasil">How it works</a>
              <a href="/setup">Setup</a>
              <a href="/servers">Servers</a>
              <a href="/stats/" className="act">Stats</a>
            </nav>
          )}
        </div>
        <div className="ps-head-actions">
          {inline && servers.length > 0 && (
            <select className="ps-server" value={server}
                    title="Select server" aria-label="Server"
                    onChange={(e) => pickServer(e.target.value)}>
              <option value="">🌐 Global</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>{s.label || s.id}</option>
              ))}
            </select>
          )}
          <label className="ps-search">
            <Magnifier />
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search players…" spellCheck={false} />
            {q && <button className="ps-search-clear" onClick={() => setQ("")}>✕</button>}
          </label>
          {inline
            ? <a className="ps-apply" href="https://discord.gg/3mQytyAwJd"
                 target="_blank" rel="noopener">Apply on Discord</a>
            : <button className="ps-close" onClick={close} title="close (Esc)">✕</button>}
        </div>
      </header>

      <div className="ps-body">
        {inline && landing && (
          <div className="ps-page-head">
            <div className="ps-page-kicker">Stats</div>
            <h1 className="ps-page-title">Player stats</h1>
            <p className="ps-page-sub">All-time leaderboards, player profiles,
              weapon meta, and heatmap — global scope.</p>
          </div>
        )}
        {err && <div className="ps-msg ps-err">Error: {err}</div>}
        {pfLoading && <div className="ps-msg"><span className="ps-spin" />Loading profile…</div>}

        {!pfLoading && profile && <ProfileView p={profile} onPick={openProfile} />}

        {!profile && !pfLoading && matchDetail && (
          <MatchDetailView m={matchDetail} onPick={openProfile} />
        )}

        {!profile && !pfLoading && !matchDetail && results !== null && (
          <SearchResults rows={results} q={q} onPick={openProfile} />
        )}

        {landing && (
          <>
            <div className="ps-tabs">
              <div className="ps-tabstrip">
                {TABS.map((t) => (
                  <button key={t.key}
                          className={t.key === tab ? "ps-tab active" : "ps-tab"}
                          onClick={() => pickTab(t.key)}>{t.label}</button>
                ))}
              </div>
              {showPeriod && (
                <select className="ps-period" value={period}
                        onChange={(e) => pickPeriod(e.target.value as StatsPeriod)}>
                  {PERIODS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              )}
            </div>

            {ldLoading && <div className="ps-msg"><span className="ps-spin" />Loading…</div>}

            {!ldLoading && LEADER_TABS.has(tab) && leaders && leaders.length === 0 && (
              <div className="ps-msg">
                {tab === "kd" ? "No players with at least 3 matches yet."
                  : tab === "elo" ? "No rated matches yet — a match must be "
                                  + "crowded and long enough to count for ELO."
                  : "No data yet."}
              </div>
            )}
            {!ldLoading && LEADER_TABS.has(tab) && leaders && leaders.length > 0 && (
              <LeaderTable rows={leaders} stat={tab} onPick={openProfile} />
            )}

            {!ldLoading && tab === "weapons" && (
              <WeaponMetaTable rows={weapons ?? []} />
            )}

            {!ldLoading && tab === "matchlist" && (
              <MatchListTable rows={matches ?? []} onOpen={openMatch} />
            )}

            {!ldLoading && tab === "heatmap" && (
              <HeatmapTab layer={layer} onPickLayer={pickLayer} heat={heat}
                          server={server} />
            )}
          </>
        )}

        {inline && (
          <div className="ps-page-foot">
            squadreader.com · <a href="/">ana sayfa</a>
          </div>
        )}
      </div>
    </>
  );

  return inline
    ? <div id="player-stats" className="ps-view">{inner}</div>
    : <dialog id="player-stats" ref={dlgRef}>{inner}</dialog>;
}

function LeaderTable({ rows, stat, onPick }: {
  rows: LeaderRow[]; stat: string; onPick: (eos: string) => void;
}) {
  const statLabel = TABS.find((t) => t.key === stat)?.label ?? stat;
  const isElo = stat === "elo";
  return (
    <table className="ps-table">
      <thead>
        <tr>
          <th className="ps-rank">#</th>
          <th>Player</th>
          <th className="ps-num ps-hl">{isElo ? "Tier" : statLabel}</th>
          <th className="ps-num">K</th>
          <th className="ps-num">D</th>
          <th className="ps-num">K/D</th>
          <th className="ps-num">Matches</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.eos_id} className="ps-row" onClick={() => onPick(r.eos_id)}>
            <td className="ps-rank">{i + 1}</td>
            <td><Name name={r.last_name} clan={r.last_clan_tag} /></td>
            <td className="ps-num ps-hl">
              {isElo && r.elo
                ? <EloPill elo={r.elo} />
                : statValue(stat, r.value)}
            </td>
            <td className="ps-num">{int(r.kills)}</td>
            <td className="ps-num">{int(r.deaths)}</td>
            <td className="ps-num">{kd(r.kills, r.deaths)}</td>
            <td className="ps-num">{int(r.matches)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WeaponMetaTable({ rows }: { rows: WeaponMetaRow[] }) {
  if (rows.length === 0) {
    return <div className="ps-msg">No weapon data for this period.</div>;
  }
  const max = Math.max(1, ...rows.map((r) => r.kills));
  return (
    <table className="ps-table">
      <thead>
        <tr>
          <th className="ps-rank">#</th>
          <th>Weapon</th>
          <th className="ps-num ps-hl">Kills</th>
          <th className="ps-num">Users</th>
          <th className="ps-num">Matches</th>
          <th className="ps-num">Avg. range</th>
          <th className="ps-num">Max.</th>
          <th className="ps-num">TK</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((w, i) => (
          <tr key={w.weapon} className="ps-row">
            <td className="ps-rank">{i + 1}</td>
            <td>
              <span className="ps-w-name" title={w.weapon}>{humanWeapon(w.weapon)}</span>
              {/* The bar re-states the kill count it sits next to — magnitude at
                  a glance, without spending a column on a second number. */}
              <span className="ps-w-track">
                <span className="ps-w-fill" style={{ width: `${(w.kills / max) * 100}%` }} />
              </span>
            </td>
            <td className="ps-num ps-hl">{int(w.kills)}</td>
            <td className="ps-num">{int(w.users)}</td>
            <td className="ps-num">{int(w.matches)}</td>
            <td className="ps-num">{metres(w.avg_distance_m)}</td>
            <td className="ps-num ps-dim">{metres(w.max_distance_m)}</td>
            <td className="ps-num ps-dim">{int(w.team_kills)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function matchResult(m: { winner_team: number | null; status: string | null }):
    [string, string] {
  if (m.status !== "final" || m.winner_team == null) return ["—", ""];
  if (m.winner_team === 0) return ["Draw", ""];
  return [`Team ${m.winner_team}`, m.winner_team === 1 ? "ps-res-win" : "ps-res-loss"];
}

function MatchListTable({ rows, onOpen }: {
  rows: MatchSummaryRow[]; onOpen: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <div className="ps-msg">No matches for this period.</div>;
  }
  return (
    <table className="ps-table">
      <thead>
        <tr>
          <th>Map</th><th>Mode</th>
          <th className="ps-num">Players</th>
          <th className="ps-num">Duration</th>
          <th>Winner</th>
          <th className="ps-num">Date</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const [txt, cls] = matchResult(m);
          return (
            <tr key={m.match_id} className="ps-row" onClick={() => onOpen(m.match_id)}>
              <td><b>{m.map_name ?? "?"}</b>
                <span className="ps-dim"> {m.team1_faction ?? ""}
                  {m.team1_faction && m.team2_faction ? " vs " : ""}
                  {m.team2_faction ?? ""}</span></td>
              <td>{m.game_mode ?? "—"}</td>
              <td className="ps-num">{m.peak_players ?? m.players}</td>
              <td className="ps-num">{fmtPlaytime(m.duration_sec)}</td>
              <td className={"ps-res " + cls}>{txt}</td>
              <td className="ps-num ps-dim">{fmtDate(m.started_at).slice(0, 16)}</td>
              <td className="ps-watch-cell">
                {m.has_replay
                  ? <a className="ps-watch-btn"
                       href={`/replay/?mode=replay&id=${encodeURIComponent(m.match_id)}`}
                       target="_blank" rel="noopener noreferrer"
                       onClick={(e) => e.stopPropagation()}>▶ Watch</a>
                  : <span className="ps-dim ps-arch">archive</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function MatchDetailView({ m, onPick }: {
  m: MatchDetail; onPick: (eos: string) => void;
}) {
  const [heat, setHeat] = useState<MatchHeatmap | null>(null);
  const [showHeat, setShowHeat] = useState(false);
  const t1 = m.players.filter((p) => p.team_id === 1);
  const t2 = m.players.filter((p) => p.team_id === 2);

  const toggleHeat = () => {
    if (showHeat) { setShowHeat(false); return; }
    setShowHeat(true);
    if (!heat) fetchMatchHeatmap(m.match_id).then(setHeat).catch(() => setHeat(null));
  };

  return (
    <div className="ps-profile">
      <div className="ps-prof-head">
        <span className="ps-pname">{m.map_name ?? "?"}</span>
        <span className="ps-prof-seen">
          {m.game_mode ?? ""} · {fmtDate(m.started_at)} · {fmtPlaytime(m.duration_sec)}
          {" · "}{m.team1_faction ?? "T1"} {m.team1_tickets ?? "—"}
          {" – "}{m.team2_tickets ?? "—"} {m.team2_faction ?? "T2"}
        </span>
        {m.has_replay ? (
          <a className="ps-tab ps-watch-btn"
             href={`/replay/?mode=replay&id=${encodeURIComponent(m.match_id)}`}
             target="_blank" rel="noopener noreferrer">▶ Watch replay</a>
        ) : null}
        <button className="ps-tab" onClick={toggleHeat}>
          {showHeat ? "Scoreboard" : "Heatmap"}
        </button>
      </div>

      {showHeat ? (
        heat
          ? <HeatmapCanvas bounds={heat.bounds}
                           data={{ kind: "match", points: heat.points }} />
          : <div className="ps-msg"><span className="ps-spin" />Loading…</div>
      ) : (
        <div className="ps-cols">
          <MatchTeamTable team={1} faction={m.team1_faction}
                          winner={m.winner_team} rows={t1} onPick={onPick} />
          <MatchTeamTable team={2} faction={m.team2_faction}
                          winner={m.winner_team} rows={t2} onPick={onPick} />
        </div>
      )}
    </div>
  );
}

function MatchTeamTable({ team, faction, winner, rows, onPick }: {
  team: 1 | 2; faction: string | null; winner: number | null;
  rows: MatchDetailPlayer[]; onPick: (eos: string) => void;
}) {
  return (
    <div className="ps-col">
      <h3>
        <span className="info-dot" style={{
          background: team === 1 ? "#d84a54" : "#5aa0e0", marginRight: 6 }} />
        Team {team}{faction ? ` · ${faction}` : ""}
        {winner === team ? " · Won" : ""}
      </h3>
      <table className="ps-mini ps-matchsb">
        <thead>
          <tr><th>Player</th><th className="ps-num">K</th><th className="ps-num">D</th>
            <th className="ps-num">Score</th></tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.eos_id} className="ps-row" onClick={() => onPick(p.eos_id)}>
              <td><Name name={p.name} clan={p.clan_tag} /></td>
              <td className="ps-num">{p.kills}</td>
              <td className="ps-num">{p.deaths}</td>
              <td className="ps-num ps-hl">{int(p.score)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatmapTab({ layer, onPickLayer, heat, server }: {
  layer: string;
  onPickLayer: (l: string) => void;
  heat: LayerHeatmap | null;
  server: string;
}) {
  const [opts, setOpts] = useState<HeatmapLayerOption[] | null>(null);
  const [optErr, setOptErr] = useState<string | null>(null);

  // The picker only offers layers that have at least one positioned kill (on the
  // selected server), so a pick can never land on an empty map. Re-fetches when
  // the server scope changes.
  useEffect(() => {
    let live = true;
    fetchHeatmapLayers(server)
      .then((o) => {
        if (!live) return;
        setOpts(o);
        // auto-pick when nothing is selected OR the current layer isn't offered
        // on this server, so the dropdown + heatmap stay in sync across scopes.
        if (o.length > 0 && !o.some((x) => x.layer_name === layer))
          onPickLayer(o[0].layer_name);
      })
      .catch((e) => { if (live) setOptErr(String(e)); });
    return () => { live = false; };
    // Re-runs on server change; layer changes are ignored (would fight auto-pick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  if (optErr) return <div className="ps-msg ps-err">Error: {optErr}</div>;
  if (opts === null) {
    return <div className="ps-msg"><span className="ps-spin" />Loading layers…</div>;
  }
  if (opts.length === 0) {
    return (
      <div className="ps-msg">
        No positioned kill data yet. Positions are only recorded for matches
        processed after this version.
      </div>
    );
  }

  return (
    <div className="hm-tab">
      <div className="hm-controls">
        <select className="ps-period" value={layer}
                onChange={(e) => onPickLayer(e.target.value)}>
          {opts.map((o) => (
            <option key={o.layer_name} value={o.layer_name}>
              {o.layer_name} ({o.deaths} deaths / {o.matches} matches)
            </option>
          ))}
        </select>
      </div>
      {heat
        ? <HeatmapCanvas bounds={heat.bounds}
                         data={{ kind: "layer", cells: heat.cells,
                                 cellCm: heat.cellCm, maxCount: heat.maxCount }} />
        : <div className="ps-msg">No death records on this layer for this period.</div>}
    </div>
  );
}

function SearchResults({ rows, q, onPick }: {
  rows: PlayerSummary[]; q: string; onPick: (eos: string) => void;
}) {
  if (rows.length === 0) {
    return <div className="ps-msg">No results for "{q.trim()}".</div>;
  }
  return (
    <table className="ps-table">
      <thead>
        <tr>
          <th>Player</th>
          <th className="ps-num">K</th><th className="ps-num">D</th>
          <th className="ps-num">K/D</th><th className="ps-num">Matches</th>
          <th className="ps-num">Last seen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.eos_id} className="ps-row" onClick={() => onPick(r.eos_id)}>
            <td><Name name={r.last_name} clan={r.last_clan_tag} /></td>
            <td className="ps-num">{int(r.kills)}</td>
            <td className="ps-num">{int(r.deaths)}</td>
            <td className="ps-num">{kd(r.kills, r.deaths)}</td>
            <td className="ps-num">{int(r.matches)}</td>
            <td className="ps-num ps-dim">{fmtDate(r.last_seen_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const Tile = ({ label, value, hl }: { label: string; value: string; hl?: boolean }) => (
  <div className={hl ? "ps-tile ps-tile-hl" : "ps-tile"}>
    <div className="ps-tile-v">{value}</div>
    <div className="ps-tile-l">{label}</div>
  </div>
);

function ProfileView({ p, onPick }: { p: PlayerProfile; onPick: (eos: string) => void }) {
  const lt = p.lifetime;
  return (
    <div className="ps-profile">
      <div className="ps-prof-head">
        <Name name={p.name} clan={p.clanTag} />
        {/* No ELO row means unrated — which is not the same as sitting at the
            1000 starting value, and must not look like it. */}
        {p.elo
          ? <EloPill elo={p.elo} showProgress />
          : <span className="elo-pill elo-unrated" title={
              "A match must be crowded and long enough to count for ELO"
            }>Unrated</span>}
        {p.mostPlayedRole && (
          <span className="ps-role-pill" title="Most played role">
            {p.mostPlayedRole.role}
          </span>
        )}
        <span className="ps-prof-seen">
          First: {fmtDate(p.firstSeenAt)} · Last: {fmtDate(p.lastSeenAt)}
        </span>
      </div>

      <div className="ps-tiles">
        <Tile label="K/D" value={kd(lt.kills, lt.deaths)} hl />
        <Tile label="Kills" value={int(lt.kills)} />
        <Tile label="Deaths" value={int(lt.deaths)} />
        <Tile label="Matches" value={int(lt.matches)} />
        <Tile label="Vehicle K" value={int(lt.vehicle_kills)} />
        <Tile label="Team Kills" value={int(lt.team_kills)} />
        <Tile label="Revives" value={int(lt.revives)} />
        <Tile label="Duration" value={fmtPlaytime(lt.playtime_sec)} />
      </div>

      {/* Squad's own per-player counters — read straight from server memory,
          not available over RCON. */}
      <div className="ps-tiles">
        <Tile label="Captures" value={int(lt.captures)} />
        <Tile label="Defenses" value={int(lt.defenses)} />
        <Tile label="FOBs Built" value={int(lt.fobs_built)} />
        <Tile label="FOBs Destroyed" value={int(lt.fobs_destroyed)} />
        <Tile label="Supplies" value={int(lt.supplies_delivered)} />
        <Tile label="Longest Kill" value={metres(p.longestKillInfM)} />
      </div>

      {(p.bestMatch?.byKills || p.periodBreakdown) && (
        <div className="ps-extra">
          {p.bestMatch?.byKills && (
            <div className="ps-extra-card">
              <div className="ps-extra-h">Best Match</div>
              <div className="ps-extra-v">{p.bestMatch.byKills.value} kill</div>
              <div className="ps-extra-l">
                {p.bestMatch.byKills.map_name ?? "?"} ·
                {" "}{fmtDate(p.bestMatch.byKills.started_at).slice(0, 10)}
              </div>
            </div>
          )}
          {p.periodBreakdown && (["weekly", "monthly", "alltime"] as const).map((k) => {
            const s = p.periodBreakdown![k];
            const label = k === "weekly" ? "This Week"
              : k === "monthly" ? "This Month" : "All Time";
            return (
              <div className="ps-extra-card" key={k}>
                <div className="ps-extra-h">{label}</div>
                <div className="ps-extra-v">{s.kills}/{s.deaths}
                  <span className="ps-dim"> · {kd(s.kills, s.deaths)}</span></div>
                <div className="ps-extra-l">{s.matches} matches</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="ps-cols">
        <div className="ps-col">
          <h3>Top Weapons</h3>
          {p.topWeapons.length === 0
            ? <div className="ps-empty">No kill-event data yet.</div>
            : <WeaponList rows={p.topWeapons} />}
          <h3>Nemesis (killed you most)</h3>
          {p.nemeses.length === 0
            ? <div className="ps-empty">—</div>
            : <NemesisList rows={p.nemeses} onPick={onPick} />}
          <h3>Victims (you killed most)</h3>
          {p.victims.length === 0
            ? <div className="ps-empty">—</div>
            : <NemesisList rows={p.victims} onPick={onPick} />}
          <h3>Squadmates</h3>
          {(p.squadmates?.length ?? 0) === 0
            ? <div className="ps-empty">—</div>
            : <SquadmateList rows={p.squadmates ?? []} onPick={onPick} />}
          <h3>Vehicles Used</h3>
          {(p.vehiclesUsed?.length ?? 0) === 0
            ? <div className="ps-empty">—</div>
            : <VehiclesUsedList rows={p.vehiclesUsed ?? []} />}
        </div>
        <div className="ps-col">
          <h3>Map Record</h3>
          {(p.mapRecords?.length ?? 0) === 0
            ? <div className="ps-empty">No maps with at least 2 matches played.</div>
            : <MapRecordTable rows={p.mapRecords ?? []} />}
          <h3>Faction Record</h3>
          {(p.factions?.length ?? 0) === 0
            ? <div className="ps-empty">—</div>
            : <FactionTable rows={p.factions ?? []} />}
          <h3>Activity (UTC)</h3>
          {(p.activity?.length ?? 0) === 0
            ? <div className="ps-empty">—</div>
            : <ActivityGrid cells={p.activity ?? []} />}
          <h3>Recent Matches</h3>
          {p.recentMatches.length === 0
            ? <div className="ps-empty">—</div>
            : <MatchList rows={p.recentMatches} />}
        </div>
      </div>
    </div>
  );
}

function SquadmateList({ rows, onPick }: {
  rows: SquadmateRow[]; onPick: (eos: string) => void;
}) {
  return (
    <table className="ps-mini">
      <tbody>
        {rows.map((s) => (
          <tr key={s.eos} className="ps-row" onClick={() => onPick(s.eos)}>
            <td><Name name={s.name} /></td>
            <td className="ps-num"><b>{s.c}</b> matches</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VehiclesUsedList({ rows }: { rows: VehicleUsedRow[] }) {
  return (
    <table className="ps-mini">
      <tbody>
        {rows.map((v) => (
          <tr key={v.vehicle_class}>
            <td>{vehicleName(v.vehicle_class)}</td>
            <td className="ps-num">{fmtPlaytime(v.time_s)}</td>
            <td className="ps-num ps-dim">{Math.round(v.distance_m / 1000)} km</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MapRecordTable({ rows }: { rows: MapRecord[] }) {
  return (
    <table className="ps-mini">
      <tbody>
        {rows.map((m) => (
          <tr key={m.map_name}>
            <td>{m.map_name}</td>
            <td className="ps-num">{Math.round((m.wins / Math.max(1, m.matches)) * 100)}%
              <span className="ps-dim"> W</span></td>
            <td className="ps-num ps-dim">{m.matches} matches · {m.kills}/{m.deaths}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FactionTable({ rows }: { rows: FactionRecord[] }) {
  return (
    <table className="ps-mini">
      <tbody>
        {rows.map((f) => (
          <tr key={f.faction}>
            <td>{f.faction}</td>
            <td className="ps-num">{Math.round((f.wins / Math.max(1, f.matches)) * 100)}%
              <span className="ps-dim"> W</span></td>
            <td className="ps-num ps-dim">{f.matches} matches · {kd(f.kills, f.deaths)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 7×24 kill-activity grid. Aqua density ramp — same hue family as the spatial
// heatmap, kept off the team red/blue. Day 0 = Sunday (SQLite strftime('%w')).
const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function ActivityGrid({ cells }: { cells: ActivityCell[] }) {
  const grid = new Map<string, number>();
  let max = 0;
  for (const c of cells) {
    grid.set(`${c.dow}:${c.hour}`, c.n);
    if (c.n > max) max = c.n;
  }
  const shade = (n: number): string => {
    if (n <= 0) return "transparent";
    const t = Math.sqrt(n / Math.max(1, max));   // sqrt: long-tailed counts
    const a = 0.2 + t * 0.75;
    return `rgba(126, 224, 200, ${a.toFixed(2)})`;   // app --accent-2 aqua
  };
  return (
    <div className="ps-activity">
      {DOW_LABELS.map((label, dow) => (
        <div className="ps-act-row" key={dow}>
          <span className="ps-act-day">{label}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const n = grid.get(`${dow}:${h}`) ?? 0;
            return <span key={h} className="ps-act-cell"
                         style={{ background: shade(n) }}
                         title={`${label} ${h}:00 — ${n} kill`} />;
          })}
        </div>
      ))}
    </div>
  );
}

function WeaponList({ rows }: { rows: WeaponStat[] }) {
  const max = Math.max(1, ...rows.map((r) => r.kills));
  return (
    <div className="ps-bars">
      {rows.map((w) => (
        <div className="ps-bar-row" key={w.weapon}>
          <span className="ps-bar-name" title={w.weapon}>{humanWeapon(w.weapon)}</span>
          <span className="ps-bar-track">
            <span className="ps-bar-fill" style={{ width: `${(w.kills / max) * 100}%` }} />
          </span>
          <span className="ps-bar-num">{w.kills}</span>
        </div>
      ))}
    </div>
  );
}
function NemesisList({ rows, onPick }: { rows: NemesisRow[]; onPick: (eos: string) => void }) {
  return (
    <table className="ps-mini">
      <tbody>
        {rows.map((n) => (
          <tr key={n.eos} className="ps-row" onClick={() => onPick(n.eos)}>
            <td><Name name={n.name} /></td>
            <td className="ps-num"><b>{n.c}</b> kill</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function MatchList({ rows }: { rows: PlayerMatchRow[] }) {
  // Returns [display-text, css-class]. The class is ASCII-only (win/loss/draw)
  // so the Turkish label never leaks into a selector.
  const result = (m: PlayerMatchRow): [string, string] => {
    if (m.status !== "final" || m.winner_team == null || m.team_id == null) return ["—", ""];
    if (m.winner_team === 0) return ["Draw", ""];
    return m.winner_team === m.team_id ? ["Win", "ps-res-win"] : ["Loss", "ps-res-loss"];
  };
  return (
    <table className="ps-mini ps-matches">
      <thead>
        <tr>
          <th>Map</th><th>Mode</th>
          <th className="ps-num">K/D</th><th>Result</th>
          <th className="ps-num">ELO</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => (
          <tr key={m.match_id}>
            <td>
              <span className="ps-m-map">{m.map_name ?? "?"}</span>
              <span className="ps-dim ps-m-date"> {fmtDate(m.started_at).slice(0, 10)}</span>
            </td>
            <td>{m.game_mode ?? "—"}</td>
            <td className="ps-num">{m.kills}/{m.deaths}</td>
            {(() => { const [txt, cls] = result(m);
              return <td className={"ps-res " + cls}>{txt}</td>; })()}
            {/* null = the match was never rated (too small/short). An em-dash,
                not a 0 — "no change" and "not counted" are different facts. */}
            <td className={"ps-num ps-delta "
                  + (m.elo_change == null ? ""
                     : m.elo_change > 0 ? "ps-delta-up"
                     : m.elo_change < 0 ? "ps-delta-down" : "")}>
              {m.elo_change == null ? "—"
                : m.elo_change > 0 ? `+${m.elo_change}` : String(m.elo_change)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
