// Bottom-fixed replay timeline. Shown only in replay mode once frames exist.
// Drives `replay.currentIdx` / `replay.playing` / `replay.speed` on the viewer
// store; the rAF playback engine (`useReplayPlayback`) reads those and moves
// the playhead. Seeks walk the frames[] timestamp list rather than the index
// alone — a recording with holes in it would not be fairly represented by a
// fixed step count.
//
// The match's important moments (flags, FOB radios, vehicles, ticket
// collapses) can be drawn two ways, and the viewer picks one:
//
//   race   — both teams' ticket lines, flags pinned above, losses ON the line
//            of the side that suffered them, collapses as the line thickening
//   lanes  — a flags lane and a losses lane, each with its own small icon
//
// Both share one time axis with the track, so a moment sits exactly where the
// thumb would be at that time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import type { Snapshot, Vehicle } from "../state/types";
import { clusterMarkers, type MarkerCluster, type ReplayMarker } from "../state/replayMarkers";
import { sampleTickets, ticketsAt, type TicketPoint } from "../state/ticketSeries";
import { teamColor } from "../canvas/draw";
import { vehicleIconUrl, vehicleTurretIconUrl } from "../canvas/icons";
import { flyTo } from "../canvas/flyTo";

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
// of a capture that took a while, and a radio is dug down over most of a
// minute, so they get the most run-up; a ticket marker is already placed
// where the losing began.
const LEAD_MS: Record<ReplayMarker["kind"], number> = {
  cap: 15_000, radio: 20_000, vehicle: 5_000, tickets: 3_000,
};

// --- views --------------------------------------------------------------------

type ViewId = "race" | "lanes";
const VIEWS: { id: ViewId; label: string }[] = [
  { id: "race", label: "Ticket race" },
  { id: "lanes", label: "Lanes" },
];
const VIEW_KEY = "sqr.timelineView";
function readView(): ViewId {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    // A stored "ticks" — a view that no longer exists — falls through.
    if (v === "race" || v === "lanes") return v;
  } catch { /* private window, blocked storage: fall through */ }
  return "race";
}
function saveView(v: ViewId) {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* not worth failing over */ }
}

const shortFaction = (f: string | null | undefined) => (f ?? "").split("_")[0] || null;

function markerText(m: ReplayMarker, side: string): string {
  switch (m.kind) {
    case "cap":
      return m.capture === "taken"
        ? `${m.subject} captured by ${side}` : `${side} lost ${m.subject}`;
    case "radio":
      return `${side} lost a FOB radio`;
    case "vehicle":
      return `${side} ${m.subject} destroyed`;
    case "tickets":
      return `${side} lost ${m.amount ?? 0} tickets in a minute`;
  }
}

// --- the moments' icons ---------------------------------------------------------
// The art the map already draws with, served next to the page: Squad's own
// objective flag and casualty skull, and each vehicle's own icon. A FOB radio
// gets a glyph of its own (RadioBadge): the map's FOB icon is a castle inside
// an opaque grey frame, and painted through a mask the two melt into one
// shapeless wedge — and a castle says "FOB", not "radio".

const OBJECTIVE = "./icons/scoreboard/objective.png";
const DEATHS = "./icons/scoreboard/deaths.png";
const VEHICLE_FALLBACK = "./icons/scoreboard/vehicle.png";

// Absolute, because a relative url() in an inline style is resolved against
// the document by some browsers and against the stylesheet by others — and the
// stylesheet lives one directory down, in assets/.
const abs = (u: string) => new URL(u, document.baseURI).href;

/** A flag in the colour of whoever holds it NOW: the taker, or neutral grey. */
const capColor = (m: ReplayMarker) => teamColor(m.capture === "taken" ? m.team : null);

/** A white PNG painted one colour through a mask. */
function MaskIcon({ src, size, color }: { src: string; size: number; color: string }) {
  const mask = `url("${abs(src)}")`;
  return (
    <span className="tb-ico" style={{ width: size, height: size }}>
      <span className="tb-ico-shape" style={{ WebkitMaskImage: mask, maskImage: mask, background: color }} />
    </span>
  );
}

function vehicleLayers(m: ReplayMarker): string[] {
  const v = { classShort: m.vehicle?.classShort ?? null, kind: m.vehicle?.kind ?? undefined } as Vehicle;
  const base = vehicleIconUrl(v) ?? VEHICLE_FALLBACK;
  // Turreted armour is drawn in two pieces on the map; put the turret back
  // on, or a tank is an empty hull.
  const turret = vehicleTurretIconUrl(v);
  return turret ? [base, turret] : [base];
}

/**
 * A vehicle's own icon, white with its detail, lying on its side facing the
 * way time runs. The map's icons are top-down and upright; at timeline size
 * every one of them, tank or truck, shrank to the same pill standing up.
 */
function VehicleIcon({ m, len }: { m: ReplayMarker; len: number }) {
  return (
    <span className="tb-veh" style={{ width: len, height: Math.round(len * 0.62) }}>
      <span className="tb-veh-in" style={{ width: len, height: len }}>
        {vehicleLayers(m).map((u) => <img key={u} src={abs(u)} alt="" draggable={false} />)}
      </span>
    </span>
  );
}

/**
 * A FOB radio: a mast with its signal, white on a disc of its side's colour —
 * the same badge language as a vehicle's chip, crisp at any size.
 */
function RadioBadge({ team, size }: { team: 1 | 2 | null; size: number }) {
  return (
    <span className="tb-radio" style={{ width: size, height: size, background: teamColor(team) }}>
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.78)} height={Math.round(size * 0.78)}
           aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2"
           strokeLinecap="round" strokeLinejoin="round">
        {/* A mast on a short tripod. An A-frame with a crossbar read as the
            letter A at timeline size. */}
        <path d="M12 10.2v11.3M8.8 21.5 12 17.6l3.2 3.9" />
        <circle cx="12" cy="8" r="1.6" fill="currentColor" stroke="none" />
        <path d="M8.6 4.6a4.8 4.8 0 0 0 0 6.8M15.4 4.6a4.8 4.8 0 0 1 0 6.8" />
        <path d="M5.8 2a8.6 8.6 0 0 0 0 12M18.2 2a8.6 8.6 0 0 1 0 12" opacity=".55" />
      </svg>
    </span>
  );
}

/** The icon a moment gets in a card or a lane. */
function MomentIcon({ m, size }: { m: ReplayMarker; size: number }) {
  switch (m.kind) {
    case "cap": return <MaskIcon src={OBJECTIVE} size={size} color={capColor(m)} />;
    case "radio": return <RadioBadge team={m.team} size={size + 2} />;
    case "tickets": return <MaskIcon src={DEATHS} size={size - 1} color={teamColor(m.team)} />;
    case "vehicle":
      return (
        <span className="tb-veh-mark" style={{ "--c": teamColor(m.team) } as React.CSSProperties}>
          <VehicleIcon m={m} len={size + 6} />
        </span>
      );
  }
}

// --- control icons --------------------------------------------------------------
// Inline SVG on a 24-unit grid in `currentColor`, so every control follows the
// theme and none depends on a font having the right glyph.

const Svg = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"
       fill="currentColor">{children}</svg>
);
const PlayIcon = () => <Svg size={18}><path d="M8.5 5.6v12.8L19 12z" /></Svg>;
const PauseIcon = () => (
  <Svg size={18}><rect x="6.5" y="5.5" width="4" height="13" rx="1" />
       <rect x="13.5" y="5.5" width="4" height="13" rx="1" /></Svg>
);
/** Circular arrow with the seconds in it; `dir` -1 winds back, +1 forward. */
const SkipIcon = ({ dir, n }: { dir: -1 | 1; n: number }) => (
  <Svg size={24}>
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
const ViewIcon = ({ id }: { id: ViewId }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {id === "race" && <path d="M3 7l5 3 4-2 4 6 5 2" />}
    {id === "lanes" && <><path d="M3 8h18M3 16h18" opacity=".45" />
                         <circle cx="8" cy="8" r="1.8" fill="currentColor" />
                         <circle cx="15" cy="16" r="1.8" fill="currentColor" /></>}
  </svg>
);

// --- the bar ----------------------------------------------------------------------

/** A spot the card can describe: a cluster, or one moment drawn on its own. */
type Spot = MarkerCluster;
const single = (m: ReplayMarker, px: number): Spot => ({ lead: m, members: [m], px, key: m.key });

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

  const [view, setView] = useState<ViewId>(readView);
  const pickView = (v: ViewId) => { setView(v); saveView(v); };

  // The time axis's width in px — overlap is a question of pixels — and where
  // it starts inside the bar, to put cards over the right spot. A callback
  // ref: the axis only exists once frames do, and it is a different element
  // in each view.
  const [axisPx, setAxisPx] = useState(0);
  const [axisLeft, setAxisLeft] = useState(0);
  const resizeObs = useRef<ResizeObserver | null>(null);
  const axisRef = useCallback((el: HTMLDivElement | null) => {
    resizeObs.current?.disconnect();
    resizeObs.current = null;
    if (!el) return;
    const measure = () => {
      setAxisPx(el.clientWidth);
      let x = 0;
      for (let n: HTMLElement | null = el; n && n.id !== "timeline-bar";
           n = n.offsetParent as HTMLElement | null) x += n.offsetLeft;
      setAxisLeft(x);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    resizeObs.current = ro;
    measure();
  }, []);

  // One open thing at a time: the list of a crowded spot, or the speed menu.
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

  // Both teams' tickets, for the race view. Re-sampled as the download grows;
  // a few hundred points, so it is cheap at four flushes a second.
  const series: TicketPoint[] = useMemo(
    () => (view === "race" ? sampleTickets(frames, frameCount) : []),
    [view, frames, frameCount]);

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
  // A marker click lands BEFORE its moment, whatever holes are in the way —
  // and takes the map to WHERE it happened, framed with its surroundings.
  const seekBefore = (m: ReplayMarker) => {
    seekToMs(m.tMs - LEAD_MS[m.kind], "before");
    if (m.at) flyTo(m.at.x, m.at.y, m.at.r);
  };

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
  const toPx = (t: number) => (asPct(t) / 100) * axisPx;
  const playX = toPx(curMs);

  // How much of the match is in hand, on the same axis. The band runs from where
  // the window begins — not from zero, because after a seek the earlier part of
  // the match genuinely is not held any more. A recording that finished loading
  // from the start holds everything, and there the band collapses to the
  // playhead rather than recolouring the whole track.
  const whollyHeld = !loading && asPct(windowStart) <= 0.01;
  const bufFrom = whollyHeld ? pct : asPct(windowStart);
  const bufTo = whollyHeld ? pct : Math.max(pct, asPct(bufferedMs));

  const caps = markers.filter((m) => m.kind === "cap");
  const losses = markers.filter((m) => m.kind !== "cap");
  const ready = axisPx > 0;

  // Every spot the active view draws, so the card can find what it describes.
  const spots = new Map<string, Spot>();
  const reg = (s: Spot) => { spots.set(s.key, s); return s; };
  const future = (s: Spot) => s.members[0]!.tMs > curMs;

  /** The shared behaviour of a drawn moment: hover for the card, click to go. */
  const spotProps = (s: Spot) => {
    const n = s.members.length;
    const label = s.members
      .map((x) => `${fmtMMSS(x.tMs - startMs)} ${markerText(x, sideName(x.team))}`)
      .join("; ");
    return {
      "aria-label": label,
      "aria-haspopup": n > 1 ? ("menu" as const) : undefined,
      "aria-expanded": n > 1 ? menu === s.key : undefined,
      onMouseEnter: () => setHover(s.key),
      onMouseLeave: () => setHover((h) => (h === s.key ? null : h)),
      onFocus: () => setHover(s.key),
      onBlur: () => setHover((h) => (h === s.key ? null : h)),
      onClick: () => (n > 1
        ? setMenu((k) => (k === s.key ? null : s.key))
        : seekBefore(s.lead)),
    };
  };

  const track = (
    <div className="tb-track">
      <input className="tb-scrub" type="range"
             min={0} max={100} step={0.05}
             value={pct} onChange={onScrub}
             aria-label="Timeline"
             style={{ "--pct": `${pct}%`,
                      "--buf0": `${bufFrom}%`,
                      "--buf": `${bufTo}%` } as React.CSSProperties} />
    </div>
  );
  const times = (
    <div className="tb-times">
      <b>{fmtMMSS(elapsedMs)}</b><span>{fmtMMSS(durationMs)}</span>
    </div>
  );

  // ---------------------------------------------------------------- race view
  let body: React.ReactNode;
  if (view === "race") {
    const H = 92, PT = 22, PB = 6;
    const vals = series.flatMap((p) => [p.t1, p.t2]).filter((v): v is number => v != null);
    // The axis spans the tickets this match actually had, not 0..max: from
    // zero both lines hug the top edge and every swing is a few pixels tall.
    const lo = vals.length ? Math.min(...vals) - 8 : 0;
    const hi = vals.length ? Math.max(...vals) + 6 : 1;
    const yv = (v: number) => PT + (1 - (v - lo) / (hi - lo || 1)) * (H - PT - PB);
    const path = (team: 1 | 2, pts: TicketPoint[]) => {
      let d = "";
      for (const p of pts) {
        const v = team === 1 ? p.t1 : p.t2;
        if (v == null) continue;
        d += `${d ? "L" : "M"}${toPx(p.tMs).toFixed(1)},${yv(v).toFixed(1)}`;
      }
      return d;
    };
    const lineAt = (team: 1 | 2, tMs: number) => {
      const v = ticketsAt(series, team, tMs);
      return v == null ? H - PB : yv(v);
    };
    const flagSpots = ready ? clusterMarkers(caps, toPx, 18).map(reg) : [];
    const dotSpots = ready
      ? ([1, 2] as const).flatMap((team) =>
          clusterMarkers(losses.filter((m) => m.team === team && m.kind !== "tickets"), toPx, 9))
          .map(reg)
      : [];
    const collapses = ready ? losses.filter((m) => m.kind === "tickets") : [];
    body = (
      <>
        <div className="tb-race" ref={axisRef}>
          {ready && (
            <svg className="tb-race-svg" width={axisPx} height={H} viewBox={`0 0 ${axisPx} ${H}`}>
              <defs>
                <clipPath id="tb-past"><rect x="0" y="0" width={Math.max(0, playX)} height={H} /></clipPath>
                <clipPath id="tb-future"><rect x={playX} y="0" width={Math.max(0, axisPx - playX)} height={H} /></clipPath>
              </defs>
              {[0, 0.5, 1].map((f) => {
                const yy = PT + f * (H - PT - PB);
                return <line key={f} x1="0" x2={axisPx} y1={yy} y2={yy} className="tb-race-grid" />;
              })}
              {([1, 2] as const).map((team) => {
                const d = path(team, series);
                if (!d) return null;
                const first = series.find((p) => (team === 1 ? p.t1 : p.t2) != null)!;
                const last = [...series].reverse().find((p) => (team === 1 ? p.t1 : p.t2) != null)!;
                const area = `${d}L${toPx(last.tMs).toFixed(1)},${H - PB}L${toPx(first.tMs).toFixed(1)},${H - PB}Z`;
                return (
                  <g key={team} style={{ color: teamColor(team) }}>
                    <path d={area} className="tb-race-area" clipPath="url(#tb-past)" />
                    <path d={area} className="tb-race-area future" clipPath="url(#tb-future)" />
                    <path d={d} className="tb-race-line" clipPath="url(#tb-past)" />
                    <path d={d} className="tb-race-line future" clipPath="url(#tb-future)" />
                  </g>
                );
              })}
              {/* A collapse IS the line falling: thicken it over that minute. */}
              {collapses.map((m) => {
                const team = m.team as 1 | 2;
                const pts = series.filter((p) => p.tMs >= m.tMs && p.tMs <= m.tMs + 60_000);
                const d = path(team, pts);
                if (!d || pts.length < 2) return null;
                const s = reg(single(m, toPx(m.tMs)));
                const sp = spotProps(s);
                return (
                  <path key={m.key} d={d} className={`tb-collapse tb-spot${m.tMs > curMs ? " future" : ""}`}
                        style={{ color: teamColor(team) }} tabIndex={0} role="button"
                        aria-label={sp["aria-label"]}
                        onMouseEnter={sp.onMouseEnter} onMouseLeave={sp.onMouseLeave}
                        onFocus={sp.onFocus} onBlur={sp.onBlur} onClick={sp.onClick} />
                );
              })}
              {flagSpots.map((s) => (
                <line key={s.key} x1={s.px} x2={s.px} y1={PT - 2} y2={H - PB}
                      className="tb-race-guide" style={{ color: capColor(s.lead) }} />
              ))}
              <line x1={playX} x2={playX} y1="0" y2={H} className="tb-race-playhead" />
            </svg>
          )}
          {flagSpots.map((s) => (
            <button key={s.key} className={`tb-spot tb-pin${future(s) ? " future" : ""}${menu === s.key ? " open" : ""}`}
                    style={{ left: s.px, top: 10 }} {...spotProps(s)}>
              <MaskIcon src={OBJECTIVE} size={15} color={capColor(s.lead)} />
            </button>
          ))}
          {dotSpots.map((s) => {
            const m = s.lead;
            const r = 3 + 2.5 * Math.max(...s.members.map((x) => x.weight));
            return (
              <button key={s.key} className={`tb-spot tb-dot${future(s) ? " future" : ""}${menu === s.key ? " open" : ""}`}
                      style={{ left: s.px, top: lineAt(m.team as 1 | 2, m.tMs) }} {...spotProps(s)}>
                {m.kind === "radio"
                  ? <RadioBadge team={m.team} size={17} />
                  : <span className="tb-dot-c" style={{ width: 2 * r, height: 2 * r, background: teamColor(m.team) }} />}
              </button>
            );
          })}
        </div>
        {track}
      </>
    );
  // --------------------------------------------------------------- lanes view
  } else {
    const flagSpots = ready ? clusterMarkers(caps, toPx, 22).map(reg) : [];
    const lossSpots = ready ? clusterMarkers(losses, toPx, 32).map(reg) : [];
    const lane = (list: Spot[], first: boolean) => (
      <div className="tb-lane">
        <div className="tb-lane-in" ref={first ? axisRef : undefined}>
          <span className="tb-playhead" style={{ left: `${pct}%` }} />
          {list.map((s) => {
            const m = s.lead;
            return (
              <button key={s.key} className={`tb-spot tb-lanespot${future(s) ? " future" : ""}${menu === s.key ? " open" : ""}`}
                      style={{ left: s.px }} {...spotProps(s)}>
                {m.kind === "vehicle"
                  ? <span className="tb-veh-under" style={{ "--c": teamColor(m.team) } as React.CSSProperties}>
                      <VehicleIcon m={m} len={Math.round(18 + 5 * m.weight)} />
                    </span>
                  : <MomentIcon m={m} size={14} />}
                {s.members.length > 1 && <b>+{s.members.length - 1}</b>}
              </button>
            );
          })}
        </div>
      </div>
    );
    body = (
      <>
        {times}
        <div className="tb-lanes">
          <span className="tb-lane-label" title="Flags"><MaskIcon src={OBJECTIVE} size={13} color="currentColor" /></span>
          {lane(flagSpots, true)}
          <span className="tb-lane-label" title="Losses"><MaskIcon src={DEATHS} size={12} color="currentColor" /></span>
          {lane(lossSpots, false)}
          <span />
          {track}
        </div>
      </>
    );
  }

  const openSpot = menu && menu !== "speed" ? spots.get(menu) ?? null : null;
  const hoverSpot = !openSpot && hover ? spots.get(hover) ?? null : null;
  const card = openSpot ?? hoverSpot;
  const playTitle = stalled ? "Buffering — waiting for the download"
                  : playing ? "Pause (Space)" : "Play (Space)";

  return (
    <div id="timeline-bar" className={`tb-view-${view}`}>
      {body}

      <div className="tb-controls">
        <button className={`tb-play${stalled ? " tb-buffering" : ""}`}
                onClick={togglePlay} title={playTitle} aria-label={playTitle}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button className="tb-icon" onClick={() => seekDeltaMs(-30_000)}
                title="Back 30 s" aria-label="Back 30 seconds"><SkipIcon dir={-1} n={30} /></button>
        <button className="tb-icon" onClick={() => seekDeltaMs(-10_000)}
                title="Back 10 s" aria-label="Back 10 seconds"><SkipIcon dir={-1} n={10} /></button>
        <button className="tb-icon" onClick={() => seekDeltaMs(10_000)}
                title="Forward 10 s" aria-label="Forward 10 seconds"><SkipIcon dir={1} n={10} /></button>
        <button className="tb-icon" onClick={() => seekDeltaMs(30_000)}
                title="Forward 30 s" aria-label="Forward 30 seconds"><SkipIcon dir={1} n={30} /></button>
        <span className="tb-sep" />
        <button className="tb-icon" onClick={() => stepReplayFrame(-1)}
                title="Previous frame ( , )" aria-label="Previous frame"><StepIcon dir={-1} /></button>
        <button className="tb-icon" onClick={() => stepReplayFrame(1)}
                title="Next frame ( . )" aria-label="Next frame"><StepIcon dir={1} /></button>
        <span className="tb-clock"><b>{fmtMMSS(elapsedMs)}</b> / {fmtMMSS(durationMs)}</span>
        <span className="tb-spacer" />
        <div className="tb-views" role="radiogroup" aria-label="Timeline style">
          {VIEWS.map((v) => (
            <button key={v.id} role="radio" aria-checked={view === v.id}
                    className={view === v.id ? "on" : ""} title={v.label} aria-label={v.label}
                    onClick={() => pickView(v.id)}>
              <ViewIcon id={v.id} />
            </button>
          ))}
        </div>
        <div className="tb-speed-wrap">
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

      {/* One card for every view: what is under the pointer, or — once a
          crowded spot is clicked — a list to pick from. Centred on its spot,
          never hanging off either end of the bar. */}
      {card && (
        <div className={`tb-card tb-moments${openSpot ? " pick" : ""}`}
             role={openSpot ? "menu" : "tooltip"}
             style={{ left: `clamp(150px, ${axisLeft + card.px}px, calc(100% - 150px))` }}>
          {card.members.map((x) => {
            const row = (
              <>
                <span className="tb-card-ico"><MomentIcon m={x} size={16} /></span>
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
