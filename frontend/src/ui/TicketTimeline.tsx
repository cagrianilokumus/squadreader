// Ticket Timeline — a replay-only overlay that charts each team's tickets over
// the whole match and attributes every LOSS to a cause (death / vehicle / bleed).
// The two lines and per-team totals are exact ground truth; the split across
// causes is a best-effort inference (see state/ticketTimeline.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import { useViewerStore } from "../state/viewerStore";
import { teamColor } from "../canvas/draw";
import { computeTicketAnalysis } from "../state/ticketTimeline";
import type { LossEvent, TeamTimeline } from "../state/ticketTimeline";

const VBH = 260;                       // graph height (px, 1:1 with viewBox)
const PADL = 46, PADR = 16, PADT = 12, PADB = 28;
const INH = VBH - PADT - PADB;

const mmss = (s: number) =>
  `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const shortFaction = (f: string | null | undefined) => (f ?? "").split("_")[0] || null;

export function TicketTimeline() {
  const mode    = useViewerStore((s) => s.mode);
  const visible = useViewerStore((s) => s.timelineVisible);
  const close   = useViewerStore((s) => s.setTimelineVisible);
  const frames  = useViewerStore((s) => s.replay.frames);
  const idx     = useViewerStore((s) => s.replay.currentIdx);
  const setReplay = useViewerStore((s) => s.setReplay);

  const analysis = useMemo(
    () => (frames.length ? computeTicketAnalysis(frames) : null), [frames]);

  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [w, setW] = useState(900);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Measure the graph width so the SVG renders 1:1 (no non-uniform stretch).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0;
      if (cw > 0) setW(Math.round(cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  const INW = Math.max(1, w - PADL - PADR);

  // Static graph geometry (independent of the playhead).
  const geo = useMemo(() => {
    if (!analysis) return null;
    const { tMs, maxTickets, t1, t2 } = analysis;
    const n = tMs.length;
    if (n < 2) return null;
    const t0 = tMs[0], tN = tMs[n - 1];
    const span = Math.max(1, tN - t0);
    const xOf = (ms: number) => PADL + ((ms - t0) / span) * INW;
    const yOf = (v: number) => PADT + INH - (v / maxTickets) * INH;
    const xs = tMs.map(xOf);
    const seg = (tix: (number | null)[]) => {
      const out: string[] = [];
      let cur: string[] = [];
      for (let i = 0; i < tix.length; i++) {
        const v = tix[i];
        if (v == null) { if (cur.length > 1) out.push(cur.join(" ")); cur = []; continue; }
        cur.push(`${xs[i].toFixed(1)},${yOf(v).toFixed(1)}`);
      }
      if (cur.length > 1) out.push(cur.join(" "));
      return out;
    };
    // Vehicle destructions are the discrete markers; deaths/bleed are continuous
    // and read from the line slope + the breakdown.
    const markers = analysis.events
      .filter((e) => e.cause === "vehicle")
      .map((e) => {
        const tix = e.team === 1 ? t1.tickets : t2.tickets;
        const v = tix[e.frameIdx];
        return { e, cx: xOf(e.tMs), cy: v != null ? yOf(v) : PADT + INH };
      });
    return { xOf, yOf, t0, tN, span,
             seg1: seg(t1.tickets), seg2: seg(t2.tickets), markers };
  }, [analysis, INW]);

  if (mode !== "replay" || frames.length === 0 || !visible) return null;

  const fac1 = shortFaction(frames[0]?.teams?.find((t) => t.id === 1)?.factionId);
  const fac2 = shortFaction(frames[0]?.teams?.find((t) => t.id === 2)?.factionId);
  const label1 = fac1 ?? "Team 1";
  const label2 = fac2 ?? "Team 2";

  const seekTo = (frameIdx: number) => {
    setReplay((r) => ({ ...r, currentIdx: Math.max(0, Math.min(frames.length - 1, frameIdx)),
                        baseWallMs: 0, baseSnapMs: 0 }));
    close(false);
  };

  const frameAtMs = (targetMs: number) => {
    if (!analysis) return 0;
    const tMs = analysis.tMs;
    let lo = 0, hi = tMs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tMs[mid] < targetMs) lo = mid + 1; else hi = mid;
    }
    return lo;
  };

  const onGraphClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || !geo) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * w;   // viewBox == px here
    const ms = geo.t0 + ((px - PADL) / INW) * geo.span;
    seekTo(frameAtMs(ms));
  };

  const showTip = (ev: LossEvent, dom: React.MouseEvent) =>
    setHover({ x: dom.clientX, y: dom.clientY,
      text: `${ev.team === 1 ? label1 : label2} — ${ev.label}  −${ev.amount}  @${mmss(ev.tickTimeSec)}` });

  const ready = analysis && geo;
  const vehEvents = analysis ? analysis.events.filter((e) => e.cause === "vehicle") : [];
  const playheadX = ready ? geo!.xOf(analysis!.tMs[Math.min(idx, analysis!.tMs.length - 1)]) : 0;
  const gridYs = ready
    ? [0, 0.5, 1].map((f) => ({ v: Math.round(analysis!.maxTickets * f),
                                y: geo!.yOf(analysis!.maxTickets * f) }))
    : [];
  const xTicks = ready
    ? [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const i = Math.min(analysis!.timeSec.length - 1,
                           Math.round(f * (analysis!.timeSec.length - 1)));
        return { x: PADL + f * INW, label: mmss(analysis!.timeSec[i]) };
      })
    : [];

  return (
    <div id="tt-overlay" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div id="ticket-timeline">
        <header>
          <span className="tt-title">Ticket Timeline</span>
          <span className="tt-legend">
            <i style={{ background: teamColor(1) }} />{label1}
            <i style={{ background: teamColor(2) }} />{label2}
            <b>▲</b>&nbsp;vehicle
          </span>
          <span className="tt-note"
                title="The lines and per-team totals are exact ground truth. Splitting each loss into death / vehicle / bleed is a best-effort estimate.">
            totals exact · causes estimated
          </span>
          <button className="tt-close" onClick={() => close(false)} title="close (G / Esc)">✕</button>
        </header>

        <div className="tt-graph-wrap" ref={wrapRef}>
          {!ready ? (
            <div className="tt-empty">Not enough ticket data in this recording.</div>
          ) : (
            <svg ref={svgRef} className="tt-graph" width={w} height={VBH}
                 viewBox={`0 0 ${w} ${VBH}`} onClick={onGraphClick}>
              {gridYs.map((g, k) => (
                <g key={k}>
                  <line x1={PADL} y1={g.y} x2={w - PADR} y2={g.y} className="tt-grid" />
                  <text x={PADL - 6} y={g.y + 3} className="tt-ylabel">{g.v}</text>
                </g>
              ))}
              {xTicks.map((t, k) => (
                <text key={k} x={t.x} y={VBH - 8} className="tt-xlabel"
                      textAnchor={k === 0 ? "start" : k === xTicks.length - 1 ? "end" : "middle"}>
                  {t.label}
                </text>
              ))}
              {geo!.seg2.map((pts, k) => (
                <polyline key={`b${k}`} points={pts} fill="none" stroke={teamColor(2)}
                          strokeWidth={1.6} strokeLinejoin="round" />
              ))}
              {geo!.seg1.map((pts, k) => (
                <polyline key={`a${k}`} points={pts} fill="none" stroke={teamColor(1)}
                          strokeWidth={1.6} strokeLinejoin="round" />
              ))}
              <line x1={playheadX} y1={PADT} x2={playheadX} y2={PADT + INH} className="tt-playhead" />
              {geo!.markers.map((m, k) => (
                <path key={k} className="tt-marker"
                      d={`M ${m.cx} ${m.cy - 5} L ${m.cx + 4.5} ${m.cy + 4} L ${m.cx - 4.5} ${m.cy + 4} Z`}
                      fill={teamColor(m.e.team)}
                      onMouseEnter={(ev) => showTip(m.e, ev)}
                      onMouseLeave={() => setHover(null)}
                      onClick={(ev) => { ev.stopPropagation(); seekTo(m.e.frameIdx); }} />
              ))}
            </svg>
          )}
        </div>

        <div className="tt-lower">
          <div className="tt-breakdown">
            {(analysis ? [analysis.t1, analysis.t2] : []).map((t: TeamTimeline) => (
              <div key={t.team} className="tt-bk-row">
                <span className="tt-bk-team" style={{ color: teamColor(t.team) }}>
                  <i style={{ background: teamColor(t.team) }} />
                  {t.team === 1 ? label1 : label2}
                </span>
                <span className="tt-bk-cells">
                  <b>{t.breakdown.total}</b> lost
                  <span className="tt-bk-sep">·</span>Deaths {t.breakdown.death}
                  <span className="tt-bk-sep">·</span>Vehicles {t.breakdown.vehicle}
                  <span className="tt-bk-sep">·</span>Bleed {t.breakdown.bleed}
                </span>
              </div>
            ))}
          </div>

          <div className="tt-events">
            <div className="tt-events-head">Vehicle losses ({vehEvents.length})</div>
            <div className="tt-events-list">
              {vehEvents.length === 0 && <div className="tt-empty2">No vehicles destroyed.</div>}
              {vehEvents.map((e, k) => (
                <button key={k} className="tt-ev-row" onClick={() => seekTo(e.frameIdx)}>
                  <span className="tt-ev-time">{mmss(e.tickTimeSec)}</span>
                  <i className="tt-ev-dot" style={{ background: teamColor(e.team) }} />
                  <span className="tt-ev-label">{e.detail ?? e.label}</span>
                  <span className="tt-ev-amt">−{e.amount}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {hover && (
        <div className="tt-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          {hover.text}
        </div>
      )}
    </div>
  );
}
