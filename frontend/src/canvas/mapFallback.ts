// Drawing the map when the recording never said which map it is.
//
// The recorder attaches a `layer` block — texture plus world bounds — by
// looking the live map name up in a table keyed by the exact display layer
// name. A community that names its scrim layer after itself ("SEC 26 Sumari
// AAS v1", "FCL Narva") misses that lookup entirely, so the frames carry no
// layer and the canvas draws a bare grid: it needs a texture AND bounds, and
// has neither. Measured on the archive: 43 of 963 matches.
//
// Fixing the recorder would only help matches recorded from then on — the
// frames already written will never grow a layer block. So the fallback works
// from the MAP name, which those frames do carry, using the same idea the
// server uses to find a minimap file: normalise the separators, then try the
// individual words longest-first, because a clan tag is nearly always shorter
// than a map name.
import { MAP_FALLBACKS, type FallbackMap } from "./mapFallbackData";

const cache = new Map<string, FallbackMap | null>();

/** Letters and digits only — "Al Basrah" and "AlBasrah" have to meet. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const BY_NORM: Map<string, FallbackMap> = (() => {
  const m = new Map<string, FallbackMap>();
  for (const [id, v] of MAP_FALLBACKS) m.set(norm(id), v);
  return m;
})();

/** Strip the layer decoration a display name carries: `AAS v1`, `RAAS v2`,
 *  `Seed v1`, `Invasion v3`, `Skirmish`, and a bare trailing `v1`. */
const DECORATION =
  /\b(aas|raas|rass|invasion|skirmish|seed|training|tc|destruction|insurgency|track attack)\b|\bv\d+\b|\bs\d+o\b/gi;

/**
 * The map to draw for a recording that carries no layer, or null when the
 * name matches nothing we ship. Null means "draw the grid", which is what
 * happens today — this only ever adds a map, never replaces a real one.
 */
export function fallbackMap(mapName: string | null | undefined): FallbackMap | null {
  if (!mapName) return null;
  const hit = cache.get(mapName);
  if (hit !== undefined) return hit;

  const cleaned = mapName.replace(DECORATION, " ");
  let found: FallbackMap | null = BY_NORM.get(norm(cleaned))
    ?? BY_NORM.get(norm(mapName))
    ?? null;

  if (!found) {
    // Runs of adjacent words, longest first: a server tag in front of a
    // two-word map ("RS Black Coast", "RS Al Basrah") hides it from both
    // whole-name lookups above, and no single word of it is a map id.
    const all = cleaned.split(/\s+/).filter(Boolean);
    for (let len = all.length - 1; len >= 2 && !found; len--) {
      for (let i = 0; i + len <= all.length && !found; i++) {
        found = BY_NORM.get(norm(all.slice(i, i + len).join(""))) ?? null;
      }
    }
  }

  if (!found) {
    // Longest word first: "FCL AlBasrah" must find AlBasrah, not FCL, and a
    // two-letter fragment must never match anything at all.
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 3)
      .sort((a, b) => b.length - a.length);
    for (const w of words) {
      const n = norm(w);
      // A possessive is part of how the map is written, not part of its id:
      // "Jensen's Training Range" is the map called Jensen. No map we ship
      // ends in an s, so dropping one cannot collide with a real name.
      const m = BY_NORM.get(n)
        ?? (n.endsWith("s") ? BY_NORM.get(n.slice(0, -1)) : undefined);
      if (m) { found = m; break; }
    }
  }
  cache.set(mapName, found);
  return found;
}
