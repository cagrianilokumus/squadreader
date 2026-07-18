// Tick-over-tick diff that turns successive snapshots into kill-feed
// entries. Pure logic — no React, no DOM — so the React hook can drive
// it from a useEffect and the same function is unit-testable.
//
// Five-tier weapon attribution chain is preserved from the legacy
// vanilla-JS module. Today most tiers return null because the backend
// only ships APawn.LastHitBy (controller pointer); each tier lights up
// independently as backend Phase B+ adds the missing fields:
//
//   tier 1: damageEvent.causerWeapon  (most accurate)
//   tier 2: damageEvent.causerClass   (raw causer)
//   tier 3: player.weapon.{className,name}  (currently equipped)
//   tier 4: vehicles[].turrets[].weapon     (killer's turret class)
//   tier 5: sticky lastKnownWeaponByPlayer  (last non-utility seen)
//
// Mounted-killer + mounted-victim vehicle context is captured AT PUSH
// TIME — dismounts happen seconds after a kill and re-resolving at
// render time would erase the vehicle association.

import type {
  DamageEvent, KillFeedEntry, Player, Snapshot, Vehicle,
} from "../state/types";

// How many ticks an attack event (wounded/killed, with an attacker) stays
// available to attribute a later death. In Squad a shot player is first
// INCAPACITATED (a wounded event, which carries the attacker) and only
// dies seconds later when they bleed out or give up — and that final
// death rarely emits its own killed event. So the death counter's rise is
// attributed back to the incap that caused it; this window must cover the
// bleed-out delay. ~20 ticks @ 0.5 Hz = ~40 s.
const ATTACK_ATTR_TTL_TICKS = 20;

// A wounded/killed damageEvent held so the death-counter increment it
// leads to can be attributed to the exact attacker, not a guessed pairing.
interface BufferedAttack {
  ev: DamageEvent;
  ttl: number;
  used: boolean;
}

export interface DiffState {
  // eosId (fallback name) -> { kills, deaths } from the previous tick.
  // Keying by the stable id — not the display name — stops two players
  // who share a name from corrupting each other's kill/death deltas.
  prevStats: Map<string, { kills: number; deaths: number }>;
  // sticky last-seen non-utility weapon per killer name (tier-5 fallback)
  lastKnownWeapon: Map<string, string>;
  // dedupe key (attacker|victim|ts) for attack events already buffered
  attackSeen: Set<string>;
  // recent attack events awaiting the death they caused
  attackBuffer: BufferedAttack[];
  // tick counter for unique entry ids
  seq: number;
  // initialised flag — first observed snapshot just seeds prevStats,
  // it doesn't emit history-since-start as a kill burst
  inited: boolean;
  // kills the backend counted that no event ever attributed — surfaced
  // for diagnostics, never turned into a fabricated row
  unattributedKills: number;
}

export function createDiffState(): DiffState {
  return {
    prevStats: new Map(),
    lastKnownWeapon: new Map(),
    attackSeen: new Set(),
    attackBuffer: [],
    seq: 0,
    inited: false,
    unattributedKills: 0,
  };
}

// ---- predicate helpers ---------------------------------------------------

const UTILITY_PATTERNS = [
  "fielddressing", "bandage", "medkit", "medicalkit", "binocular",
  "entrench", "shovel", "pickaxe", "repair", "fortif", "wrench",
  "smokelauncher", "smoke_launcher",
];

export function isUtilityClass(cls: string | null | undefined): boolean {
  if (!cls) return false;
  const cl = cls.toLowerCase();
  return UTILITY_PATTERNS.some((p) => cl.includes(p));
}

export function isSoldierClass(cls: string | null | undefined): boolean {
  return !!cls && /^BP_Soldiers?_/i.test(cls);
}

// ---- damageType → display label ------------------------------------------

export function deathCauseFromDamageType(dt: string | null | undefined):
  { label: string; title: string } | null {
  if (!dt) return null;
  if (/_fall(?:\b|$|_)/i.test(dt) || /fallingdamage/i.test(dt))
    return { label: "Fall", title: "Fall damage" };
  if (/underwater|drown/i.test(dt))
    return { label: "Drown", title: "Drowning" };
  if (/helicopter.*collision|helicrash/i.test(dt))
    return { label: "Heli crash", title: "Helicopter collision" };
  if (/collision/i.test(dt))
    return { label: "Run over", title: "Vehicle collision" };
  if (/burning|burndamage/i.test(dt))
    return { label: "Burned", title: "Burning / fire damage" };
  if (/wounded/i.test(dt))
    return { label: "Bled out", title: "Bled out (no medic in time)" };
  return null;
}

export function deathCausePhrase(dt: string | null | undefined): string {
  if (!dt) return "died";
  if (/_fall(?:\b|$|_)|fallingdamage/i.test(dt)) return "fell to death";
  if (/underwater|drown/i.test(dt))               return "drowned";
  if (/helicopter.*collision|helicrash/i.test(dt))return "died in a helicopter crash";
  if (/collision/i.test(dt))                      return "was run over";
  if (/burning|burndamage/i.test(dt))             return "burned to death";
  if (/wounded/i.test(dt))                        return "has bled out";
  return "died";
}

export function damageTypeCategoryLabel(dt: string | null | undefined): string | null {
  if (!dt) return null;
  if (/fall|underwater|drown|collision|burning|wounded/i.test(dt)) return null;
  if (/SmallArms/i.test(dt))         return "Gunfire";
  if (/Fragmentation/i.test(dt))     return "Frag";
  if (/HAT|HeatExplosive/i.test(dt)) return "HAT";
  if (/Kinetic/i.test(dt))           return "Tank shell";
  if (/ExplosiveRocket/i.test(dt))   return "Rocket";
  if (/Explosives|Explosive/i.test(dt)) return "Explosion";
  if (/Thermite/i.test(dt))          return "Thermite";
  if (/AmmoBox/i.test(dt))           return "Ammo cook-off";
  return null;
}

// ---- vehicle context lookups --------------------------------------------

// Look up the vehicle the named player is currently sitting in. We use
// vehicle.seats[].occupantName (the backend's Phase B field), falling
// back to the legacy `s.player` shape just in case.
export function findPlayerVehicle(snap: Snapshot | null, name: string | null):
  Vehicle | null {
  if (!snap || !name) return null;
  for (const v of snap.vehicles ?? []) {
    if (!v.seats) continue;
    for (const s of v.seats) {
      const occ = s.occupantName;
      if (occ === name) return v;
    }
  }
  return null;
}

// ---- weapon attribution chain -------------------------------------------

function pickWeaponFromEvent(ev: DamageEvent): string | null {
  if (ev.causerWeapon && !isUtilityClass(ev.causerWeapon))
    return ev.causerWeapon;
  if (ev.causerClass && !isSoldierClass(ev.causerClass)
      && !isUtilityClass(ev.causerClass))
    return ev.causerClass;
  return null;
}

interface ResolvedWeapon {
  weaponClass: string | null;
  weaponApprox: boolean;   // resolved only from the sticky cache (tier 5)
  hitDistance: number | null;
  headshot: boolean;
  damageType: string | null;
}

function resolveWeapon(
  killerName: string,
  victimName: string,
  events: DamageEvent[] | undefined,
  killerPlayer: Player | null,
  killerVehicle: Vehicle | null,
  cache: Map<string, string>,
): ResolvedWeapon {
  const out: ResolvedWeapon = {
    weaponClass: null, weaponApprox: false,
    hitDistance: null, headshot: false, damageType: null,
  };
  // Tier 1+2: pair-matched damageEvent
  if (events?.length) {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.attacker !== killerName || ev.victim !== victimName) continue;
      const w = pickWeaponFromEvent(ev);
      if (w) { out.weaponClass = w; }
      if (ev.damageType) out.damageType = ev.damageType;
      if (ev.hitDistance != null && ev.hitDistance > 0)
        out.hitDistance = ev.hitDistance;
      if (ev.headshot) out.headshot = true;
      if (out.weaponClass) break;
    }
    // Tier 2 sweep: same killer, any victim — catches sibling-event cases
    if (!out.weaponClass) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]!;
        if (ev.attacker !== killerName) continue;
        const w = pickWeaponFromEvent(ev);
        if (w) { out.weaponClass = w; break; }
      }
    }
  }
  // A killer manning a vehicle turret kills with the turret, not the
  // infantry weapon they still have holstered — so when the killer is in a
  // vehicle that has a turret, tier 4 (the turret) takes the place of tier 3.
  const turret = killerVehicle?.turrets?.[0];
  // Tier 3: killer's currently-equipped infantry weapon, from soldier.weapon
  // (className is the canonical 'BP_X_C' shape; name is the live UE instance
  // name fallback). Skipped when the killer is gunning a turret.
  if (!out.weaponClass && !turret && killerPlayer) {
    const wp = killerPlayer.soldier?.weapon;
    if (wp) {
      const c = wp.className || wp.name || null;
      if (c && !isUtilityClass(c)) out.weaponClass = c;
    }
  }
  // Tier 4: killer's turret weapon (vehicles[].turrets[]). The killer is
  // memory-confirmed sitting in the vehicle and the turret is its weapon
  // system, so this is grounded, not a guess.
  if (!out.weaponClass && turret) {
    const c = turret.turretBaseClass || turret.className || null;
    if (c) out.weaponClass = c;
  }
  // Tier 5: sticky cache — last non-utility weapon we saw this killer
  // holding. It may not be the weapon that got THIS kill, so flag it.
  if (!out.weaponClass) {
    const cached = cache.get(killerName);
    if (cached) { out.weaponClass = cached; out.weaponApprox = true; }
  }
  return out;
}

// ---- main diff -----------------------------------------------------------

export interface DiffResult {
  newEntries: KillFeedEntry[];
}

export function diffSnapshot(
  state: DiffState,
  snap: Snapshot,
): DiffResult {
  const players = snap.players ?? [];
  const events  = snap.damageEvents ?? [];
  const gameTime = snap.gameState?.elapsedSec ?? null;

  // Refresh the sticky weapon cache from current snapshot equipment.
  for (const p of players) {
    if (!p.name) continue;
    const wp = p.soldier?.weapon;
    if (!wp) continue;
    const c = wp.className || wp.name;
    if (c && !isUtilityClass(c)) state.lastKnownWeapon.set(p.name, c);
  }

  // Death counters are the authoritative "a death happened" signal — one
  // increment per death, keyed by the stable id so two players sharing a
  // name can't corrupt each other's deltas. Killed damageEvents then
  // attribute the exact attacker below; we never guess a pairing.
  const idOf = (p: Player) => (p.eosId || p.name) as string;
  const cur = new Map<string, { kills: number; deaths: number }>();
  const deaths: Player[] = [];
  for (const p of players) {
    if (!p.name) continue;
    const k = Number(p.stats?.kills ?? 0);
    const d = Number(p.stats?.deaths ?? 0);
    const id = idOf(p);
    cur.set(id, { kills: k, deaths: d });
    const prev = state.prevStats.get(id);
    if (!prev) continue;
    if (d > prev.deaths) deaths.push(p);
  }
  state.prevStats = cur;

  // First tick: just seed the baseline, don't emit history-as-burst
  if (!state.inited) { state.inited = true; return { newEntries: [] }; }

  // Round/map transitions read as a broken combat state for a few ticks: the
  // game still reports InProgress but every soldier pawn is being torn down
  // (the backend logs this as "SANITY: InProgress low-alive (0/N) -> cache
  // reset"). Players still alive at round-end get a death-counter bump with NO
  // damage event to attribute it — which used to spray the feed with a burst
  // of unattributed "?" rows on every map change. Detect the transition and
  // skip emitting for this tick; the baseline was already advanced above.
  //   - notPlaying: match explicitly not InProgress (post-match / warmup).
  //   - rosterCollapsed: a full server with ~everyone despawned (the SANITY
  //     low-alive read) — never happens during real combat.
  //   - massUnattributed: many simultaneous deaths with zero damage events;
  //     real multi-kills come from explosives that DO carry events.
  const matchState = snap.gameState?.matchState ?? null;
  const notPlaying = matchState != null && matchState !== "InProgress";
  const aliveCount = players.reduce(
    (n, p) => n + (p.soldier && (p.soldier.health ?? 0) > 0 ? 1 : 0), 0);
  const rosterCollapsed = players.length >= 20 && aliveCount <= 1;
  const massUnattributed = events.length === 0 && deaths.length >= 5;
  if (notPlaying || rosterCollapsed || massUnattributed) {
    return { newEntries: [] };
  }

  const out: KillFeedEntry[] = [];
  const wallMs = Date.now();
  const nextId = () => `kf-${wallMs}-${state.seq++}`;
  const playerByName = new Map(players.filter((p) => p.name).map((p) => [p.name as string, p]));
  const teamByName = (n: string | null): number | null =>
    (n ? playerByName.get(n)?.teamId ?? null : null);

  // --- Wounded (incap) rows: intentionally NOT emitted -----------------
  // The feed shows one row per KILL, not per incap. Emitting a wounded row
  // AND a death row double-listed every engagement ("X incap'd Y" at the
  // incap, then "X killed Y" seconds later when they bled out). We keep only
  // the death row; the wound is still buffered below so the death that
  // follows is attributed to whoever put the player down. A wound that never
  // becomes a death (the victim was revived) correctly shows nothing.

  // --- Buffer this tick's attack events -------------------------------
  // Any wounded/killed event with a real attacker records who put a
  // player down. The death that follows (usually seconds later, once they
  // bleed out — and rarely with its own killed event) is attributed back
  // to it. Deduped by fingerprint so a re-emitted event buffers once.
  for (const ev of events) {
    if (!ev.victim || !ev.attacker || ev.attacker === ev.victim) continue;
    if (!ev.killed && !ev.wounded) continue;
    const fp = `${ev.attacker}|${ev.victim}|${ev.ts ?? ""}`;
    if (state.attackSeen.has(fp)) continue;
    state.attackSeen.add(fp);
    state.attackBuffer.push({ ev, ttl: ATTACK_ATTR_TTL_TICKS, used: false });
  }

  // --- Attribute each death -------------------------------------------
  // Match a death to the MOST RECENT buffered attack on that victim (by
  // stable id, else name): found -> exact "A killed B"; not found -> an
  // honest "B died" with the world cause if an event names them. Never a
  // guessed killer.
  for (const p of deaths) {
    const vname = p.name as string;
    const veos = p.eosId ?? null;
    let buf: BufferedAttack | undefined;
    for (let i = state.attackBuffer.length - 1; i >= 0; i--) {
      const b = state.attackBuffer[i]!;
      if (b.used || b.ev.victim !== vname) continue;
      if (veos != null && b.ev.victimEosId != null && b.ev.victimEosId !== veos) continue;
      buf = b;
      break;
    }

    if (buf) {
      buf.used = true;
      const ev = buf.ev;
      const attacker = ev.attacker && ev.attacker !== vname ? ev.attacker : null;
      const suicide = ev.selfInflicted === true || ev.attacker === vname;
      const killerPlayer = attacker ? playerByName.get(attacker) ?? null : null;
      const killerVehicle = attacker ? findPlayerVehicle(snap, attacker) : null;
      const w = resolveWeapon(attacker ?? "", vname, [ev], killerPlayer,
                              killerVehicle, state.lastKnownWeapon);
      const kTeam = attacker ? teamByName(attacker) : null;
      const vTeam = p.teamId ?? ev.victimTeam;
      out.push({
        id: nextId(),
        wallClockMs: wallMs,
        gameTimeSec: gameTime,
        killer: suicide ? null : attacker,
        killerTeam: kTeam,
        killerRoleId: attacker ? playerByName.get(attacker)?.roleId ?? null : null,
        killerVehicleClass: killerVehicle?.classShort ?? null,
        weaponClass: w.weaponClass,
        weaponApprox: w.weaponApprox,
        damageType: w.damageType ?? ev.damageType ?? null,
        hitDistance: w.hitDistance,
        headshot: w.headshot,
        victim: vname,
        victimTeam: vTeam,
        victimRoleId: p.roleId ?? null,
        victimVehicleClass: findPlayerVehicle(snap, vname)?.classShort ?? null,
        tk: !suicide && kTeam !== null && kTeam === vTeam,
        suicide,
        wounded: false,
      });
      continue;
    }

    // No killed event for this death: world cause (fall/drown), a
    // bleed-out, or a kill the backend didn't capture. Show it with no
    // attacker rather than inventing one; pull the cause from any event.
    let damageType: string | null = null;
    let isSuicide = false;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]!;
      if (ev.victim !== vname) continue;
      if (ev.attacker === vname || ev.selfInflicted) isSuicide = true;
      if (ev.damageType) { damageType = ev.damageType; break; }
    }
    out.push({
      id: nextId(),
      wallClockMs: wallMs,
      gameTimeSec: gameTime,
      killer: null,
      killerTeam: null,
      killerRoleId: null,
      killerVehicleClass: null,
      weaponClass: null,
      damageType,
      hitDistance: null,
      headshot: false,
      victim: vname,
      victimTeam: p.teamId,
      victimRoleId: p.roleId ?? null,
      victimVehicleClass: findPlayerVehicle(snap, vname)?.classShort ?? null,
      tk: false,
      suicide: isSuicide,
      wounded: false,
    });
  }

  // Age the attack buffer; drop consumed entries. An unconsumed attack
  // that ages out was an incap whose victim never died (revived, or they
  // left) — that's fine, most incaps don't become kills.
  const keep: BufferedAttack[] = [];
  for (const b of state.attackBuffer) {
    if (b.used) continue;
    b.ttl -= 1;
    if (b.ttl <= 0) continue;
    keep.push(b);
  }
  state.attackBuffer = keep;

  // Bound the dedupe set so it can't grow forever in long matches.
  if (state.attackSeen.size > 600) state.attackSeen = trimSet(state.attackSeen, 300);

  return { newEntries: out };
}

// Keep only the most recently-added `keepLast` members of an insertion-
// ordered Set (JS Sets preserve insertion order).
function trimSet(s: Set<string>, keepLast: number): Set<string> {
  const drop = s.size - keepLast;
  if (drop <= 0) return s;
  const trimmed = new Set<string>();
  let n = 0;
  for (const v of s) { if (n++ < drop) continue; trimmed.add(v); }
  return trimmed;
}
