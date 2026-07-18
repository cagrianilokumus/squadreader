// Infantry-weapon catalog (1015 entries mapping a weapon class shortname to its
// display name + icon path). Originally cota.squadreplay.com/static/data/
// weapons_static.json.
//
// The 217 KB of data is now loaded on demand (see staticCatalogs.ts) rather than
// bundled; `weaponStatic` reads the live map, which is empty until the fetch
// lands and then populated. `weaponDisplayName` already falls back to a humanised
// class name, so callers see readable text throughout.
//
// Live snapshot data carries `BP_X_C` (with the UE class-suffix); catalog
// keys are `BP_X` (no suffix). `weaponStatic()` tries both shapes.

import { weaponsCatalog } from "./staticCatalogs";

export interface WeaponStatic {
  category?: string;
  displayName?: string;
  iconKey?: string;
  iconPath?: string;
  maxMags?: number;
}

export function weaponStatic(classShort: string | null | undefined):
  WeaponStatic | null {
  if (!classShort) return null;
  const RAW = weaponsCatalog();
  if (RAW[classShort]) return RAW[classShort]!;
  const stripped = classShort.replace(/_C$/, "");
  return RAW[stripped] ?? null;
}

// Resolve a class shortname into a human-readable label. Falls back to
// a humanised version of the raw blueprint name when the catalog has
// no entry — covers experimental/new weapons before the catalog ships
// an update.
export function weaponDisplayName(classShort: string | null | undefined): string {
  const w = weaponStatic(classShort);
  if (w?.displayName) return w.displayName;
  if (!classShort) return "?";
  return classShort
    .replace(/^BP_/, "")
    .replace(/_C$/, "")
    .replace(/_/g, " ");
}
