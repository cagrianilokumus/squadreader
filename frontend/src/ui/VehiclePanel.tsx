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
import { vehicleLoadout, type LoadoutWeapon } from "../data/vehicleLoadouts";
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

const SEAT_ROLE_LABELS: Record<string, string> = {
  Driver: "DRIVER", Gunner: "GUNNER", Passenger: "PASSENGER",
  Commander: "COMMANDER", Pilot: "PILOT", Loader: "LOADER",
  Crew: "CREW",
};

// Prefer the vehicle's REAL per-seat role from the loadout catalog (a
// passenger seat is not a "GUNNER", a commander/loader is not a generic
// "SEAT N"). Fall back to the positional label only when the seat is not
// in the catalog. An unmapped role (e.g. "TOW Gunner") is shown
// uppercased — descriptive beats a wrong one.
function seatRoleLabel(role: string | null | undefined, idx: number): string {
  if (!role) return seatLabel(idx);
  return SEAT_ROLE_LABELS[role] ?? role.toUpperCase();
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

// Ammo-type inference when the loadout catalog can't resolve the live
// weapon (emplacements, new vehicles). Ordered most-specific first — a
// Kornet must classify as atgm, not mg. Matches the tag- CSS colors.
function weaponTypeFromClass(cls: string | null | undefined): string {
  const s = (cls ?? "").toLowerCase();
  if (/smoke/.test(s)) return "smoke";
  if (/kornet|konkurs|tow|atgm|milan|_at_|maljutka|metis|hj[- _]?8/.test(s)) return "atgm";
  if (/zu23|zpu|flak|aa[_-]|antiair|stinger|igla/.test(s)) return "aa";
  if (/apfsds|sabot|_ap_|_ap$|_ap[_-]|kinetic|2a46|2a42|2a28|m256|l30|l55/.test(s)) return "kinetic";
  if (/heat|hesh|_he_|_he$/.test(s)) return "heat";
  if (/kord|dshk|pkt|coax|m240|m2$|_m2_|50cal|browning|hmg|autocannon|mg\b|c6|qjz|nsv/.test(s)) return "mg";
  return "mg";
}

function roleDisplay(role: string): string {
  return SEAT_ROLE_LABELS[role] ?? role.toUpperCase();
}

// Live magazine readout: one pip per magazine (fill = current/max), plus a
// total-rounds summary. Pips render partial belts (Kord 62/100) and count
// discrete shells (tank 19 AP rounds) with the same primitive.
function AmmoReadout({ cur, max, type }: {
  cur: number[]; max: number[]; type: string;
}) {
  const CAP = 30;
  const shown = cur.slice(0, CAP);
  const totalCur = cur.reduce((a, b) => a + b, 0);
  const totalMax = (max.length ? max : cur).reduce((a, b) => a + b, 0) || totalCur;
  const n = cur.length;
  return (
    <div className="vp-ammo">
      <div className={`vp-ammo-pips tag-${type}`}>
        {shown.map((c, i) => {
          const m = max[i] ?? c;
          const pf = m > 0 ? Math.max(0, Math.min(100, (c / m) * 100)) : 0;
          return (
            <span key={i} className="vp-pip" title={`${c}/${m}`}
                  style={{ ["--pf" as string]: `${pf}%` }} />
          );
        })}
        {n > CAP && <span className="vp-pip-more">+{n - CAP}</span>}
      </div>
      <span className={`vp-ammo-sum tag-${type}`}>
        {totalCur}<span className="vp-ammo-max">/{totalMax}</span>
        <span className="vp-ammo-lbl"> rds · {n} mag{n > 1 ? "s" : ""}</span>
      </span>
    </div>
  );
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

        {/* ---- CREW & WEAPONS: seat roster merged with each seat's live
             weapon + magazine ammo. Live turrets attach to seats by class,
             then by position (variant-suffix names like _IMF_C / _Woodland_C
             rarely match the base catalog key, so a class-only join dropped
             the ammo — the positional fallback below is what makes it show). ---- */}
        {(() => {
          const lo = vehicleLoadout(v.classShort);

          // Live turrets that actually carry ammo — the ones worth showing.
          const liveArmed = (v.turrets ?? []).filter(
            (t) => t.magazines && t.magazines.length > 0);
          const byClass = new Map<string, VehicleTurret[]>();
          for (const t of liveArmed) {
            const k = classKey(t.className);
            const q = byClass.get(k);
            if (q) q.push(t); else byClass.set(k, [t]);
          }
          const used = new Set<VehicleTurret>();
          const claimByClass = (turretClass: string | null): VehicleTurret | null => {
            if (!turretClass) return null;
            const q = byClass.get(classKey(turretClass));
            while (q && q.length) {
              const t = q.shift()!;
              if (!used.has(t)) { used.add(t); return t; }
            }
            return null;
          };

          const occByIdx = new Map<number, typeof displaySeats[number]>();
          for (const s of displaySeats) occByIdx.set(s.idx, s);

          type Row = {
            key: string; role: string;
            occ: typeof displaySeats[number] | null;
            live: VehicleTurret | null;
            switchable: LoadoutWeapon[];
            turretClass: string | null;
            isWeaponSeat: boolean;
          };
          const rows: Row[] = [];

          if (lo) {
            const usedIdx = new Set<number>();
            for (const seat of lo.seats) {
              usedIdx.add(seat.index);
              const switchable = seat.turretClass
                ? (lo.turrets[seat.turretClass]
                   ?? lo.turrets[classKey(seat.turretClass)] ?? [])
                : [];
              rows.push({ key: `s${seat.index}`, role: roleDisplay(seat.role),
                occ: occByIdx.get(seat.index) ?? null,
                live: claimByClass(seat.turretClass), switchable,
                turretClass: seat.turretClass,
                isWeaponSeat: !!seat.turretClass && switchable.length > 0 });
            }
            for (const s of displaySeats) {
              if (usedIdx.has(s.idx)) continue;
              rows.push({ key: `x${s.idx}`,
                role: seatRoleLabel(seatRoleByIdx.get(s.idx), s.idx),
                occ: s, live: null, switchable: [], turretClass: null,
                isWeaponSeat: false });
            }
          } else {
            for (const s of displaySeats) {
              rows.push({ key: `s${s.idx}`,
                role: seatRoleLabel(seatRoleByIdx.get(s.idx), s.idx),
                occ: s, live: null, switchable: [], turretClass: null,
                isWeaponSeat: false });
            }
          }

          // Positional fallback: armed live turrets not claimed by class fill
          // the next weapon-seat still lacking one, in order; anything still
          // unclaimed becomes its own WEAPON row (emplacements, driver smoke).
          const leftover = liveArmed.filter((t) => !used.has(t));
          if (leftover.length) {
            for (const r of rows) {
              if (!leftover.length) break;
              if (r.isWeaponSeat && !r.live) {
                r.live = leftover.shift()!; used.add(r.live);
              }
            }
            leftover.forEach((t, i) => rows.push({ key: `o${i}`, role: "WEAPON",
              occ: null, live: t, switchable: [], turretClass: null,
              isWeaponSeat: true }));
          }

          // Active weapon label: the live currentWeapon class, named via the
          // switchable catalog when it matches, else humanised / inferred.
          const activeWeapon = (r: Row) => {
            const activeCls = r.live?.weaponClass || null;
            if (activeCls) {
              const m = r.switchable.find(
                (w) => classKey(w.class) === classKey(activeCls));
              return { name: m?.name ?? vehicleWeaponDisplayName(activeCls),
                       type: m?.type ?? weaponTypeFromClass(activeCls) };
            }
            if (r.switchable.length > 0)
              return { name: r.switchable[0]!.name,
                       type: r.switchable[0]!.type
                             ?? weaponTypeFromClass(r.turretClass) };
            if (r.turretClass)
              return { name: humanWeapon(r.turretClass),
                       type: weaponTypeFromClass(r.turretClass) };
            return { name: null as string | null, type: null as string | null };
          };

          return (
            <>
              <h3>CREW &amp; WEAPONS ({occupiedSeats}/{totalSeats})</h3>
              <div className="vp-crew">
                {rows.map((r) => {
                  const hasAmmo = !!(r.live?.magazines
                    && r.live.magazines.length > 0);
                  const { name: wepName, type: wepType } = activeWeapon(r);
                  return (
                    <div key={r.key} className={"vp-crew-row"
                      + (r.occ?.occupantName ? " occ" : "")
                      + (hasAmmo ? " armed" : "")}>
                      <div className="vp-crew-head">
                        <span className="vp-crew-role">{r.role}</span>
                        {r.occ?.occupantName ? (
                          <span className="vp-crew-occ">
                            <span className="dot" style={{
                              background: teamColor(r.occ.occupantTeamId) }} />
                            {r.occ.occupantName}
                          </span>
                        ) : r.occ ? (
                          <span className="vp-crew-empty">empty</span>
                        ) : null}
                      </div>
                      {wepName && (hasAmmo || r.isWeaponSeat) && (
                        <div className="vp-crew-wep">
                          <span className="vp-w-name">{wepName}</span>
                          {wepType && (
                            <span className={`vp-w-type tag-${wepType}`}>
                              {wepType}
                            </span>
                          )}
                        </div>
                      )}
                      {hasAmmo && (
                        <AmmoReadout cur={r.live!.magazines!}
                          max={r.live!.magazinesMax ?? r.live!.magazines!}
                          type={wepType ?? "mg"} />
                      )}
                      {r.isWeaponSeat && r.switchable.length > 1 && (
                        <div className="vp-crew-loadout">
                          {r.switchable.map((w, wi) => (
                            <span key={w.class + wi}
                                  className={`vp-load-chip tag-${w.type ?? "mg"}`}
                                  title={w.caliber ?? ""}>
                              {w.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {!v.seats && occupiedSeats > 0 && (
                <div className="note" style={{ marginTop: 8 }}>
                  seat slots inferred by position
                </div>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
