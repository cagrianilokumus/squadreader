// Pure rendering — every draw function takes (ctx, snap, view, canvas)
// and emits pixels. No React, no store access. The map texture and
// icon helpers do their own caching; everything else is per-frame.

import type { CapGeometry, Deployable, Player, Snapshot, Vehicle, ViewState } from "../state/types";
import {
  drawIcon, drawIconCentered, deployableIconUrl, icon, iconBbox, mapTexture,
  markerIconUrl, roleIconUrl, tintedIcon, colorizedIcon, vehicleIconUrl,
  vehicleTurretIconUrl, factionFlagUrl,
} from "./icons";
import { drawProjectilesAndImpacts } from "./projectiles";
import { coord, viewWindow, worldToScreen } from "./worldToScreen";
import { visibleCaps } from "./capVisibility";

export function teamColor(t: number | null | undefined): string {
  if (t === 1) return "#d84a54";
  if (t === 2) return "#5aa0e0";
  return "#9aa7b8";
}

// Best display name for a cap zone: SquadCalc's readable name only ("Niva
// Lower", "Train Station") — no live lane-letter prefix. Without a static match
// we fall back to the live name, stripping any UE class suffix AND the lane
// prefix ("E1-TrainStation" → "TrainStation") so no "E1/E2" leader is shown.
export function capLabel(
  cz: { name?: string | null; staticName?: string | null },
): string {
  const stat = cz.staticName;
  if (stat) return stat;
  return (cz.name ?? "")
    .replace(/-BP_[A-Za-z0-9_]+$/, "")
    .replace(/^[A-Za-z0-9]+-/, "");
}

interface CanvasSize { width: number; height: number; cssWidth: number; cssHeight: number; dpr: number; }

function drawMapTexture(ctx: CanvasRenderingContext2D, snap: Snapshot,
                        view: ViewState, cs: CanvasSize): boolean {
  const layer = snap.gameState?.layer ?? null;
  const tl = layer ? coord(layer.topLeft) : null;
  const br = layer ? coord(layer.bottomRight) : null;
  if (!layer?.texture || !tl || !br) return false;
  const img = mapTexture(layer.texture);
  if (img._failed || !img.complete || img.naturalWidth === 0) return false;
  const [x0, y0] = worldToScreen(view, cs, tl[0], tl[1]);
  const [x1, y1] = worldToScreen(view, cs, br[0], br[1]);
  const left = Math.min(x0, x1), top = Math.min(y0, y1);
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  ctx.drawImage(img, left, top, w, h);
  return true;
}

function drawGrid(ctx: CanvasRenderingContext2D, view: ViewState, cs: CanvasSize) {
  ctx.save();
  ctx.strokeStyle = "#1a2230";
  ctx.lineWidth = 1 * cs.dpr;
  const step = 10000;
  const startX = Math.floor(view.minX / step) * step;
  const endX   = Math.ceil(view.maxX / step) * step;
  const startY = Math.floor(view.minY / step) * step;
  const endY   = Math.ceil(view.maxY / step) * step;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    const [sx] = worldToScreen(view, cs, x, 0);
    ctx.moveTo(sx, 0); ctx.lineTo(sx, cs.height);
  }
  for (let y = startY; y <= endY; y += step) {
    const [, sy] = worldToScreen(view, cs, 0, y);
    ctx.moveTo(0, sy); ctx.lineTo(cs.width, sy);
  }
  ctx.stroke();
  ctx.restore();
}

// AAS / RAAS lane graph — solid lines connecting capture zones in
// the order they must be captured. Drawn under the cap badges so the
// flag visuals sit on top of the line endpoints. Double-stroked
// (dark halo + bright top line) for legibility on every map tile
// colour.
function drawLane(ctx: CanvasRenderingContext2D, snap: Snapshot,
                  view: ViewState, cs: CanvasSize) {
  const lane = snap.gameState?.lane;
  if (!lane?.edges?.length) return;
  // Lane nodes in Squad v10 are BP_CaptureZoneCluster actors, NOT the
  // BP_CaptureZone_C instances in captureZones[]. The cluster's own
  // RootComponent sits 50-100 m off the cap badge, so using its raw
  // world position makes the lane "miss" every flag.
  //
  // Both classes share a name prefix though — e.g. "A1-…Cluster" and
  // "A1-NorthOrchard". We extract that prefix and snap each lane
  // endpoint to its matching cap zone's position. Team mains
  // ("00-Team1Main" / "Z-Team2Main") have no cap-zone twin, so we
  // fall back to the cluster's own position for those.
  const prefixOf = (n: string | null | undefined): string => {
    if (!n) return "";
    const m = /^([^-]+)-/.exec(n);
    return m ? m[1]!.toUpperCase() : n.toUpperCase();
  };
  // A lane node can hold MORE THAN ONE cap (e.g. two "B5" flags at the same
  // depth — Gorodok RAAS v2 "B5-NivaLower" + "B5-TrainBridge"). Keep EVERY cap
  // per prefix, not just the last: a single-value map lets the line snap to one
  // flag and visibly miss the other (the reported "line and cap in different
  // places" bug).
  const capsByPrefix = new Map<string, { x: number; y: number }[]>();
  for (const cz of snap.captureZones ?? []) {
    if (cz.name && cz.position) {
      const k = prefixOf(cz.name);
      let arr = capsByPrefix.get(k);
      if (!arr) { arr = []; capsByPrefix.set(k, arr); }
      // Same SquadCalc anchor the badge uses (falls back to RAM position) so
      // the lane threads through the flags exactly where they're drawn.
      arr.push(cz.staticPosition ?? cz.position);
    }
  }
  const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const allCaps = [...capsByPrefix.values()].flat();
  // A no-cap node whose cluster sits right on top of a flag is an unrevealed
  // RAAS objective overlapping its neighbour — snap it there so the line
  // doesn't dip through the (unreliable, up to ~360 m off) cluster point.
  // Mains sit far from every flag (~700 m here), so they never snap and keep
  // their reliable cluster position as the lane's endpoints. 150 m separates
  // the two cleanly.
  const NEAR_CAP_SNAP_CM = 15000;
  const snapToNearCap = (pos: { x: number; y: number }) => {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const c of allCaps) { const d = dist2(c, pos); if (d < bd) { bd = d; best = c; } }
    return best && bd <= NEAR_CAP_SNAP_CM ** 2 ? best : null;
  };
  // Resolve a lane endpoint to the cap of its prefix nearest `toward` (the
  // segment's other end) so each edge hits the flag in its direction of travel.
  const resolve = (
    name: string | null | undefined,
    fallback: { x: number; y: number } | null | undefined,
    toward: { x: number; y: number } | null | undefined,
  ): { x: number; y: number } | null => {
    const caps = capsByPrefix.get(prefixOf(name));
    if (caps && caps.length) {
      if (caps.length === 1 || !toward) return caps[0]!;
      let best = caps[0]!, bd = dist2(best, toward);
      for (const c of caps) { const d = dist2(c, toward); if (d < bd) { bd = d; best = c; } }
      return best;
    }
    if (fallback) {
      const near = snapToNearCap(fallback);
      if (near) return near;   // unrevealed intermediate node → snap onto flag
    }
    return fallback ?? null;    // main base, or no flag nearby → cluster position
  };
  const segs: number[][] = [];
  const pushSeg = (a: { x: number; y: number } | null,
                   b: { x: number; y: number } | null) => {
    if (!a || !b) return;
    if (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1) return;  // zero-length
    const [ax, ay] = worldToScreen(view, cs, a.x, a.y);
    const [bx, by] = worldToScreen(view, cs, b.x, b.y);
    segs.push([ax, ay, bx, by]);
  };
  for (const e of lane.edges) {
    pushSeg(resolve(e.from, e.fromPos, e.toPos),
            resolve(e.to, e.toPos, e.fromPos));
  }
  // Thread the line through EVERY flag of a multi-cap node: link its caps in a
  // nearest-neighbour chain so both flags sit on the lane, not just one.
  for (const caps of capsByPrefix.values()) {
    if (caps.length < 2) continue;
    const remaining = caps.slice();
    let cur = remaining.shift()!;
    while (remaining.length) {
      let bi = 0, bd = dist2(cur, remaining[0]!);
      for (let i = 1; i < remaining.length; i++) {
        const d = dist2(cur, remaining[i]!); if (d < bd) { bd = d; bi = i; }
      }
      const nxt = remaining.splice(bi, 1)[0]!;
      pushSeg(cur, nxt);
      cur = nxt;
    }
  }
  if (!segs.length) return;

  ctx.save();
  ctx.lineCap = "round";
  // (1) Dark halo underneath for terrain legibility.
  ctx.lineWidth = 5 * cs.dpr;
  ctx.strokeStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  for (const [ax, ay, bx, by] of segs) {
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  }
  ctx.stroke();
  // (2) Bright top line — slightly transparent white so the cap
  //     badges visibly sit "on top" of the lane.
  ctx.lineWidth = 2.5 * cs.dpr;
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.beginPath();
  for (const [ax, ay, bx, by] of segs) {
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  }
  ctx.stroke();
  ctx.restore();
}

// Draw a cap zone's real footprint from static SquadCalc geometry (sphere /
// box / capsule), centred on `center` (world-cm). Ported from Squad-Replay's
// flags.js drawFlagCircles shape branch.
//
// Scale: pxPerWorld = cs.width / viewWindow(view).w is the TRUE zoom-aware,
// isotropic device-px-per-world-cm factor (worldToScreen divides by the same
// v.w and multiplies by cs.width). Do NOT use drawCaps' clamped ring factor —
// that one ignores zoom on purpose so the fixed badge ring never balloons; a
// real footprint must scale with the map.
//
// Rotation: `rot` is a world-space yaw in degrees. worldToScreen maps world +Y
// straight to screen +Y (NO flip — see worldToScreen.ts), so a positive world
// yaw is a positive screen-space rotation and we rotate the canvas by +rot
// directly. If a Y-flip were ever added to the projection this would need to
// negate, hence the explicit note.
function drawCapGeometry(
  ctx: CanvasRenderingContext2D, view: ViewState, cs: CanvasSize,
  center: { x: number; y: number }, geometry: CapGeometry[],
  opts: { stroke: string; fill: string; dashed: boolean; fillAlpha?: number },
) {
  const pxPerWorld = cs.width / (viewWindow(view).w || 1);
  const fillAlpha = opts.fillAlpha ?? 0.2;
  const lw = 2 * cs.dpr;
  const dash: number[] = opts.dashed ? [6 * cs.dpr, 4 * cs.dpr] : [];
  for (const g of geometry) {
    const [sx, sy] = worldToScreen(view, cs, center.x + g.dx, center.y + g.dy);
    ctx.save();
    ctx.strokeStyle = opts.stroke;
    ctx.fillStyle = opts.fill;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash);
    if (g.type === "sphere") {
      const r = g.radius * pxPerWorld;
      if (r < 2) { ctx.restore(); continue; }
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, 2 * Math.PI);
    } else if (g.type === "box") {
      const hw = g.extX * pxPerWorld, hh = g.extY * pxPerWorld;
      if (hw < 2 && hh < 2) { ctx.restore(); continue; }
      ctx.translate(sx, sy);
      if (g.rot) ctx.rotate((g.rot * Math.PI) / 180);
      ctx.beginPath();
      ctx.rect(-hw, -hh, hw * 2, hh * 2);
    } else {
      // capsule — stadium along local Y, halfLen = (length - radius), matching
      // flags.js (SquadCalc `length` is the capsule half-height).
      const r = g.radius * pxPerWorld;
      const halfLen = (g.length - g.radius) * pxPerWorld;
      if (r < 2) { ctx.restore(); continue; }
      ctx.translate(sx, sy);
      if (g.rot) ctx.rotate((g.rot * Math.PI) / 180);
      ctx.beginPath();
      ctx.arc(0, -halfLen, r, Math.PI, 0);   // top cap
      ctx.lineTo(r, halfLen);
      ctx.arc(0, halfLen, r, 0, Math.PI);    // bottom cap
      ctx.closePath();
    }
    ctx.globalAlpha = fillAlpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.restore();
  }
}

// Capture zone — rendered like the in-game flag pole HUD:
//   * dashed influence circle around the cap centre
//   * flag-shaped rectangle with the OWNING team's faction code on it
//   * capture-progress arc wrapping the badge
//   * cap name label below the flag
//   * small lock badge top-right corner when isLocked
// Faction code (e.g. AFU, TLF, USA, RUS) comes from
// `snap.teams[].factionId`; the team's `id` matches `cz.owningTeam`.
// RAAS fallback: on RAAS maps the capturable objectives are
// BP_CaptureZoneCluster actors, which the backend doesn't emit into
// captureZones[] (it reads BP_CaptureZone_C, an AAS-era class). But the
// lane graph DOES carry each cluster's name + world position, so when
// captureZones is empty we synthesize cap markers from the lane nodes —
// otherwise only the connecting lines show and the objectives are
// invisible (the reported bug).
function drawLaneNodeCaps(ctx: CanvasRenderingContext2D, snap: Snapshot,
                          view: ViewState, cs: CanvasSize) {
  const lane = snap.gameState?.lane;
  if (!lane?.edges?.length) return;

  const nodes = new Map<string, { label: string;
    pos: { x: number; y: number }; team: number | null }>();
  const add = (name: string | null | undefined,
               pos: { x: number; y: number } | null | undefined) => {
    if (!name || !pos) return;
    const key = name.toUpperCase();
    if (nodes.has(key)) return;
    let label = name.replace(/-?BP_CaptureZoneCluster$/i, "")
                    .replace(/-?Cluster$/i, "");
    let team: number | null = null;
    const m = /Team\s*([12])\s*Main/i.exec(name);
    if (m) { team = Number(m[1]); label = `T${team} Main Base`; }
    else { label = label.replace(/-/g, " ").trim(); }
    nodes.set(key, { label, pos, team });
  };
  for (const e of lane.edges) { add(e.from, e.fromPos); add(e.to, e.toPos); }

  // Static SquadCalc geometry resolved onto this lane server-side, keyed by
  // node name (uppercased to match the node map). RAAS carries no per-flag
  // ownership, so non-main objectives draw neutral — this shows WHERE the
  // objective is and its SHAPE, not who holds it. The static anchor is also
  // the ACCURATE flag position (the live cluster actor sits 50-100 m off the
  // real flag), so when matched we recentre the diamond onto it too.
  const staticByName = new Map<string,
    { geo: CapGeometry[]; pos: { x: number; y: number } | null;
      name: string | null }>();
  for (const o of lane.staticObjectives ?? []) {
    if (o.name && o.geometry?.length) {
      staticByName.set(o.name.toUpperCase(),
        { geo: o.geometry, pos: o.position ?? null, name: o.staticName ?? null });
    }
  }

  for (const [key, node] of nodes.entries()) {
    const { team } = node;
    const col = team != null ? teamColor(team) : "#c9d3e0";
    const match = staticByName.get(key);
    // Prefer SquadCalc's readable name for non-main objectives ("Niva Lower",
    // no lane prefix); mains keep their "T1 Ana Üs" label.
    const label = (match?.name && team == null) ? match.name : node.label;
    const pos = match?.pos ?? node.pos;      // prefer the accurate static anchor
    const [x, y] = worldToScreen(view, cs, pos.x, pos.y);
    if (match) {
      drawCapGeometry(ctx, view, cs, { x: pos.x, y: pos.y }, match.geo,
        { stroke: col, fill: col, dashed: false, fillAlpha: 0.16 });
    }
    const r = 13 * cs.dpr;
    const diamond = () => {
      ctx.beginPath();
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    };
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = r * 0.7; ctx.shadowOffsetY = r * 0.12;
    diamond(); ctx.fillStyle = col; ctx.fill();
    ctx.restore();
    diamond();
    ctx.lineWidth = 1.6 * cs.dpr;
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r * 0.34, 0, 2 * Math.PI);
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();

    if (label) {
      const f = Math.max(11, Math.round(11 * cs.dpr));
      ctx.font = `bold ${f}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      const ly = y + r + 3 * cs.dpr;
      ctx.lineWidth = Math.max(2.5, f * 0.28);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(label, x, ly);
      ctx.fillStyle = "#ffffff"; ctx.fillText(label, x, ly);
    }
  }
}

function drawCaps(ctx: CanvasRenderingContext2D, snap: Snapshot,
                  view: ViewState, cs: CanvasSize) {
  // No real BP_CaptureZone_C instances (RAAS map) → derive markers from
  // the lane graph's cluster nodes so the objectives are still visible.
  if (!(snap.captureZones ?? []).length) {
    drawLaneNodeCaps(ctx, snap, view, cs);
    return;
  }
  // Build owner-team → faction-code lookup once per frame.
  const factionByTeam: Record<number, string> = {};
  for (const t of snap.teams ?? []) {
    if (t.id != null && t.factionId) {
      factionByTeam[t.id] = t.factionId.toUpperCase();
    }
  }
  // Faction codes are sometimes longer than the flag area; map common
  // overflows to their compact abbreviations.
  const compact = (code: string): string => {
    // Neutral / unknown owner (no faction code) draws NO glyph — just the plate
    // — instead of a literal "?". A revealed neutral objective should read as an
    // empty flag, not a broken marker.
    if (!code) return "";
    if (code.length <= 4) return code;
    // e.g. "Militia" → "MIL", "Marines" → "MAR"
    return code.slice(0, 3);
  };

  // Influence circle radius in world units. ~75 m is the typical
  // Squad cap radius; we approximate by scaling against view bounds.
  const worldW = (view.maxX - view.minX) || 1;
  const pxPerWorld = cs.width / worldW;
  const ringR = 7500 * pxPerWorld;  // 75 m × 100 cm/m = 7500 cm world units

  // Fog of war: hide the RAAS pre-roll cloud. At match start Squad replicates
  // EVERY lane's objectives as locked + neutral capture zones (~40), burying
  // the map under grey "?" flags. visibleCaps() drops the dormant candidates
  // while a whole cloud of them is present and reveals each the instant it is
  // in play; once the lane resolves, the few upcoming (still-locked) flags on
  // the active route stay visible. See ./capVisibility. (Replaces the old
  // global laneDecided gate, which the first shared objective unlocking at
  // ~0:06 defeated — un-hiding all 40 candidates.)
  for (const cz of visibleCaps(snap.captureZones ?? [])) {
    if (!cz.position) continue;
    // Placement (badge + shape + name) is anchored to SquadCalc's static
    // position when we have a match — the canonical, corruption-proof flag
    // location — falling back to the live RAM position. Only the DYNAMIC state
    // read below (owner, capture %, lock, advantage) comes from RAM. This is
    // the two-source split: SquadCalc = where/what, RAM = live state.
    const anchor = cz.staticPosition ?? cz.position;
    const [x, y] = worldToScreen(view, cs, anchor.x, anchor.y);
    const ownTeam = cz.owningTeam;
    const ownColor = teamColor(ownTeam);
    const capColor = teamColor(cz.capturingTeam ?? cz.owningTeam);

    // (1) Cap footprint. With static SquadCalc geometry we draw the REAL
    //     shape(s) — the actual capturable area — in the live ownership colour.
    //     Without it we fall back to the clamped dashed influence ring.
    const contested = (cz.capturingTeam ?? 0) > 0
      && cz.capturingTeam !== cz.owningTeam;
    if (cz.geometry?.length) {
      const col = contested ? capColor : ownColor;
      drawCapGeometry(ctx, view, cs, { x: anchor.x, y: anchor.y }, cz.geometry,
        { stroke: col, fill: col, dashed: !!cz.isLocked,
          fillAlpha: contested ? 0.25 : 0.18 });
    } else {
      const ringPx = Math.max(28 * cs.dpr, Math.min(ringR, 180 * cs.dpr));
      ctx.save();
      ctx.setLineDash([6 * cs.dpr, 5 * cs.dpr]);
      ctx.lineWidth = 1.5 * cs.dpr;
      ctx.strokeStyle = ownColor;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(x, y, ringPx, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    // (2) Capture progress arc, drawn just outside the flag badge.
    const badgeW = 40 * cs.dpr;
    const badgeH = 26 * cs.dpr;   // ~3:2 flag proportions; the 2:1 art is cover-fit (cropped, never stretched)
    const arcR  = Math.max(badgeW, badgeH) * 0.62;
    if (cz.capturePercent != null && cz.capturePercent > 0
        && cz.capturePercent < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, arcR, -Math.PI / 2,
              -Math.PI / 2 + 2 * Math.PI * cz.capturePercent);
      ctx.lineWidth = 3 * cs.dpr;
      ctx.strokeStyle = capColor;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.restore();
    }

    // (3) Flag-shaped rounded rectangle with drop shadow. The badge is a
    //     team-coloured plate; when we have the owning faction's flag art we
    //     lay it on top, otherwise we fall back to the faction code text.
    const bx = x - badgeW / 2;
    const by = y - badgeH / 2;
    const rad = 4 * cs.dpr;
    const flagUrl = factionFlagUrl(factionByTeam[ownTeam ?? -1]);
    const flagImg = flagUrl ? icon(flagUrl) : null;
    const flagReady = !!(flagImg && flagImg.complete && flagImg.naturalWidth > 0);

    ctx.save();
    ctx.shadowColor   = "rgba(0,0,0,0.55)";
    ctx.shadowBlur    = badgeW * 0.18;
    ctx.shadowOffsetY = badgeW * 0.04;
    roundRectPath(ctx, bx, by, badgeW, badgeH, rad);
    ctx.fillStyle = ownColor;
    ctx.fill();
    ctx.restore();

    if (flagReady) {
      // (4a) Faction flag, COVER-fit into the badge and clipped: the 2:1 art is
      //      scaled to fill the ~3:2 badge and the side overflow is cropped —
      //      never stretched — so the flag keeps its true proportions.
      ctx.save();
      roundRectPath(ctx, bx, by, badgeW, badgeH, rad);
      ctx.clip();
      const iw = flagImg!.naturalWidth, ih = flagImg!.naturalHeight;
      const k = Math.max(badgeW / iw, badgeH / ih);
      const dw = iw * k, dh = ih * k;
      ctx.drawImage(flagImg!, x - dw / 2, y - dh / 2, dw, dh);
      ctx.restore();
    } else {
      // (4b) No flag art → shaded bottom hem so the badge still reads as a flag.
      ctx.save();
      roundRectPath(ctx, bx, by, badgeW, badgeH, rad);
      ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(bx, by + badgeH * 0.62, badgeW, badgeH * 0.38);
      ctx.restore();
    }

    // (5) Border — team-coloured when a flag fills the badge (ownership stays
    //     obvious without the team-colour fill), else a neutral white hairline.
    roundRectPath(ctx, bx, by, badgeW, badgeH, rad);
    ctx.lineWidth = (flagReady ? 2 : 1) * cs.dpr;
    ctx.strokeStyle = flagReady ? ownColor : "rgba(255,255,255,0.55)";
    ctx.stroke();

    // (6) Faction code centred — only when there's no flag art for this faction.
    if (!flagReady) {
      const fcode = compact(factionByTeam[ownTeam ?? -1] ?? "");
      if (fcode) {
        const fontPx = Math.max(10, Math.round(11 * cs.dpr));
        ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = Math.max(2, fontPx * 0.22);
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.strokeText(fcode, x, y);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(fcode, x, y);
      }
    }

    // (7) Cap name label directly under the badge.
    const name = capLabel(cz);
    if (name) {
      const nameFont = Math.max(11, Math.round(11 * cs.dpr));
      ctx.font = `bold ${nameFont}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ly = by + badgeH + 3 * cs.dpr;
      ctx.lineWidth = Math.max(2.5, nameFont * 0.28);
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(name, x, ly);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(name, x, ly);
    }

    // (8) Lock badge — small dark circle with a stylised padlock glyph.
    if (cz.isLocked) {
      const lkR = 7 * cs.dpr;
      const lkx = bx + badgeW - lkR * 0.4;
      const lky = by + lkR * 0.4;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      ctx.arc(lkx, lky, lkR, 0, 2 * Math.PI);
      ctx.fillStyle = "#0e1116";
      ctx.fill();
      ctx.lineWidth = 1 * cs.dpr;
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.stroke();
      ctx.restore();
      // Simple padlock shape: shackle + body.
      ctx.save();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2 * cs.dpr;
      // Shackle (arc)
      ctx.beginPath();
      ctx.arc(lkx, lky - 1 * cs.dpr, 2.2 * cs.dpr, Math.PI, 0);
      ctx.stroke();
      // Body (rect)
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(lkx - 2.5 * cs.dpr, lky + 0.5 * cs.dpr,
                   5 * cs.dpr, 3.5 * cs.dpr);
      ctx.restore();
    }
  }
}

// Helper: roundRect path on canvas (Edge < 99 doesn't ship Path.roundRect,
// safer to draw manually).
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number,
                       w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// Tactical badge for FOB / HAB / mine / ammo crate — same palette as
// the player + vehicle markers (solid team-coloured disc + dark inner
// + drop shadow + hairline bezel). Stock Squad deployable art is the
// usual grey outline style, so the icon is drawn un-tinted (white
// source-in tint would haze the interior — same problem we hit with
// vehicle outlines). FOBs get a slightly thicker bezel as a hierarchy
// cue: they're the key landmark on the map.
function drawDeployableBadge(ctx: CanvasRenderingContext2D,
                             cx: number, cy: number,
                             iconSize: number, teamCol: string,
                             img: CachedImageLike,
                             emphasis: boolean) {
  const rOuter = iconSize * 0.50;
  const rInner = iconSize * 0.41;

  // (1) Drop shadow + solid team-coloured disc
  ctx.save();
  ctx.shadowColor    = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur     = iconSize * 0.18;
  ctx.shadowOffsetY  = iconSize * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
  ctx.fillStyle = teamCol;
  ctx.fill();
  ctx.restore();

  // (2) Dark inner screen
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.fillStyle = "#13171F";
  ctx.fill();

  // (3) Bezel — thicker for FOBs to mark them as key landmarks
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.strokeStyle = emphasis
    ? "rgba(255, 255, 255, 0.22)"
    : "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = emphasis
    ? Math.max(1, iconSize * 0.035)
    : Math.max(1, iconSize * 0.02);
  ctx.stroke();

  // (4) Deployable silhouette — un-tinted (grey on dark reads cleanly
  // for outline-style icons), sized to fill most of the inner disc.
  drawIcon(ctx, img, cx, cy, rInner * 1.55, {});
}

// FOB build / influence radii, drawn under the FOB badge so they don't
// overlap the iconography. Squad's actual numbers:
//   150 m — enemy-build-block radius (no enemy FOB can dig inside this)
//   400 m — territorial / influence zone
// Squad world units are cm.
function drawFobRadii(ctx: CanvasRenderingContext2D, snap: Snapshot,
                      view: ViewState, cs: CanvasSize) {
  for (const d of snap.deployables ?? []) {
    if (!d.isFob || !d.position) continue;
    const [cx, cy] = worldToScreen(view, cs, d.position.x, d.position.y);
    // Project a point 1 unit east of the FOB to get the px/cm ratio at
    // current zoom — works even if the view transform isn't isotropic.
    const [ex, _ey] = worldToScreen(view, cs,
      d.position.x + 100, d.position.y);  // 100 cm = 1 m baseline
    const pxPerMeter = Math.abs(ex - cx);
    const rInner = 150 * pxPerMeter;
    const rOuter = 400 * pxPerMeter;
    const tc = teamColor(d.team);

    // Inner build radius — soft filled disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
    ctx.fillStyle = tc;
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5 * cs.dpr;
    ctx.strokeStyle = tc;
    ctx.stroke();
    ctx.restore();

    // Outer influence — dashed ring
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
    ctx.setLineDash([10 * cs.dpr, 7 * cs.dpr]);
    ctx.lineWidth = 2.5 * cs.dpr;
    ctx.strokeStyle = tc;
    ctx.globalAlpha = 0.85;
    ctx.stroke();
    ctx.restore();
  }
}

function drawDeployables(ctx: CanvasRenderingContext2D, snap: Snapshot,
                         view: ViewState, cs: CanvasSize) {
  for (const d of snap.deployables ?? []) {
    if (!d.position) continue;
    const [x, y] = worldToScreen(view, cs, d.position.x, d.position.y);
    const url = deployableIconUrl(d);
    // FOB+HAB are the key landmarks (bigger badge, emphasis bezel).
    // Other deployables (mines, ammo crates, repair stations) get the
    // same badge wrapper but smaller and without the emphasis bezel.
    const isHab = !d.isFob
      && (d.classShort ?? "").toUpperCase().includes("HAB");
    const emphasis = !!(d.isFob || isHab);
    const sizeCss = d.isFob ? 30 : isHab ? 28 : 22;
    const size = sizeCss * cs.dpr;
    const img = url ? icon(url) : null;
    const ready = !!(img && img.complete && img.naturalWidth > 0);

    if (ready) {
      drawDeployableBadge(ctx, x, y, size, teamColor(d.team), img!, emphasis);
      if (d.isFob) drawFobResourceLabel(ctx, d, x, y, size, cs);
      continue;
    }
    // Fallback while the icon warms up (or for deployable kinds we
    // don't have art for): square chip, FOB white-bordered.
    const s = d.isFob ? 9 * cs.dpr : 5 * cs.dpr;
    ctx.fillStyle = teamColor(d.team);
    ctx.fillRect(x - s / 2, y - s / 2, s, s);
    if (d.isFob) {
      ctx.lineWidth = 1.5 * cs.dpr;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      drawFobResourceLabel(ctx, d, x, y, s, cs);
    }
  }
}

// Resource pill under a FOB radio: [ammo-icon NN]  [build-icon NN].
// Same urgency ramp on border + text as the full label — green by
// default, amber on bleeding, red on sieged.
function drawFobResourceLabel(ctx: CanvasRenderingContext2D,
                              d: Deployable, x: number, y: number,
                              badgeSize: number, cs: CanvasSize) {
  const ammo = d.ammo;
  const con  = d.construction;
  if (ammo == null && con == null) return;
  const fmt = (n: number | null | undefined) =>
    n == null ? "—" : String(Math.round(n));
  const ammoTxt = fmt(ammo);
  const conTxt  = fmt(con);

  const fontSize = 11 * cs.dpr;
  const iconSize = 13 * cs.dpr;
  const gap      = 3 * cs.dpr;  // icon → number
  const colGap   = 8 * cs.dpr;  // ammo group → construction group

  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const ammoW = ctx.measureText(ammoTxt).width;
  const conW  = ctx.measureText(conTxt).width;

  const padX = 6 * cs.dpr;
  const padY = 3 * cs.dpr;
  const innerW = iconSize + gap + ammoW + colGap + iconSize + gap + conW;
  const w = innerW + padX * 2;
  const h = Math.max(iconSize, fontSize) + padY * 2;
  const lx = x - w / 2;
  const ly = y + badgeSize * 0.55 + 4 * cs.dpr;
  const rad = 3 * cs.dpr;

  // Background pill — dark, team-coloured (or urgency-coloured) border.
  ctx.beginPath();
  ctx.moveTo(lx + rad, ly);
  ctx.lineTo(lx + w - rad, ly);
  ctx.arcTo(lx + w, ly, lx + w, ly + rad, rad);
  ctx.lineTo(lx + w, ly + h - rad);
  ctx.arcTo(lx + w, ly + h, lx + w - rad, ly + h, rad);
  ctx.lineTo(lx + rad, ly + h);
  ctx.arcTo(lx, ly + h, lx, ly + h - rad, rad);
  ctx.lineTo(lx, ly + rad);
  ctx.arcTo(lx, ly, lx + rad, ly, rad);
  ctx.closePath();
  ctx.fillStyle = "rgba(15,18,22,0.88)";
  ctx.fill();
  ctx.lineWidth = 1 * cs.dpr;
  ctx.strokeStyle = d.fobSieged ? "#ff3b3b"
                  : d.fobBleeding ? "#f5b21f"
                  : teamColor(d.team);
  ctx.stroke();

  const cy = ly + h / 2;
  let cursor = lx + padX;

  // Ammo icon + number.
  const ammoImg = icon("./icons/general/supplies_ammo_square.png");
  drawIcon(ctx, ammoImg, cursor + iconSize / 2, cy, iconSize);
  cursor += iconSize + gap;
  ctx.fillStyle = d.fobSieged ? "#ff7878"
                : d.fobBleeding ? "#ffce5a"
                : "#ffffff";
  ctx.fillText(ammoTxt, cursor, cy + 0.5 * cs.dpr);
  cursor += ammoW + colGap;

  // Construction icon + number.
  const conImg = icon("./icons/general/supplies_construction_square.png");
  drawIcon(ctx, conImg, cursor + iconSize / 2, cy, iconSize);
  cursor += iconSize + gap;
  ctx.fillText(conTxt, cursor, cy + 0.5 * cs.dpr);
}

function drawSpawners(ctx: CanvasRenderingContext2D, snap: Snapshot,
                      view: ViewState, cs: CanvasSize) {
  for (const sp of snap.vehicleSpawners ?? []) {
    if (!sp.position) continue;
    const [x, y] = worldToScreen(view, cs, sp.position.x, sp.position.y);
    const r = 6 * cs.dpr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.lineWidth = 1.2 * cs.dpr;
    ctx.strokeStyle = teamColor(sp.team);
    ctx.globalAlpha = sp.spawnerEnabled ? 1 : 0.4;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

// Vehicle marker: solid team-coloured disc with a dark inner screen and
// the original vehicle silhouette (rotated by yaw) on top. Vehicle PNGs
// are kept un-tinted — Squad's stock art uses semi-transparent inner
// shading inside the outer hull stroke, and a source-in white tint
// promoted those faint pixels to bright white, making outline-style
// hulls look filled. Drawing the raw grey art preserves the
// outline-with-shadowed-detail look the source artists intended.
function drawVehicleBadge(ctx: CanvasRenderingContext2D,
                          cx: number, cy: number,
                          yawIcon: number, iconSize: number,
                          teamCol: string,
                          vehImg: CachedImageLike,
                          turretImg?: CachedImageLike | null,
                          turretYawIcon?: number) {
  const rOuter = iconSize * 0.50;
  const rInner = iconSize * 0.41;

  // (1) Drop shadow + solid team-coloured disc
  ctx.save();
  ctx.shadowColor    = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur     = iconSize * 0.18;
  ctx.shadowOffsetY  = iconSize * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
  ctx.fillStyle = teamCol;
  ctx.fill();
  ctx.restore();

  // (2) Dark inner screen (kept — matches the player-badge palette)
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.fillStyle = "#13171F";
  ctx.fill();

  // (3) Hairline bezel highlight for inner-edge separation
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth   = Math.max(1, iconSize * 0.02);
  ctx.stroke();

  // (4)+(5) Vehicle silhouette, plus an optional independently-rotating
  // turret layer for tanks / IFVs.
  const iconSpan = rInner * 1.55;
  const hasTurret = !!(turretImg && turretImg.complete
      && turretImg.naturalWidth > 0 && typeof turretYawIcon === "number");
  if (hasTurret) {
    // Matched base+turret pair: register both by IMAGE CENTRE at one shared
    // pixels-per-unit (derived from the hull's bbox so on-screen weight matches
    // the other icons), then rotate the turret about that centre = the ring
    // pivot. Per-image bbox centring (drawIcon) misplaced the turret because
    // the barrel skews its bbox centre off the ring.
    const bb = iconBbox(vehImg);
    const ppu = bb ? iconSpan / Math.max(bb.w, bb.h)
                   : iconSpan / Math.max(1, vehImg.naturalWidth);
    drawIconCentered(ctx, vehImg, cx, cy, ppu, yawIcon);
    drawIconCentered(ctx, turretImg!, cx, cy, ppu, turretYawIcon!);
  } else {
    // drawIcon handles bbox-aware aspect-ratio-preserving scaling, so wide
    // helis and tall MBTs both fit cleanly inside the inner disc.
    drawIcon(ctx, vehImg, cx, cy, iconSpan, { rotate: yawIcon });
  }
}

// A squad leader — the role FName carries the `_SL_` token (crewman / pilot
// SL variants included). Mirrors the SL match in icons.ts:roleIconUrl.
function isSquadLeader(p: { roleId: string | null }): boolean {
  const rid = (p.roleId ?? "").toLowerCase();
  return rid.includes("_sl_") || rid.endsWith("_sl");
}

// Small rounded pill showing a number, centred horizontally at `cx` with its
// TOP edge at `topY`. Dark fill + team-coloured border + white text — the same
// visual treatment as the rally-point squad label so the map reads uniformly.
function drawNumberBadge(ctx: CanvasRenderingContext2D, cx: number, topY: number,
                         text: string, borderCol: string, fontSize: number,
                         cs: CanvasSize) {
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const m = ctx.measureText(text);
  const padX = 5 * cs.dpr;
  const padY = 2 * cs.dpr;
  const w = Math.max(m.width + padX * 2, fontSize + padX * 2);
  const h = fontSize + padY * 2;
  const lx = cx - w / 2;
  const ly = topY;
  const rad = 3 * cs.dpr;
  ctx.beginPath();
  ctx.moveTo(lx + rad, ly);
  ctx.lineTo(lx + w - rad, ly);
  ctx.arcTo(lx + w, ly, lx + w, ly + rad, rad);
  ctx.lineTo(lx + w, ly + h - rad);
  ctx.arcTo(lx + w, ly + h, lx + w - rad, ly + h, rad);
  ctx.lineTo(lx + rad, ly + h);
  ctx.arcTo(lx, ly + h, lx, ly + h - rad, rad);
  ctx.lineTo(lx, ly + rad);
  ctx.arcTo(lx, ly, lx + rad, ly, rad);
  ctx.closePath();
  ctx.fillStyle = "rgba(15,18,22,0.88)";
  ctx.fill();
  ctx.lineWidth = 1 * cs.dpr;
  ctx.strokeStyle = borderCol;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, cx, ly + h / 2 + 0.5 * cs.dpr);
}

// A vehicle carries no squad of its own, so its "number" is derived from the
// crew: the driver's squad (seat idx 0), falling back to the lowest-index
// crewed seat. Returns null for an empty vehicle or an unsquadded crew.
function vehicleSquadNumber(v: Vehicle,
                           eosSquad: Map<string, number>): number | null {
  const seats = [...(v.seats ?? [])].sort((a, b) => a.idx - b.idx);
  for (const seat of seats) {
    const eos = seat.occupantEosId;
    if (eos && eosSquad.has(eos)) return eosSquad.get(eos)!;
  }
  return null;
}

function drawVehicles(ctx: CanvasRenderingContext2D, snap: Snapshot,
                      view: ViewState, cs: CanvasSize,
                      showAllNumbers: boolean) {
  for (const v of snap.vehicles ?? []) {
    if (!v.position) continue;
    const [x, y] = worldToScreen(view, cs, v.position.x, v.position.y);
    // UE yaw: 0° = +X (east / right). Squad's stock minimap PNGs are
    // drawn nose-UP (top of image = front of vehicle), so a +90° (π/2)
    // offset aligns the icon with the actual heading.
    // Null yaw = heading unknown (rare: valid position but the rotation
    // quat + its fallback both failed). Draw a neutral, un-rotated icon
    // rather than asserting due-east like `?? 0` used to — matches how the
    // player pin omits its needle when yaw is null.
    const hasYaw  = v.yaw != null;
    const yawRaw  = hasYaw ? (v.yaw! * Math.PI) / 180 : 0;
    const yawIcon = hasYaw ? yawRaw + Math.PI / 2 : 0;
    const url     = vehicleIconUrl(v);
    const vehImg  = url ? icon(url) : null;
    const ready   = !!(vehImg && vehImg.complete && vehImg.naturalWidth > 0);
    // Vehicles read bigger than players (more important on the map) and
    // helis bigger still (they cover more ground per tick).
    const sizeCss = v.kind === "Heli" ? 40 : 34;
    const size    = sizeCss * cs.dpr;

    // Turret layer: tanks / IFVs ship as two PNGs (base + turret) and
    // the backend reads each turret actor's RelativeRotation.Yaw — its
    // facing offset from the hull. World yaw = hull yaw + turret yaw.
    // The +90° offset matches the same nose-up convention applied to
    // the hull icon.
    const turretUrl = vehicleTurretIconUrl(v);
    const turretImg = turretUrl ? icon(turretUrl) : null;
    let turretYawIcon: number | undefined;
    const t0 = v.turrets && v.turrets[0];
    if (turretImg && t0 && t0.yaw != null && hasYaw) {
      turretYawIcon = (v.yaw! + t0.yaw) * Math.PI / 180 + Math.PI / 2;
    }

    if (ready) {
      drawVehicleBadge(ctx, x, y, yawIcon, size, teamColor(v.team), vehImg!,
                       turretImg, turretYawIcon);
      // Attached / parked-on-another-actor cue: thin white outer ring.
      if (v.attached) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.55, 0, 2 * Math.PI);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1 * cs.dpr;
        ctx.stroke();
      }
      continue;
    }

    // Fallback when the icon hasn't loaded yet (or art is missing for
    // this vehicle kind): nose-right triangle, raw yaw.
    const ts = 7 * cs.dpr;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(yawRaw);
    ctx.beginPath();
    ctx.moveTo(ts, 0);
    ctx.lineTo(-ts * 0.7, ts * 0.6);
    ctx.lineTo(-ts * 0.7, -ts * 0.6);
    ctx.closePath();
    ctx.fillStyle = teamColor(v.team);
    ctx.fill();
    ctx.lineWidth = 1.2 * cs.dpr;
    ctx.strokeStyle = v.attached ? "#fff" : "#0e1116";
    ctx.stroke();
    ctx.restore();
  }

  // Second pass — driver-squad number labels on top of every badge (Squad #s
  // layer only). Drawn after the badge loop so a later vehicle never overdraws
  // an earlier one's number.
  if (showAllNumbers) {
    const eosSquad = new Map<string, number>();
    for (const p of snap.players ?? [])
      if (p.eosId && p.squadId != null) eosSquad.set(p.eosId, p.squadId);
    for (const v of snap.vehicles ?? []) {
      if (!v.position) continue;
      const sq = vehicleSquadNumber(v, eosSquad);
      if (sq == null) continue;
      const [x, y] = worldToScreen(view, cs, v.position.x, v.position.y);
      const size = (v.kind === "Heli" ? 40 : 34) * cs.dpr;
      drawNumberBadge(ctx, x, y + size * 0.5 + 2 * cs.dpr,
                      String(sq), teamColor(v.team), size * 0.38, cs);
    }
  }
}

function drawMarkers(ctx: CanvasRenderingContext2D, snap: Snapshot,
                     view: ViewState, cs: CanvasSize) {
  for (const m of snap.markers ?? []) {
    if (!m.position) continue;
    const [x, y] = worldToScreen(view, cs, m.position.x, m.position.y);
    const url = markerIconUrl(m);
    const size = 22 * cs.dpr;
    const col = teamColor(m.team);
    // Colourise (NOT flat-fill) — preserves the icon's inner light/
    // dark structure while shifting its hue to the team colour.
    const img = url ? icon(url) : null;
    if (img && img.complete && img.naturalWidth > 0) {
      const bbox = iconBbox(img);
      const colored = colorizedIcon(img, col);
      if (colored && bbox) {
        const k  = size / Math.max(bbox.w, bbox.h);
        const dw = bbox.w * k;
        const dh = bbox.h * k;
        ctx.save();
        ctx.shadowColor   = "rgba(0,0,0,0.45)";
        ctx.shadowBlur    = size * 0.18;
        ctx.shadowOffsetY = size * 0.04;
        ctx.drawImage(colored, x - dw / 2, y - dh / 2, dw, dh);
        ctx.restore();
      } else {
        // Colourise failed: draw the raw icon untouched.
        drawIcon(ctx, img, x, y, size);
      }
    } else {
      // Final fallback while the icon is still loading: tiny team-coloured
      // diamond so the marker doesn't disappear during the brief warm-up.
      const r = 5 * cs.dpr;
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    }

    // Squad attribution label below the icon — squad number alone for
    // SL markers, `<n>B` for Bravo FTL markers, `<n>C` for Charlie.
    // Skip when there's no squad info (POI without owner, etc.).
    const sq = m.squad;
    if (sq != null && sq > 0) {
      const ft = m.fireTeamId;
      const label = ft === 1 ? `${sq}B`
                   : ft === 2 ? `${sq}C`
                   : `${sq}`;
      const fontPx = Math.max(10, Math.round(11 * cs.dpr));
      ctx.save();
      ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const ly = y + size * 0.55 + 2 * cs.dpr;
      // Dark outline so the digits read on every map tile colour.
      ctx.lineWidth = Math.max(2, fontPx * 0.25);
      ctx.strokeStyle = "rgba(0,0,0,0.9)";
      ctx.strokeText(label, x, ly);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, x, ly);
      ctx.restore();
    }
  }
}

// Rally point — uses the same drawDeployableBadge wrapper as FOBs/HABs
// so it sits visually in the same family. Squad number drawn below
// without a "Sqd " prefix; spawns-remaining counter top-right.
function drawRallyPoints(ctx: CanvasRenderingContext2D, snap: Snapshot,
                         view: ViewState, cs: CanvasSize) {
  const rallyImg = icon("./icons/mark/rallypoint.png");
  for (const rp of snap.rallyPoints ?? []) {
    if (!rp.position) continue;
    const [x, y] = worldToScreen(view, cs, rp.position.x, rp.position.y);
    const teamId = rp.squadTeamId ?? rp.team ?? null;
    const col = teamColor(teamId);
    const size = 24 * cs.dpr;
    const ready = rallyImg.complete && rallyImg.naturalWidth > 0;

    if (ready) {
      // Disabled / sieged rallies dim the disc colour so the badge
      // still uses the standard wrapper.
      const disc = rp.spawningEnabled ? col : "#5a5a5a";
      ctx.save();
      if (!rp.spawningEnabled) ctx.globalAlpha = 0.65;
      drawDeployableBadge(ctx, x, y, size, disc, rallyImg, false);
      ctx.restore();
      // Sieged overlay ring — sits just outside the badge to flag urgency.
      if (rp.sieged) {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.55, 0, 2 * Math.PI);
        ctx.strokeStyle = "#ff3b3b";
        ctx.lineWidth = 2.2 * cs.dpr;
        ctx.stroke();
      }
    }

    // Number-only label below the badge (the FOB pill uses the same
    // visual treatment — dark fill, team-coloured border).
    const sqLabel = rp.squadId != null ? String(rp.squadId) : "?";
    const fontSize = size * 0.5;
    ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const m = ctx.measureText(sqLabel);
    const padX = 5 * cs.dpr;
    const padY = 2 * cs.dpr;
    const labelW = Math.max(m.width + padX * 2, fontSize + padX * 2);
    const labelH = fontSize + padY * 2;
    const lx = x - labelW / 2;
    const ly = y + size * 0.5 + 2 * cs.dpr;
    const rad = 3 * cs.dpr;
    ctx.beginPath();
    ctx.moveTo(lx + rad, ly);
    ctx.lineTo(lx + labelW - rad, ly);
    ctx.arcTo(lx + labelW, ly, lx + labelW, ly + rad, rad);
    ctx.lineTo(lx + labelW, ly + labelH - rad);
    ctx.arcTo(lx + labelW, ly + labelH, lx + labelW - rad, ly + labelH, rad);
    ctx.lineTo(lx + rad, ly + labelH);
    ctx.arcTo(lx, ly + labelH, lx, ly + labelH - rad, rad);
    ctx.lineTo(lx, ly + rad);
    ctx.arcTo(lx, ly, lx + rad, ly, rad);
    ctx.closePath();
    ctx.fillStyle = "rgba(15,18,22,0.88)";
    ctx.fill();
    ctx.lineWidth = 1 * cs.dpr;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(sqLabel, x, ly + labelH / 2 + 0.5 * cs.dpr);

    // Spawns remaining — small green/amber/red counter top-right.
    const n = rp.spawnsRemaining;
    if (n != null && n >= 0) {
      const dotR = 7 * cs.dpr;
      const dx = x + size * 0.45;
      const dy = y - size * 0.45;
      ctx.beginPath();
      ctx.arc(dx, dy, dotR, 0, 2 * Math.PI);
      ctx.fillStyle = n >= 6 ? "#3ec74b" : n >= 3 ? "#f5b21f" : "#e94a4a";
      ctx.fill();
      ctx.lineWidth = 1 * cs.dpr;
      ctx.strokeStyle = "#0e1116";
      ctx.stroke();
      ctx.fillStyle = "#0e1116";
      ctx.font = `bold ${dotR * 1.3}px system-ui, sans-serif`;
      ctx.fillText(String(n), dx, dy + 0.5 * cs.dpr);
    }
  }
}

// Tactical operator marker: solid team-colored badge with a dark inner
// screen, white role glyph, and a detached compass needle pointing in
// the facing direction. Three distinct shapes are layered so each part
// stays crisp — a clean circle never becomes a misshapen "speech
// bubble". Drop shadow lifts the marker off busy map terrain.
//
// Layout:
//                                ▲       ← facing needle (separate)
//                            ┌───────┐
//                            │       │
//                            │  [R]  │   ← team-coloured ring +
//                            │       │     dark screen + white glyph
//                            └───────┘
//
// UE yaw 0 = +X = canvas right; with world-Y-down (no flip) Math.cos/
// sin from yaw radians give correct screen offsets directly.
function drawPlayerPin(ctx: CanvasRenderingContext2D,
                       cx: number, cy: number,
                       yawDeg: number | null | undefined,
                       iconSize: number, teamCol: string,
                       roleImg: CachedImageLike | null) {
  const rOuter  = iconSize * 0.48;
  const rInner  = iconSize * 0.39;       // ring band ~9% of size on each side
  const hasYaw  = yawDeg != null;
  const yaw     = hasYaw ? (yawDeg as number * Math.PI) / 180 : 0;

  // (1) Drop shadow + solid team-coloured disc. Scoped via save/restore
  // so the shadow only attaches to the outer silhouette, not the inner
  // layers (which would otherwise smudge over the bright ring).
  ctx.save();
  ctx.shadowColor    = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur     = iconSize * 0.18;
  ctx.shadowOffsetY  = iconSize * 0.05;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
  ctx.fillStyle = teamCol;
  ctx.fill();
  ctx.restore();

  // (2) Dark inner "screen" — solid (not semi-transparent) so the white
  // glyph on top reads cleanly even when the marker sits over light
  // sand on the desert maps.
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.fillStyle = "#13171F";
  ctx.fill();

  // (3) Hairline highlight on the inner edge — costs almost nothing,
  // adds a "bezelled" feel that separates ring from screen at small
  // zoom levels where they'd otherwise bleed together.
  ctx.beginPath();
  ctx.arc(cx, cy, rInner, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth   = Math.max(1, iconSize * 0.02);
  ctx.stroke();

  // (4) Role glyph, recoloured to white. Stock Squad role art ships as
  // mid-grey silhouettes; against the near-black screen they'd vanish,
  // so `tintedIcon` rewrites every opaque pixel to white via a cached
  // source-in pass. Falls back to the raw art if the bbox scan failed.
  // Aspect ratio is preserved by scaling the longest edge to glyphSize
  // — drawing the bbox-cropped canvas into a square box would stretch
  // non-square silhouettes (e.g. the SL chevron is taller than wide).
  if (roleImg) {
    const tinted = tintedIcon(roleImg, "#ffffff");
    const glyphSize = rInner * 1.45;
    if (tinted) {
      const k  = glyphSize / Math.max(tinted.width, tinted.height);
      const dw = tinted.width * k;
      const dh = tinted.height * k;
      ctx.drawImage(tinted, cx - dw / 2, cy - dh / 2, dw, dh);
    } else {
      drawIcon(ctx, roleImg, cx, cy, glyphSize, {});
    }
  }

  // (5) Compass needle: a small isosceles triangle floating just
  // outside the disc, separated by a hairline gap. Detaching it from
  // the badge body keeps the body a perfect circle (no "kite" shape)
  // while still making facing immediately obvious. Own soft shadow so
  // it lifts off the map the same way the disc does.
  if (hasYaw) {
    const gap     = iconSize * 0.05;
    const baseR   = rOuter + gap;
    const tipR    = rOuter + gap + iconSize * 0.20;
    const halfA   = (14 * Math.PI) / 180;
    const a1      = yaw - halfA;
    const a2      = yaw + halfA;
    ctx.save();
    ctx.shadowColor   = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur    = iconSize * 0.06;
    ctx.shadowOffsetY = iconSize * 0.02;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(yaw) * tipR,  cy + Math.sin(yaw) * tipR);
    ctx.lineTo(cx + Math.cos(a1)  * baseR, cy + Math.sin(a1)  * baseR);
    ctx.lineTo(cx + Math.cos(a2)  * baseR, cy + Math.sin(a2)  * baseR);
    ctx.closePath();
    ctx.fillStyle = teamCol;
    ctx.fill();
    ctx.restore();
  }
}

// Convenience type — `drawIcon` accepts the cached `Image` shape.
type CachedImageLike = HTMLImageElement;

// A downed (incapacitated) soldier: pawn still in the world, ragdolled and
// waiting for a medic revive. Distinct from "gone" (soldier pointer nulled
// after give-up / bleed-out), which drops the player from the map entirely
// (handled by carryOver never re-injecting the dead).
//
// Prefers the server's replicated life-state (the `incapacitated` state is the
// exact revive-waiting bit); a soldier that is only `bleeding` is still up and
// moving, so it stays a normal pin. Falls back to the health<=0 correlate for
// legacy snapshots/replays that don't carry lifeState.
function isDowned(s: { health: number | null;
                       lifeState?: "healthy" | "bleeding" | "incapacitated" | null }):
                       boolean {
  if (s.lifeState != null) return s.lifeState === "incapacitated";
  return s.health != null && s.health <= 0;
}

// Faded ring + medic cross drawn over a dimmed pin so a downed body reads
// as "revivable" rather than just a low-opacity live player.
function drawDownedMarker(ctx: CanvasRenderingContext2D,
                          cx: number, cy: number, size: number,
                          teamCol: string) {
  const r = size * 0.6;
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.strokeStyle = teamCol;
  ctx.lineWidth = 1.4 * (size / 28);
  ctx.setLineDash([3 * (size / 28), 3 * (size / 28)]);
  ctx.stroke();
  ctx.setLineDash([]);
  // small white medic cross in the centre
  const c = size * 0.16;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2 * (size / 28);
  ctx.beginPath();
  ctx.moveTo(cx - c, cy); ctx.lineTo(cx + c, cy);
  ctx.moveTo(cx, cy - c); ctx.lineTo(cx, cy + c);
  ctx.stroke();
  ctx.restore();
}

// Admin in the developer free-cam (pawn class BP_DeveloperAdminCam_C).
// Rendered as a normal pin but in a distinct violet so it just reads as
// "not a normal player" — no loud effects.
const ADMIN_CAM_COLOR = "#a877f0";
function isAdminCam(s: { classShort: string | null }): boolean {
  return (s.classShort ?? "").includes("DeveloperAdminCam");
}

// Identity key for the followed player — must match MapCanvas.pKey /
// PlayerPanel.playerKey exactly (eosId, else pid:<id>, else name:<name>).
function pKey(p: { eosId: string | null; playerId: number | null; name: string | null }): string {
  return p.eosId ?? (p.playerId != null ? `pid:${p.playerId}` : `name:${p.name ?? "?"}`);
}

// The followed player's squad, resolved per frame. When set, drawPlayers spot-
// lights that squad — an amber ring on members, a brighter glowing ring on the
// followed player — and fades every non-member pin back.
export interface FollowHighlight {
  key: string;              // pKey of the followed player
  teamId: number | null;
  squadId: number;
}

// Ring around a player pin, just outside the team disc — the follow-squad
// highlight. `glow` adds a soft halo (used for the followed player).
function drawSquadRing(ctx: CanvasRenderingContext2D, cx: number, cy: number,
                       size: number, color: string, lineWidth: number,
                       glow: boolean) {
  ctx.save();
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = size * 0.28; }
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.55, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function drawPlayers(ctx: CanvasRenderingContext2D, snap: Snapshot,
                     view: ViewState, cs: CanvasSize,
                     showSLNumbers: boolean, showAllNumbers: boolean,
                     follow: FollowHighlight | null) {
  const players = snap.players ?? [];
  // Members of the followed squad (the followed player counts as one).
  const inFollowSquad = (p: Player) =>
    !!follow && p.teamId === follow.teamId && p.squadId === follow.squadId;

  // Pass 1 — the pins themselves.
  for (const p of players) {
    const s = p.soldier;
    if (!s?.position || s.stale) continue;
    const admin = isAdminCam(s);
    // Mounted soldiers are represented by the vehicle icon they're in.
    if (s.attached && !admin) continue;
    const [x, y] = worldToScreen(view, cs, s.position.x, s.position.y);
    // One uniform badge size for every soldier — stance is no longer
    // expressed via marker shrink. Keeps the map visually consistent and
    // avoids the "some players look further away than others" illusion.
    const size = 28 * cs.dpr;
    const url = roleIconUrl(p);
    const roleImg = url ? icon(url) : null;
    const ready = !!(roleImg && roleImg.complete && roleImg.naturalWidth > 0);
    const col = admin ? ADMIN_CAM_COLOR : teamColor(p.teamId);
    const downed = isDowned(s);
    const squad = inFollowSquad(p);
    // Follow spotlight: while a squad is followed, non-members fade back so the
    // tracked squad reads at a glance.
    const dim = !!follow && !squad;

    ctx.save();
    if (dim) ctx.globalAlpha = 0.3;
    else if (downed) ctx.globalAlpha = 0.4;   // revivable body stays visible
    drawPlayerPin(ctx, x, y, s.yaw, size, col, ready ? roleImg : null);
    ctx.restore();
    if (downed) drawDownedMarker(ctx, x, y, size, col);

    // Squad-highlight rings, at full opacity (squad members are never dimmed).
    if (squad) {
      if (pKey(p) === follow!.key)
        drawSquadRing(ctx, x, y, size, "#ffffff", 2.6 * cs.dpr, true);
      else
        drawSquadRing(ctx, x, y, size, "#ffcc33", 2 * cs.dpr, false);
    }
  }

  // Pass 2 — squad-number labels on top of every pin. A squad leader shows its
  // number when SL-numbers are on; everyone else only when the all-numbers
  // option is on (which also covers SLs). Second pass so a neighbouring pin
  // never buries a number.
  for (const p of players) {
    const s = p.soldier;
    if (!s?.position || s.stale) continue;
    if (s.attached && !isAdminCam(s)) continue;
    if (p.squadId == null) continue;             // unsquadded / admin cam
    const sl = isSquadLeader(p);
    if (!((sl && showSLNumbers) || showAllNumbers)) continue;
    const [x, y] = worldToScreen(view, cs, s.position.x, s.position.y);
    const size = 28 * cs.dpr;
    // SL numbers a touch larger so leaders read at a glance in a cluster.
    const fontSize = size * (sl ? 0.46 : 0.4);
    // Keep numbers consistent with the pin spotlight: fade non-squad labels.
    ctx.save();
    if (follow && !inFollowSquad(p)) ctx.globalAlpha = 0.3;
    drawNumberBadge(ctx, x, y + size * 0.5 + 2 * cs.dpr,
                    String(p.squadId), teamColor(p.teamId), fontSize, cs);
    ctx.restore();
  }
}

// Delegates to the projectiles module which owns the cross-tick
// tracker, heading derivation, and impact ring animation. Kept as a
// thin wrapper so renderScene's call sequence stays uniform.
function drawProjectiles(ctx: CanvasRenderingContext2D, snap: Snapshot,
                         view: ViewState, cs: CanvasSize) {
  drawProjectilesAndImpacts(ctx, snap, view, cs);
}

// Thin "command line" from each action marker back to the placer's
// current soldier position. Visual cue that mirrors Squad's own HUD —
// helps an admin see WHO is ordering WHAT without hovering each icon.
// Only drawn for the order family (Move/Attack/Defend/Build/Observe,
// SL + FT variants); spotted/option/POI/director markers stay clean.
// If the placer can't be resolved (offline, on a different map, etc.)
// we silently skip — no guess line.
function drawActionMarkerLines(ctx: CanvasRenderingContext2D,
                                snap: Snapshot,
                                view: ViewState, cs: CanvasSize) {
  const players = snap.players ?? [];
  if (!players.length) return;
  for (const m of snap.markers ?? []) {
    if (!m.position || !m.type) continue;
    if (!/^BP_MapMarker_Action_/i.test(m.type)) continue;
    if (m.team == null || m.squad == null) continue;
    const ft = m.fireTeamId;
    // Find the placer by team + squad + fireteam role (same logic the
    // tooltip uses). SL = (idx 0, pos 0); FTL = (idx N, pos 0).
    const candidates = players.filter(
      (p) => p.teamId === m.team && p.squadId === m.squad
    );
    if (!candidates.length) continue;
    const wantIdx = ft === -1 || ft == null ? 0 : ft;
    const placer = candidates.find((p) => {
      const s = p.stats ?? {};
      return s.fireTeamIndex === wantIdx && s.fireTeamPosition === 0;
    });
    if (!placer || !placer.soldier || !placer.soldier.position) continue;
    // Hide the line while the placer is dead (or their soldier record
    // went stale). The line reappears automatically the next tick after
    // respawn — `placer.soldier.position` updates to the new spawn
    // location, so no extra wiring needed.
    if (placer.soldier.stale) continue;
    if ((placer.soldier.health ?? 0) <= 0) continue;
    const sp = placer.soldier.position;
    const [ax, ay] = worldToScreen(view, cs, sp.x, sp.y);
    const [bx, by] = worldToScreen(view, cs, m.position.x, m.position.y);
    const col = teamColor(m.team);
    ctx.save();
    // Dark halo underneath for terrain legibility.
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2 * cs.dpr;
    ctx.stroke();
    // Team-tinted hairline on top.
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1 * cs.dpr;
    ctx.stroke();
    ctx.restore();
  }
}

// Which entity families to draw. Absent/true = draw. Structural layers
// (map texture, grid, lanes, capture zones, FOB radii) are always drawn;
// only the toggleable entity families are gated.
export interface LayerVisibility {
  players?: boolean;
  vehicles?: boolean;
  deployables?: boolean;
  markers?: boolean;
  projectiles?: boolean;
  spawners?: boolean;
  rallies?: boolean;
  slNumbers?: boolean;
  squadNumbers?: boolean;
}

export function renderScene(ctx: CanvasRenderingContext2D, snap: Snapshot,
                            view: ViewState, cs: CanvasSize,
                            layers?: LayerVisibility,
                            follow?: FollowHighlight | null) {
  const on = (k: keyof LayerVisibility) => !layers || layers[k] !== false;
  // SL numbers default ON (absent = show, like the entity layers); the
  // all-numbers option defaults OFF (opt-in declutter, absent = hide).
  const showSLNumbers = layers?.slNumbers !== false;
  const showAllNumbers = layers?.squadNumbers === true;
  ctx.clearRect(0, 0, cs.width, cs.height);
  const hadTex = drawMapTexture(ctx, snap, view, cs);
  // Background overlays first — FOB radii are giant translucent discs
  // that should sit between the map texture and the entity badges.
  if (on("deployables")) drawFobRadii(ctx, snap, view, cs);
  if (!hadTex) drawGrid(ctx, view, cs);
  drawLane(ctx, snap, view, cs);
  // Action-marker command lines as a low-level overlay — drawn before
  // any entity icon so vehicles / deployables / markers / players all
  // sit on top of the line, never under it.
  if (on("markers")) drawActionMarkerLines(ctx, snap, view, cs);
  if (on("spawners")) drawSpawners(ctx, snap, view, cs);
  if (on("deployables")) drawDeployables(ctx, snap, view, cs);
  drawCaps(ctx, snap, view, cs);
  if (on("vehicles")) drawVehicles(ctx, snap, view, cs, showAllNumbers);
  if (on("markers")) drawMarkers(ctx, snap, view, cs);
  if (on("rallies")) drawRallyPoints(ctx, snap, view, cs);
  if (on("players")) drawPlayers(ctx, snap, view, cs, showSLNumbers, showAllNumbers, follow ?? null);
  if (on("projectiles")) drawProjectiles(ctx, snap, view, cs);
}
