// Single Zustand store. Slices kept in one file because cross-slice
// access is the norm (e.g. mode flips need to clear replay buffer).
// Selectors at call sites keep re-renders fine-grained.

import { create } from "zustand";
import { DEFAULT_VIEW } from "./types";
import { patchSnapshot, resetCarryOver } from "./carryOver";
import { replayLoad } from "./replayLoad";
import type { ReplayMarker } from "./replayMarkers";
import type { TeamView } from "../canvas/teamView";
import type {
  ConnStatus, KillFeedEntry, Mode, RecordingMeta, Snapshot, TeamState, ViewState,
} from "./types";

export const KILL_FEED_MAX = 60;

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
// The live snap ring must always hold ≥ RENDER_DELAY_MS of frames (so the render
// clock — which sits RENDER_DELAY_MS in the past — always has a bracketing pair)
// PLUS a full survivable stall. We trim the ring by TIME, not frame count, so
// this window holds at ANY tick rate: the reader runs anywhere from 0.5 Hz up to
// the ~4 Hz two-tier rate. (A fixed 16-frame cap silently broke at 4 Hz — 16
// frames spanned only ~4 s, less than the 6 s render delay, so the buffer never
// reached RENDER_DELAY_MS and warmup could never complete.) SNAP_BUFFER_CAP is
// now only a memory ceiling, above the frame count that window implies at 4 Hz
// (~10 s / 250 ms ≈ 40).
const SNAP_BUFFER_SPAN_MS = RENDER_DELAY_MS + 4_000;  // 10 s time window
const SNAP_BUFFER_CAP = 48;  // memory ceiling (~10 s @ 4 Hz = 40 frames, + margin)

// Toggleable map layers (show/hide entity families for decluttering) plus the
// number-label options. Both are stored in the same `layers` map and driven by
// the settings menu; NUMBER_ORDER / LAYER_ORDER just group them for display.
export type LayerKey =
  | "players" | "vehicles" | "deployables" | "markers"
  | "projectiles" | "spawners" | "rallies"
  | "slNumbers" | "squadNumbers";

// Generic click-selection for every map entity that gets the shared InfoPanel
// (everything EXCEPT player/vehicle, which keep their dedicated panels + follow).
export type InfoKind =
  | "marker" | "deployable" | "spawner"
  | "rally" | "capzone" | "projectile";
export interface SelectedInfo { kind: InfoKind; id: string; }

// Entity-family layers (icons on the map).
export const LAYER_ORDER: LayerKey[] = [
  "players", "vehicles", "deployables", "markers",
  "projectiles", "spawners", "rallies",
];

// Number-label options — shown as their own group in the settings menu.
export const NUMBER_ORDER: LayerKey[] = ["slNumbers", "squadNumbers"];

export const LAYER_LABELS: Record<LayerKey, string> = {
  players: "Players",
  vehicles: "Vehicles",
  deployables: "FOB / HAB",
  markers: "Markers",
  projectiles: "Projectiles",
  spawners: "Spawn Points",
  rallies: "Rallies",
  slNumbers: "Squad leader numbers",
  squadNumbers: "All player & vehicle numbers",
};

const DEFAULT_LAYERS: Record<LayerKey, boolean> = {
  players: true, vehicles: true, deployables: true, markers: true,
  projectiles: true, spawners: false, rallies: true,
  slNumbers: true, squadNumbers: false,
};

const LAYERS_LS_KEY = "sqr.mapLayers";

// Persist the settings-menu choices across reloads. Absent/unknown keys fall
// back to DEFAULT_LAYERS, so a newly added option shows at its intended default
// even for returning users. Wrapped in try/catch — a disabled or quota'd
// localStorage must never break the viewer.
function loadLayers(): Record<LayerKey, boolean> {
  try {
    const raw = localStorage.getItem(LAYERS_LS_KEY);
    if (!raw) return { ...DEFAULT_LAYERS };
    const saved = JSON.parse(raw) as Partial<Record<LayerKey, boolean>>;
    const merged = { ...DEFAULT_LAYERS };
    for (const k of Object.keys(merged) as LayerKey[])
      if (typeof saved[k] === "boolean") merged[k] = saved[k] as boolean;
    return merged;
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

function saveLayers(layers: Record<LayerKey, boolean>): void {
  try { localStorage.setItem(LAYERS_LS_KEY, JSON.stringify(layers)); }
  catch { /* ignore quota / disabled storage */ }
}

interface ReplaySlice {
  id: string | null;
  /**
   * MUTATED IN PLACE while the recording downloads.
   *
   * Its identity is stable for a whole load, deliberately: the loader hands the
   * same array to the store every quarter second as it grows, so copying would
   * be O(n²) and a new array each time would re-run every `useMemo` keyed on it
   * (`computeTicketAnalysis` over the whole match, four times a second).
   *
   * The cost is that this field is NOT a change signal. Subscribe to
   * `frameCount` or `bufferedMs` instead; anything reading `frames.length`
   * inside a selector will quietly serve stale data.
   */
  frames: Snapshot[];
  /** Reactive mirror of `frames.length` — the signal `frames` cannot be. */
  frameCount: number;
  /** The NDJSON stream is still open. */
  loading: boolean;
  /**
   * Timestamp of the first frame HELD, epoch ms. After a seek that restarted
   * the download part-way in, this is the start of the window, not of the
   * match — `matchStartMs` is the match.
   */
  startMs: number;
  /** Where the match itself begins, from the match row. 0 until known. */
  matchStartMs: number;
  /** The `from` the current stream was requested with. 0 = from the beginning. */
  windowFromMs: number;
  /** Timestamp of the last frame held — the download frontier, on the time axis. */
  bufferedMs: number;
  /**
   * Whole-recording duration in ms, announced by the server before the frames
   * arrive. 0 when unknown, in which case the timeline falls back to what it
   * holds — and then the axis does move as it loads.
   */
  totalMs: number;
  /** Playing, but parked at the frontier waiting for bytes. */
  stalled: boolean;
  /** The stream died after at least one frame: this is all there will be. */
  truncated: boolean;
  /**
   * Important moments for the timeline (flags, vehicles, ticket collapses),
   * found as the frames arrive. Replaced, never mutated, when one is added —
   * there are a few dozen per match, and a template object holding an array
   * that somebody pushes into is how one replay's markers end up in the next.
   *
   * Kept across a seek that restarts the download: the moments are facts about
   * the MATCH, and the part of it already watched does not stop having them
   * because the window moved.
   */
  markers: ReplayMarker[];
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

/** Everything a replay slice is before a recording is opened. */
const PRISTINE_REPLAY = {
  id: null as string | null,
  frames: [] as Snapshot[],
  frameCount: 0,
  loading: false,
  startMs: 0,
  matchStartMs: 0,
  windowFromMs: 0,
  bufferedMs: 0,
  totalMs: 0,
  stalled: false,
  truncated: false,
  markers: [] as ReplayMarker[],
  currentIdx: 0,
  playing: false,
  speed: 1,
  baseWallMs: 0,
  baseSnapMs: 0,
};

interface Store {
  mode: Mode;
  status: ConnStatus;

  // Live-map access. This is the DISTRIBUTED (operator) build, which has no
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
  // When set, the camera keeps this vehicle (by id) centred each frame.
  // Mutually exclusive with followKey; cleared the same way.
  followVehicleId: string | null;

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

  // Replay-only: the WHOLE match's kill feed, pre-computed once at load by a
  // single forward diff pass over every frame (so each attacker is resolved
  // once, from the full frame that carried its damage event, and stays
  // resolved). Each entry is tagged with the frame index it fired on; the
  // visible `killFeed` is just this list filtered to frameIdx <= the playhead.
  // That makes scrubbing a pure filter — it rewinds correctly and can never
  // re-emit a death with no attacker ("?"), which the live incremental diff did
  // on every seek (its attack buffer was already consumed). Empty in live mode.
  replayKillTimeline: (KillFeedEntry & { frameIdx: number })[];

  // Scoreboard overlay (Tab to toggle, like Squad in-game) — modal that
  // covers the map with team rosters + per-player stats. closedSquads
  // stores the user-collapsed squad ids per team (default expanded).
  scoreboardVisible: boolean;
  scoreboardClosedSquads: { 1: number[]; 2: number[] };
  // Ticket-timeline overlay (replay-only) — the match-long ticket-loss analysis.
  timelineVisible: boolean;

  // Map layer visibility — which entity families the canvas draws.
  layers: Record<LayerKey, boolean>;
  // Whose map the canvas draws: both teams, or one team's own entities only.
  // Deliberately NOT persisted: a filter left on from last time would open the
  // next match with half the players silently missing.
  teamView: TeamView;

  // mutators
  setMode(m: Mode): void;
  setStatus(s: ConnStatus): void;
  setCanLive(v: boolean): void;
  ingestLive(snap: Snapshot): void;
  setView(updater: (v: ViewState) => ViewState): void;
  setReplay(updater: (r: ReplaySlice) => ReplaySlice): void;
  retryReplayLoad(): void;
  /** Point the viewer at a recording, wiping every trace of the last one. */
  openReplay(id: string | null): void;
  /** Adopt the loader's growing array and republish the scalars that mirror it. */
  appendReplayFrames(frames: Snapshot[]): void;
  /** Announce where the match starts and how long it runs. */
  setReplayTiming(timing: { startMs: number; durationMs: number }): void;
  /**
   * Throw away the current window and restart the download at `ms`.
   *
   * There is no Range support and no index, so a point the viewer does not
   * hold cannot be reached by asking for bytes — the stream is asked to begin
   * there instead, and what was already downloaded ahead of it is dropped.
   */
  restartReplayAt(ms: number): void;
  /** Append newly found timeline markers (already de-duplicated by the caller). */
  addReplayMarkers(markers: ReplayMarker[]): void;
  /**
   * One recorded frame forward (+1) or back (-1), and pause. Stepping is how
   * you look at a moment, so playing on past it would defeat the point. Clamped
   * to what is HELD: at the download frontier there is no next frame yet.
   */
  stepReplayFrame(delta: number): void;
  /** The stream closed: no more frames are coming. */
  finishReplayLoad(opts?: { truncated?: boolean }): void;
  setRecordings(r: RecordingMeta[] | null): void;
  setRecordingsLoading(b: boolean): void;
  setRecordingsError(e: string | null): void;
  setSelectedVehicleId(id: string | null): void;
  setSelectedPlayerKey(key: string | null): void;
  setSelectedInfo(info: SelectedInfo | null): void;
  setFollowKey(key: string | null): void;
  setFollowVehicleId(id: string | null): void;
  pushKillFeed(entries: KillFeedEntry[]): void;
  setKillFeed(entries: KillFeedEntry[]): void;
  setReplayKillTimeline(tl: (KillFeedEntry & { frameIdx: number })[]): void;
  clearKillFeed(): void;
  toggleKillFeed(): void;
  toggleScoreboard(): void;
  setScoreboardVisible(v: boolean): void;
  toggleScoreboardSquad(team: 1 | 2, sqId: number): void;
  toggleTimeline(): void;
  setTimelineVisible(v: boolean): void;
  toggleLayer(key: LayerKey): void;
  setTeamView(t: TeamView): void;
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
  replay: { ...PRISTINE_REPLAY, loadNonce: 0 },
  recordings: null,
  recordingsLoading: false,
  recordingsError: null,
  selectedVehicleId: null,
  selectedPlayerKey: null,
  selectedInfo: null,
  followKey: null,
  followVehicleId: null,
  killFeed: [],
  replayKillTimeline: [],
  killFeedVisible: true,
  scoreboardVisible: false,
  timelineVisible: false,
  scoreboardClosedSquads: { 1: [], 2: [] },
  layers: loadLayers(),
  teamView: 0,

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
    set({ mode: m, snapBuffer: [], killFeed: [], replayKillTimeline: [] });
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
      // Append to the render-delay ring. Trim by TIME first (rate-independent:
      // always keeps ~SNAP_BUFFER_SPAN_MS of frames whether the reader runs at
      // 0.5 Hz or 4 Hz), then a hard frame ceiling as a memory backstop. Raw
      // arrival `t` (no reclock — the teleport guard already reads the real
      // per-pair span, so in-tolerance motion is correct).
      const snapBuffer = [...s.snapBuffer, { snap: patched, t: now }];
      while (snapBuffer.length > 2
             && now - snapBuffer[0]!.t > SNAP_BUFFER_SPAN_MS) snapBuffer.shift();
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
      replay: { ...PRISTINE_REPLAY, id: s.replay.id, speed: s.replay.speed,
                loadNonce: s.replay.loadNonce + 1 },
    }));
  },
  openReplay(id) {
    // A full reset, not a spread. Every caller used to hand-roll this and each
    // kept whatever it did not mention, so a second recording inherited the
    // first one's totalMs and bufferedMs for a render or two — the timeline
    // drew the old match's length around the new match's frames.
    set((s) => ({ replay: { ...PRISTINE_REPLAY, id, loadNonce: s.replay.loadNonce } }));
  },
  appendReplayFrames(frames) {
    set((s) => {
      const r = s.replay;
      if (frames === r.frames && frames.length === r.frameCount) return {};
      const last = frames[frames.length - 1];
      return {
        replay: {
          ...r,
          frames,
          frameCount: frames.length,
          startMs: r.startMs || Date.parse(frames[0]?.timestamp ?? "") || 0,
          bufferedMs: Date.parse(last?.timestamp ?? "") || r.bufferedMs,
        },
      };
    });
  },
  setReplayTiming({ startMs, durationMs }) {
    set((s) => {
      const r = s.replay;
      const totalMs = durationMs > r.totalMs ? durationMs : r.totalMs;
      const matchStartMs = r.matchStartMs || startMs;
      return (totalMs === r.totalMs && matchStartMs === r.matchStartMs)
        ? {} : { replay: { ...r, totalMs, matchStartMs } };
    });
  },
  restartReplayAt(ms) {
    replayLoad.error = false;
    set((s) => ({
      replay: {
        ...PRISTINE_REPLAY,
        id: s.replay.id,
        speed: s.replay.speed,
        playing: s.replay.playing,
        // Kept across the restart: they describe the MATCH, not the window,
        // and re-fetching them would make the axis flicker on every seek.
        totalMs: s.replay.totalMs,
        matchStartMs: s.replay.matchStartMs,
        markers: s.replay.markers,
        windowFromMs: ms,
        loading: true,
        loadNonce: s.replay.loadNonce + 1,
      },
    }));
  },
  finishReplayLoad(opts) {
    set((s) => {
      const r = s.replay;
      return {
        replay: {
          ...r,
          loading: false,
          stalled: false,
          truncated: !!opts?.truncated,
          // Only ever widened here, and only if the server told us nothing: a
          // recording whose length we had to infer is the one case where the
          // axis legitimately settles at the end.
          totalMs: r.totalMs || Math.max(1, r.bufferedMs - r.startMs),
        },
      };
    });
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
    // Opening the vehicle panel closes any info panel; closing it stops any
    // follow on that vehicle.
    set((s) => ({ selectedVehicleId: id,
                  followVehicleId: id == null ? null : s.followVehicleId,
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
                  followKey: info == null ? s.followKey : null,
                  followVehicleId: info == null ? s.followVehicleId : null }));
  },
  setFollowKey(key) {
    // Following a player cancels any vehicle-follow (one camera target).
    set((s) => ({ followKey: key, followVehicleId: key ? null : s.followVehicleId }));
  },
  setFollowVehicleId(id) {
    set((s) => ({ followVehicleId: id, followKey: id ? null : s.followKey }));
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
  setKillFeed(entries) {
    // Replace the feed wholesale (replay: the playhead-filtered slice of the
    // pre-computed timeline). Newest-first + capping are the caller's job.
    set({ killFeed: entries });
  },
  stepReplayFrame(delta) {
    set((s) => {
      const r = s.replay;
      if (!r.frameCount) return {};
      const next = Math.max(0, Math.min(r.frameCount - 1, r.currentIdx + delta));
      return { replay: { ...r, currentIdx: next, playing: false,
                         baseWallMs: 0, baseSnapMs: 0 } };
    });
  },
  addReplayMarkers(markers) {
    if (!markers.length) return;
    set((s) => ({ replay: { ...s.replay, markers: [...s.replay.markers, ...markers] } }));
  },
  setReplayKillTimeline(tl) {
    set({ replayKillTimeline: tl });
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
  toggleTimeline() {
    set((s) => ({ timelineVisible: !s.timelineVisible }));
  },
  setTimelineVisible(v) {
    set({ timelineVisible: v });
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
  setTeamView(t) {
    set({ teamView: t });
  },
  toggleLayer(key) {
    set((s) => {
      const layers = { ...s.layers, [key]: !s.layers[key] };
      saveLayers(layers);
      return { layers };
    });
  },
  resetView() {
    set((s) => ({
      view: { ...s.view, zoom: 1, panX: 0, panY: 0, userInteracted: false },
    }));
  },
}));
