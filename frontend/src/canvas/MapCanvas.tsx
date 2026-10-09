// <MapCanvas /> — owns the canvas element, runs the continuous rAF
// loop that interpolates prev → cur and renders, and wires pan/zoom/
// hover. Pure presentation: snapshot data + view state come from the
// store; tooltip state is passed in (App owns it for layout reasons).

import { useEffect, useRef, type CSSProperties } from "react";
import { renderScene, type FollowHighlight } from "./draw";
import { lerpSnap } from "./interpolation";
import { autoFit, refitAspect, screenToWorld, viewWindow } from "./worldToScreen";
import { hitTest, type Hit } from "./hitTest";
import { teamViewSnapshot } from "./teamView";
import type { Ruler } from "./ruler";

// How close a new drag has to start, in world units at 1x zoom, to be
// treated as continuing the last measurement rather than starting one.
// Scaled by zoom so it stays about the same distance on screen.
const EXTEND_SNAP_CM = 1500;
import { useViewerStore, RENDER_DELAY_MS } from "../state/viewerStore";
import { replayClock } from "../state/replayClock";
import { DEFAULT_VIEW } from "../state/types";
import type { Snapshot, ViewState } from "../state/types";

interface Props {
  onHover: (hit: Hit | null, cssX: number, cssY: number) => void;
  onLeave: () => void;
  onClick: (hit: Hit | null) => void;
}

// Player identity key — must match PlayerPanel.playerKey exactly.
function pKey(p: { eosId: string | null; playerId: number | null; name: string | null }): string {
  return p.eosId ?? (p.playerId != null ? `pid:${p.playerId}` : `name:${p.name ?? "?"}`);
}

// When FOLLOW is active, override pan so the tracked player sits at the
// centre of the view. Zoom stays whatever the user set. Returns the view
// unchanged when not following or the player has no position.
function followView(view: ViewState, followKey: string | null,
                    followVehicleId: string | null,
                    snap: Snapshot | null): ViewState {
  if (!snap || (!followKey && !followVehicleId)) return view;
  const pos = followKey
    ? (snap.players ?? []).find((pl) => pKey(pl) === followKey)?.soldier?.position
    : (snap.vehicles ?? []).find((v) => v.id === followVehicleId)?.position;
  if (!pos) return view;
  const cx0 = (view.minX + view.maxX) / 2;
  const cy0 = (view.minY + view.maxY) / 2;
  return { ...view, panX: pos.x - cx0, panY: pos.y - cy0 };
}

export function MapCanvas({ onHover, onLeave, onClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ x0: number; y0: number; panX0: number; panY0: number } | null>(null);
  // Track whether the mousedown→mouseup motion was small enough to
  // count as a click (vs an intentional drag). 4 css pixels feels right.
  const downRef = useRef<{ x: number; y: number; t: number } | null>(null);
  // A measurement lives outside React state on purpose: it changes on every
  // mousemove while dragging, and re-rendering the tree at pointer rate to
  // move a line would be absurd. The render loop reads it each frame.
  const rulerRef = useRef<Ruler | null>(null);
  const rulerDragRef = useRef<boolean>(false);
  // Active touch gesture (one-finger pan / two-finger pinch). Fields are shared
  // across the two gesture kinds; `mode` says which are meaningful.
  const touchRef = useRef<{
    mode: "pan" | "pinch";
    startX?: number; startY?: number; panX0?: number; panY0?: number;
    downX?: number; downY?: number; downT?: number;
    startDist?: number; startZoom?: number;
  } | null>(null);
  const firstAutoFitRef = useRef(true);
  const lastArRef = useRef<number | null>(null);
  // The exact frame the renderer last drew: the delayed/interpolated
  // display snapshot AND the follow-adjusted view. Hover/click/follow read
  // this so hit-testing lines up with what's actually on screen (the drawn
  // positions lag curSnap by ~DELAY under the render-delay buffer).
  const displayRef = useRef<{ snap: Snapshot | null; view: ViewState }>(
    { snap: null, view: { ...DEFAULT_VIEW } });
  // Monotonic render-clock latch — belt-and-suspenders. Inert while
  // RENDER_DELAY_MS is constant (now() only increases, so now-DELAY never
  // regresses), but hard-guarantees the map can never step backward if DELAY
  // is ever retuned/ramped. Persists across frames and reconnects.
  const lastRenderClockRef = useRef(0);

  // Pull state via selectors so a snapshot tick doesn't re-render the
  // canvas component (rendering is rAF-driven; we only need the latest
  // state available, not React lifecycle).
  const setView = useViewerStore((s) => s.setView);
  const resetView = useViewerStore((s) => s.resetView);

  // rAF loop. Reads store directly via getState() to avoid React rerender
  // overhead on every tick.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    let stopped = false;
    let raf = 0;
    const tick = () => {
      if (stopped) return;
      const s = useViewerStore.getState();
      const ctx = cv.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(tick); return; }
      const dpr = window.devicePixelRatio || 1;
      const cssW = cv.clientWidth, cssH = cv.clientHeight;
      const wantW = Math.floor(cssW * dpr), wantH = Math.floor(cssH * dpr);
      if (cv.width !== wantW)  cv.width = wantW;
      if (cv.height !== wantH) cv.height = wantH;
      const cs = { width: cv.width, height: cv.height,
                   cssWidth: cssW, cssHeight: cssH, dpr };

      const cur = s.curSnap;
      if (cur) {
        if (firstAutoFitRef.current && cssW > 0 && cssH > 0) {
          firstAutoFitRef.current = false;
          const fit = autoFit(cur, { width: cssW, height: cssH });
          setView((v) => ({ ...v, ...fit }));
          lastArRef.current = cssW / cssH;
        } else if (cssW > 0 && cssH > 0) {
          // Keep worldToScreen isotropic across window/aspect changes: when
          // the canvas AR shifts, re-shape the view rectangle to match so
          // headings (drawn in screen space) stay aligned with the map.
          const ar = cssW / cssH;
          if (lastArRef.current !== null
              && Math.abs(ar - lastArRef.current) > 1e-3) {
            setView((v) => refitAspect(v, { width: cssW, height: cssH }));
          }
          lastArRef.current = ar;
        }
        let display: Snapshot | null;
        if (s.mode === "live") {
          // Render a FIXED RENDER_DELAY_MS (~6s ≈ 3 ticks) in the PAST,
          // interpolating between the two buffered frames that bracket the
          // render clock. Both frames have already arrived, so interpolation
          // never overruns the newest frame into a dead hold even if the
          // backend stalls for a tick or two — this is what removes the
          // periodic ~0.5s freeze AND survives multi-tick backend hiccups.
          const buf = s.snapBuffer;
          // Fixed delay (see RENDER_DELAY_MS) + a belt-and-suspenders monotonic
          // clamp so the render clock can never regress. Decoupling from the
          // EMA is what removes the periodic hitch AND the jitter time-warp.
          const renderClock = Math.max(
            performance.now() - RENDER_DELAY_MS,
            lastRenderClockRef.current,
          );
          lastRenderClockRef.current = renderClock;
          let a: { snap: Snapshot; t: number } | null = null;
          let b: { snap: Snapshot; t: number } | null = null;
          for (let i = buf.length - 1; i >= 1; i--) {
            if (buf[i - 1].t <= renderClock && renderClock <= buf[i].t) {
              a = buf[i - 1]; b = buf[i]; break;
            }
          }
          if (a && b) {
            const span = Math.max(1, b.t - a.t);
            const t = (renderClock - a.t) / span;
            // Real per-pair interval as tickMs so the teleport guard (and
            // the attached-soldier vehicle threshold) scale correctly.
            display = lerpSnap(a.snap, b.snap, t, span);
          } else if (buf.length) {
            // Underrun: renderClock is before the oldest frame (just
            // connected) or after the newest (a genuine >DELAY stall).
            // Hold the nearest real frame — a brief micro-hold, never a jump.
            display = renderClock < buf[0]!.t
              ? buf[0]!.snap : buf[buf.length - 1]!.snap;
          } else {
            display = cur;
          }
        } else {
          // Replay: interpolate between the two recorded frames bracketing the
          // continuous playhead (published by the playback engine), so motion
          // is smooth at 60fps instead of snapping every ~2s recorded frame —
          // the same fix as the live path, just driven by the scrub clock.
          const r = s.replay;
          const frames = r.frames;
          if (replayClock.valid && frames.length) {
            // currentIdx is maintained as the largest frame whose timestamp is
            // <= the playhead, so [i, i+1] brackets it.
            const i = Math.max(0, Math.min(frames.length - 1, r.currentIdx));
            const a = frames[i];
            const b = frames[i + 1];
            if (a && b) {
              const ta = Date.parse(a.timestamp) || 0;
              const tb = Date.parse(b.timestamp) || 0;
              const span = Math.max(1, tb - ta);
              const alpha = Math.max(0, Math.min(1, (replayClock.ms - ta) / span));
              if (alpha <= 0) {
                // Paused on a boundary → show frame `a` verbatim.
                display = a;
              } else {
                // Interpolate entity POSITIONS a→b for smooth motion, but keep
                // every DISCRETE field (markers, deployables, rallies, spawners,
                // gameState, …) from the frame the playhead is IN (`a`).
                // lerpSnap bases those on `cur` (= b, the NEXT frame), so a
                // marker placed on frame b would show while playing but vanish
                // the instant you pause (which shows `a`) — the reported
                // "markers disappear when paused" bug. Grafting a's discrete
                // state onto the interpolated entities keeps play == pause.
                const interp = lerpSnap(a, b, alpha, span);
                display = interp ? {
                  ...a,
                  players: interp.players,
                  vehicles: interp.vehicles,
                  projectiles: interp.projectiles,
                  captureZones: interp.captureZones,
                } : a;
              }
            } else {
              display = a ?? cur;
            }
          } else {
            display = cur;
          }
        }
        const shown = display ?? cur;
        // FOLLOW camera: centre on the tracked player in the SHOWN frame so
        // camera + icon agree. No store write — computed per frame.
        const rview = followView(s.view, s.followKey, s.followVehicleId, shown);
        // Follow spotlight: when following a player, highlight their whole
        // squad. Resolved from the shown frame so it tracks live as the squad
        // moves / reshuffles. No highlight when following a vehicle or a
        // squadless player.
        let followHl: FollowHighlight | null = null;
        if (s.followKey) {
          const fp = (shown.players ?? []).find((pl) => pKey(pl) === s.followKey);
          if (fp && fp.squadId != null)
            followHl = { key: s.followKey, teamId: fp.teamId, squadId: fp.squadId };
        }
        // One team's map, when asked for. Applied after the follow camera
        // (which keeps tracking whoever it follows) and before drawing AND
        // the hit-test frame, so a hidden entity cannot be hovered or clicked.
        const drawn = teamViewSnapshot(shown, s.teamView);
        renderScene(ctx, drawn, rview, cs, s.layers, followHl,
                    rulerRef.current);
        displayRef.current = { snap: drawn, view: rview };
      } else {
        ctx.clearRect(0, 0, cs.width, cs.height);
        displayRef.current = { snap: null, view: s.view };
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [setView]);

  // Pan + click detection (click = mousedown→mouseup with <4 px and <300 ms drift)
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    // Measuring: right-drag, or shift+left-drag for anyone whose mouse or
    // trackpad makes a right-drag awkward. Neither collides with pan (plain
    // left) or select (left click), so nothing had to be given up for it.
    const worldAt = (e: MouseEvent) => {
      // Canvas-relative from the bounding rect, NOT offsetX: the move and up
      // handlers are on `window`, so once the cursor leaves the canvas
      // offsetX is measured against whatever element it is over instead —
      // and the line would jump the moment you dragged past the edge.
      const rect = cv.getBoundingClientRect();
      const v = useViewerStore.getState().view;
      const [wx, wy] = screenToWorld(v, {
        width: cv.width, height: cv.height,
        cssWidth: cv.clientWidth, cssHeight: cv.clientHeight,
        dpr: cv.width / Math.max(1, cv.clientWidth),
      } as never, e.clientX - rect.left, e.clientY - rect.top);
      return { x: wx, y: wy };
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 2 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        const p = worldAt(e);
        // Starting near where the last one ended EXTENDS the path instead of
        // replacing it, so a route round a hill is measured by dragging leg
        // after leg. No extra modifier to learn: you simply carry on from
        // where you stopped, and starting anywhere else begins afresh.
        const prev = rulerRef.current;
        const tail = prev?.points[prev.points.length - 1];
        const near = tail && Math.hypot(tail.x - p.x, tail.y - p.y)
          <= EXTEND_SNAP_CM / Math.max(0.05, useViewerStore.getState().view.zoom);
        rulerRef.current = near && prev
          ? { points: [...prev.points, p] }
          : { points: [p, p] };
        rulerDragRef.current = true;
        return;
      }
      if (e.button !== 0) return;
      cv.classList.add("dragging");
      const st = useViewerStore.getState();
      // Manual pan releases FOLLOW — but commit the current follow
      // position into the view first so the drag continues smoothly from
      // where the camera was, not from the stale stored pan.
      if (st.followKey || st.followVehicleId) {
        // Commit the exact rendered (follow-adjusted) view so the drag
        // continues from where the camera actually was on screen.
        st.setView(() => displayRef.current.view);
        st.setFollowKey(null); st.setFollowVehicleId(null);
      }
      const v = useViewerStore.getState().view;
      dragRef.current = { x0: e.clientX, y0: e.clientY, panX0: v.panX, panY0: v.panY };
      downRef.current = { x: e.offsetX, y: e.offsetY, t: performance.now() };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (rulerDragRef.current && rulerRef.current) {
        const pts = rulerRef.current.points.slice();
        pts[pts.length - 1] = worldAt(e);
        rulerRef.current = { points: pts };
        return;
      }
      if (!dragRef.current) return;
      const v = useViewerStore.getState().view;
      const win = viewWindow(v);
      const dx = e.clientX - dragRef.current.x0;
      const dy = e.clientY - dragRef.current.y0;
      setView((vv) => ({
        ...vv,
        panX: dragRef.current!.panX0 - (dx / cv.clientWidth)  * win.w,
        panY: dragRef.current!.panY0 - (dy / cv.clientHeight) * win.h,
        userInteracted: true,
      }));
    };
    const onMouseUp = (e: MouseEvent) => {
      if (rulerDragRef.current) {
        rulerDragRef.current = false;
        // A right-click that never moved is not a measurement, it is someone
        // asking for a context menu they are not going to get.
        // A right-click that never moved is not a measurement, it is someone
        // asking for a context menu they are not going to get.
        const r = rulerRef.current;
        if (r) {
          const n = r.points.length;
          const last = r.points[n - 1]!, before = r.points[n - 2]!;
          if (last.x === before.x && last.y === before.y) {
            rulerRef.current = n > 2 ? { points: r.points.slice(0, n - 1) } : null;
          }
        }
        return;
      }
      if (dragRef.current) cv.classList.remove("dragging");
      dragRef.current = null;
      const down = downRef.current;
      downRef.current = null;
      if (!down) return;
      // Same-spot mouseup = click; hit-test at the up position so we
      // pick whatever's currently under the cursor (which has been
      // interpolating during the press, so use the latest hit anyway).
      const dx = (e as MouseEvent).clientX - down.x;
      const dy = (e as MouseEvent).clientY - down.y;
      const movedPx = Math.hypot(dx, dy);
      const elapsedMs = performance.now() - down.t;
      // mouseup is on window; clientX is page coords. The down `x`/`y`
      // was offsetX/offsetY (canvas-local). Cross-comparing them isn't
      // strictly correct, but since we only need a "click vs drag"
      // signal, the test below catches drags reliably (a real click
      // travels < 4 page pixels regardless).
      if (movedPx > 4 || elapsedMs > 500) return;
      // Re-hit-test at the canvas-local down position, against the SAME
      // delayed/interpolated frame + view the renderer drew.
      const { snap, view } = displayRef.current;
      const cssSize = { width: cv.clientWidth, height: cv.clientHeight };
      const [wx, wy] = screenToWorld(view, cssSize, down.x, down.y);
      const win = viewWindow(view);
      const worldRadius = 12 * (win.w / Math.max(1, cssSize.width));
      const hit = hitTest(snap, wx, wy, worldRadius);
      // Clicking bare map puts the measurement away; left pinned there it
      // stops being an answer and becomes litter. Clicking a player or a
      // vehicle does NOT, because inspecting what you just measured between
      // is the obvious next thing to do.
      //
      // And this belongs in the CLICK branch, never in mousedown: mousedown
      // also fires at the start of a pan, so clearing there wiped the
      // measurement the moment you dragged the map to look at it.
      if (!hit) rulerRef.current = null;
      onClick(hit);
    };
    cv.addEventListener("mousedown", onMouseDown);
    cv.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      cv.removeEventListener("mousedown", onMouseDown);
      cv.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [setView, onClick]);

  // Wheel zoom (toward cursor — or toward the followed player while following)
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useViewerStore.getState();
      const factor = Math.pow(1.0015, -e.deltaY);
      const v = st.view;
      const newZoom = Math.max(0.2, Math.min(40, v.zoom * factor));
      // While FOLLOWING, zooming must NOT break the follow — just change the
      // zoom level and keep the player centred. followView overrides pan every
      // frame, so a cursor-anchored pan here would fight it (and get discarded);
      // we intentionally skip it and leave followKey set.
      if (st.followKey || st.followVehicleId) {
        setView((vv) => ({ ...vv, zoom: newZoom, userInteracted: true }));
        return;
      }
      // Free camera: zoom toward the cursor by keeping the world point under
      // the pointer fixed across the zoom.
      const cssSize = { width: cv.clientWidth, height: cv.clientHeight };
      const [wx0, wy0] = screenToWorld(v, cssSize, e.offsetX, e.offsetY);
      const vAfter = { ...v, zoom: newZoom };
      const [wx1, wy1] = screenToWorld(vAfter, cssSize, e.offsetX, e.offsetY);
      setView((vv) => ({
        ...vv,
        zoom: newZoom,
        panX: vv.panX + (wx0 - wx1),
        panY: vv.panY + (wy0 - wy1),
        userInteracted: true,
      }));
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [setView]);

  // Touch: one finger pans, two fingers pinch-zoom toward the pinch midpoint, a
  // quick tap selects. Mirrors the mouse/wheel behaviour above (same follow
  // rules: a pan releases follow, a pinch keeps it) so tablets/phones get the
  // same map. preventDefault throughout stops the page from scrolling/zooming
  // AND suppresses the synthetic mouse events touch would otherwise emit, so the
  // two input paths never double-fire.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;

    const dist = (a: Touch, b: Touch) =>
      Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    // Canvas-local coords (mouse used offsetX/Y; touch has none, so derive it).
    const local = (t: Touch) => {
      const r = cv.getBoundingClientRect();
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };

    const t = touchRef;

    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      const st = useViewerStore.getState();
      if (e.touches.length === 1) {
        // A one-finger drag takes over the camera — release follow, committing
        // the rendered follow view so the pan continues from where it looked.
        if (st.followKey || st.followVehicleId) {
          st.setView(() => displayRef.current.view);
          st.setFollowKey(null); st.setFollowVehicleId(null);
        }
        const v = useViewerStore.getState().view;
        const p = local(e.touches[0]!);
        t.current = {
          mode: "pan",
          startX: e.touches[0]!.clientX, startY: e.touches[0]!.clientY,
          panX0: v.panX, panY0: v.panY,
          downX: p.x, downY: p.y, downT: performance.now(),
        };
      } else if (e.touches.length === 2) {
        // Pinch keeps follow (like wheel zoom): only the zoom level changes.
        t.current = {
          mode: "pinch",
          startDist: dist(e.touches[0]!, e.touches[1]!),
          startZoom: st.view.zoom,
        };
      }
    };

    const onMove = (e: TouchEvent) => {
      const cur = t.current;
      if (!cur) return;
      e.preventDefault();
      const cssSize = { width: cv.clientWidth, height: cv.clientHeight };

      if (cur.mode === "pinch" && e.touches.length >= 2) {
        const st = useViewerStore.getState();
        const ratio = dist(e.touches[0]!, e.touches[1]!) / Math.max(1, cur.startDist!);
        const newZoom = Math.max(0.2, Math.min(40, cur.startZoom! * ratio));
        if (st.followKey || st.followVehicleId) {
          setView((vv) => ({ ...vv, zoom: newZoom, userInteracted: true }));
          return;
        }
        // Anchor the zoom at the CURRENT midpoint so the world point under the
        // fingers stays put.
        const m0 = local(e.touches[0]!), m1 = local(e.touches[1]!);
        const mx = (m0.x + m1.x) / 2, my = (m0.y + m1.y) / 2;
        const v = st.view;
        const [wx0, wy0] = screenToWorld(v, cssSize, mx, my);
        const [wx1, wy1] = screenToWorld({ ...v, zoom: newZoom }, cssSize, mx, my);
        setView((vv) => ({
          ...vv, zoom: newZoom,
          panX: vv.panX + (wx0 - wx1), panY: vv.panY + (wy0 - wy1),
          userInteracted: true,
        }));
      } else if (cur.mode === "pan" && e.touches.length === 1) {
        const v = useViewerStore.getState().view;
        const win = viewWindow(v);
        const dx = e.touches[0]!.clientX - cur.startX!;
        const dy = e.touches[0]!.clientY - cur.startY!;
        setView((vv) => ({
          ...vv,
          panX: cur.panX0! - (dx / cv.clientWidth)  * win.w,
          panY: cur.panY0! - (dy / cv.clientHeight) * win.h,
          userInteracted: true,
        }));
      }
    };

    const onEnd = (e: TouchEvent) => {
      const cur = t.current;
      if (!cur) return;
      e.preventDefault();
      // A one-finger press that barely moved and ended quickly is a tap → select
      // whatever is under it, hit-testing the SAME delayed/interpolated frame the
      // renderer drew (displayRef), exactly like the mouse click path.
      if (cur.mode === "pan" && e.touches.length === 0) {
        const ch = e.changedTouches[0];
        if (ch) {
          const p = local(ch);
          const moved = Math.hypot(p.x - cur.downX!, p.y - cur.downY!);
          const elapsed = performance.now() - cur.downT!;
          if (moved <= 8 && elapsed < 500) {
            const { snap, view } = displayRef.current;
            const cssSize = { width: cv.clientWidth, height: cv.clientHeight };
            const [wx, wy] = screenToWorld(view, cssSize, cur.downX!, cur.downY!);
            const win = viewWindow(view);
            const worldRadius = 16 * (win.w / Math.max(1, cssSize.width));
            onClick(hitTest(snap, wx, wy, worldRadius));
          }
        }
      }
      // End the gesture once no fingers remain; a lingering finger after a pinch
      // just waits for the next touchstart rather than silently becoming a pan.
      if (e.touches.length === 0) t.current = null;
    };

    cv.addEventListener("touchstart", onStart, { passive: false });
    cv.addEventListener("touchmove", onMove, { passive: false });
    cv.addEventListener("touchend", onEnd, { passive: false });
    cv.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      cv.removeEventListener("touchstart", onStart);
      cv.removeEventListener("touchmove", onMove);
      cv.removeEventListener("touchend", onEnd);
      cv.removeEventListener("touchcancel", onEnd);
    };
  }, [setView, onClick]);

  // Hover (hit-test against latest snap)
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) { onHover(null, 0, 0); return; }
      // Hit-test against the SAME delayed/interpolated frame + view the
      // renderer drew, so hover lines up with what's on screen.
      const { snap, view } = displayRef.current;
      const cssSize = { width: cv.clientWidth, height: cv.clientHeight };
      const [wx, wy] = screenToWorld(view, cssSize, e.offsetX, e.offsetY);
      const win = viewWindow(view);
      const worldRadius = 12 * (win.w / Math.max(1, cssSize.width));
      const hit = hitTest(snap, wx, wy, worldRadius);
      onHover(hit, e.offsetX, e.offsetY);
    };
    cv.addEventListener("mousemove", onMove);
    cv.addEventListener("mouseleave", onLeave);
    return () => {
      cv.removeEventListener("mousemove", onMove);
      cv.removeEventListener("mouseleave", onLeave);
    };
  }, [onHover, onLeave]);

  // Keyboard: F to fit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rulerRef.current) {
        rulerRef.current = null;
        return;
      }
      if ((e.key === "f" || e.key === "F") &&
          !["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName ?? "")) {
        resetView();
        firstAutoFitRef.current = true;  // re-autoFit next frame
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resetView]);

  const style: CSSProperties = { width: "100%", height: "100%", display: "block" };
  return <canvas ref={canvasRef} id="map" style={style} />;
}
