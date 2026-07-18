// Vehicle-weapon catalog (tank shells, MG belts, ATGM rounds, etc.).
// Imported from cota.squadreplay.com/static/data/vehicle_weapons_static.json.
//
// Per-entry fields: displayName, maxMags (full vehicle capacity),
// roundsPerMag (1 for tank shells, 2000 for coax belts), muzzleVelocity
// (cm/s — divide by 100 for m/s), rearmSeconds, firemodes.

// The 144 KB of data is loaded on demand (staticCatalogs.ts), not bundled; the
// lookup reads the live map (empty until the fetch lands) and the display-name
// helper falls back to a humanised class name meanwhile.
import { vehicleWeaponsCatalog } from "./staticCatalogs";

export interface VehicleWeaponStatic {
  displayName?: string;
  iconKey?: string;
  iconPath?: string;
  maxMags?: number;
  roundsPerMag?: number;
  muzzleVelocity?: number;
  rearmSeconds?: number;
  rearmRoundsPerItem?: number;
  firemodes?: number[];
  timeBetweenShots?: number;
}

export function vehicleWeaponStatic(classShort: string | null | undefined):
  VehicleWeaponStatic | null {
  if (!classShort) return null;
  const RAW = vehicleWeaponsCatalog();
  if (RAW[classShort]) return RAW[classShort]!;
  const stripped = classShort.replace(/_C$/, "");
  return RAW[stripped] ?? null;
}

export function vehicleWeaponDisplayName(classShort: string | null | undefined): string {
  const w = vehicleWeaponStatic(classShort);
  if (w?.displayName) return w.displayName;
  if (!classShort) return "?";
  return classShort
    .replace(/^BP_/, "")
    .replace(/_C$/, "")
    .replace(/_/g, " ");
}
