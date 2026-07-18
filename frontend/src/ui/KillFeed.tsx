// Killfeed panel — bottom-right corner. Newest entry at the top.
// Renders three row layouts: standard kill (killer → weapon → victim),
// wounded incap (yellow tint), world-cause (single-sentence row).
// Click on a name pins that player in the player-detail panel.

import { teamColor } from "../canvas/draw";
import { roleIconUrl } from "../canvas/icons";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";
import { weaponDisplayName, weaponStatic } from "../data/weaponsStatic";
import { vehicleWeaponStatic } from "../data/vehicleWeaponsStatic";
import { useStaticCatalogs } from "../data/staticCatalogs";
import { useViewerStore } from "../state/viewerStore";
import { playerKey } from "./PlayerPanel";
import {
  damageTypeCategoryLabel, deathCauseFromDamageType, deathCausePhrase,
} from "../killfeed/diff";
import type { KillFeedEntry } from "../state/types";

function fmtGameTime(s: number | null) {
  if (s == null || !Number.isFinite(s) || s < 0) return "00:00";
  const sec = Math.floor(s);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
}

// Resolve the best weapon label we can show. Priority order:
//   1. WEAPONS_STATIC catalog (infantry rifles, pistols, equipment)
//   2. VEHICLE_WEAPONS_STATIC catalog (tank shells, MG belts, ATGM)
//   3. raw blueprint name humanised (BP_X_C -> X)
//   4. damage-type category fallback (Gunfire / Frag / HAT / etc.)
function weaponLabel(e: KillFeedEntry): string {
  if (e.weaponClass) {
    const ws = weaponStatic(e.weaponClass);
    if (ws?.displayName) return ws.displayName;
    const vws = vehicleWeaponStatic(e.weaponClass);
    if (vws?.displayName) return vws.displayName;
    // Catalog miss — render a humanised raw class.
    return weaponDisplayName(e.weaponClass);
  }
  const cat = damageTypeCategoryLabel(e.damageType);
  if (cat) return cat;
  return "";
}

interface NameChipProps {
  name: string;
  team: number | null;
  roleId: string | null;
  onClick: () => void;
}
function NameChip({ name, team, roleId, onClick }: NameChipProps) {
  const url = roleIconUrl({ roleId });
  return (
    <span className="kf-name"
          style={{ color: teamColor(team) }}
          onClick={onClick} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}>
      {url && <img className="kf-role" src={url} alt="" />}
      {name}
    </span>
  );
}

function VehicleChip({ cls }: { cls: string | null }) {
  if (!cls) return null;
  const name = vehicleDisplayName(cls);
  return <span className="kf-veh" title={name}>{name}</span>;
}

interface RowProps { e: KillFeedEntry; select: (name: string | null) => void; }
function Row({ e, select }: RowProps) {
  const time = fmtGameTime(e.gameTimeSec);
  const rowCls = ["kf-row",
    e.wounded ? "kf-wounded" : "",
    e.tk ? "kf-tk" : "",
    e.suicide ? "kf-suicide" : "",
  ].filter(Boolean).join(" ");
  const worldCause = !e.killer && !e.suicide
    ? deathCauseFromDamageType(e.damageType) : null;

  // World-cause: single sentence row ("X fell to death")
  if (worldCause) {
    return (
      <div className={rowCls + " kf-row-world"}>
        <span className="kf-time">{time}</span>
        <NameChip name={e.victim} team={e.victimTeam} roleId={e.victimRoleId}
                  onClick={() => select(e.victim)} />
        <VehicleChip cls={e.victimVehicleClass} />
        <span className="kf-world-phrase" title={worldCause.title}>
          {deathCausePhrase(e.damageType)}
        </span>
      </div>
    );
  }

  const wLabel = weaponLabel(e);
  return (
    <div className={rowCls} title={e.wounded ? "Wounded (incap)" : undefined}>
      <span className="kf-time">{time}</span>
      {e.killer
        ? <NameChip name={e.killer} team={e.killerTeam} roleId={e.killerRoleId}
                    onClick={() => select(e.killer)} />
        : <span className="kf-name kf-name-mute">
            {e.suicide ? "Suicide" : "?"}
          </span>}
      <VehicleChip cls={e.killerVehicleClass} />
      <span className="kf-weapon">
        {wLabel && <span className="kf-weapon-label"
          title={e.weaponApprox ? "approximate — this player's last seen weapon, may not be the killing weapon" : undefined}>
          {wLabel}{e.weaponApprox ? " ?" : ""}</span>}
        {e.hitDistance != null && (
          <span className="kf-dist">{Math.round(e.hitDistance)} m</span>
        )}
        {e.headshot && <span className="kf-hs" title="Headshot">HS</span>}
        <span className="kf-arrow">›</span>
      </span>
      <NameChip name={e.victim} team={e.victimTeam} roleId={e.victimRoleId}
                onClick={() => select(e.victim)} />
      <VehicleChip cls={e.victimVehicleClass} />
    </div>
  );
}

export function KillFeed() {
  useStaticCatalogs();  // re-render once the weapon catalogs load in
  const entries = useViewerStore((s) => s.killFeed);
  const visible = useViewerStore((s) => s.killFeedVisible);
  const toggle  = useViewerStore((s) => s.toggleKillFeed);
  const clear   = useViewerStore((s) => s.clearKillFeed);
  const setSelectedPlayerKey = useViewerStore((s) => s.setSelectedPlayerKey);
  const setSelectedVehicleId = useViewerStore((s) => s.setSelectedVehicleId);

  // Resolve the clicked kill-feed name to the LIVE player's canonical key
  // (eosId) so the detail panel finds them. The feed only carries names, but
  // players are keyed by eosId — a raw name: key never matches a live player,
  // which is why clicking used to always say "oyuncu kayboldu". Read the
  // freshest snapshot at click time via getState() so the feed doesn't
  // re-render every tick. A dead/absent victim falls back to a name: key and
  // still shows the honest "kayboldu" panel.
  const select = (name: string | null) => {
    if (!name) return;
    const live = (useViewerStore.getState().curSnap?.players ?? [])
      .find((p) => p.name === name);
    setSelectedPlayerKey(
      live ? playerKey(live) : playerKey({ eosId: null, playerId: null, name }));
    setSelectedVehicleId(null);
  };

  return (
    <div id="killfeed" className={visible ? "kf-open" : "kf-collapsed"}>
      <header onClick={toggle} title="Show / hide">
        <span>Kills</span>
        <span className="kf-count">{entries.length}</span>
        <button className="kf-clear" onClick={(e) => { e.stopPropagation(); clear(); }}
                title="Clear">⨯</button>
      </header>
      {visible && (
        <div className="kf-body">
          {entries.length === 0 && (
            <div className="kf-empty">No kills yet</div>
          )}
          {entries.map((e) => <Row key={e.id} e={e} select={select} />)}
        </div>
      )}
    </div>
  );
}
