// A recording whose layer the recorder could not identify still has to draw a
// map. 43 of 963 matches in the archive carry no `layer` block — Jensen's
// Training Range, and mostly scrim layers a community named after itself —
// and the canvas showed them as a bare grid. Framework-free, as the tests
// beside it are.
import { fallbackMap } from "./mapFallback.ts";

let passed = 0, failed = 0;
function ok(cond: any, msg: string) {
  if (cond) { passed++; } else { failed++; console.error("  FAIL:", msg); }
}

// --- the names that were actually failing -----------------------------------
{
  const cases: [string, string][] = [
    ["Jensen's Training Range", "Jensen"],
    ["SEC 26 Sumari AAS v1", "Sumari"],
    ["FCL Narva", "Narva"],
    ["FCL Kokan", "Kokan"],
    ["FCL AlBasrah", "AlBasrah"],
    ["FCL Anvil", "Anvil"],
    ["BALT 26 AlBasrah AAS v1", "AlBasrah"],
    ["SAT Tallil Seed v1", "Tallil"],
    ["Mutaha S3O v1", "Mutaha"],
    // A server tag in front of a two-word map: the stats heatmap reported
    // these as having no bounds at all.
    ["RS Black Coast RAAS v2", "BlackCoast"],
    ["RS Al Basrah RAAS v1", "AlBasrah"],
    ["RS Narva RAAS v1", "Narva"],
    ["Al Basrah RAAS v3", "AlBasrah"],
  ];
  for (const [name, want] of cases) {
    const got = fallbackMap(name);
    ok(got?.texture === want,
       `${name} -> ${got ? got.texture : "nothing"}, want ${want}`);
  }
}

// --- it must bring bounds, not just a picture -------------------------------
{
  const m = fallbackMap("Jensen's Training Range")!;
  ok(m && typeof m.topLeft.x === "number" && typeof m.bottomRight.y === "number",
     "a fallback carries the world bounds the canvas needs");
  ok(m.topLeft.x < m.bottomRight.x, "bounds are the right way round");
}

// --- and it must not invent a map -------------------------------------------
{
  ok(fallbackMap("OCBT Shchyhliivka AAS v1") === null,
     "a map we do not ship stays unmatched rather than becoming a wrong one");
  ok(fallbackMap("") === null, "an empty name matches nothing");
  ok(fallbackMap(null) === null, "a missing name matches nothing");
  ok(fallbackMap(undefined) === null, "an absent name matches nothing");
  // A short fragment must never match: "FCL" and "26" are not maps.
  ok(fallbackMap("FCL") === null, "a clan tag alone matches nothing");
  ok(fallbackMap("SEC 26") === null, "a tag and a number match nothing");
}

// --- the ordinary case still works ------------------------------------------
{
  ok(fallbackMap("Narva")?.texture === "Narva", "a plain map name resolves");
  ok(fallbackMap("Al Basrah")?.texture === "AlBasrah",
     "a space is not a reason to fail");
  ok(fallbackMap("albasrah")?.texture === "AlBasrah", "casing does not matter");
}

console.log(`mapFallback: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
