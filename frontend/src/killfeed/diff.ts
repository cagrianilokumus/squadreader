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

// How long an attack event (wounded/killed, with an attacker) stays available
// to attribute a later death. In Squad a shot player is first INCAPACITATED (a
// wounded event, which carries the attacker) and only dies seconds later when
// they bleed out or give up — and that final death rarely emits its own killed
// event. So the death counter's rise is attributed back to the incap that
// caused it; this window must cover the bleed-out delay. Expressed in GAME-TIME
// SECONDS, not ticks: the reader ranges from 0.5 Hz to the ~4 Hz two-tier rate,
// and a fixed 20-tick TTL that was ~40 s at 0.5 Hz collapsed to ~5 s at 4 Hz —
// the incap aged out long before the bleed-out death, so nearly every kill
// showed a "?" attacker (both live and replay). 120 s covers real Squad
// bleed-outs (measured against a full recorded match: ~83% -> ~90% attributed)
// without the mis-attribution a longer window brings — at 180 s a couple of
// world-cause deaths (fall/drown, no attacker) matched a stale incap instead.
const ATTACK_ATTR_TTL_SEC = 120;

// How long a death that nothing yet explains waits for the event naming its
// killer. The server-log kill line is tailed and drained a beat after the
// death counter moves: in a recorded altai match three deaths printed "?"
// while their killer — pau, and an IED that took two at once — arrived 0.2 s
// later, in the very next frame. Wall time, not ticks, so it holds from
// 0.5 Hz to 4 Hz. Only a death with NO event at all waits: an event that
// says "no killer" is already the answer.
const LATE_EVENT_WAIT_MS = 4000;

// How far back the events naming a victim are kept, to say what a death with
// no killer was once its wait is over.
const RECENT_EVENT_MS = 15000;

interface PendingDeath {
  p: Player;
  atMs: number;
  gameTime: number | null;
  wallMs: number;
  victimVehicleClass: string | null;
}

// A wounded/killed damageEvent held so the death-counter increment it
// leads to can be attributed to the exact attacker, not a guessed pairing.
interface BufferedAttack {
  ev: DamageEvent;
  bufAt: number | null;  // gameState.elapsedSec when buffered (game-time TTL)
  used: boolean;
}

export interface DiffState {
  // eosId (fallback name) -> { kills, deaths } from the last tick that player
  // was seen on — kept across ticks they are missing from, so a row that
  // drops out for a tick does not come back as a fresh baseline.
  // Keying by the stable id — not the display name — stops two players
  // who share a name from corrupting each other's kill/death deltas.
  prevStats: Map<string, { kills: number; deaths: number }>;
  // name -> eosId last seen with it, for the rows that arrive without one
  eosByName: Map<string, string>;
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
  // deaths waiting a moment for a late event (see LATE_EVENT_WAIT_MS)
  pending: PendingDeath[];
  // every event that names a victim, briefly, whatever its attacker
  recentEvents: { ev: DamageEvent; atMs: number | null }[];
}

export function createDiffState(): DiffState {
  return {
    prevStats: new Map(),
    eosByName: new Map(),
    lastKnownWeapon: new Map(),
    attackSeen: new Set(),
    attackBuffer: [],
    seq: 0,
    inited: false,
    unattributedKills: 0,
    pending: [],
    recentEvents: [],
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

interface NoKillerDeath {
  suicide: boolean;
  cause: "bledout" | "died" | null;
  damageType: string | null;
  weaponClass: string | null;
}

/**
 * What the events naming a victim say about a death nobody is credited with.
 *
 * Damage the victim's own soldier caused is how the game records bleeding out
 * or giving up while wounded — the server log writes those deaths with no
 * killer and the dying soldier's own class as the cause. That used to read as
 * "Suicide". A self-inflicted round from a real weapon (a grenade) still is
 * one. Otherwise a world cause (fall, drowning) or a weapon with an unknown
 * hand is shown as such, and with nothing at all the row says only that the
 * player died — "?" claimed a killer nobody saw.
 */
export function classifyNoKiller(victim: string, evs: DamageEvent[]): NoKillerDeath {
  // Self-inflicted with no cause at all says little on its own: after a wound
  // it is the bleed-out, without one it is as likely a redeploy at spawn (two
  // such deaths in a match's first minutes had no wound before them).
  const wounded = evs.some((ev) => ev.victim === victim && ev.wounded);
  let self: "suicide" | "bledout" | "unknown" | null = null;
  let damageType: string | null = null;
  let weaponClass: string | null = null;
  for (let i = evs.length - 1; i >= 0; i--) {
    const ev = evs[i]!;
    if (ev.victim !== victim) continue;
    const causer = ev.causerWeapon || ev.causerClass || null;
    if (self == null && (ev.selfInflicted === true || ev.attacker === victim)) {
      if (causer && isSoldierClass(causer)) self = "bledout";
      else if (causer && !isUtilityClass(causer)) self = "suicide";
      else if (ev.attacker === victim) self = "suicide";
      else self = wounded ? "bledout" : "unknown";
    }
    if (damageType == null && ev.damageType) damageType = ev.damageType;
    if (weaponClass == null && !ev.attacker && !ev.selfInflicted && causer
        && !isSoldierClass(causer) && !isUtilityClass(causer)) weaponClass = causer;
  }
  if (self === "suicide") return { suicide: true, cause: null, damageType, weaponClass: null };
  if (self === "bledout") return { suicide: false, cause: "bledout", damageType: null, weaponClass: null };
  // A world cause (a fall, drowning) says what happened whoever was blamed.
  if (damageType && deathCauseFromDamageType(damageType))
    return { suicide: false, cause: null, damageType, weaponClass: null };
  // Something with a weapon did it, and nobody knows whose: keep the weapon.
  if (self == null && (weaponClass || damageType))
    return { suicide: false, cause: null, damageType, weaponClass };
  return { suicide: false, cause: "died", damageType: null, weaponClass: null };
}

/** Of two rows for the same player, the one whose counters are further along
 *  — a counter only climbs during a match, so the lower one is the copy that
 *  is behind. On a tie, the row that says more about the player. */
function outranks(a: Player, b: Player): boolean {
  const ad = Number(a.stats?.deaths ?? 0), bd = Number(b.stats?.deaths ?? 0);
  if (ad !== bd) return ad > bd;
  const ak = Number(a.stats?.kills ?? 0), bk = Number(b.stats?.kills ?? 0);
  if (ak !== bk) return ak > bk;
  if (!!a.eosId !== !!b.eosId) return !!a.eosId;
  const ar = !!a.roleId && a.roleId !== "None", br = !!b.roleId && b.roleId !== "None";
  return ar && !br;
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
  const nowMs = snapClockMs(snap);

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
  //
  // A player stuck reconnecting has TWO player states, and neither carries an
  // eosId: the old one holding the match's deaths, and the new one still
  // loading (team 0, deaths 0). Keyed by name, the two met under one key and
  // the counter read 0 -> N on every tick — one "? > Name" row per tick, for
  // as long as the player stayed stuck (measured: 17 in a row for one player).
  // So a row without an eosId borrows the one last seen under its name, rows
  // sharing a key collapse to the one with the higher counters, and a row
  // that has not joined a team yet (team 0 — it cannot have died in this
  // match) neither emits nor moves the baseline. Nor does a row whose team is
  // no team at all: a torn read at match end once printed "? > Suedaaa <3"
  // from team 1216741536 with 108 deaths.
  for (const p of players) {
    if (p.name && p.eosId) state.eosByName.set(p.name, p.eosId);
  }
  const idOf = (p: Player) =>
    (p.eosId || state.eosByName.get(p.name as string) || p.name) as string;
  const byId = new Map<string, Player>();
  for (const p of players) {
    if (!p.name || (p.teamId != null && p.teamId !== 1 && p.teamId !== 2)) continue;
    const id = idOf(p);
    const have = byId.get(id);
    if (!have || outranks(p, have)) byId.set(id, p);
  }
  const cur = new Map(state.prevStats);
  const deaths: Player[] = [];
  for (const [id, p] of byId) {
    const k = Number(p.stats?.kills ?? 0);
    const d = Number(p.stats?.deaths ?? 0);
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

  const out: KillFeedEntry[] = [];
  const wallMs = Date.now();
  const nextId = () => `kf-${wallMs}-${state.seq++}`;
  const playerByName = new Map(players.filter((p) => p.name).map((p) => [p.name as string, p]));
  const teamByName = (n: string | null): number | null =>
    (n ? playerByName.get(n)?.teamId ?? null : null);

  // Everything said about a victim, killer or not, for the deaths that end up
  // with nobody to credit (see classifyNoKiller).
  for (const ev of events) {
    if (ev.victim && (ev.killed || ev.wounded || ev.damageType || ev.selfInflicted))
      state.recentEvents.push({ ev, atMs: nowMs });
  }
  if (nowMs != null) {
    state.recentEvents = state.recentEvents.filter(
      (r) => r.atMs == null || nowMs - r.atMs <= RECENT_EVENT_MS);
  }
  if (state.recentEvents.length > 600) state.recentEvents = state.recentEvents.slice(-600);
  const recentFor = (victim: string): DamageEvent[] =>
    state.recentEvents.filter((r) => r.ev.victim === victim).map((r) => r.ev);

  interface DeathMeta { gameTime: number | null; wallMs: number; victimVehicleClass: string | null }
  const metaNow = (vname: string): DeathMeta => ({
    gameTime, wallMs, victimVehicleClass: findPlayerVehicle(snap, vname)?.classShort ?? null,
  });

  const takeBuffered = (p: Player): BufferedAttack | undefined => {
    const vname = p.name as string;
    const veos = p.eosId ?? null;
    for (let i = state.attackBuffer.length - 1; i >= 0; i--) {
      const b = state.attackBuffer[i]!;
      if (b.used || b.ev.victim !== vname) continue;
      if (veos != null && b.ev.victimEosId != null && b.ev.victimEosId !== veos) continue;
      b.used = true;
      return b;
    }
    return undefined;
  };

  const emitCredited = (p: Player, buf: BufferedAttack, m: DeathMeta) => {
    const vname = p.name as string;
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
      wallClockMs: m.wallMs,
      gameTimeSec: m.gameTime,
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
      victimVehicleClass: m.victimVehicleClass,
      tk: !suicide && kTeam !== null && kTeam === vTeam,
      suicide,
      wounded: false,
    });
  };

  // No event credits anyone with this death: say what the events naming the
  // victim do say, and never invent a killer.
  const emitUncredited = (p: Player, m: DeathMeta) => {
    const vname = p.name as string;
    const c = classifyNoKiller(vname, recentFor(vname));
    out.push({
      id: nextId(),
      wallClockMs: m.wallMs,
      gameTimeSec: m.gameTime,
      killer: null,
      killerTeam: null,
      killerRoleId: null,
      killerVehicleClass: null,
      weaponClass: c.weaponClass,
      damageType: c.damageType,
      hitDistance: null,
      headshot: false,
      victim: vname,
      victimTeam: p.teamId,
      victimRoleId: p.roleId ?? null,
      victimVehicleClass: m.victimVehicleClass,
      tk: false,
      suicide: c.suicide,
      wounded: false,
      cause: c.cause,
    });
  };

  // Deaths that were waiting for a late event: credit them if it came, settle
  // them once the wait is over — at once when there is no clock to wait on,
  // or when the match has stopped being played.
  const settlePending = (force: boolean) => {
    const still: PendingDeath[] = [];
    for (const d of state.pending) {
      const buf = takeBuffered(d.p);
      if (buf) { emitCredited(d.p, buf, d); continue; }
      if (force || nowMs == null || nowMs - d.atMs >= LATE_EVENT_WAIT_MS) {
        emitUncredited(d.p, d);
        continue;
      }
      still.push(d);
    }
    state.pending = still;
  };

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
  // Deaths already waiting from before are real ones: settle them now.
  if (notPlaying || rosterCollapsed || massUnattributed) {
    settlePending(true);
    return { newEntries: out };
  }

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
    // Include the event KIND: a wounded (incap) and the killed event that
    // follows it share attacker|victim and usually carry no ts, so a single
    // attacker|victim|ts key made the killed event look like a duplicate of the
    // incap and dropped it. When the incap then aged out of the buffer before
    // the death, the death had nothing left to attribute → "?". Keying them
    // separately keeps the fresh killed event, which attributes at the death.
    const fp = `${ev.attacker}|${ev.victim}|${ev.ts ?? ""}|${ev.killed ? "k" : "w"}`;
    if (state.attackSeen.has(fp)) continue;
    state.attackSeen.add(fp);
    state.attackBuffer.push({ ev, bufAt: gameTime, used: false });
  }

  settlePending(false);

  // --- Attribute each death -------------------------------------------
  // Match a death to the MOST RECENT buffered attack on that victim (by
  // stable id, else name): found -> exact "A killed B". Not found, but an
  // event this tick names the victim -> it already says what happened (no
  // killer, a fall, their own wounds). Not found and nothing yet -> wait a
  // moment for the late event (LATE_EVENT_WAIT_MS). Never a guessed killer.
  for (const p of deaths) {
    const vname = p.name as string;
    const buf = takeBuffered(p);
    if (buf) { emitCredited(p, buf, metaNow(vname)); continue; }
    const named = events.some((ev) => ev.victim === vname);
    if (named || nowMs == null) { emitUncredited(p, metaNow(vname)); continue; }
    state.pending.push({ p, atMs: nowMs, ...metaNow(vname) });
  }

  // Age the attack buffer; drop consumed entries. Expire the rest by GAME TIME
  // (rate-independent — see ATTACK_ATTR_TTL_SEC), so a bleed-out death is still
  // attributed at 4 Hz. An unconsumed attack that ages out was an incap whose
  // victim never died (revived, or they left) — fine, most incaps aren't kills.
  const keep: BufferedAttack[] = [];
  for (const b of state.attackBuffer) {
    if (b.used) continue;
    if (gameTime != null && b.bufAt != null
        && gameTime - b.bufAt > ATTACK_ATTR_TTL_SEC) continue;
    keep.push(b);
  }
  // Hard cap so a stretch with no gameState can't grow the buffer unbounded.
  state.attackBuffer = keep.length > 400 ? keep.slice(keep.length - 400) : keep;

  // Bound the dedupe set so it can't grow forever in long matches.
  if (state.attackSeen.size > 600) state.attackSeen = trimSet(state.attackSeen, 300);

  return { newEntries: out };
}

/** Settle every death still waiting for a late event — the stream ended and
 *  nothing more will arrive. Rows come out as they would have after the wait. */
export function flushPendingDeaths(state: DiffState, snap: Snapshot): KillFeedEntry[] {
  if (!state.pending.length) return [];
  const ended: Snapshot = {
    ...snap,
    damageEvents: [],
    gameState: snap.gameState
      ? { ...snap.gameState, matchState: "WaitingPostMatch" } : null,
  };
  return diffSnapshot(state, ended).newEntries;
}

/** A frame's wall clock in ms: its timestamp, else its game time, else none. */
function snapClockMs(snap: Snapshot): number | null {
  const t = Date.parse(snap.timestamp ?? "");
  if (Number.isFinite(t)) return t;
  const g = snap.gameState?.elapsedSec;
  return g != null && Number.isFinite(g) ? g * 1000 : null;
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
