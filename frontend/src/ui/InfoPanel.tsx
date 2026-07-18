// Shared click-detail panel for every map entity that isn't a player or a
// vehicle (those keep their own panels). One component, keyed on the generic
// `selectedInfo` selection; the body switches on the entity kind. Squad
// terminology (marker/vehicle/faction names) stays English.

import type React from "react";
import { teamColor } from "../canvas/draw";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";
import { useViewerStore } from "../state/viewerStore";
import type {
  CaptureZone, Deployable, Marker, Projectile, RallyPoint, Vec3,
  VehicleSpawner,
} from "../state/types";
import { fmtInt, ftLabel, findPlacer, markerLabel } from "./entityInfo";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="info-row">
      <span className="info-k">{label}</span>
      <span className="info-v">{children}</span>
    </div>
  );
}

// Reuse the shared .hp-row bar (health / ammo / construction).
function Bar({ label, cur, max, color }: {
  label: string; cur: number | null | undefined; max: number | null | undefined;
  color?: string;
}) {
  const pct = (cur != null && max != null && max > 0)
    ? Math.max(0, Math.min(100, (cur / max) * 100)) : null;
  return (
    <div className="hp-row">
      <span className="hp-label">{label}</span>
      <div className="hp-bar">
        <div className="hp-fill" style={{ width: `${pct ?? 0}%`,
          background: color ?? "var(--good)" }} />
      </div>
      <span className="hp-num">{fmtInt(cur)}{max != null ? `/${fmtInt(max)}` : ""}</span>
    </div>
  );
}

// mm:ss for a countdown in seconds. Negative/undefined → null (caller hides it).
function fmtCountdown(sec: number | null | undefined): string | null {
  if (sec == null || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Badges({ items }: { items: [string, boolean | null | undefined][] }) {
  const on = items.filter(([, v]) => v);
  if (!on.length) return null;
  return (
    <div className="info-badges">
      {on.map(([label]) => <span key={label} className="info-badge">{label}</span>)}
    </div>
  );
}

function posRow(pos: Vec3 | null | undefined) {
  if (!pos) return null;
  return (
    <Row label="POS">
      <span className="info-mono">
        {Math.round(pos.x)}, {Math.round(pos.y)}, {pos.z != null ? Math.round(pos.z) : "—"}
      </span>
    </Row>
  );
}

// ---- per-kind bodies -------------------------------------------------------

function MarkerBody({ e }: { e: Marker }) {
  const players = useViewerStore((s) => s.curSnap?.players ?? []);
  const placer = findPlacer(e, players);
  return (
    <>
      <Row label="TEAM">{e.team ?? "—"}</Row>
      {e.squad != null && (
        <Row label="ROLE">Squad {e.squad} · {ftLabel(e.fireTeamId)}</Row>
      )}
      <Row label="PLACER">
        {placer
          ? <b>{placer.clanTag ? `[${placer.clanTag}] ` : ""}{placer.name ?? "?"}</b>
          : <span className="info-mute">offline / unresolved</span>}
      </Row>
      <Row label="ID">{e.id}</Row>
      <Row label="RAW TYPE">
        <span className="info-mono">{(e.type ?? "").replace(/^BP_MapMarker_/, "") || "—"}</span>
      </Row>
      {posRow(e.position)}
    </>
  );
}

function DeployableBody({ e, worldTimeSec }: {
  e: Deployable; worldTimeSec?: number | null;
}) {
  // FOB bleed-out countdown: only while bleeding, and only when both the death
  // stamp and the current world clock are known. Otherwise hidden — never a
  // guessed timer.
  const bleedLeft = (e.fobBleeding && e.estimatedDeathTime != null
                     && worldTimeSec != null)
    ? fmtCountdown(e.estimatedDeathTime - worldTimeSec) : null;
  return (
    <>
      <Row label="TEAM">{e.team ?? "—"}{e.isFob ? " · FOB" : ""}</Row>
      <Bar label="HP" cur={e.health} max={e.maxHealth} />
      {e.isFob && <>
        <Bar label="AMMO" cur={e.ammo} max={e.maxAmmo} color="var(--accent)" />
        <Bar label="BUILD" cur={e.construction} max={e.maxConstruction} color="var(--accent-2)" />
        {(e.ammoPerSecond != null || e.cpPerSecond != null) && (
          <Row label="RATE">
            <span className="info-mono">
              ammo {e.ammoPerSecond ?? "—"}/s · build {e.cpPerSecond ?? "—"}/s
            </span>
          </Row>
        )}
        {bleedLeft && (
          <Row label="BLEED"><span className="info-danger">☠ {bleedLeft}</span></Row>
        )}
        {e.nearbyEnemies != null && <Row label="ENEMIES">{e.nearbyEnemies}</Row>}
        <Badges items={[
          ["Sieged", e.fobSieged], ["Spawning", e.fobSpawningEnabled],
          ["Bleeding", e.fobBleeding], ["Overrun", e.fobOverrun],
        ]} />
      </>}
      {e.buildState != null && <Row label="BUILT">{e.buildState}</Row>}
      {e.classShort && <Row label="CLASS"><span className="info-mono">{e.classShort}</span></Row>}
      <Row label="ID">{e.id}</Row>
      {posRow(e.position)}
    </>
  );
}

function SpawnerBody({ e }: { e: VehicleSpawner }) {
  return (
    <>
      <Row label="TEAM">{e.team ?? "—"}</Row>
      <Row label="VEHICLE"><b>{vehicleDisplayName(e.vehicleClass ?? e.classShort)}</b></Row>
      {(() => { const cd = fmtCountdown(e.nextSpawnSec);
        return cd ? <Row label="RESPAWN"><span className="info-mono">{cd}</span></Row>
                  : null; })()}
      <Badges items={[
        ["Ready", e.spawnerEnabled], ["Spawning", e.spawnInProgress],
        ["Overlapped", e.spawnOverlapped],
      ]} />
      {e.actorName && <Row label="ACTOR"><span className="info-mono">{e.actorName}</span></Row>}
      <Row label="ID">{e.id}</Row>
      {posRow(e.position)}
    </>
  );
}

function RallyBody({ e }: { e: RallyPoint }) {
  return (
    <>
      <Row label="TEAM">{e.team ?? "—"}</Row>
      <Row label="SQUAD">{e.squadName ?? (e.squadId != null ? `#${e.squadId}` : "—")}</Row>
      {e.spawnsRemaining != null && <Row label="SPAWNS">{e.spawnsRemaining}</Row>}
      <Badges items={[["Spawning", e.spawningEnabled], ["Sieged", e.sieged]]} />
      <Row label="ID">{e.id}</Row>
      {posRow(e.position)}
    </>
  );
}

function CapzoneBody({ e }: { e: CaptureZone }) {
  return (
    <>
      <Row label="FLAG"><b>{e.flagName ?? e.name ?? "?"}</b></Row>
      <Row label="OWNER">
        <span className="info-dot" style={{ background: teamColor(e.owningTeam) }} />
        Team {e.owningTeam ?? "—"}
      </Row>
      {e.capturingTeam != null && (
        <Row label="CAPPING">
          <span className="info-dot" style={{ background: teamColor(e.capturingTeam) }} />
          Team {e.capturingTeam}
        </Row>
      )}
      <Bar label="CAP" cur={e.capturePercent != null ? e.capturePercent * 100 : null} max={100} />
      {e.captureRate != null && <Row label="RATE">{e.captureRate}</Row>}
      {e.playerAdvantage != null && (
        <Row label="ADVANTAGE">
          <span className="info-mono">{e.playerAdvantage > 0 ? "+" : ""}
            {e.playerAdvantage.toFixed(1)}</span>
        </Row>
      )}
      <Badges items={[["Locked", e.isLocked]]} />
      <Row label="ID">{e.id}</Row>
      {posRow(e.position)}
    </>
  );
}

function ProjectileBody({ e }: { e: Projectile }) {
  return (
    <>
      <Row label="TEAM">{e.team ?? "—"}</Row>
      <Row label="KIND">{e.kind ?? e.classShort ?? "projectile"}</Row>
      {e.isExplosive && e.explosiveBaseDamage != null && (
        <Row label="DAMAGE">{fmtInt(e.explosiveBaseDamage)}
          {e.explosiveKillZoneRadius != null
            ? ` · r ${fmtInt(e.explosiveKillZoneRadius)}` : ""}</Row>
      )}
      {e.firer && <Row label="FIRER"><b>{e.firer}</b></Row>}
      <Badges items={[["Tracer", e.isTracer], ["Impacted", e.hasImpacted]]} />
      <Row label="ID">{e.id}</Row>
      {posRow(e.position)}
    </>
  );
}

// ---- panel shell -----------------------------------------------------------

export function InfoPanel() {
  const sel   = useViewerStore((s) => s.selectedInfo);
  const snap  = useViewerStore((s) => s.curSnap);
  const close = useViewerStore((s) => s.setSelectedInfo);

  if (!sel) return null;

  // Resolve the live entity from the current snapshot by kind + id.
  let title = "";
  let team: number | null | undefined = null;
  let bodyEl: React.ReactNode = null;
  const find = <T extends { id: string }>(arr: T[] | undefined) =>
    (arr ?? []).find((x) => x.id === sel.id) ?? null;

  switch (sel.kind) {
    case "marker": {
      const e = find<Marker>(snap?.markers);
      if (e) { title = markerLabel(e.type); team = e.team; bodyEl = <MarkerBody e={e} />; }
      break;
    }
    case "deployable": {
      const e = find<Deployable>(snap?.deployables);
      if (e) { title = (e.isFob ? "FOB · " : "") + (e.classShort ?? "Deployable");
               team = e.team;
               bodyEl = <DeployableBody e={e}
                          worldTimeSec={snap?.gameState?.worldTimeSec} />; }
      break;
    }
    case "spawner": {
      const e = find<VehicleSpawner>(snap?.vehicleSpawners);
      if (e) { title = vehicleDisplayName(e.vehicleClass ?? e.classShort);
               team = e.team; bodyEl = <SpawnerBody e={e} />; }
      break;
    }
    case "rally": {
      const e = find<RallyPoint>(snap?.rallyPoints);
      if (e) { title = "Rally Point"; team = e.team; bodyEl = <RallyBody e={e} />; }
      break;
    }
    case "capzone": {
      const e = find<CaptureZone>(snap?.captureZones);
      if (e) { title = e.flagName ?? e.name ?? "Capture Zone";
               team = e.owningTeam; bodyEl = <CapzoneBody e={e} />; }
      break;
    }
    case "projectile": {
      const e = find<Projectile>(snap?.projectiles);
      if (e) { title = e.classShort ?? "Projectile"; team = e.team; bodyEl = <ProjectileBody e={e} />; }
      break;
    }
  }

  const tc = teamColor(team);

  if (!bodyEl) {
    // Entity left the snapshot (despawned / out of range) since selection.
    return (
      <div id="info-panel" className="detail-panel">
        <header>
          <h2>no longer on the map</h2>
          <button onClick={() => close(null)} title="Close (esc)">✕</button>
        </header>
        <div className="body">
          <div className="empty">this object is no longer in the snapshot — despawned or out of range</div>
        </div>
      </div>
    );
  }

  return (
    <div id="info-panel" className="detail-panel">
      <header>
        <h2>
          <span className="dot" style={{ background: tc }} />
          {title}
        </h2>
        <button onClick={() => close(null)} title="Close (esc)">✕</button>
      </header>
      <div className="body">
        <div className="info-rows">{bodyEl}</div>
      </div>
    </div>
  );
}
