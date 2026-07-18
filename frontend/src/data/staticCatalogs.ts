// The infantry- and vehicle-weapon catalogs are ~360 KB of static JSON that only
// decorate kill-feed rows and the detail panels with names + icons. They used to
// be statically imported, so they sat in the entry chunk and every visitor paid
// for them on first paint — even someone who only ever watches the map.
//
// They are pulled at runtime instead, via dynamic import() so Vite emits them as
// their own on-demand chunks. Every lookup already degrades to a humanised class
// name (see weaponsStatic / vehicleWeaponsStatic), so the brief window before the
// catalogs land shows a readable fallback rather than nothing; when they arrive a
// version bump re-renders the handful of components that read them.

import { useSyncExternalStore } from "react";
import type { WeaponStatic } from "./weaponsStatic";
import type { VehicleWeaponStatic } from "./vehicleWeaponsStatic";

let weapons: Record<string, WeaponStatic> = {};
let vehicleWeapons: Record<string, VehicleWeaponStatic> = {};
let version = 0;
let started = false;
const listeners = new Set<() => void>();

function bump(): void {
  version++;
  for (const l of listeners) l();
}

// Fire-and-forget; safe to call repeatedly (guarded). Both fetches fail silently
// — a missing catalog just means lookups keep returning the humanised fallback.
export function ensureCatalogs(): void {
  if (started) return;
  started = true;
  import("./weapons_static.json")
    .then((m) => { weapons = m.default as Record<string, WeaponStatic>; bump(); })
    .catch(() => { started = false; });   // allow a retry on the next mount
  import("./vehicle_weapons_static.json")
    .then((m) => { vehicleWeapons = m.default as Record<string, VehicleWeaponStatic>; bump(); })
    .catch(() => { started = false; });
}

export function weaponsCatalog(): Record<string, WeaponStatic> {
  return weapons;
}
export function vehicleWeaponsCatalog(): Record<string, VehicleWeaponStatic> {
  return vehicleWeapons;
}

// Components that render weapon names/icons call this once so they re-render when
// the catalogs finish loading. The returned version number is intentionally
// unused by callers — subscribing is the whole point.
export function useStaticCatalogs(): number {
  return useSyncExternalStore(
    (cb) => {
      ensureCatalogs();
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    () => version,
    () => version,
  );
}
