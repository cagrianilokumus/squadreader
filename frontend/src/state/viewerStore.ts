// Single Zustand store. Slices kept in one file because cross-slice
// access is the norm (e.g. mode flips need to clear replay buffer).
// Selectors at call sites keep re-renders fine-grained.

import { create } from "zustand";
import { DEFAULT_VIEW } from "./types";
import { patchSnapshot, resetCarryOver } from "./carryOver";
import { replayLoad } from "./replayLoad";
import type {
  ConnStatus, KillFeedEntry, Mode, RecordingMeta, Snapshot, TeamState, ViewState,
} from "./types";

const KILL_FEED_MAX = 60;

// Backend publishes at a FIXED 0.5 Hz. These three constants are the entire
// cadence contract for the live render path — keep them mutually consistent.
const NOMINAL_TICK_MS = 2000;
// FIXED render-delay: the canvas draws the world this far in the PAST, between
// two already-arrived buffered frames, so it can never overrun the newest frame
// and freeze. Decoupled from the jittery avgTickMs EMA on purpose (a constant
// makes the render clock strictly monotonic → no time-warp). 6s ⇒ stall
// tolerance = DELAY - tick = 4000ms ≈ 2 dropped ticks (a tick running 2-3×
// slow) absorbed with zero freeze — a deliberate trade of the earlier 10s for
// lower perceived latency. Also gates the BufferOverlay warmup/stall UI.
// Imported by MapCanvas.
export const RENDER_DELAY_MS = 6_000;
// Render-delay ring size. INVARIANT (paired with RENDER_DELAY_MS = 6000):
//   (SNAP_BUFFER_CAP - 1) * NOMINAL_TICK_MS  >  RENDER_DELAY_MS + maxSurvivableGap
//   (16-1) * 2000 = 30000ms  >  6000 + 4000 = 10000ms
// so the pair bracketing the render clock is never evicted, even across a
// full survivable stall, with generous margin.
const SNAP_BUFFER_CAP = 16;

// Toggleable map layers (show/hide entity families for decluttering).
export type LayerKey =
  | "players" | "vehicles" | "deployables" | "markers"
  | "projectiles" | "spawners" | "rallies";

// Generic click-selection for every map entity that gets the shared InfoPanel
// (everything EXCEPT player/vehicle, which keep their dedicated panels + follow).
export type InfoKind =
  | "marker" | "deployable" | "spawner"
  | "rally" | "capzone" | "projectile";
export interface SelectedInfo { kind: InfoKind; id: string; }

export const LAYER_ORDER: LayerKey[] = [
  "players", "vehicles", "deployables", "markers",
  "projectiles", "spawners", "rallies",
];

export const LAYER_LABELS: Record<LayerKey, string> = {
  players: "Players",
  vehicles: "Vehicles",
  deployables: "FOB / HAB",
  markers: "Markers",
  projectiles: "Projectiles",
  spawners: "Spawn Points",
  rallies: "Rallies",
};

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  players: true, vehicles: true, deployables: true, markers: true,
  projectiles: true, spawners: false, rallies: true,
};

interface ReplaySlice {
  id: string | null;
  frames: Snapshot[];
  currentIdx: number;
  playing: boolean;
  speed: number;
  // wall-clock baseline rebased on every play/seek/speed change
  baseWallMs: number;
  baseSnapMs: number;
  // Bumped to re-run the loader for the SAME id (retry after a failed fetch) —
  // re-assigning the unchanged id wouldn't retrigger the effect on its own.
  loadNonce: number;
}

interface Store {
  mode: Mode;
  status: ConnStatus;

  // Live-map access. This is the DISTRIBUTED (open-source) build, which has no
  // live map at all: canLive is hard-wired false so the whole live surface
  // (toggle, "enter live" CTA, in-progress recordings) stays hidden. The type
  // keeps `null` only so shared components need no change; nothing ever sets it.
  canLive: boolean | null;

  // The most recent two snapshots — used for inter-tick lerp. In live
  // mode `prev` is the previous SSE tick. In replay mode `cur` is the
  // playhead frame; the renderer reads frames[currentIdx + 1] for
  // forward interpolation.
  prevSnap: Snapshot | null;
  curSnap: Snapshot | null;
  // Teams captured from the last InProgress snapshot — the win-instant ticket
  // values. Squad keeps bleeding the winner's Tickets field for a moment into
  // WaitingPostMatch, so live reads drift a few tickets below the game's frozen
  // final; the match-end overlay uses these instead. Updated every InProgress
  // tick, so at the round-end transition it holds the last live values.
  lastInProgressTeams: TeamState[] | null;
  curArrivalMs: number;
  avgTickMs: number;

  // Render-delay interpolation buffer: a timestamped ring of the last few
  // PATCHED snapshots. The canvas renders at (now - DELAY) between the two
  // frames that bracket that time, so interpolation is always fed by two
  // already-arrived snapshots — it can never run past the newest frame and
  // freeze (the periodic ~0.5s map hitch). Latency is a non-issue here.
  snapBuffer: { snap: Snapshot; t: number }[];

  view: ViewState;

  replay: ReplaySlice;

  // recording picker cache
  recordings: RecordingMeta[] | null;
  recordingsLoading: boolean;
  recordingsError: string | null;

  // Clicking a vehicle pins it into the right-side detail panel; null
  // means the panel is closed. We store the vehicle ID (the hex actor
  // pointer, which is stable while alive) — the panel re-resolves the
  // live vehicle from the latest snap on each render.
  selectedVehicleId: string | null;

  // Same idea for players. Key by eosId (Epic Online Services player
  // ID): stable across the player's lifetime, unique across the lobby,
  // unaffected by PlayerState reallocations. Falls back to playerId
  // when eosId is missing (bots).
  selectedPlayerKey: string | null;

  // When set, the map camera keeps this player (same key scheme)
  // centred each frame. Cleared by any manual pan/zoom or on deselect.
  followKey: string | null;

  // Generic selection for the non-player/non-vehicle entities (marker, FOB/
  // deployable, spawner, rally, capture zone, projectile) — drives the shared
  // InfoPanel. Mutually exclusive with selectedVehicleId/selectedPlayerKey so
  // only one detail panel is ever open.
  selectedInfo: SelectedInfo | null;

  // Kill feed — derived view appended by the diff hook on every snapshot
  // tick. Newest entry first. Capped at KILL_FEED_MAX so the buffer can't
  // grow unbounded across a long match.
  killFeed: KillFeedEntry[];
  killFeedVisible: boolean;

  // Scoreboard overlay (Tab to toggle, like Squad in-game) — modal that
  // covers the map with team rosters + per-player stats. closedSquads
  // stores the user-collapsed squad ids per team (default expanded).
  scoreboardVisible: boolean;
  scoreboardClosedSquads: { 1: number[]; 2: number[] };

  // Map layer visibility — which entity families the canvas draws.
  layers: Record<LayerKey, boolean>;

  // mutators
  setMode(m: Mode): void;
  setStatus(s: ConnStatus): void;
  setCanLive(v: boolean): void;
  ingestLive(snap: Snapshot): void;
  setView(updater: (v: ViewState) => ViewState): void;
  setReplay(updater: (r: ReplaySlice) => ReplaySlice): void;
  retryReplayLoad(): void;
  setRecordings(r: RecordingMeta[] | null): void;
  setRecordingsLoading(b: boolean): void;
  setRecordingsError(e: string | null): void;
  setSelectedVehicleId(id: string | null): void;
  setSelectedPlayerKey(key: string | null): void;
  setSelectedInfo(info: SelectedInfo | null): void;
  setFollowKey(key: string | null): void;
  pushKillFeed(entries: KillFeedEntry[]): void;
  clearKillFeed(): void;
  toggleKillFeed(): void;
  toggleScoreboard(): void;
  setScoreboardVisible(v: boolean): void;
  toggleScoreboardSquad(team: 1 | 2, sqId: number): void;
  toggleLayer(key: LayerKey): void;
  resetView(): void;
}

export const useViewerStore = create<Store>((set) => ({
  mode: "home",
  status: "connecting",
  canLive: false,
  prevSnap: null,
  curSnap: null,
  lastInProgressTeams: null,
  curArrivalMs: 0,
  // Seed at the prod nominal interval (0.5 Hz = 2000 ms). avgTickMs is now
  // TELEMETRY ONLY (TopBar Hz readout) — it no longer feeds the render DELAY
  // (that is a FIXED constant in MapCanvas), so its EMA jitter can never
  // time-warp the map. See ingestLive + MapCanvas RENDER_DELAY_MS.
  avgTickMs: NOMINAL_TICK_MS,
  snapBuffer: [],
  view: { ...DEFAULT_VIEW },
  replay: {
    id: null,
    frames: [],
    currentIdx: 0,
    playing: false,
    speed: 1,
    baseWallMs: 0,
    baseSnapMs: 0,
    loadNonce: 0,
  },
  recordings: null,
  recordingsLoading: false,
  recordingsError: null,
  selectedVehicleId: null,
  selectedPlayerKey: null,
  selectedInfo: null,
  followKey: null,
  killFeed: [],
  killFeedVisible: true,
  scoreboardVisible: false,
  scoreboardClosedSquads: { 1: [], 2: [] },
  layers: { ...DEFAULT_LAYERS },

  setMode(m) {
    // Everything that remembers state ACROSS ticks has to be dropped here, or the
    // incoming mode's first frame gets read against the outgoing mode's past:
    //   - carry-over would resurrect live ghosts into a replay,
    //   - the render buffer would bracket stale live frames,
    //   - the kill feed would keep showing the live match's kills over a replay
    //     of a different one.
    // The kill-feed DIFF state is reset in useKillFeed, which watches `mode` —
    // without that, the first replay frame is diffed against the live match's
    // stats and invents kills that never happened.
    resetCarryOver();
    set({ mode: m, snapBuffer: [], killFeed: [] });
  },
  setStatus(s) {
    set({ status: s });
  },
  setCanLive(v) {
    set({ canLive: v });
  },
  ingestLive(snap) {
    set((s) => {
      const now = performance.now();
      // Repair transient gaps (missing players / null positions from
      // one-tick backend read failures) before the snap becomes
      // renderer-visible — see carryOver.ts. LIVE ONLY: replay frames are
      // the ground truth, and the wall-clock TTL is decoupled from replay
      // time, so running it in replay re-injects end-of-match ghosts when
      // you seek backward. Pass replay frames through untouched.
      const patched = s.mode === "replay" ? snap : patchSnapshot(snap, now);
      let avg = s.avgTickMs;
      let prev = s.prevSnap;
      if (s.curSnap) {
        const dt = now - s.curArrivalMs;
        if (dt > 50 && dt < 5000) avg = avg * 0.7 + dt * 0.3;
        prev = s.curSnap;
      } else {
        prev = patched;  // first tick — lerp identity
      }
      // Append to the render-delay ring. Cap raised 8 → 16 so the window
      // always spans RENDER_DELAY_MS (10s) PLUS a full worst-case survivable
      // stall (10s) with margin. Raw arrival `t` (no reclock — the teleport
      // guard already reads the real per-pair span, so in-tolerance motion is
      // correct; reclock is the documented future fix only for post-stall
      // bursts, which cannot occur in 0.5 Hz steady state).
      const snapBuffer = [...s.snapBuffer, { snap: patched, t: now }];
      while (snapBuffer.length > SNAP_BUFFER_CAP) snapBuffer.shift();
      // Freeze the win-instant tickets: only advance lastInProgressTeams while
      // the match is actually InProgress (and the read carried teams), so it
      // holds the last live values once the round flips to WaitingPostMatch.
      const ms = patched.gameState?.matchState;
      const lastInProgressTeams =
        ms === "InProgress" && (patched.teams?.length ?? 0) > 0
          ? patched.teams!
          : s.lastInProgressTeams;
      return {
        prevSnap: prev,
        curSnap: patched,
        lastInProgressTeams,
        curArrivalMs: now,
        avgTickMs: avg,
        snapBuffer,
      };
    });
  },
  setView(updater) {
    set((s) => ({ view: updater(s.view) }));
  },
  setReplay(updater) {
    set((s) => ({ replay: updater(s.replay) }));
  },
  retryReplayLoad() {
    // Re-run the loader for the current id after a failed fetch. Clear the error
    // flag the overlay reads, drop any partial frames, and bump the nonce the
    // loader effect depends on.
    replayLoad.error = false;
    replayLoad.active = false;
    set((s) => ({
      replay: { ...s.replay, frames: [], currentIdx: 0, playing: false,
                loadNonce: s.replay.loadNonce + 1 },
    }));
  },
  setRecordings(r) {
    set({ recordings: r });
  },
  setRecordingsLoading(b) {
    set({ recordingsLoading: b });
  },
  setRecordingsError(e) {
    set({ recordingsError: e });
  },
  setSelectedVehicleId(id) {
    // Opening the vehicle panel closes any info panel.
    set((s) => ({ selectedVehicleId: id,
                  selectedInfo: id == null ? s.selectedInfo : null }));
  },
  setSelectedPlayerKey(key) {
    // Closing the player panel also stops any follow on that player; opening
    // it closes any info panel.
    set((s) => ({ selectedPlayerKey: key,
                  followKey: key == null ? null : s.followKey,
                  selectedInfo: key == null ? s.selectedInfo : null }));
  },
  setSelectedInfo(info) {
    // Opening an info panel closes the player + vehicle panels (and follow).
    set((s) => ({ selectedInfo: info,
                  selectedVehicleId: info == null ? s.selectedVehicleId : null,
                  selectedPlayerKey: info == null ? s.selectedPlayerKey : null,
                  followKey: info == null ? s.followKey : null }));
  },
  setFollowKey(key) {
    set({ followKey: key });
  },
  pushKillFeed(entries) {
    if (!entries.length) return;
    set((s) => {
      // Newest first; cap to KILL_FEED_MAX so the buffer can't grow
      // unbounded across a 60-minute match (Squad can hit 300+ kills).
      const next = [...entries, ...s.killFeed].slice(0, KILL_FEED_MAX);
      return { killFeed: next };
    });
  },
  clearKillFeed() {
    set({ killFeed: [] });
  },
  toggleKillFeed() {
    set((s) => ({ killFeedVisible: !s.killFeedVisible }));
  },
  toggleScoreboard() {
    set((s) => ({ scoreboardVisible: !s.scoreboardVisible }));
  },
  setScoreboardVisible(v) {
    set({ scoreboardVisible: v });
  },
  toggleScoreboardSquad(team, sqId) {
    set((s) => {
      const list = s.scoreboardClosedSquads[team];
      const next = list.includes(sqId)
        ? list.filter((x) => x !== sqId)
        : [...list, sqId];
      return {
        scoreboardClosedSquads: { ...s.scoreboardClosedSquads, [team]: next },
      };
    });
  },
  toggleLayer(key) {
    set((s) => ({ layers: { ...s.layers, [key]: !s.layers[key] } }));
  },
  resetView() {
    set((s) => ({
      view: { ...s.view, zoom: 1, panX: 0, panY: 0, userInteracted: false },
    }));
  },
}));
