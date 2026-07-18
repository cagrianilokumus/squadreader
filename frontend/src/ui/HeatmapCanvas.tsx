// Kill/death heatmap over the layer's minimap texture. Two modes:
//   • "layer" — server-aggregated death-density grid across every match
//   • "match" — one match's individual kill points, coloured by team
//
// Colour decisions (validated, not eyeballed):
//
//   Density uses a SINGLE-HUE aqua ramp. Red and blue are not available: this
//   app binds them to team 1 and team 2 everywhere (see teamColor), so a red
//   density map would read as "team 1's ground" rather than "people die here".
//   Amber is the --warn status token and is reserved. Aqua is neither, and no
//   Squad terrain texture contains it, so the overlay never camouflages itself
//   against the map. The ramp passes the ordinal checks against this app's
//   surface: monotone lightness, adjacent ΔL ≥ 0.06, one hue (8° spread).
//
//   Team points reuse teamColor() unchanged — colour follows the entity, so a
//   team is the same colour here as it is on the live map. The pair separates
//   at ΔE 54.4 under protanopia, far past the ≥12 target, so the two teams stay
//   distinguishable for colourblind viewers without a second channel.
//
// The ramp was validated against a FLAT dark surface, but these cells land on a
// photographic terrain texture whose own luminance varies wildly. The scrim
// below is what makes that validation true: it flattens the map back down to
// roughly the app's background before any data is drawn.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapTexture } from "../canvas/icons";
import { coord } from "../canvas/worldToScreen";
import { teamColor } from "../canvas/draw";
import type {
  HeatmapCell, HeatmapPoint, LayerBounds,
} from "../state/types";

/** Single-hue aqua ramp, low → high density. Validated: monotone L, ΔL ≥ 0.06,
 *  hue spread 8°, low end 2.62:1 on the app surface. */
const DENSITY_RAMP = [
  "#1d5f57", "#2a8478", "#37a695", "#4cc4ae", "#7ee0c8", "#b8f3e5",
] as const;

/** Opacity climbs with the ramp so low-density cells let the terrain read
 *  through and hot cells own their pixels. Same direction as lightness — the two
 *  channels reinforce rather than fight. */
const DENSITY_ALPHA = [0.35, 0.45, 0.55, 0.68, 0.8, 0.92] as const;

/** Flattens the terrain photo into a near-uniform dark surface, so the ramp
 *  above behaves the way it was validated to. */
const SCRIM = "rgba(10, 13, 18, 0.62)";

function rampIndex(n: number, max: number): number {
  if (max <= 1) return DENSITY_RAMP.length - 1;
  // Square-root scale: kill counts are heavily long-tailed (one contested
  // objective can hold 50× the deaths of an open field), and a linear ramp
  // would paint everything but that one cell at the bottom step.
  const t = Math.sqrt(n / max);
  const i = Math.round(t * (DENSITY_RAMP.length - 1));
  return Math.min(DENSITY_RAMP.length - 1, Math.max(0, i));
}

interface Extent { minX: number; minY: number; maxX: number; maxY: number; }

function extentOf(b: LayerBounds | null): Extent | null {
  const tl = b ? coord(b.topLeft) : null;
  const br = b ? coord(b.bottomRight) : null;
  if (!tl || !br) return null;
  return {
    minX: Math.min(tl[0], br[0]), maxX: Math.max(tl[0], br[0]),
    minY: Math.min(tl[1], br[1]), maxY: Math.max(tl[1], br[1]),
  };
}

export type HeatmapData =
  | { kind: "layer"; cells: HeatmapCell[]; cellCm: number; maxCount: number }
  | { kind: "match"; points: HeatmapPoint[] };

export function HeatmapCanvas({ bounds, data }: {
  bounds: LayerBounds | null;
  data: HeatmapData;
}) {
  const cvsRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const extent = useMemo(() => extentOf(bounds), [bounds]);

  const draw = useCallback(() => {
    const cvs = cvsRef.current;
    if (!cvs || !extent) return;
    const ctx = cvs.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = cvs.clientWidth, cssH = cvs.clientHeight;
    if (!cssW || !cssH) return;
    if (cvs.width !== cssW * dpr || cvs.height !== cssH * dpr) {
      cvs.width = cssW * dpr;
      cvs.height = cssH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // World -> screen. Squad's world Y grows southward, so no flip (same as
    // canvas/worldToScreen.ts — keep these two in step).
    const wW = extent.maxX - extent.minX || 1;
    const wH = extent.maxY - extent.minY || 1;
    const sx = (x: number) => ((x - extent.minX) / wW) * cssW;
    const sy = (y: number) => ((y - extent.minY) / wH) * cssH;

    const tex = bounds?.texture ? mapTexture(bounds.texture) : null;
    if (tex && tex.complete && !tex._failed && tex.naturalWidth > 0) {
      ctx.drawImage(tex, 0, 0, cssW, cssH);
    } else {
      ctx.fillStyle = "#0f141c";
      ctx.fillRect(0, 0, cssW, cssH);
    }
    ctx.fillStyle = SCRIM;
    ctx.fillRect(0, 0, cssW, cssH);

    if (data.kind === "layer") {
      const cw = Math.max(1, (data.cellCm / wW) * cssW);
      const ch = Math.max(1, (data.cellCm / wH) * cssH);
      for (const c of data.cells) {
        const i = rampIndex(c.n, data.maxCount);
        ctx.globalAlpha = DENSITY_ALPHA[i];
        ctx.fillStyle = DENSITY_RAMP[i];
        // cell_x/cell_y are the cell's lower-left corner in world cm.
        ctx.fillRect(sx(c.cell_x), sy(c.cell_y), cw, ch);
      }
      ctx.globalAlpha = 1;
    } else {
      for (const p of data.points) {
        const x = sx(p.victim_x), y = sy(p.victim_y);
        // A 2px surface ring keeps overlapping marks readable where deaths pile
        // up — without it a cluster fuses into one blob.
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fillStyle = teamColor(p.victim_team);
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(10,13,18,0.85)";
        ctx.stroke();
      }
    }
  }, [bounds, data, extent]);

  useEffect(() => {
    draw();
    const cvs = cvsRef.current;
    if (!cvs) return;
    const ro = new ResizeObserver(draw);
    ro.observe(cvs);
    // The texture is fetched lazily and cached; if it was not decoded yet, the
    // first draw painted the fallback. Repaint once it lands.
    const tex = bounds?.texture ? mapTexture(bounds.texture) : null;
    if (tex && !tex.complete) tex.addEventListener("load", draw, { once: true });
    return () => ro.disconnect();
  }, [draw, bounds]);

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const cvs = cvsRef.current;
    if (!cvs || !extent || data.kind !== "layer") return;
    const r = cvs.getBoundingClientRect();
    const wW = extent.maxX - extent.minX || 1;
    const wH = extent.maxY - extent.minY || 1;
    const wx = extent.minX + ((e.clientX - r.left) / r.width) * wW;
    const wy = extent.minY + ((e.clientY - r.top) / r.height) * wH;
    const hit = data.cells.find(
      (c) => wx >= c.cell_x && wx < c.cell_x + data.cellCm
          && wy >= c.cell_y && wy < c.cell_y + data.cellCm);
    setHover(hit ? `${hit.n} deaths` : null);
  }, [data, extent]);

  // No bounds means we do not know where this layer sits in the world. Say so —
  // a guessed extent would put every death in the wrong place, convincingly.
  if (!extent) {
    return (
      <div className="ps-empty">
        This layer's map bounds are missing from the static data, so the heatmap can't be drawn.
      </div>
    );
  }

  return (
    <div className="hm-wrap">
      <canvas ref={cvsRef} className="hm-canvas"
              onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && <div className="hm-hover">{hover}</div>}
      {data.kind === "layer"
        ? <DensityLegend max={data.maxCount} />
        : <TeamLegend />}
    </div>
  );
}

function DensityLegend({ max }: { max: number }) {
  return (
    <div className="hm-legend">
      <span className="hm-legend-l">low</span>
      <span className="hm-ramp">
        {DENSITY_RAMP.map((c, i) => (
          <span key={c} style={{ background: c, opacity: DENSITY_ALPHA[i] }} />
        ))}
      </span>
      <span className="hm-legend-l">high{max > 0 ? ` (${max})` : ""}</span>
    </div>
  );
}

function TeamLegend() {
  return (
    <div className="hm-legend">
      <span className="hm-key">
        <span className="hm-dot" style={{ background: teamColor(1) }} />Team 1
      </span>
      <span className="hm-key">
        <span className="hm-dot" style={{ background: teamColor(2) }} />Team 2
      </span>
      <span className="hm-legend-l">death locations</span>
    </div>
  );
}
