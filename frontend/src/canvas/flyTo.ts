// Take the map's camera to a place, smoothly — used when a timeline moment is
// clicked, so the viewer lands on WHERE it happened as well as when.

import { useViewerStore } from "../state/viewerStore";
import type { ViewState } from "../state/types";

// The wheel's own limits (MapCanvas), so a flight never ends somewhere the
// user could not have scrolled to.
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 40;
/** The framed circle's diameter, as a share of the view's shorter side. */
const FILL = 0.5;

let raf = 0;
/** The last view this module wrote, to notice anyone else moving the camera. */
let wrote: Pick<ViewState, "zoom" | "panX" | "panY"> | null = null;

const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export function cancelFly(): void {
  cancelAnimationFrame(raf);
  raf = 0;
  wrote = null;
}

/**
 * Frame a circle of radius `r` (world cm) around (x, y).
 *
 * Zoom is interpolated geometrically and the centre linearly, eased at both
 * ends. If anything else moves the camera mid-flight — the user grabbing the
 * map, a wheel — the flight stops rather than fighting it.
 */
export function flyTo(x: number, y: number, r: number, durationMs = 700): void {
  const st = useViewerStore.getState();
  const from = st.view;
  const baseW = from.maxX - from.minX;
  const baseH = from.maxY - from.minY;
  if (!(baseW > 1 && baseH > 1) || !(r > 0)) return;   // the map is not fitted yet
  // Following a player or vehicle re-centres the camera every frame and
  // would undo the flight immediately: let go of it first.
  if (st.followKey || st.followVehicleId) {
    st.setFollowKey(null);
    st.setFollowVehicleId(null);
  }
  const zoomTo = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (FILL * Math.min(baseW, baseH)) / (2 * r)));
  const panXTo = x - (from.minX + from.maxX) / 2;
  const panYTo = y - (from.minY + from.maxY) / 2;

  cancelFly();
  const set = (zoom: number, panX: number, panY: number) => {
    wrote = { zoom, panX, panY };
    useViewerStore.getState().setView((v) => ({ ...v, zoom, panX, panY, userInteracted: true }));
  };
  const reduced = typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || durationMs <= 0) { set(zoomTo, panXTo, panYTo); wrote = null; return; }

  const z0 = from.zoom, x0 = from.panX, y0 = from.panY;
  const t0 = performance.now();
  const step = (now: number) => {
    const v = useViewerStore.getState().view;
    if (wrote && (v.zoom !== wrote.zoom || v.panX !== wrote.panX || v.panY !== wrote.panY)) {
      cancelFly();                        // someone else has the camera now
      return;
    }
    const k = Math.min(1, (now - t0) / durationMs);
    const e = ease(k);
    set(z0 * Math.pow(zoomTo / z0, e), x0 + (panXTo - x0) * e, y0 + (panYTo - y0) * e);
    if (k < 1) raf = requestAnimationFrame(step);
    else { raf = 0; wrote = null; }
  };
  raf = requestAnimationFrame(step);
}
