// World/screen transform, ported from the old viewer.
// Squad's world Y increases southward (verified empirically — see
// layer_bounds.json: topLeft.y < bottomRight.y), so we map world-Y
// directly to screen-Y with no flip. World X maps directly too.

import type { Snapshot, ViewState, LayerBounds } from "../state/types";

export interface ViewWindow {
  w: number;
  h: number;
  left: number;
  bottom: number;
  top: number;
}

export function viewWindow(view: ViewState): ViewWindow {
  const w = (view.maxX - view.minX) / view.zoom;
  const h = (view.maxY - view.minY) / view.zoom;
  const cx = (view.minX + view.maxX) / 2 + view.panX;
  const cy = (view.minY + view.maxY) / 2 + view.panY;
  return { w, h, left: cx - w / 2, bottom: cy - h / 2, top: cy + h / 2 };
}

export function worldToScreen(
  view: ViewState, canvas: { width: number; height: number },
  x: number, y: number,
): [number, number] {
  const v = viewWindow(view);
  return [
    ((x - v.left) / v.w) * canvas.width,
    ((y - v.bottom) / v.h) * canvas.height,
  ];
}

export function screenToWorld(
  view: ViewState, canvasCss: { width: number; height: number },
  cssX: number, cssY: number,
): [number, number] {
  const v = viewWindow(view);
  return [
    v.left + (cssX / canvasCss.width) * v.w,
    v.bottom + (cssY / canvasCss.height) * v.h,
  ];
}

// Accept either [x, y] array OR {x, y} object shape for metadata
// corners. Returns null if neither shape matches.
export function coord(p: LayerBounds["topLeft"] | null | undefined):
    [number, number] | null {
  if (!p) return null;
  if (Array.isArray(p) && p.length >= 2) return [p[0], p[1]];
  if (typeof p === "object" && "x" in p && "y" in p) return [p.x, p.y];
  return null;
}

// Compute a base view rectangle that fits all entities (or the layer
// bounds if available) into the canvas without aspect-ratio distortion.
// Always pads the SHORTER side so the projection stays square.
export function autoFit(
  snap: Snapshot,
  canvasCss: { width: number; height: number },
  padding = 0.06,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const layer = snap.gameState?.layer ?? null;
  const tl = layer ? coord(layer.topLeft) : null;
  const br = layer ? coord(layer.bottomRight) : null;
  let minX: number, minY: number, maxX: number, maxY: number;

  if (tl && br) {
    minX = Math.min(tl[0], br[0]);
    maxX = Math.max(tl[0], br[0]);
    minY = Math.min(tl[1], br[1]);
    maxY = Math.max(tl[1], br[1]);
  } else {
    // Entity-bounding-box fallback.
    minX = Infinity; minY = Infinity;
    maxX = -Infinity; maxY = -Infinity;
    const sources = [
      snap.captureZones, snap.vehicles, snap.deployables,
      snap.vehicleSpawners, snap.rallyPoints, snap.markers, snap.projectiles,
    ];
    for (const arr of sources) {
      if (!arr) continue;
      for (const e of arr) {
        const p = e.position;
        if (!p) continue;
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
    for (const pl of snap.players ?? []) {
      const p = pl.soldier?.position;
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) {
      minX = -100000; maxX = 100000; minY = -100000; maxY = 100000;
    }
    const wRaw = maxX - minX || 1, hRaw = maxY - minY || 1;
    minX -= wRaw * padding; maxX += wRaw * padding;
    minY -= hRaw * padding; maxY += hRaw * padding;
  }

  // Aspect-fit: pad the SHORTER side so the projection isn't squashed.
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const cw = canvasCss.width, ch = canvasCss.height;
  if (cw && ch) {
    const dataAR = w / h;
    const viewAR = cw / ch;
    if (dataAR < viewAR) {
      const targetW = h * viewAR;
      const extra = (targetW - w) / 2;
      minX -= extra; maxX += extra;
    } else {
      const targetH = w / viewAR;
      const extra = (targetH - h) / 2;
      minY -= extra; maxY += extra;
    }
  }
  return { minX, minY, maxX, maxY };
}

// Re-shape an existing view rectangle to the canvas aspect ratio, expanding
// the deficient axis about its centre. worldToScreen is only isotropic
// (scaleX==scaleY) when the view rectangle's AR matches the canvas AR;
// after a window resize the canvas AR changes and the projection shears —
// positions stay on the (stretched) map but headings, drawn in pure screen
// space, no longer line up. Call this on every canvas aspect change.
// Preserves zoom / pan / userInteracted.
export function refitAspect(
  view: ViewState, canvasCss: { width: number; height: number },
): ViewState {
  let { minX, minY, maxX, maxY } = view;
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const cw = canvasCss.width, ch = canvasCss.height;
  if (!cw || !ch) return view;
  const dataAR = w / h, viewAR = cw / ch;
  if (Math.abs(dataAR - viewAR) < 1e-4) return view;
  if (dataAR < viewAR) {
    const extra = (h * viewAR - w) / 2;
    minX -= extra; maxX += extra;
  } else {
    const extra = (w / viewAR - h) / 2;
    minY -= extra; maxY += extra;
  }
  return { ...view, minX, minY, maxX, maxY };
}
