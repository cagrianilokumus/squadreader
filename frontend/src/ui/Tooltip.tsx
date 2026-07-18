// Hover popup. Positioned absolutely; content depends on entity type.

import { teamColor } from "../canvas/draw";
import type { Hit } from "../canvas/hitTest";
import { passengersOf } from "../canvas/passengers";
import { useViewerStore } from "../state/viewerStore";
import type { Snapshot } from "../state/types";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";
import { markerLabel, findPlacer, ftLabel, fmtInt } from "./entityInfo";

interface Props { hit: Hit | null; x: number; y: number; }

function dot(t: number | null | undefined) {
  return <span className="swatch" style={{ background: teamColor(t) }} />;
}

function body(hit: Hit, snap: Snapshot | null) {
  switch (hit.hit.type) {
    case "player": {
      const e = hit.hit.e;
      const s = e.soldier ?? null;
      return <>
        {dot(e.teamId)}<b>{e.name ?? "?"}</b>
        {e.clanTag && <span style={{ opacity: .6 }}> [{e.clanTag}]</span>}
        <br />{e.roleId ?? "—"}
        {e.squadId ? ` · sq ${e.squadId}` : ""}
        <br />HP {fmtInt(s?.health)} · {s?.stance ?? "standing"}
        {s?.classShort && <><br /><span style={{ opacity: .6 }}>{s.classShort}</span></>}
      </>;
    }
    case "vehicle": {
      const e = hit.hit.e;
      const passengers = passengersOf(snap, e);
      return <>
        {dot(e.team)}<b>{vehicleDisplayName(e.classShort)}</b>
        <br />HP {fmtInt(e.health)} / {fmtInt(e.maxHealth)}
        {e.attached && <><br /><span style={{ opacity: .6 }}>attached</span></>}
        {e.lastDamager && <><br />last hit by {e.lastDamager.name ?? "?"}</>}
        {passengers.length > 0 && (
          <>
            <br /><span style={{ opacity: .6 }}>
              passengers ({passengers.length}):
            </span>
            {passengers.map((p) => (
              <div key={p.eosId ?? p.name ?? Math.random()}
                   style={{ marginLeft: 8 }}>
                {dot(p.teamId)}{p.name ?? "?"}
                {p.roleId && p.roleId !== "None" && (
                  <span style={{ opacity: .5 }}> · {p.roleId}</span>
                )}
              </div>
            ))}
          </>
        )}
      </>;
    }
    case "capzone": {
      const e = hit.hit.e;
      return <>
        <b>{e.name ?? "?"}</b>
        <br />owner {dot(e.owningTeam)}team {e.owningTeam ?? "—"}
        {e.capturingTeam && <><br />capping {dot(e.capturingTeam)}team {e.capturingTeam}</>}
        <br />cap {e.capturePercent != null ? (e.capturePercent * 100).toFixed(0) + "%" : "—"}
        {e.isLocked && <><br /><span style={{ opacity: .6 }}>locked</span></>}
      </>;
    }
    case "deployable": {
      const e = hit.hit.e;
      return <>
        {dot(e.team)}<b>{e.classShort ?? "?"}</b>
        {e.isFob && <span style={{ opacity: .6 }}> FOB</span>}
        <br />HP {fmtInt(e.health)} / {fmtInt(e.maxHealth)}
        <br />built {e.buildState ?? "—"}
      </>;
    }
    case "spawner": {
      const e = hit.hit.e;
      // vehicleClass already arrives as a BP_X_C blueprint name on the
      // spawner record too, so the same lookup applies.
      const label = vehicleDisplayName(e.vehicleClass ?? e.classShort);
      return <>
        {dot(e.team)}<b>{label}</b>
        <br />{e.spawnerEnabled ? "ready" : "disabled"}
        {e.actorName && <><br /><span style={{ opacity: .6 }}>{e.actorName}</span></>}
      </>;
    }
    case "marker": {
      const e = hit.hit.e;
      const placer = findPlacer(e, snap?.players ?? []);
      const role = ftLabel(e.fireTeamId);
      return <>
        {dot(e.team)}<b>{markerLabel(e.type)}</b>
        {e.squad != null && <><br />Squad {e.squad} · {role}</>}
        <br />
        {placer ? (
          <>Placed by: <b>{placer.name ?? "?"}</b>{placer.clanTag
            ? <span style={{ opacity: .6 }}> [{placer.clanTag}]</span>
            : null}</>
        ) : (
          <span style={{ opacity: .55 }}>Placer: (offline / unresolved)</span>
        )}
      </>;
    }
    case "projectile": {
      const e = hit.hit.e;
      return <>
        <b>{e.classShort ?? "projectile"}</b>
        {e.explosiveBaseDamage != null && <><br />dmg {fmtInt(e.explosiveBaseDamage)}</>}
        {e.hasImpacted && <><br /><span style={{ opacity: .6 }}>impacted</span></>}
      </>;
    }
  }
}

export function Tooltip({ hit, x, y }: Props) {
  // Subscribe so passenger list updates as the live snap changes
  // (interpolation already drives the canvas at 60 fps; tooltip
  // refresh on tick boundaries is fine — passengers are stable).
  const snap = useViewerStore((s) => s.curSnap);
  if (!hit) return null;
  // Clamp into the viewport so the box doesn't overflow.
  const left = Math.max(4, Math.min(window.innerWidth - 240, x + 12));
  const top  = Math.max(4, Math.min(window.innerHeight - 80, y + 12));
  return (
    <div id="tooltip" style={{ left, top, display: "block",
                               whiteSpace: "normal", maxWidth: 280 }}>
      {body(hit, snap)}
    </div>
  );
}
