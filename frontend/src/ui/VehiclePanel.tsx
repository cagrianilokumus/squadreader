// Detail panel pinned to the right side when a vehicle is clicked.
// Prefers the backend-supplied `vehicle.seats[]` (real occupancy from
// SQVehicleSeatComponent.SeatedPlayer reflection). Falls back to the
// position-join heuristic for snapshots without that field.

import { useState } from "react";
import { teamColor } from "../canvas/draw";
import { passengersOf } from "../canvas/passengers";
import { useViewerStore } from "../state/viewerStore";
import type { VehicleComponent, VehicleSeat, VehicleTurret } from "../state/types";
import { vehicleDisplayName } from "../data/vehicleDisplayNames";
import { vehiclePhotoUrl } from "../data/vehiclePhotos";
import { vehicleLoadout } from "../data/vehicleLoadouts";
import { vehicleWeaponDisplayName } from "../data/vehicleWeaponsStatic";
import { useStaticCatalogs } from "../data/staticCatalogs";

function fmtInt(v: number | null | undefined) {
  return v == null ? "—" : Math.round(v).toString();
}

// Vehicle render photo banner (from the SquadCalc asset set). Self-hides if
// the file 404s — the mapping is manifest-gated so that's only a safety net.
// Parent passes key={url} so switching vehicles remounts and resets `err`.
function VehiclePhoto({ url }: { url: string }) {
  const [err, setErr] = useState(false);
  if (err) return null;
  return (
    <div className="vp-photo">
      <img src={url} alt="" loading="lazy" onError={() => setErr(true)} />
    </div>
  );
}

function seatLabel(idx: number) {
  if (idx === 0) return "DRIVER";
  if (idx === 1) return "GUNNER";
  return `SEAT ${idx + 1}`;
}

const SEAT_ROLE_TR: Record<string, string> = {
  Driver: "DRIVER", Gunner: "GUNNER", Passenger: "PASSENGER",
  Commander: "COMMANDER", Pilot: "PILOT", Loader: "LOADER",
  Crew: "CREW",
};

// Prefer the vehicle's REAL per-seat role from the loadout catalog (a
// passenger seat is not "NİŞANCI"/Gunner, a commander/loader is not a
// generic "KOLTUK N"). Fall back to the positional label only when the
// seat isn't in the catalog. Unmapped English roles (e.g. "TOW Gunner")
// are shown uppercased — descriptive beats a wrong Turkish label.
function seatRoleLabel(role: string | null | undefined, idx: number): string {
  if (!role) return seatLabel(idx);
  return SEAT_ROLE_TR[role] ?? role.toUpperCase();
}

// Vehicle component classification — drives the panel layout. Matches
// against the SQVehicleComponent subclass + the BP component name.
type CompSlot = "engine" | "ammo" | "turretBase" | "rotorMain" | "rotorTail"
              | "wheelL" | "wheelR" | "trackL" | "trackR" | "other";

function classifyComponent(c: VehicleComponent): { slot: CompSlot; idx: number; label: string } {
  const n = c.name;
  const cls = c.className;
  if (cls === "SQVehicleEngine" || /engine/i.test(n))
    return { slot: "engine", idx: 0, label: "Engine" };
  if (cls === "SQVehicleAmmoBox" || /ammo/i.test(n))
    return { slot: "ammo", idx: 0, label: "Ammo" };
  if (/Main.?Rotor/i.test(n) || /MainBlade/i.test(n))
    return { slot: "rotorMain", idx: 0, label: "Rotor" };
  if (/Tail.?Rotor/i.test(n) || /TailBlade/i.test(n))
    return { slot: "rotorTail", idx: 0, label: "Tail" };
  const wheelMatch = n.match(/wheel_([LR])(\d+)/i);
  if (wheelMatch) {
    const side = wheelMatch[1]!.toUpperCase();
    const idx = parseInt(wheelMatch[2]!, 10);
    return {
      slot: side === "L" ? "wheelL" : "wheelR",
      idx,
      label: `${side}${idx}`,
    };
  }
  if (/^TrackLeft/i.test(n))  return { slot: "trackL", idx: 0, label: "Left Track" };
  if (/^TrackRight/i.test(n)) return { slot: "trackR", idx: 0, label: "Right Track" };
  if (/turret/i.test(n))      return { slot: "turretBase", idx: 0, label: "Turret" };
  // Strip "Component" suffix for readability
  const label = n.replace(/Component$/i, "");
  return { slot: "other", idx: 0, label };
}

function compHpColor(hp: number | null, max: number | null): string {
  if (hp == null || max == null || max <= 0) return "var(--ink-mute)";
  const pct = (hp / max) * 100;
  if (pct >= 75) return "var(--good)";
  if (pct >= 25) return "var(--warn)";
  return "var(--bad)";
}

interface CompIndicatorProps { c: VehicleComponent; }
function CompIndicator({ c }: CompIndicatorProps) {
  const info = classifyComponent(c);
  const hp = c.health ?? 0;
  const max = c.maxHealth ?? 1;
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const col = compHpColor(c.health, c.maxHealth);
  const destroyed = c.state === 2 || hp <= 0;
  return (
    <div className="vc-ind" title={`${info.label}: ${Math.round(pct)}% (${Math.round(hp)}/${Math.round(max)})`}>
      <div className="vc-bar"><div className="vc-bar-fill"
            style={{ width: `${pct}%`, background: col,
                     opacity: destroyed ? 0.3 : 1 }} /></div>
      <div className="vc-label" style={{ color: col }}>{info.label}</div>
    </div>
  );
}

function humanWeapon(s: string): string {
  return s.replace(/^BP_/, "").replace(/_C(?:_\d+)?$/, "").replace(/_/g, " ");
}

// Normalise turret/weapon class identifiers so live-data (with UE
// instance index, with `_C` suffix) compares to catalog keys (without).
function classKey(s: string | null | undefined): string {
  return (s ?? "").replace(/_\d+$/, "").replace(/_C$/, "");
}

export function VehiclePanel() {
  useStaticCatalogs();  // re-render once the vehicle catalogs load in
  const id = useViewerStore((s) => s.selectedVehicleId);
  const snap = useViewerStore((s) => s.curSnap);
  const close = useViewerStore((s) => s.setSelectedVehicleId);
  const followVehicleId = useViewerStore((s) => s.followVehicleId);
  const setFollowVehicle = useViewerStore((s) => s.setFollowVehicleId);

  if (!id) return null;
  const v = snap?.vehicles?.find((x) => x.id === id) ?? null;
  if (!v) {
    // Vehicle is gone (destroyed / left the world). Show a thin
    // "lost" stub so the user knows why their panel went dark.
    return (
      <div id="vehicle-panel">
        <header>
          <h2>vehicle lost</h2>
          <button onClick={() => close(null)} title="close">✕</button>
        </header>
        <div className="body">
          <div className="row" style={{ opacity: 0.6 }}>
            id <span style={{ fontFamily: "monospace" }}>{id}</span>
          </div>
          <div style={{ opacity: 0.6, marginTop: 8 }}>
            no longer in the snapshot — destroyed, lost, or out of range
          </div>
        </div>
      </div>
    );
  }

  const hp = v.health ?? 0;
  const hpMax = v.maxHealth ?? 0;
  const hpPct = hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
  const hpColor = hpPct > 50 ? "var(--good)"
                 : hpPct > 25 ? "var(--warn)"
                 : "var(--bad)";
  const alive = hp > 0;

  // Prefer the real seat array from the backend (post-Phase B). It
  // includes empty slots as well so the panel shows full seat layout.
  // When the field is missing, fall back to the position-join heuristic
  // — only emits occupied seats, no empty slots.
  let displaySeats: { idx: number; occupantName: string | null;
                       occupantTeamId?: number | null;
                       occupantEosId?: string | null;
                       seatHealth?: number | null }[];
  let totalSeats = 0;
  let occupiedSeats = 0;
  if (v.seats && v.seats.length > 0) {
    displaySeats = v.seats as VehicleSeat[];
    totalSeats = v.seats.length;
    occupiedSeats = v.seats.filter((s) => s.occupantName).length;
  } else {
    const fallback = passengersOf(snap, v);
    displaySeats = fallback.map((p, i) => ({
      idx: i,
      occupantName: p.name,
      occupantTeamId: p.teamId,
      occupantEosId: p.eosId,
    }));
    totalSeats = fallback.length;
    occupiedSeats = fallback.length;
  }

  // Real per-seat roles from the loadout catalog, keyed by seat index.
  const seatRoleByIdx = new Map<number, string>();
  for (const s of vehicleLoadout(v.classShort)?.seats ?? []) {
    seatRoleByIdx.set(s.index, s.role);
  }

  return (
    <div id="vehicle-panel">
      <header>
        <h2>
          <span className="dot" style={{ background: teamColor(v.team) }} />
          {vehicleDisplayName(v.classShort)}
        </h2>
        <div className="vp-head-actions">
          <button className={"vp-follow" + (followVehicleId === v.id ? " on" : "")}
                  onClick={() => setFollowVehicle(followVehicleId === v.id ? null : v.id)}
                  title="follow this vehicle">
            {followVehicleId === v.id ? "FOLLOW ✓" : "FOLLOW"}
          </button>
          <button onClick={() => close(null)} title="close (esc)">✕</button>
        </div>
      </header>
      <div className="body">
        {(() => {
          const photoUrl = vehiclePhotoUrl(v.classShort);
          return photoUrl ? <VehiclePhoto key={photoUrl} url={photoUrl} /> : null;
        })()}
        <div className="meta">
          <span>Team: <b>{v.team ?? "—"}</b></span>
          <span>Status: <b className={alive ? "alive" : "dead"}>
            {alive ? "Intact" : "Destroyed"}
          </b></span>
          {v.kind && <span>Type: <b>{v.kind}</b></span>}
        </div>

        <div className="hp-row">
          <span className="hp-label">{fmtInt(hpPct)}%</span>
          <div className="hp-bar">
            <div className="hp-fill"
                 style={{ width: `${hpPct}%`, background: hpColor }} />
          </div>
          <span className="hp-num">{fmtInt(hp)}/{fmtInt(hpMax)}</span>
        </div>

        {v.attached && (
          <div className="note">attached to another object / parked</div>
        )}
        {v.lastDamager && (
          <div className="note">last hit by: {v.lastDamager.name ?? "?"}</div>
        )}

        {v.resourcePools && v.resourcePools.length > 0 && (() => {
          // Modern logi trucks carry two SEPARATE pools: AmmoResourceWeapon_C
          // (ammo) and ConstructionResourceWeapon_C (build). Some factions'
          // trucks instead carry one COMBINED AmmoWep supply crate, named by
          // capacity (AmmoWep_1000_C / _2000_C) or carrying "Logi"
          // (AmmoWep_technicalLogi_C). A combat vehicle's built-in ammo is
          // type-named (AmmoWep_APC_C / _LightVehicle_C / _Helicopter_C) or a
          // small capacity (AmmoWep_50_C — a tank's main-gun rounds).
          // So: a Construction* pool, a *Logi* name, or a 3+-digit AmmoWep
          // capacity is the build/logistics supply; everything else (Ammo*,
          // the small _50_C, APC / LightVehicle / …) is ammo.
          const isSupply = (c: string) =>
            /construction/i.test(c) || /logi/i.test(c) || /^AmmoWep_\d{3,}_C$/.test(c);
          const ammoPools   = v.resourcePools.filter(
            (p) => !(p.className && isSupply(p.className)));
          const supplyPools = v.resourcePools.filter(
            (p) => p.className && isSupply(p.className));
          const fmt = (n: number | null) => n == null ? "—" : String(n);
          const pct = (cur: number | null, mx: number | null) =>
            (cur == null || mx == null || mx <= 0) ? 0
              : Math.max(0, Math.min(100, (cur / mx) * 100));
          const barColor = (p: number) =>
            p > 50 ? "var(--good)" : p > 25 ? "var(--warn)" : "var(--bad)";
          const Row = ({ p, iconUrl, alt, label }: { p: typeof v.resourcePools[0];
                                              iconUrl: string; alt: string; label: string }) => {
            const cur = p.current ?? 0;
            const mx  = p.max ?? 0;
            const pp  = pct(p.current, p.max);
            return (
              <div className="vp-res-row">
                <img className="vp-res-icon" src={iconUrl} alt={alt} title={label} />
                <span className="vp-res-tag">{label}</span>
                <div className="vp-res-bar">
                  <div className="vp-res-fill"
                       style={{ width: `${pp}%`, background: barColor(pp) }} />
                </div>
                <span className="vp-res-num">{fmt(p.current)}/{fmt(p.max)}</span>
                <span className="vp-res-pct" style={{ color: barColor(pp) }}>
                  {Math.round(pp)}%
                </span>
                {/* Use cur/mx to silence unused-var warning when both 0. */}
                <span style={{ display: "none" }}>{cur}/{mx}</span>
              </div>
            );
          };
          return (
            <>
              <h3>RESOURCES</h3>
              <div className="vp-res-grid">
                {ammoPools.map((p, i) => (
                  <Row key={"a" + i} p={p} alt="ammo" label="AMMO"
                       iconUrl="./icons/general/supplies_ammo_square.png" />
                ))}
                {supplyPools.map((p, i) => (
                  <Row key={"s" + i} p={p} alt="supply" label="BUILD"
                       iconUrl="./icons/general/supplies_construction_square.png" />
                ))}
              </div>
            </>
          );
        })()}

        {v.components && v.components.length > 0 && (
          <>
            <h3>COMPONENTS</h3>
            <div className="vc-grid">
              {(() => {
                // Group by anatomical slot so the layout matches the
                // legacy 3-column wheels|center|wheels arrangement.
                const groups: Record<CompSlot, VehicleComponent[]> = {
                  engine: [], ammo: [], turretBase: [],
                  rotorMain: [], rotorTail: [],
                  wheelL: [], wheelR: [], trackL: [], trackR: [],
                  other: [],
                };
                for (const c of v.components!) {
                  groups[classifyComponent(c).slot].push(c);
                }
                // Sort wheels by index (L1, L2, L3, ...)
                const byIdx = (a: VehicleComponent, b: VehicleComponent) =>
                  classifyComponent(a).idx - classifyComponent(b).idx;
                groups.wheelL.sort(byIdx);
                groups.wheelR.sort(byIdx);

                const isHeli = groups.rotorMain.length + groups.rotorTail.length > 0;
                const leftCol = isHeli ? [] : [...groups.wheelL, ...groups.trackL];
                const rightCol = isHeli ? [] : [...groups.wheelR, ...groups.trackR];
                const centerCol = isHeli
                  ? [...groups.rotorMain, ...groups.engine, ...groups.rotorTail]
                  : [...groups.turretBase, ...groups.ammo, ...groups.engine];

                return (
                  <>
                    <div className="vc-col">
                      {leftCol.map((c, i) =>
                        <CompIndicator key={c.name + i} c={c} />)}
                    </div>
                    <div className="vc-col vc-col-mid">
                      {centerCol.map((c, i) =>
                        <CompIndicator key={c.name + i} c={c} />)}
                    </div>
                    <div className="vc-col">
                      {rightCol.map((c, i) =>
                        <CompIndicator key={c.name + i} c={c} />)}
                    </div>
                  </>
                );
              })()}
            </div>
            {/* "Other" components below the grid (driver-mounted smoke,
                etc.) when they exist. Helps prevent silent data loss
                while we expand the classifier. */}
            {(() => {
              const others = v.components!.filter((c) =>
                classifyComponent(c).slot === "other");
              if (others.length === 0) return null;
              return (
                <div className="vc-other">
                  {others.map((c, i) =>
                    <CompIndicator key={c.name + i} c={c} />)}
                </div>
              );
            })()}
          </>
        )}

        {v.turrets && v.turrets.length > 0 && (() => {
          // Loadout-aware turret rendering: when VEHICLE_LOADOUTS has an
          // entry for this vehicle, we know which turret class belongs
          // to which seat role (Driver / Gunner / Commander / RWS …) AND
          // the full list of switchable weapons per turret with caliber
          // tags. Falls back to a flat turret-class list when the vehicle
          // isn't in the loadout catalog (emplacements, new vehicles).
          const lo = vehicleLoadout(v.classShort);
          if (!lo) {
            return (
              <>
                <h3>TURRETS ({v.turrets!.length})</h3>
                <table className="seats">
                  <tbody>
                    {v.turrets!.map((t: VehicleTurret, i) => (
                      <tr key={t.name + i}>
                        <td className="role">{`T${i + 1}`}</td>
                        <td className="who">{humanWeapon(t.className)}
                          {t.magazines && t.magazines.length > 0 && (
                            <span className="tag2">
                              {t.magazines[0]}{t.magazines.length > 1
                                ? ` (+${t.magazines.length - 1})` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            );
          }
          // Live turrets grouped by normalised class as a QUEUE per class,
          // not a single entry — a vehicle can carry two turret actors of
          // the SAME class (e.g. twin door guns), and a last-write-wins Map
          // would show both door seats the same magazine count. Each loadout
          // seat below consumes the next unused live turret of its class.
          const liveByClass = new Map<string, VehicleTurret[]>();
          for (const t of v.turrets!) {
            const k = classKey(t.className);
            const q = liveByClass.get(k);
            if (q) q.push(t); else liveByClass.set(k, [t]);
          }
          return (
            <>
              <h3>TURRETS</h3>
              {lo.seats
                .filter((seat) => seat.turretClass !== null)
                .map((seat) => {
                  const tClassKey = classKey(seat.turretClass);
                  const live = liveByClass.get(tClassKey)?.shift();
                  const weps = lo.turrets[seat.turretClass!]
                            ?? lo.turrets[tClassKey]
                            ?? [];
                  return (
                    <div key={seat.index} className="vp-turret-block">
                      <div className="vp-turret-head">
                        <span className="vp-turret-role">{seat.role}</span>
                        <span className="vp-turret-name">
                          {humanWeapon(seat.turretClass ?? "")}
                        </span>
                      </div>
                      {weps.length === 0 ? (
                        <div className="empty">no weapon</div>
                      ) : (
                        <ul className="vp-weapon-list">
                          {weps.map((w, wi) => (
                            <li key={w.class + wi}>
                              <span className="vp-w-name">
                                {w.name}
                                {w.caliber && (
                                  <span className="vp-w-cal"> ({w.caliber})</span>
                                )}
                              </span>
                              {w.mags != null && w.magSize != null && (
                                <span className="vp-w-cap">
                                  {w.mags}×{w.magSize}
                                </span>
                              )}
                              {w.type && (
                                <span className={`vp-w-type tag-${w.type}`}>
                                  {w.type}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      {/* Live magazine count from the actor (when reads work) */}
                      {live?.magazines && live.magazines.length > 0 && (
                        <div className="vp-turret-live">
                          live mag: {live.magazines[0]}
                          {live.magazines.length > 1
                            && ` (+${live.magazines.length - 1})`}
                        </div>
                      )}
                    </div>
                  );
                })}
              {/* Orphan turrets reported by the actor but not mapped by the
                  loadout (driver smoke launchers etc.) */}
              {(() => {
                const mappedKeys = new Set(
                  lo.seats
                    .filter((s) => s.turretClass)
                    .map((s) => classKey(s.turretClass)));
                const orphans = v.turrets!.filter((t) =>
                  !mappedKeys.has(classKey(t.className)));
                if (orphans.length === 0) return null;
                return (
                  <>
                    <h3>OTHER TURRETS</h3>
                    <table className="seats">
                      <tbody>
                        {orphans.map((t, i) => (
                          <tr key={t.name + i}>
                            <td className="role">·</td>
                            <td className="who">
                              {vehicleWeaponDisplayName(t.className)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                );
              })()}
            </>
          );
        })()}

        <h3>SEATS ({occupiedSeats}/{totalSeats})</h3>
        {totalSeats === 0 ? (
          <div className="empty">empty</div>
        ) : (
          <table className="seats">
            <tbody>
              {displaySeats.map((s) => (
                <tr key={s.idx}
                    className={s.occupantName ? "occupied" : "empty-seat"}>
                  <td className="role">{seatRoleLabel(seatRoleByIdx.get(s.idx), s.idx)}</td>
                  <td className="who">
                    {s.occupantName ? (
                      <>
                        <span className="dot"
                              style={{ background: teamColor(s.occupantTeamId) }} />
                        {s.occupantName}
                      </>
                    ) : (
                      <span style={{ opacity: .4 }}>—</span>
                    )}
                  </td>
                  {s.seatHealth != null && s.seatHealth < 100 && (
                    <td className="seat-hp"
                        style={{ color: s.seatHealth > 50
                                  ? "var(--good)"
                                  : s.seatHealth > 25
                                  ? "var(--warn)"
                                  : "var(--bad)" }}>
                      {Math.round(s.seatHealth)}%
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!v.seats && occupiedSeats > 0 && (
          <div className="note" style={{ marginTop: 8 }}>
            seat slots inferred by position (backend doesn't expose
            per-seat data on this snapshot)
          </div>
        )}
      </div>
    </div>
  );
}
