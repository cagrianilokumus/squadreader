// Mortar / rocket projectile rendering with cross-tick tracking,
// directional icon orientation, and an impact ring animation. Ported
// from the legacy vanilla-JS mortar-rounds module; adapted to our
// React canvas where MapCanvas already runs a continuous rAF loop
// (no need for the old requestDraw() pump — rings animate naturally).
//
// Tracking strategy in priority order:
//   1. projectile.id (actor pointer) — stable while the actor lives,
//      so the cheapest sig match for matching this-tick to last-tick.
//   2. Nearest-neighbour within MATCH_RADIUS — covers id churn across
//      respawns / bucket boundary cases.
//   3. velocity vector (when backend Phase B+ emits it) — first-tick
//      heading derived directly, no second sample required.
//
// Impact ring spawn priority:
//   A. projectile.hasImpacted flag (reader emits the moment
//      ASQProjectile.bHasImpacted flips). Spawned at the exact
//      replicated impact position. Deduped via `impactSpawned` so the
//      same dying actor (which lingers a few ticks with hasImpacted
//      still true) doesn't stack rings on the same point.
//   B. Tracker-vanish heuristic. Anything we saw last tick but not
//      this tick → assume it impacted at its last known location.
//      Skipped when (A) already fired for the same signature.

import type { Projectile, Snapshot, ViewState } from "../state/types";
import { icon } from "./icons";
import { worldToScreen } from "./worldToScreen";

const MATCH_RADIUS_UE  = 250_000;                        // 2500 m
const MATCH_RADIUS_SQ  = MATCH_RADIUS_UE * MATCH_RADIUS_UE;
const IMPACT_MS        = 1200;                           // ring lifetime
const STALE_MS         = 12_000;                         // drop trackers older than this

const MORTAR_ICON_URL  = "./icons/deployables/mortar_round.svg";

interface CanvasSize {
  width: number; height: number; cssWidth: number; cssHeight: number; dpr: number;
}

interface Track {
  x: number;
  y: number;
  heading: number | null;   // screen-space radians, +x axis baseline
  lastSeenAt: number;       // wall-clock ms
  kind: string;
}

interface Impact {
  x: number;
  y: number;
  startAt: number;
  kind: string;
}

// Module-level tracker state. Shared across renderScene calls so
// position deltas + impact dedupe survive between snapshots. (Single
// renderer instance per page — MapCanvas — so a singleton is fine.)
const tracks         = new Map<string, Track>();
const impacts: Impact[] = [];
const impactSpawned  = new Map<string, number>();

// Signature: prefer the stable actor id, fall back to a coarse class +
// position bucket so micro-drift between ticks doesn't generate two
// signatures for the same physical round.
function signature(p: Projectile): string {
  if (p.id) return `id:${p.id}`;
  const pos = p.position;
  if (pos) {
    const bx = Math.round(pos.x / 500);
    const by = Math.round(pos.y / 500);
    return `c:${p.classShort ?? ""}:${bx}:${by}`;
  }
  return `n:${p.classShort ?? ""}`;
}

export function drawProjectilesAndImpacts(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  view: ViewState,
  cs: CanvasSize,
) {
  const now = Date.now();
  const seen = new Set<string>();
  const rounds = snap.projectiles ?? [];

  const img = icon(MORTAR_ICON_URL);
  const imgReady = img.complete && img.naturalWidth > 0;

  // ---- per-projectile pass (update tracker, draw icon) -----------------
  for (const r of rounds) {
    if (!r.position) continue;
    const sig = signature(r);
    seen.add(sig);

    // Resolve previous track: sig hit first, then nearest-neighbour
    // within radius (covers id-changing edge cases).
    let prev: Track | null = tracks.get(sig) ?? null;
    if (!prev) {
      let bestD2 = MATCH_RADIUS_SQ;
      let bestSig: string | null = null;
      for (const [psig, pt] of tracks) {
        if (seen.has(psig)) continue;
        const dx = r.position.x - pt.x, dy = r.position.y - pt.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) { bestD2 = d2; bestSig = psig; prev = pt; }
      }
      if (bestSig) tracks.delete(bestSig);
    }

    // Heading: prefer screen-space delta from the previous sample
    // (handles map Y-flip correctly). Ignore micro-jitter (<1m).
    let heading = prev ? prev.heading : null;
    if (prev) {
      const dxU = r.position.x - prev.x, dyU = r.position.y - prev.y;
      if (dxU * dxU + dyU * dyU > 10_000) {
        const [psx, psy] = worldToScreen(view, cs, prev.x, prev.y);
        const [csx, csy] = worldToScreen(view, cs, r.position.x, r.position.y);
        heading = Math.atan2(csy - psy, csx - psx);
      }
    }
    // First-tick fallback when backend emits velocity (Phase B+).
    if (heading == null && r.velocity && (r.velocity.x || r.velocity.y)) {
      const [ox, oy] = worldToScreen(view, cs, r.position.x, r.position.y);
      const [tx, ty] = worldToScreen(view, cs,
        r.position.x + r.velocity.x,
        r.position.y + r.velocity.y);
      heading = Math.atan2(ty - oy, tx - ox);
    }
    const kind = r.kind ?? "mortar";
    tracks.set(sig, {
      x: r.position.x, y: r.position.y,
      heading, lastSeenAt: now, kind,
    });

    // Path A: reader said this projectile has impacted. Spawn the
    // burst now at the replicated impact position. The actor will
    // linger a couple of ticks with hasImpacted=true; impactSpawned
    // dedupes so we don't stack rings.
    if (r.hasImpacted) {
      if (!impactSpawned.has(sig)) {
        impacts.push({ x: r.position.x, y: r.position.y, startAt: now, kind });
        impactSpawned.set(sig, now);
      }
      // Don't draw the icon — actor is exploding, not flying.
      continue;
    }

    // Draw the rotated icon.
    const [sx, sy] = worldToScreen(view, cs, r.position.x, r.position.y);
    if (sx < -80 || sx > cs.width + 80 || sy < -80 || sy > cs.height + 80) {
      continue;  // offscreen; tracker keeps updating for heading carry
    }
    if (imgReady) {
      const isRocket = kind === "grad" || kind === "s5";
      const w = (isRocket ? 14 : 12) * cs.dpr;
      const h = (isRocket ? 30 : 26) * cs.dpr;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.translate(sx, sy);
      // Icon's native nose points -Y; rotate by heading + π/2 so the
      // tip aims along the travel direction in screen space.
      if (heading != null) ctx.rotate(heading + Math.PI / 2);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      // Fallback dot while the SVG warms up.
      ctx.beginPath();
      ctx.arc(sx, sy, 3 * cs.dpr, 0, 2 * Math.PI);
      ctx.fillStyle = "#ffd166";
      ctx.fill();
    }
  }

  // ---- Path B: tracker-vanish impact spawn ------------------------------
  for (const [sig, pt] of Array.from(tracks)) {
    if (seen.has(sig)) continue;
    if (now - pt.lastSeenAt > STALE_MS) {
      tracks.delete(sig);
      impactSpawned.delete(sig);
      continue;
    }
    if (!impactSpawned.has(sig)) {
      impacts.push({ x: pt.x, y: pt.y, startAt: now, kind: pt.kind });
    }
    tracks.delete(sig);
    impactSpawned.delete(sig);
  }
  // Belt-and-suspenders GC of the dedupe map.
  for (const [sig, t] of Array.from(impactSpawned)) {
    if (now - t > STALE_MS) impactSpawned.delete(sig);
  }

  // ---- impact rings -----------------------------------------------------
  if (impacts.length) drawImpacts(ctx, view, cs, now);
}

function drawImpacts(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  cs: CanvasSize,
  now: number,
) {
  // Reap finished effects first.
  for (let i = impacts.length - 1; i >= 0; i--) {
    if (now - impacts[i]!.startAt > IMPACT_MS) impacts.splice(i, 1);
  }
  for (const e of impacts) {
    const t = Math.min(1, (now - e.startAt) / IMPACT_MS);  // 0..1
    const [sx, sy] = worldToScreen(view, cs, e.x, e.y);
    if (sx < -120 || sx > cs.width + 120
        || sy < -120 || sy > cs.height + 120) continue;
    const isRocket = e.kind === "grad" || e.kind === "s5";
    const maxR = (isRocket ? 32 : 22) * cs.dpr;
    const ringR = (4 * cs.dpr) + (maxR - 4 * cs.dpr) * t;
    // Fast fade-in (0..0.2) → slow fade-out (0.2..1).
    const fade = t < 0.2 ? (t / 0.2) : (1 - (t - 0.2) / 0.8);

    ctx.save();
    ctx.globalAlpha = fade * 0.85;
    ctx.strokeStyle = "#ff2418";
    ctx.lineWidth = 2.5 * cs.dpr;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, 2 * Math.PI);
    ctx.stroke();
    if (t < 0.5) {
      ctx.globalAlpha = (1 - t * 2) * 0.7;
      ctx.fillStyle = "#ff5040";
      ctx.beginPath();
      ctx.arc(sx, sy, 3 * cs.dpr, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }
}
