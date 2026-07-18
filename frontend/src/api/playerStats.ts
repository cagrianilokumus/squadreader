// Thin fetch helpers for the persistent player-stats API
// (/api/players, /api/players/<eos>, /api/leaderboard, /api/servers). Same-origin
// relative URLs + no-store, mirroring api/recordings.ts.
//
// `server` scopes a query to one enrolled server; "" (the default) = GLOBAL. The
// agent's own stats API has a single server and ignores the param, so passing it
// unconditionally is harmless on both the agent and the central builds.

import type {
  PlayerSummary, PlayerProfile, LeaderRow, StatsPeriod,
  WeaponMetaRow, MatchHeatmap, LayerHeatmap, HeatmapLayerOption,
  MatchSummaryRow, MatchDetail, ServerOption,
} from "../state/types";

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** `&server=<id>` when scoped to a server, else "" (global). */
const srv = (server?: string) =>
  server ? `&server=${encodeURIComponent(server)}` : "";

/** The enrolled servers for the scope picker (central only; empty elsewhere). */
export async function fetchServers(): Promise<ServerOption[]> {
  return getJson("./api/servers");
}

export async function searchPlayers(
  q: string, limit = 30, server = "",
): Promise<PlayerSummary[]> {
  return getJson(`./api/players?q=${encodeURIComponent(q)}&limit=${limit}${srv(server)}`);
}

export async function fetchProfile(
  eosId: string, server = "",
): Promise<PlayerProfile> {
  return getJson(`./api/players/${encodeURIComponent(eosId)}?x=1${srv(server)}`);
}

export async function fetchLeaderboard(
  stat: string, limit = 50, period: StatsPeriod = "alltime", server = "",
): Promise<LeaderRow[]> {
  return getJson(
    `./api/leaderboard?stat=${encodeURIComponent(stat)}` +
    `&limit=${limit}&period=${period}${srv(server)}`);
}

export async function fetchWeaponMeta(
  period: StatsPeriod = "alltime", limit = 40, server = "",
): Promise<WeaponMetaRow[]> {
  return getJson(`./api/weapons?period=${period}&limit=${limit}${srv(server)}`);
}

export async function fetchMatchHeatmap(matchId: string): Promise<MatchHeatmap> {
  return getJson(`./api/heatmap?match=${encodeURIComponent(matchId)}`);
}

/** Only layers that have at least one positioned kill — the rest cannot be drawn. */
export async function fetchHeatmapLayers(server = ""): Promise<HeatmapLayerOption[]> {
  return getJson(`./api/layers?x=1${srv(server)}`);
}

export async function fetchMatches(
  period: StatsPeriod = "alltime", limit = 50, server = "",
): Promise<MatchSummaryRow[]> {
  return getJson(`./api/matches?period=${period}&limit=${limit}${srv(server)}`);
}

export async function fetchMatchDetail(matchId: string): Promise<MatchDetail> {
  return getJson(`./api/match/${encodeURIComponent(matchId)}`);
}

export async function fetchLayerHeatmap(
  layer: string, period: StatsPeriod = "alltime", cellCm = 5000, server = "",
): Promise<LayerHeatmap> {
  return getJson(
    `./api/heatmap?layer=${encodeURIComponent(layer)}` +
    `&period=${period}&cell=${cellCm}${srv(server)}`);
}
