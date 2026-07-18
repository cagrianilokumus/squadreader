// Icon URL resolvers + Image cache + alpha-bbox auto-fit for
// visual-weight normalisation. Ported from the old viewer; no React.

import type { Deployable, Marker, Vehicle } from "../state/types";

interface CachedImage extends HTMLImageElement {
  _bbox?: { x: number; y: number; w: number; h: number } | null;
}

const CACHE = new Map<string, CachedImage>();

export function icon(url: string): CachedImage {
  let img = CACHE.get(url);
  if (img) return img;
  img = new Image() as CachedImage;
  img.src = url;
  CACHE.set(url, img);
  return img;
}

// Alpha-bbox: many source PNGs ship with wildly different amounts of
// transparent padding. Scanning once on load and cropping the bbox
// means a tank icon and an APC icon end up the same on-screen size
// regardless of how the artist padded the source.
export function iconBbox(img: CachedImage): { x: number; y: number; w: number; h: number } | null {
  if (img._bbox !== undefined) return img._bbox;
  if (!img.complete || img.naturalWidth === 0) return null;
  const W = img.naturalWidth, H = img.naturalHeight;
  const off = document.createElement("canvas");
  off.width = W; off.height = H;
  const oc = off.getContext("2d", { willReadFrequently: true });
  if (!oc) { img._bbox = null; return null; }
  oc.drawImage(img, 0, 0);
  let data: Uint8ClampedArray;
  try { data = oc.getImageData(0, 0, W, H).data; }
  catch { img._bbox = null; return null; }  // CORS-tainted
  let minX = W, minY = H, maxX = -1, maxY = -1;
  const cutoff = 20;  // ignore antialiasing fringe
  for (let y = 0; y < H; y++) {
    const row = y * W * 4 + 3;
    for (let x = 0; x < W; x++) {
      if (data[row + x * 4] > cutoff) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const bbox = maxX >= minX
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : { x: 0, y: 0, w: W, h: H };
  img._bbox = bbox;
  return bbox;
}

export interface DrawIconOpts {
  rotate?: number;
  tint?: string;
}

// Returns true if the image was drawn, false if not loaded yet (the
// caller should fall back to a shape primitive in that case).
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  img: CachedImage,
  x: number, y: number, size: number,
  opts: DrawIconOpts = {},
): boolean {
  if (!img.complete || img.naturalWidth === 0) return false;
  const bbox = iconBbox(img);
  ctx.save();
  ctx.translate(x, y);
  if (opts.rotate) ctx.rotate(opts.rotate);
  if (opts.tint) {
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.55, 0, 2 * Math.PI);
    ctx.fillStyle = opts.tint;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (bbox) {
    const scale = size / Math.max(bbox.w, bbox.h);
    const dw = bbox.w * scale, dh = bbox.h * scale;
    ctx.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h,
                  -dw / 2, -dh / 2, dw, dh);
  } else {
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
  }
  ctx.restore();
  return true;
}

// Draw the FULL image centred on its own image centre (no alpha-bbox crop),
// scaled by an explicit pixels-per-unit factor. Used for matched base+turret
// icon pairs: both PNGs are authored on a shared-width canvas with the turret
// pivot at the image centre (the turret canvas is padded taller so its centre
// lands on the ring). Drawing both by image centre at the SAME ppu keeps them
// registered, and rotating the turret about that shared centre spins it in
// place. (drawIcon's per-image bbox centring can't be used here — the turret's
// barrel pushes its bbox centre off the ring, offsetting the whole turret.)
export function drawIconCentered(
  ctx: CanvasRenderingContext2D,
  img: CachedImage,
  x: number, y: number, ppu: number,
  rotate = 0,
): boolean {
  if (!img.complete || img.naturalWidth === 0) return false;
  const dw = img.naturalWidth * ppu, dh = img.naturalHeight * ppu;
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate);
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
  return true;
}

// One-shot recolour. Source-in composite over a flat fill rewrites every
// opaque pixel to `color` while preserving the alpha mask — perfect for
// turning the stock grey role silhouettes into a high-contrast white glyph
// against the dark inner of the player marker. Result is cached forever
// because role art is static.
const TINT_CACHE = new Map<string, HTMLCanvasElement>();

export function tintedIcon(img: CachedImage, color: string): HTMLCanvasElement | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  const key = img.src + "|" + color;
  const hit = TINT_CACHE.get(key);
  if (hit) return hit;
  const bbox = iconBbox(img);
  if (!bbox) return null;
  const c = document.createElement("canvas");
  c.width = bbox.w; c.height = bbox.h;
  const oc = c.getContext("2d");
  if (!oc) return null;
  oc.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  oc.globalCompositeOperation = "source-in";
  oc.fillStyle = color;
  oc.fillRect(0, 0, bbox.w, bbox.h);
  TINT_CACHE.set(key, c);
  return c;
}

// Colorized variant — preserves the original icon's light/dark
// structure instead of flattening every opaque pixel to one colour.
// Uses `multiply` blend so a white shape tints to the target colour,
// a grey shape becomes a darker shade of it, and inner highlights
// stay visible. Works well for the Squad command-marker art which
// ships as white silhouettes with subtle anti-aliased detail.
const COLORIZE_CACHE = new Map<string, HTMLCanvasElement>();

export function colorizedIcon(img: CachedImage,
                              color: string): HTMLCanvasElement | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  const key = img.src + "|" + color;
  const hit = COLORIZE_CACHE.get(key);
  if (hit) return hit;
  const bbox = iconBbox(img);
  if (!bbox) return null;
  const c = document.createElement("canvas");
  c.width = bbox.w; c.height = bbox.h;
  const oc = c.getContext("2d");
  if (!oc) return null;
  // 1) Original icon (preserves alpha + grayscale structure).
  oc.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  // 2) Multiply the team colour into the icon. `multiply` keeps darker
  //    pixels dark and tints the bright shape with the chosen hue.
  oc.globalCompositeOperation = "multiply";
  oc.fillStyle = color;
  oc.fillRect(0, 0, bbox.w, bbox.h);
  // 3) Clip the colour rectangle to the icon's alpha mask so transparent
  //    background stays transparent (multiply alone tints everything,
  //    including the alpha=0 corners).
  oc.globalCompositeOperation = "destination-in";
  oc.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  COLORIZE_CACHE.set(key, c);
  return c;
}

// ----- resolvers ---------------------------------------------------------

// Faction flag chips for capture-zone badges. The code comes from the game's
// FactionSetupId (team.factionId); the flag art is the SquadCalc set
// (github.com/sh4rkman/SquadCalc, public/img/flags) under icons/flags/. A few
// of our codes name a nation where SquadCalc names the specific force — alias
// those; anything unresolved returns null so the badge falls back to text.
const FLAG_CODES = new Set([
  "ADF", "AFU", "BAF", "CAF", "CRF", "GFI", "IMF", "INS", "MEA", "MEI",
  "PLA", "PLAAGF", "PLANMC", "RGF", "TLF", "USA", "USMC", "VDV", "WPMC",
]);
const FLAG_ALIAS: Record<string, string> = {
  RUS: "RGF",   // generic Russia → Russian Ground Forces
  AUS: "ADF",   // Australia → Australian Defence Force
  GB:  "BAF",   // Great Britain → British Armed Forces
  MIL: "IMF",   // Militia → Irregular Militia Forces
};

export function factionFlagUrl(factionId: string | null | undefined): string | null {
  if (!factionId) return null;
  const up = factionId.toUpperCase();
  const head = up.split("_")[0]!;
  const code = FLAG_CODES.has(up) ? up
             : FLAG_ALIAS[up] ? FLAG_ALIAS[up]
             : FLAG_CODES.has(head) ? head
             : FLAG_ALIAS[head] ?? null;
  return code ? `./icons/flags/${code}.webp` : null;
}

const VEHICLE_ICON: Record<string, string> = {
  "MBT":        "./icons/vehicles/map_tank_base.png",
  "Heavy IFV":  "./icons/vehicles/map_trackedifv_base.png",
  "Light IFV":  "./icons/vehicles/map_ifv_base.png",
  "APC":        "./icons/vehicles/map_apc.png",
  "Heli":       "./icons/vehicles/map_transporthelo.png",
  "Transport":  "./icons/vehicles/map_truck_transport.png",
  "Logi":       "./icons/vehicles/map_truck_logistics.png",
  "Scout":      "./icons/vehicles/map_truck_transport_armed.png",
};

// Two-piece vehicles — when the vehicle is one of these kinds AND the
// snapshot carries `turrets[]` data with a yaw, we layer the turret
// glyph on top of the hull rotated independently. Wheeled / soft-skin
// vehicles use a single static icon.
const VEHICLE_TURRET_ICON: Record<string, string> = {
  "MBT":        "./icons/vehicles/map_tank_turret.png",
  "Heavy IFV":  "./icons/vehicles/map_trackedifv_turret_v2.png",
  "Light IFV":  "./icons/vehicles/map_ifv_turret.png",
};

// Mirror the regex ladder in vehicleIconUrl so we get a turret layer
// even when the metadata catalog hasn't classified the vehicle (TLF /
// AFU / new BPs commonly land here without `kind`).
export function vehicleTurretIconUrl(v: Vehicle): string | null {
  if (v.kind && VEHICLE_TURRET_ICON[v.kind]) return VEHICLE_TURRET_ICON[v.kind]!;
  const cs = (v.classShort ?? "").toUpperCase();
  if (!cs) return null;
  // MBTs
  if (/T6[02]|T7[02]|T64|T90|M1A[12]|M60T|LEOPARD|CHALLENGER|2A6|MBT|ZTZ99|FV4034|FV510UA/.test(cs)) {
    return VEHICLE_TURRET_ICON["MBT"]!;
  }
  // Heavy IFV (tracked, autocannon)
  if (/BMP|BMD|BRADLEY|BFV|WARRIOR|HIFV|FV510|FV432|FV107|MARDER|M7A3|MTLB|ZBD|ZBL|ZSD|AAVP|ACV|M113A?[23]?/.test(cs)) {
    return VEHICLE_TURRET_ICON["Heavy IFV"]!;
  }
  // Light IFV (wheeled autocannon, BTR-4, WZ551 autocannon variants).
  if (/BTR4|WZ551B|VBCI|BOXER|PIRANHA|STRYKER_MGS/.test(cs)) {
    return VEHICLE_TURRET_ICON["Light IFV"]!;
  }
  return null;
}

// Turreted armour (MBT / Heavy IFV / Light IFV) keeps the legacy two-piece
// base+turret PNGs so the turret can rotate to its real facing. This pairs
// each turret icon back to its hull base.
const TURRET_TO_BASE: Record<string, string> = {
  "./icons/vehicles/map_tank_turret.png":          "./icons/vehicles/map_tank_base.png",
  "./icons/vehicles/map_trackedifv_turret_v2.png": "./icons/vehicles/map_trackedifv_base.png",
  "./icons/vehicles/map_ifv_turret.png":           "./icons/vehicles/map_ifv_base.png",
};

// SquadCalc's granular map-icon set (github.com/sh4rkman/SquadCalc,
// public/img/icons/default/vehicles), rasterised to 128px PNG under
// icons/vic/. Used for every NON-turreted vehicle so wheeled recon / MRAPs,
// technicals, trucks, boats and helis each get a distinct silhouette instead
// of the old coarse kind bucket. Returns null when nothing matches — the
// caller then falls back to the legacy icon so no vehicle is ever icon-less.
function scVehicleIcon(cs: string): string | null {
  if (!cs) return null;
  const V = (n: string) => `./icons/vic/${n}.png`;

  // Fixed-wing + drones (rare; mod maps)
  if (/A-?10|SU-?25/.test(cs)) return V("map_jet_a10");
  if (/UAV|DRONE|BAYRAKTAR|TB2/.test(cs)) return V("map_handhelddrone");

  // Helicopters: scout (Loach) / CAS / attack / transport
  if (/LOACH/.test(cs)) return V(/CAS/.test(cs) ? "T_map_helicopter_lightcas" : "T_map_helicopter_scout");
  if (/MI24|MI28|KA52|Z10|AH1|AH-1|APACHE|VIPER/.test(cs)) return V("map_attackhelo");
  if (/UH60|UH1|MI8|MI17|CH146|CH178|SA330|MRH90|_Z8|_Z9|RAVEN|PUMA|HUEY|HELO|HELI/.test(cs))
    return V(/CAS/.test(cs) ? "T_map_helicopter_lightcas" : "map_transporthelo");

  // Boats
  if (/RHIB|BOAT|RIB/.test(cs)) return V(/LOGI/.test(cs) ? "T_map_boat_logistics" : "T_map_boat_openturret");

  // Motorcycles / quads
  if (/MINSK|QUADBIKE/.test(cs)) return V("map_motorcycle");

  // Mobile Gun System (direct-fire gun on a wheeled / APC hull)
  if (/M1128|SPRUT|ZTD05|_MGS/.test(cs)) return V("T_map_mgs");

  // Tracked APC carriers (the autocannon IFVs are turreted and never reach here)
  if (/M113|FV432|MTLB|AAV|BTR-?D|BTRMDM|BTR-ZD|ACV-?15|ZSD89|M1064/.test(cs)) {
    if (/LOGI/.test(cs)) return V("T_map_trackedapc_logistics");
    if (/MORTAR|M121|M1064/.test(cs)) return V("T_map_trackedapc_artillery");
    if (/MSV/.test(cs)) return V("T_map_trackedapc_msv");
    return V("map_trackedapc");
  }

  // Wheeled armoured recon / MRAP — the big win (M-ATV & friends)
  if (/MATV|BRDM|TIGR|COBRA|CSK131|SAFIR|TAPV|PMV|KOZAK|M1151|M1152|HMMWV/.test(cs))
    return V("T_map_wheeledrecon");

  // Wheeled APC troop carriers (RWS but no autocannon)
  if (/BTR80|BTR-80|M1126|M1117|LAV_RWS|LAVIII|LAV-III/.test(cs))
    return V(/RWS|CROWS|OPEN/.test(cs) ? "T_map_apc_open_turret" : "map_apc");

  // Technicals / soft jeeps — pick by weapon fit
  if (/TECHNICAL|PICKUP|LUVW|CPV|GATOR|LPPV|JEEP|LYNXATV/.test(cs)) {
    if (/ZU23|ZU-23/.test(cs))                       return V("T_map_jeep_antiair");
    if (/TOW|KORNET|SPG9|ATGM|HJ-?8|MILAN/.test(cs)) return V("map_jeep_antitank");
    if (/MORTAR/.test(cs))                           return V("map_jeep_artillery");
    if (/LOGI/.test(cs))                             return V("map_jeep_logistics");
    if (/M2|DSHK|M134|MG3|KORD|NSV|AGS|UB32|HMG|MINIGUN|M240|MK19|RWS|CROWS/.test(cs))
                                                     return V("map_jeep_turret");
    return V("map_jeep_transport");
  }

  // Trucks
  if (/GRAD|BM-?21/.test(cs)) return V("T_map_truck_artillery");
  if (/LOGI/.test(cs))        return V("map_truck_logistics");
  if (/URAL|KAMAZ|KRAZ|HX60|MSVS|CTM131|M939|BMC|_UTIL_|TRUCK|5350|6322/.test(cs))
    return V(/ZU23|ZU-23/.test(cs) ? "map_truck_antiair" : "map_truck_transport");

  return null;
}

export function vehicleIconUrl(v: Vehicle): string | null {
  // Turreted armour keeps the legacy two-piece base (turret layer rotates via
  // vehicleTurretIconUrl). Everything else uses the SquadCalc granular set,
  // falling back to the legacy coarse icon when nothing matches.
  const turret = vehicleTurretIconUrl(v);
  if (turret) return TURRET_TO_BASE[turret] ?? legacyVehicleIconUrl(v);
  const cs = (v.classShort ?? "").toUpperCase();
  return scVehicleIcon(cs) ?? legacyVehicleIconUrl(v);
}

function legacyVehicleIconUrl(v: Vehicle): string | null {
  // Logistics check runs BEFORE the backend `kind` lookup. The backend
  // classifier collapses all trucks into "Transport" — it can't tell
  // a logi truck from a personnel truck — but the blueprint class name
  // always contains "Logi" for the logistics variant. So when the
  // classShort says LOGI we hard-route to the logistics icon and only
  // fall back to the kind / regex ladder for everything else.
  const cs = (v.classShort ?? "").toUpperCase();
  if (cs && /LOGI/.test(cs)) return VEHICLE_ICON["Logi"]!;
  // "Scout" is a mixed backend bucket — it lumps wheeled MRAPs (M-ATV, BRDM,
  // Tigr, Cobra, CSK131, TAPV…) together with soft-skin technicals/jeeps. Its
  // coarse icon is the armed-transport truck, which is wrong for the armoured
  // ones. Skip the kind shortcut for Scout so those fall through to the
  // classShort regex ladder below, which routes wheeled armour → APC and real
  // technicals → the scout/armed-transport art. Every other kind still wins here.
  if (v.kind && v.kind !== "Scout" && VEHICLE_ICON[v.kind]) return VEHICLE_ICON[v.kind]!;
  if (!cs) return null;
  // Skip emplacements (mortars, AA guns, deployed TOWs) — they have
  // their own marker rendering and the truck icon would be wrong.
  if (/EMPLACED|^BP_M\d+MORTAR|BASEPLATE|HELLCANNON|^BP_M252|^BP_M1937/.test(cs)) {
    return null;
  }
  // Helicopters
  if (/UH60|UH1[HY]|MI8|MI17|MI24|HUEY|HELO|HELI|RAVEN|CH146|CH178|SA330|MRH90|Z8[A-Z]?|Z9[A-Z]?|LOACH/.test(cs)) {
    return VEHICLE_ICON["Heli"]!;
  }
  // MBTs
  if (/T6[02]|T7[02]|T64|T90|M1A[12]|M60T|LEOPARD|CHALLENGER|2A6|MBT|ZTZ99|FV4034|FV510UA/.test(cs)) {
    return VEHICLE_ICON["MBT"]!;
  }
  // Heavy IFV (tracked, autocannon)
  if (/BMP|BMD|BRADLEY|BFV|WARRIOR|HIFV|FV510|FV432|FV107|MARDER|M7A3|MTLB|ZBD|ZBL|ZSD|AAVP|ACV|M113A?[23]?/.test(cs)) {
    return VEHICLE_ICON["Heavy IFV"]!;
  }
  // APC / wheeled armoured (carriers + recon vehicles, weapon-armed)
  if (/LAV|BTR|STRYKER|APC|TAPV|TPV|COBRA|PMV|MATV|M1151|M1126|M1128|M1117|CSK131|SAFIR|TIGR|KOZAK|HMMWV|BRDM|PARS|WZ551|ZSL10|ZBL08/.test(cs)) {
    return VEHICLE_ICON["APC"]!;
  }
  // Light tactical / scout — technicals + jeeps + bikes
  if (/TECHNICAL|PICKUP|LUVW|LPPV|JEEP|MINSK|QUADBIKE|M-GATOR|MGATOR|LYNXATV|CPV/.test(cs)) {
    return VEHICLE_ICON["Scout"]!;
  }
  // Boats (no dedicated icon; closest is scout/transport)
  if (/RHIB|BOAT|RIB/.test(cs)) return VEHICLE_ICON["Transport"]!;
  // Logistics truck (carries supplies; distinct icon shipped on server)
  if (/LOGI/.test(cs)) return VEHICLE_ICON["Logi"]!;
  // Generic transport truck — anything that looks like a "Util/Truck"
  if (/UTIL|URAL|KAMAZ|KRAZ|TRUCK|HX60|MSVS|CTM131|TLF/.test(cs)) {
    return VEHICLE_ICON["Transport"]!;
  }
  // Last-resort fallback: assume it's a transport vehicle. Better than
  // leaving the player with no icon at all for any new vehicle class
  // that ships before this table is updated.
  return VEHICLE_ICON["Transport"]!;
}

export function deployableIconUrl(d: Deployable): string | null {
  if (d.isFob) return "./icons/markers/fob.png";
  const cs = (d.classShort ?? "").toUpperCase();
  if (cs.includes("HAB"))      return "./icons/deployables/deployable_hab.png";
  if (cs.includes("MORTAR"))   return "./icons/deployables/deployable_mortars.png";
  if (cs.includes("REPAIR"))   return "./icons/deployables/deployable_repairstation.png";
  if (cs.includes("MINE"))     return "./icons/deployables/map_mine.png";
  if (cs.includes("AMMO") || cs.includes("CRATE"))
                               return "./icons/general/supplies_ammo_square.png";
  if (cs.includes("CONSTRUCT"))return "./icons/general/supplies_construction_square.png";
  return null;
}

// Player role → role icon. We pattern-match against `roleId` (the bare
// Squad role FName, e.g. 'WPMC_LAT_02' / 'CAF_SL_05') because it's
// more discriminating than rolePool (which buckets Recruit/Grenadier/
// Raider under "Generic"). Order matters — most-specific first.
export function roleIconUrl(p: { roleId: string | null }): string | null {
  const rid = (p.roleId ?? "").toLowerCase();
  if (!rid || rid === "none") return null;
  const base = "./icons/roles/";
  // Crewman + Pilot — these vehicle-only roles have SL variants too.
  if (rid.includes("crewman") && (rid.includes("_sl_") || rid.endsWith("_sl")))
    return base + "T_role_crewman_squadleader.png";
  if (rid.includes("crewman")) return base + "T_role_crewman.png";
  if (rid.includes("pilot")) return base + "T_role_pilot_squadleader.png";
  // Squad Leader (matches _SL_ token to avoid catching "slfx" etc.)
  if (rid.includes("_sl_") || rid.endsWith("_sl"))
    return base + "T_role_squadleader.png";
  if (rid.includes("medic"))            return base + "T_role_medic.png";
  if (rid.includes("hat"))              return base + "T_role_heavyantitank.png";
  if (rid.includes("lat"))              return base + "T_role_lightantitank.png";
  if (rid.includes("automaticrifleman") || rid.includes("_ar_") || rid.endsWith("_ar"))
                                        return base + "T_role_automaticrifleman.png";
  if (rid.includes("marksman") || rid.includes("designated") || rid.includes("dmr"))
                                        return base + "T_role_designatedmarksman.png";
  if (rid.includes("machinegunner") || rid.includes("_mg_") || rid.endsWith("_mg"))
                                        return base + "T_role_machinegunner.png";
  if (rid.includes("engineer") || rid.includes("sapper"))
                                        return base + "T_role_engineer.png";
  if (rid.includes("grenadier"))        return base + "T_role_grenadier.png";
  if (rid.includes("raider"))           return base + "T_role_raider.png";
  if (rid.includes("recruit"))          return base + "T_role_recruit.png";
  if (rid.includes("scout"))            return base + "T_role_scout.png";
  if (rid.includes("rifleman"))         return base + "T_role_rifleman.png";
  return null;
}

export function markerIconUrl(m: Marker): string | null {
  // Squad v10 marker `type` comes from the SQMapMarkerDataAsset
  // instance name attached to each marker entry — e.g.
  // "BP_MapMarker_Action_MoveSL", "BP_MapMarker_Option_TrackIFV",
  // "BP_MapMarker_Support_FOB", "BP_MapMarker_GridHeader_Spotted_…".
  // We lowercase + match on stable substrings. First match wins.
  const t = (m.type ?? "").toLowerCase();
  if (!t) return null;

  // ---- Action markers (SL = squad leader / FT = fireteam leader) ----
  // Asset name shape: "..._action_<verb><role>" with no separator —
  // e.g. "moveft" / "movesl" / "attackft" / "attackft".
  const isFT = /(?:move|attack|defend|observe|build)ft\b/.test(t);
  if (t.includes("attack"))
    return isFT ? "./icons/markers/map_commandmarker_squad_attack.png"
                : "./icons/markers/map_commandmarker_attack.png";
  if (t.includes("defend"))
    return isFT ? "./icons/markers/map_commandmarker_squad_defend.png"
                : "./icons/markers/map_commandmarker_defend.png";
  if (t.includes("move"))
    return isFT ? "./icons/markers/map_commandmarker_squad_move.png"
                : "./icons/markers/map_commandmarker_move.png";
  if (t.includes("observe"))
    return isFT ? "./icons/markers/map_commandmarker_squad_observe.png"
                : "./icons/markers/map_commandmarker_observe.png";
  if (t.includes("build") || t.includes("construct"))
    return "./icons/markers/map_commandmarker_resupply_construction.png";

  // ---- Support requests (T-menu SL radial) -------------------------
  if (t.includes("support_fob") || (t.includes("support") && t.includes("fob")))
    return "./icons/markers/map_commandmarker_fobrequest.png";
  if (t.includes("resupply") || t.includes("supply") || t.includes("ammo"))
    return "./icons/markers/map_commandmarker_resupply_construction.png";
  if (t.includes("pickup"))
    return "./icons/markers/map_commandmarker_pickup.png";

  // ---- "Option" markers (T-menu spotted-vehicle picker) ------------
  // These are the icons users pick from the radial menu to flag a
  // spotted enemy asset on the map. Vehicle category drives the icon.
  if (t.includes("option_rally") || t.endsWith("rally"))
    return "./icons/mark/rallypoint.png";
  if (t.includes("option_fob") || t.includes("_fob"))
    return "./icons/markers/map_commandmarker_fobrequest.png";
  if (t.includes("option_hab") || t.endsWith("hab") || t.includes("_hab"))
    return "./icons/markers/fob.png";        // no dedicated HAB icon shipped
  if (t.includes("option_tank") || t.endsWith("tank"))
    return "./icons/markers/map_tank.png";
  if (t.includes("trackifv"))    return "./icons/markers/map_trackedifv.png";
  if (t.includes("wheelifv"))    return "./icons/markers/map_ifv.png";
  if (t.includes("trackapc"))    return "./icons/markers/map_trackedapc.png";
  if (t.includes("wheelapc"))    return "./icons/markers/map_apc.png";
  if (t.includes("apc"))         return "./icons/markers/map_apc.png";
  if (t.includes("ifv"))         return "./icons/markers/map_ifv.png";
  if (t.includes("mortar"))      return "./icons/markers/map_mortars.png";
  if (t.includes("logi"))        return "./icons/markers/map_truck_logistics.png";
  if (t.includes("jeep"))        return "./icons/markers/map_truck_logistics.png";
  if (t.includes("truck"))       return "./icons/markers/map_truck_logistics.png";
  if (t.includes("boat"))        return "./icons/markers/map_boat_openturret.png";
  if (t.includes("mine"))        return "./icons/markers/map_mine.png";
  if (t.includes("helotrans") || t.includes("transhelo") || t.includes("helicopter"))
    return "./icons/markers/map_genericinfantry.png";  // no heli icon shipped

  // ---- Spotted call-outs (GridHeader_Spotted_*) --------------------
  if (t.includes("spotted")) {
    if (t.includes("lightvehicle")) return "./icons/markers/map_truck_logistics.png";
    if (t.includes("heavyvehicle")) return "./icons/markers/map_tank.png";
    if (t.includes("infantry"))     return "./icons/markers/map_genericinfantry.png";
    return "./icons/markers/map_genericinfantry.png";
  }

  // ---- POI markers -------------------------------------------------
  if (t.includes("poi"))
    return "./icons/markers/map_genericinfantry.png";

  // ---- Director / arrow markers (rendered as point fallback) ------
  // These should ideally render as arrows (we'd need arrowLength +
  // arrowHeading on the marker payload). For now show a generic
  // infantry glyph at the start point so they don't disappear.
  if (t.includes("director") || t.includes("frontline"))
    return "./icons/markers/map_genericinfantry.png";

  return null;
}

// Map texture cache (separate from icon cache — different URL path,
// different size class). Failed loads are sticky to avoid retry loops.
interface MapTexture extends HTMLImageElement {
  _failed?: boolean;
}
const MAP_CACHE = new Map<string, MapTexture>();

// Per-tab cache buster: ensures opening a fresh tab always fetches the
// current sqmap file, even if a stale 24-h-cached entry is still in
// the disk cache from a previous session. Within the same tab the
// browser's memory cache + the ETag handshake keep things efficient.
const SESSION_NONCE = Date.now().toString(36);

export function mapTexture(textureName: string): MapTexture {
  let img = MAP_CACHE.get(textureName);
  if (img) return img;
  img = new Image() as MapTexture;
  img.addEventListener("error", () => { img!._failed = true; });
  img.src = "./sqmaps/" + encodeURIComponent(textureName)
          + "?v=" + SESSION_NONCE;
  MAP_CACHE.set(textureName, img);
  return img;
}
