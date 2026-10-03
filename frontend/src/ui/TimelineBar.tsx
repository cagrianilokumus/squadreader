// Bottom-fixed replay timeline. Shown only in replay mode once frames exist.
// Drives `replay.currentIdx` / `replay.playing` / `replay.speed` on the viewer
// store; the rAF playback engine (`useReplayPlayback`) reads those and moves
// the playhead. Seeks walk the frames[] timestamp list rather than the index
// alone — a recording with holes in it would not be fairly represented by a
// fixed step count.
//
// Laid out the way demo viewers do it:
//
//   12:14 ━━━━━━━━━━━●┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄  36:39   time · track · length
//   FLAGS │  ⚑      ⚑  ⚑            ⚑                    one labelled lane
//  LOSSES │   ▲ ▼ ▲▲3  ▲  ▼    ▲   ▲  ▲▼                 per kind of moment
//          ‹ ›        ↺30 ↺10  ▶  ↻10 ↻30        1× ▾    frame · skip · speed
//
// The lanes share the track's axis exactly, and a hairline playhead runs
// through them, so "what happens next" is read straight off the bar.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import type { Snapshot, Vehicle } from "../state/types";
import { clusterMarkers, type MarkerCluster, type ReplayMarker } from "../state/replayMarkers";
import { teamColor } from "../canvas/draw";
import { vehicleIconUrl, vehicleTurretIconUrl } from "../canvas/icons";

function fmtMMSS(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${ss.toString().padStart(2, "0")}`;
}

function snapMs(s: Snapshot | undefined | null): number {
  if (!s || !s.timestamp) return 0;
  const t = Date.parse(s.timestamp);
  return Number.isFinite(t) ? t : 0;
}

// Half speed is for watching one fight properly; the rest are for getting
// through a 40-minute round.
const SPEEDS = [0.5, 1, 2, 4, 8] as const;

// How far BEFORE a moment a click on its marker lands. A flag falls at the end
// of a capture that took a while, so it gets the most run-up; a ticket marker
// is already placed where the losing began.
const LEAD_MS: Record<ReplayMarker["kind"], number> = {
  cap: 15_000, vehicle: 5_000, tickets: 3_000,
};

// Moments closer than a lane's gap share one spot: wide enough for its widest
// icon plus a count, so no icon sits under another and swallows its clicks. A
// vehicle lies on its side and is the widest thing drawn.
const LANES = [
  { id: "flags", label: "Flags", gapPx: 24,
    kinds: ["cap"] as ReplayMarker["kind"][] },
  { id: "losses", label: "Losses", gapPx: 40,
    kinds: ["vehicle", "tickets"] as ReplayMarker["kind"][] },
];

const shortFaction = (f: string | null | undefined) => (f ?? "").split("_")[0] || null;

function markerText(m: ReplayMarker, side: string): string {
  switch (m.kind) {
    case "cap":
      return m.capture === "taken"
        ? `${m.subject} captured by ${side}` : `${side} lost ${m.subject}`;
    case "vehicle":
      return `${side} ${m.subject} destroyed`;
    case "tickets":
      return `${side} lost ${m.amount ?? 0} tickets in a minute`;
  }
}

// --- the moments' icons -------------------------------------------------------
// The same art the map draws with, served next to the page: Squad's own
// objective flag and casualty skull, and for a vehicle ITS silhouette — a
// tank reads as a tank, a truck as a truck — with the explosion over it.
// White PNGs, painted in a team colour through a CSS mask.

const OBJECTIVE = "./icons/scoreboard/objective.png";
const DEATHS = "./icons/scoreboard/deaths.png";
const EXPLODED = "./icons/misc/exploded.png";
const VEHICLE_FALLBACK = "./icons/scoreboard/vehicle.png";

// Absolute, because a relative url() in an inline style is resolved against
// the document by some browsers and against the stylesheet by others — and the
// stylesheet lives one directory down, in assets/.
const abs = (u: string) => new URL(u, document.baseURI).href;

function momentIcon(m: ReplayMarker): { layers: string[]; color: string } {
  switch (m.kind) {
    case "cap":
      // The flag in the colour of whoever holds it NOW: the side that took it,
      // or neutral grey when it fell to nobody.
      return { layers: [OBJECTIVE], color: teamColor(m.capture === "taken" ? m.team : null) };
    case "vehicle": {
      const v = { classShort: m.vehicle?.classShort ?? null,
                  kind: m.vehicle?.kind ?? undefined } as Vehicle;
      const base = vehicleIconUrl(v) ?? VEHICLE_FALLBACK;
      // Turreted armour is drawn in two pieces on the map; put the turret
      // back on, or a tank is an empty hull.
      const turret = vehicleTurretIconUrl(v);
      return { layers: turret ? [base, turret] : [base], color: teamColor(m.team) };
    }
    case "tickets":
      return { layers: [DEATHS], color: teamColor(m.team) };
  }
}

/**
 * Lane size: flags all alike, vehicles by what they cost, collapses by depth.
 * A vehicle's box is its LENGTH — it is drawn lying on its side, facing the
 * way time runs, because the map's icons are top-down and upright: at lane
 * height every one of them, tank or truck, shrank to the same rounded pill,
 * while on its side a tank keeps its barrel and a truck its cab.
 */
function laneIconSize(m: ReplayMarker, weight: number): number {
  if (m.kind === "cap") return 16;
  if (m.kind === "vehicle") return Math.round(20 + 6 * weight);
  return Math.round(14 + 3 * weight);
}

function MomentIcon({ m, size }: { m: ReplayMarker; size: number }) {
  const { layers, color } = momentIcon(m);
  if (m.kind === "vehicle") {
    // Drawn the way the map draws a vehicle: the icon as it is, white with its
    // own detail, on a chip in the team's colour. Painting the silhouette
    // through a mask kept only its outline — hatch, cab and turret are grey
    // lines INSIDE the white, and a mask reads nothing but alpha — so every
    // vehicle came out the same rounded blob.
    return (
      <span className="tb-veh" style={{ "--c": color } as React.CSSProperties}>
        <span className="tb-veh-chip"
              style={{ width: size + 6, height: Math.round(size * 0.62) + 4 }}>
          <span className="tb-veh-in" style={{ width: size, height: size }}>
            {layers.map((u) => <img key={u} src={abs(u)} alt="" draggable={false} />)}
          </span>
        </span>
        <span className="tb-boom" style={{ backgroundImage: `url("${abs(EXPLODED)}")` }} />
      </span>
    );
  }
  const mask = layers.map((u) => `url("${abs(u)}")`).join(", ");
  return (
    <span className={`tb-ico k-${m.kind}`} style={{ width: size, height: size }}>
      <span className="tb-ico-shape"
            style={{ WebkitMaskImage: mask, maskImage: mask, background: color }} />
    </span>
  );
}

// --- control icons ------------------------------------------------------------
// Inline SVG, drawn on a 24-unit grid in `currentColor`, so every control
// follows the theme and none depends on a font having the right glyph.

const Svg = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
       fill="currentColor">{children}</svg>
);
const PlayIcon = () => <Svg><path d="M8.5 5.6v12.8L19 12z" /></Svg>;
const PauseIcon = () => (
  <Svg><rect x="6.5" y="5.5" width="4" height="13" rx="1" />
       <rect x="13.5" y="5.5" width="4" height="13" rx="1" /></Svg>
);
/** Circular arrow with the seconds in it; `dir` -1 winds back, +1 forward. */
const SkipIcon = ({ dir, n }: { dir: -1 | 1; n: number }) => (
  <Svg size={26}>
    <g transform={dir > 0 ? "translate(24 0) scale(-1 1)" : undefined}>
      <path d="M5.5 8.25A7.5 7.5 0 1 0 12 4.5" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.4 4.5 12.6 1.7v5.6z" />
    </g>
    <text x="12" y="15.3" textAnchor="middle" fontSize="7.6" fontWeight="800"
          letterSpacing="-0.3">{n}</text>
  </Svg>
);
const StepIcon = ({ dir }: { dir: -1 | 1 }) => (
  <Svg>
    <g transform={dir > 0 ? "translate(24 0) scale(-1 1)" : undefined}>
      <rect x="6" y="6.5" width="2.2" height="11" rx="0.8" />
      <path d="M18 6.5v11L9.8 12z" />
    </g>
  </Svg>
);
const Caret = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
    <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function TimelineBar() {
  const mode    = useViewerStore((s) => s.mode);
  const frames  = useViewerStore((s) => s.replay.frames);
  // `frames` is mutated in place while downloading, so it cannot be the signal
  // that it grew. These scalars are.
  const frameCount  = useViewerStore((s) => s.replay.frameCount);
  const loading     = useViewerStore((s) => s.replay.loading);
  const bufferedMs  = useViewerStore((s) => s.replay.bufferedMs);
  const totalMs     = useViewerStore((s) => s.replay.totalMs);
  const startMsStore = useViewerStore((s) => s.replay.startMs);
  const matchStartMs = useViewerStore((s) => s.replay.matchStartMs);
  const restartReplayAt = useViewerStore((s) => s.restartReplayAt);
  const idx     = useViewerStore((s) => s.replay.currentIdx);
  const playing = useViewerStore((s) => s.replay.playing);
  const stalled = useViewerStore((s) => s.replay.stalled);
  const speed   = useViewerStore((s) => s.replay.speed);
  const setReplay = useViewerStore((s) => s.setReplay);
  const stepReplayFrame = useViewerStore((s) => s.stepReplayFrame);
  const markers = useViewerStore((s) => s.replay.markers);

  // The lanes' inner width in px — overlap is a question of pixels — and
  // where they start inside the bar, to put cards over the right spot. A
  // callback ref, not useEffect: the lanes only exist once frames do.
  const [lanePx, setLanePx] = useState(0);
  const [laneLeft, setLaneLeft] = useState(0);
  const resizeObs = useRef<ResizeObserver | null>(null);
  const laneRef = useCallback((el: HTMLDivElement | null) => {
    resizeObs.current?.disconnect();
    resizeObs.current = null;
    if (!el) return;
    const measure = () => {
      setLanePx(el.clientWidth);
      // Relative to #timeline-bar, the cards' containing block.
      let x = 0;
      for (let n: HTMLElement | null = el; n && n.id !== "timeline-bar";
           n = n.offsetParent as HTMLElement | null) x += n.offsetLeft;
      setLaneLeft(x);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    resizeObs.current = ro;
    measure();
  }, []);

  // One open thing at a time: the list of a crowded spot, or the speed menu.
  // A spot holding several moments opens a list instead of seeking — one
  // glyph covers most of a minute on a long round, and seeking to the first
  // moment in it would make the rest unreachable.
  const [menu, setMenu] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.(".tb-card, .tb-spot, .tb-speed")) setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [menu]);

  if (mode !== "replay" || frameCount === 0) return null;

  const lastIdx = frameCount - 1;
  // Two different starts, and the difference matters. `windowStart` is the first
  // frame we HOLD; `startMs` is where the MATCH begins. They diverge once a seek
  // has restarted the download part-way in — and drawing the axis from the
  // window would rescale the whole bar around whichever piece is in memory.
  const windowStart = startMsStore || snapMs(frames[0]);
  const startMs = matchStartMs || windowStart;
  const curMs   = snapMs(frames[idx]);
  // The denominator comes from the SERVER, not from the frames in hand. Derived
  // from the frames it would grow for the whole download — the total time and
  // the thumb would both crawl rightwards under the user's cursor. It falls back
  // to what we hold only when the server told us nothing.
  const durationMs = totalMs > 0
    ? totalMs : Math.max(1, (bufferedMs || snapMs(frames[lastIdx])) - startMs);
  const elapsedMs  = Math.max(0, curMs - startMs);

  // Seek to a specific frame index. Rebases playback anchors so play
  // resumes from the new position cleanly.
  const seekToIdx = (newIdx: number) => {
    const clamped = Math.max(0, Math.min(lastIdx, newIdx));
    setReplay((r) => ({ ...r, currentIdx: clamped,
                        baseWallMs: 0, baseSnapMs: 0 }));
  };

  /**
   * Seek to a point on the MATCH clock.
   *
   * Inside what is held, that is a binary search. Outside it there is nothing to
   * search: the server has no Range support and the stream has no index, so the
   * only way to reach an unheld point is to ask the stream to start there. That
   * is the behaviour asked for — click ahead and it begins there, with the rest
   * arriving behind it.
   *
   * The 1 s slack on the lower bound is for the ±30 s button landing a hair
   * before the first held frame; restarting the download for that would be a
   * silly way to spend a request.
   *
   * `prefer` decides which side of a HOLE to land on. Recordings have holes:
   * one community's agent writes in bursts with 25-30 s between them. The
   * first frame after a point inside a hole is its far side — so −10 s from
   * just past a hole did not move at all, and a marker click meant to land
   * five seconds before a moment landed on it. Going back, and arriving before
   * something, both want the last frame at or before the target instead.
   */
  const seekToMs = (target: number, prefer: "after" | "before" = "after") => {
    const held = target >= windowStart - 1000 && target <= bufferedMs;
    if (!held) { restartReplayAt(Math.max(startMs, target)); return; }
    let lo = 0, hi = lastIdx;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (snapMs(frames[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    // `lo` is the first frame at or after the target.
    if (prefer === "before" && lo > 0 && snapMs(frames[lo]) > target) lo -= 1;
    seekToIdx(lo);
  };

  // ±N-second jump along the timestamp axis (not the index axis).
  const seekDeltaMs = (deltaMs: number) => {
    seekToMs(curMs + deltaMs, deltaMs < 0 ? "before" : "after");
  };
  // A marker click lands BEFORE its moment, whatever holes are in the way.
  const seekBefore = (m: ReplayMarker) => seekToMs(m.tMs - LEAD_MS[m.kind], "before");

  const onScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    seekToMs(startMs + (parseFloat(e.target.value) / 100) * durationMs);
  };

  const togglePlay = () => {
    setReplay((r) => ({
      ...r,
      playing: !r.playing,
      // Rebase anchors so resume starts from the current playhead.
      baseWallMs: 0,
      baseSnapMs: 0,
      // If at the END OF THE MATCH, pressing play rewinds to the start. Not
      // merely at the end of what has downloaded: that would throw away the
      // half-hour you just watched every time playback caught the frontier.
      currentIdx: (r.currentIdx >= lastIdx && !r.loading) ? 0 : r.currentIdx,
    }));
  };

  const setSpeed = (sp: number) => {
    setReplay((r) => ({ ...r, speed: sp, baseWallMs: 0, baseSnapMs: 0 }));
    setMenu(null);
  };

  const pct = Math.max(0, Math.min(100, (elapsedMs / durationMs) * 100));
  const sideName = (team: 1 | 2 | null) =>
    shortFaction(frames[0]?.teams?.find((t) => t.id === team)?.factionId)
      ?? (team ? `Team ${team}` : "Neutral");
  const asPct = (ms: number) =>
    Math.max(0, Math.min(100, ((ms - startMs) / durationMs) * 100));

  const toPx = (t: number) => (asPct(t) / 100) * lanePx;
  const lanes = LANES.map((l) => ({
    ...l,
    spots: lanePx > 0
      ? clusterMarkers(markers.filter((m) => l.kinds.includes(m.kind)), toPx, l.gapPx)
      : [] as MarkerCluster[],
  }));
  // Looked up every render: a marker arriving mid-download can change a spot's
  // members and so its key, and then the card simply closes.
  const allSpots = lanes.flatMap((l) => l.spots);
  const openSpot = menu && menu !== "speed" ? allSpots.find((c) => c.key === menu) ?? null : null;
  const hoverSpot = !openSpot && hover ? allSpots.find((c) => c.key === hover) ?? null : null;
  const card = openSpot ?? hoverSpot;

  // How much of the match is in hand, on the same axis. The band runs from where
  // the window begins — not from zero, because after a seek the earlier part of
  // the match genuinely is not held any more. A recording that finished loading
  // from the start holds everything, and there the band collapses to the
  // playhead rather than recolouring the whole track.
  const whollyHeld = !loading && asPct(windowStart) <= 0.01;
  const bufFrom = whollyHeld ? pct : asPct(windowStart);
  const bufTo = whollyHeld ? pct : Math.max(pct, asPct(bufferedMs));

  const playTitle = stalled ? "Buffering — waiting for the download"
                  : playing ? "Pause (Space)" : "Play (Space)";

  return (
    <div id="timeline-bar">
      <div className="tb-grid">
        <span className="tb-time" aria-label="elapsed">{fmtMMSS(elapsedMs)}</span>
        <div className="tb-track">
          <input className="tb-scrub" type="range"
                 min={0} max={100} step={0.05}
                 value={pct} onChange={onScrub}
                 aria-label="Timeline"
                 style={{ "--pct": `${pct}%`,
                          "--buf0": `${bufFrom}%`,
                          "--buf": `${bufTo}%` } as React.CSSProperties} />
        </div>
        <span className="tb-time tb-time-end" aria-label="length">{fmtMMSS(durationMs)}</span>

        {lanes.map((lane, i) => (
          <Fragment key={lane.id}>
            <span className="tb-lane-label">{lane.label}</span>
            <div className="tb-lane">
              <div className="tb-lane-in" ref={i === 0 ? laneRef : undefined}>
                <span className="tb-playhead" style={{ left: `${pct}%` }} />
                {lane.spots.map((c) => {
                  const m = c.lead;
                  const n = c.members.length;
                  const label = c.members
                    .map((x) => `${fmtMMSS(x.tMs - startMs)} ${markerText(x, sideName(x.team))}`)
                    .join("; ");
                  return (
                    <button key={c.key}
                            className={`tb-spot k-${m.kind}`
                                       + (m.capture === "lost" ? " lost" : "")
                                       + (menu === c.key ? " open" : "")}
                            style={{ left: `${c.px}px`,
                                     "--c": momentIcon(m).color,
                                   } as React.CSSProperties}
                            aria-label={label}
                            aria-haspopup={n > 1 ? "menu" : undefined}
                            aria-expanded={n > 1 ? menu === c.key : undefined}
                            onMouseEnter={() => setHover(c.key)}
                            onMouseLeave={() => setHover((h) => (h === c.key ? null : h))}
                            onFocus={() => setHover(c.key)}
                            onBlur={() => setHover((h) => (h === c.key ? null : h))}
                            onClick={() => n > 1
                              ? setMenu((k) => (k === c.key ? null : c.key))
                              : seekBefore(m)}>
                      <MomentIcon m={m}
                                  size={laneIconSize(m, Math.max(...c.members.map((x) => x.weight)))} />
                      {n > 1 && <b>{n}</b>}
                    </button>
                  );
                })}
              </div>
            </div>
            <span />
          </Fragment>
        ))}
      </div>

      <div className="tb-controls">
        <div className="tb-group tb-left">
          <button className="tb-icon" onClick={() => stepReplayFrame(-1)}
                  title="Previous frame ( , )" aria-label="Previous frame">
            <StepIcon dir={-1} /></button>
          <button className="tb-icon" onClick={() => stepReplayFrame(1)}
                  title="Next frame ( . )" aria-label="Next frame">
            <StepIcon dir={1} /></button>
        </div>
        <div className="tb-group tb-center">
          <button className="tb-icon" onClick={() => seekDeltaMs(-30_000)}
                  title="Back 30 s" aria-label="Back 30 seconds"><SkipIcon dir={-1} n={30} /></button>
          <button className="tb-icon" onClick={() => seekDeltaMs(-10_000)}
                  title="Back 10 s" aria-label="Back 10 seconds"><SkipIcon dir={-1} n={10} /></button>
          <button className={`tb-play${stalled ? " tb-buffering" : ""}`}
                  onClick={togglePlay} title={playTitle} aria-label={playTitle}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button className="tb-icon" onClick={() => seekDeltaMs(10_000)}
                  title="Forward 10 s" aria-label="Forward 10 seconds"><SkipIcon dir={1} n={10} /></button>
          <button className="tb-icon" onClick={() => seekDeltaMs(30_000)}
                  title="Forward 30 s" aria-label="Forward 30 seconds"><SkipIcon dir={1} n={30} /></button>
        </div>
        <div className="tb-group tb-right">
          <button className={`tb-speed${menu === "speed" ? " open" : ""}`}
                  aria-haspopup="menu" aria-expanded={menu === "speed"}
                  title="Playback speed"
                  onClick={() => setMenu((k) => (k === "speed" ? null : "speed"))}>
            {speed}× <Caret />
          </button>
          {menu === "speed" && (
            <div className="tb-card tb-speed-menu" role="menu">
              {[...SPEEDS].reverse().map((sp) => (
                <button key={sp} role="menuitemradio" aria-checked={speed === sp}
                        className={speed === sp ? "on" : ""}
                        onClick={() => setSpeed(sp)}>
                  {sp}×
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* One card for both: what is under the pointer, or — once a crowded
          spot is clicked — a list to pick from. Centred on its spot, never
          hanging off either end of the bar. */}
      {card && (
        <div className={`tb-card tb-moments${openSpot ? " pick" : ""}`}
             role={openSpot ? "menu" : "tooltip"}
             style={{ left: `clamp(150px, ${laneLeft + card.px}px, calc(100% - 150px))` }}>
          {card.members.map((x) => {
            const row = (
              <>
                <MomentIcon m={x} size={18} />
                <span className="tb-card-time">{fmtMMSS(x.tMs - startMs)}</span>
                <span className="tb-card-text">{markerText(x, sideName(x.team))}</span>
              </>
            );
            return openSpot
              ? <button key={x.key} role="menuitem"
                        onClick={() => { seekBefore(x); setMenu(null); setHover(null); }}>
                  {row}</button>
              : <div key={x.key} className="tb-card-row">{row}</div>;
          })}
          {!openSpot && card.members.length > 1 && (
            <div className="tb-card-hint">Click to choose one</div>
          )}
        </div>
      )}
    </div>
  );
}
