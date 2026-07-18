// Snapshot schema produced by sqreader.squad.snapshot.build_snapshot
// + clean_nonfinite (NaN→null). Mirrors the JSON shape; everything is
// nullable because real-world memory reads can fail at any boundary
// and we ship null per the no-guess policy.

export type Vec3 = { x: number; y: number; z: number | null };

// ESQVoiceChannel — which channel a player is keying this tick. 'none' means
// embodied but not transmitting; commandSQ1..9 = commander broadcasting to a
// specific squad. Absent (undefined) when the read failed the sanity gate.
export type VoiceChannel =
  | "none" | "local" | "squad" | "command" | "toCommander"
  | "commandSQ1" | "commandSQ2" | "commandSQ3" | "commandSQ4" | "commandSQ5"
  | "commandSQ6" | "commandSQ7" | "commandSQ8" | "commandSQ9";

export interface Player {
  _addr?: string;
  name: string | null;
  eosId: string | null;
  playerId: number | null;
  teamId: number | null;
  roleId: string | null;
  score: number | null;
  ping: number | null;
  isBot: boolean | null;
  clanTag: string | null;
  squadStateAddr: string | null;
  teamStateAddr: string | null;
  squadId?: number;
  squadName?: string;
  squadTeamId?: number;
  rolePool?: string;
  rolePoolLabel?: string;
  soldier: Soldier | null;
  stats?: Record<string, number | boolean | null>;
  // Live voice channel keyed off this player's own SQPlayerController.
  voiceChannel?: VoiceChannel | null;
}

export interface SoldierWeapon {
  className: string;            // BP_X_C — catalog key for WEAPONS_STATIC lookup
  name: string | null;          // UE instance name (e.g. 'BP_AKM_C_2147483645')
  magazines?: number[];         // [loaded, spare1, spare2, ...] round counts
}

export interface Soldier {
  addr: string;
  classShort: string | null;
  health: number | null;
  breathHoldStamina: number | null;
  // Real sprint stamina (SQSoldierMovement.Stamina) + its max. Range 0..staminaMax
  // (100 on current build). Distinct from breathHoldStamina (scope steadiness).
  // Optional: present only when the movement-component read succeeds.
  stamina?: number | null;
  staminaMax?: number | null;
  stance: "standing" | "crouched" | "prone" | null;
  position: Vec3 | null;
  yaw: number | null;
  attached: boolean | null;
  stale?: boolean;
  // Life-state — the server's replicated bIsWounded/bIsBleeding/bIsDying flags,
  // and the derived lifeState. Optional: present only when reflection resolved
  // the masks (legacy snapshots/replays omit them).
  isWounded?: boolean | null;
  isBleeding?: boolean | null;
  isDying?: boolean | null;
  lifeState?: "healthy" | "bleeding" | "incapacitated" | null;
  // Phase 2D part 2 — resolved CurrentHeldWeapon. Optional because a
  // soldier mid-bandage / mid-vehicle-mount can be in an unequipped
  // state; the killfeed uses lastKnownWeapon cache to bridge those.
  weapon?: SoldierWeapon | null;
}

export interface VehicleSeat {
  idx: number;
  addr?: string;
  seatComponentClass?: string | null;
  seatHealth?: number | null;
  playerStateAddr?: string;
  occupantName: string | null;
  occupantEosId?: string | null;
  occupantPlayerId?: number | null;
  occupantTeamId?: number | null;
}

export interface VehicleComponent {
  name: string;                 // BP component name: 'wheel_L1', 'TrackLeftComponent', etc.
  className: string;            // SQVehicleEngine / SQVehicleTrack / SQVehicleAmmoBox / ...
  health: number | null;
  maxHealth: number | null;
  state: number | null;         // enum: 0=Healthy, 1=Damaged, 2=Destroyed
}

export interface VehicleTurret {
  name: string;                 // e.g. 'BP_T62_Turret_C_2147478966' (UE instance name)
  className: string;            // e.g. 'BP_T62_Turret_C'
  magazines?: number[];         // [loaded, spare1, spare2, ...] — rounds per mag
  turretBaseClass?: string | null;
  // Turret RootComponent.RelativeRotation.Yaw — the turret's facing
  // offset from the hull's attach socket. World yaw = vehicle.yaw + turret.yaw.
  yaw?: number | null;
}

export interface Vehicle {
  id: string;
  classShort: string | null;
  team: number | null;
  health: number | null;
  maxHealth: number | null;
  position: Vec3 | null;
  yaw: number | null;
  attached: boolean | null;
  kind?: string;
  faction?: string[];
  lastDamager?: { addr: string; name: string | null; class: string | null };
  seats?: VehicleSeat[];
  // Phase 2B additions — populated by backend reads of SQVehicle's
  // VehicleComponents / VehicleTurrets / CachedVehicleEngine fields.
  // engine is often null on Squad vehicles because the cached pointer
  // is unset at runtime; the EngineComponent shows up in `components`
  // with className='SQVehicleEngine' so render it from there.
  engine?: VehicleComponent | null;
  components?: VehicleComponent[];
  turrets?: VehicleTurret[];
  // AmmoWep_*_C resource pools the vehicle owns. Logi trucks carry two
  // (one drops as ammo to refill FOBs, one drops as construction);
  // combat vehicles carry one for their built-in weapons.
  resourcePools?: VehicleResourcePool[];
}

export interface VehicleResourcePool {
  className: string | null;
  current: number | null;
  max: number | null;
}

// Static cap-zone footprint geometry, merged server-side from SquadCalc
// (see sqreader/squad/capzones.py). dx,dy are world-cm offsets from the zone
// anchor; rot is degrees in the same convention drawCapGeometry documents.
export type CapGeometry =
  | { type: "sphere"; dx: number; dy: number; radius: number }
  | { type: "box"; dx: number; dy: number; extX: number; extY: number; rot: number }
  | { type: "capsule"; dx: number; dy: number; radius: number; length: number; rot: number };

export interface CaptureZone {
  id: string;
  name: string | null;
  position: Vec3 | null;
  flagName: string | null;
  owningTeam: number | null;
  capturingTeam: number | null;
  lastOwningTeam: number | null;
  initialTeam: number | null;
  capturePercent: number | null;
  captureRate: number | null;
  captureDirection: number | null;
  isLocked: boolean | null;
  teamCapturabilities: number | null;
  teamKnowledge: number | null;
  // Live capture-rate advantage (which side is winning the flag now).
  // Reflection-derived server-side; absent if the SDK field name differs.
  playerAdvantage?: number | null;
  component: unknown;
  // Static SquadCalc geometry attached at snapshot time (AAS). Absent when
  // no static data matched (older snapshots, unknown layer) → circle fallback.
  geometry?: CapGeometry[];
  staticName?: string | null;
  staticCluster?: string | null;
  staticPosition?: Vec3 | { x: number; y: number } | null;
}

// One RAAS objective on the active lane, shaped from static data. Layout only —
// carries no ownership (the reader can't read RAAS cluster ownership).
export interface StaticObjective {
  name: string | null;
  staticName?: string | null;   // SquadCalc readable name ("Niva Lower")
  cluster?: string | null;
  position?: { x: number; y: number } | null;
  geometry?: CapGeometry[];
}

export interface Deployable {
  id: string;
  classShort: string | null;
  actorName: string | null;
  team: number | null;
  initialTeam: number | null;
  isFob: boolean | null;
  isPlaced: boolean | null;
  buildState: number | null;
  cost: number | null;
  health: number | null;
  maxHealth: number | null;
  initialHealth: number | null;
  owningFobAddr: string | null;
  position: Vec3 | null;
  yaw: number | null;
  // FOB-only fields (present when isFob === true). Read from
  // BP_BaseFobCreator_C overlay on the same actor address.
  ammo?: number | null;
  maxAmmo?: number | null;
  construction?: number | null;
  maxConstruction?: number | null;
  ammoPerSecond?: number | null;
  cpPerSecond?: number | null;
  nearbyEnemies?: number | null;
  fobSieged?: boolean | null;
  fobSpawningEnabled?: boolean | null;
  fobBleeding?: boolean | null;
  fobOverrun?: boolean | null;
  // World-clock time (same units as gameState.worldTimeSec) this FOB is
  // projected to bleed out. Only meaningful while fobBleeding; the client
  // shows (estimatedDeathTime - worldTimeSec) as a countdown.
  estimatedDeathTime?: number | null;
}

export interface VehicleSpawner {
  id: string;
  classShort: string | null;
  actorName: string | null;
  team: number | null;
  spawnInProgress: boolean | null;
  spawnOverlapped: boolean | null;
  spawnerEnabled: boolean | null;
  lockedUntilRaw: number | null;
  // Seconds until this pad unlocks (decoded from the FDateTime lock stamp).
  // Positive = cooldown, <=0 = ready, null = no active lock / undecodable.
  nextSpawnSec?: number | null;
  vehicleClass: string | null;
  vehicleClassAddr: string | null;
  teamAuthorityAddr: string | null;
  position: Vec3 | null;
}

export interface RallyPoint {
  id: string;
  classShort: string | null;
  actorName: string | null;
  team: number | null;
  spawningEnabled: boolean | null;
  sieged: boolean | null;
  spawnsRemaining: number | null;
  squadStateAddr: string | null;
  position: Vec3 | null;
  // Filled in by backend join against snapshot.squads[].
  squadId: number | null;
  squadName: string | null;
  squadTeamId: number | null;
}

export interface Marker {
  id: string;
  type: string | null;
  team: number | null;
  squad: number | null;
  fireTeamId: number | null;
  ownerPlayerStateAddr: string | null;
  position: Vec3 | null;
  // v10 squad-state data markers carry an iconClass (e.g.
  // BP_WaypointMapMarker_Move_C / _Attack_C / _Defend_C / _Build_C /
  // _Observe_C / their _FT_C variants). Used to discriminate the
  // sub-kind of Waypoint-style markers when the BP type alone isn't
  // enough (Waypoint is the umbrella class for all 5 kinds).
  iconClass?: string | null;
  squadStateAddr?: string | null;
  visible?: boolean | null;
}

export interface Projectile {
  id: string;
  classShort: string | null;
  hasImpacted: boolean | null;
  isTracer: boolean | null;
  isExplosive: boolean | null;
  explosiveBaseDamage: number | null;
  explosiveKillZoneRadius: number | null;
  position: Vec3 | null;
  // Optional Phase B+ fields. velocity lets the renderer rotate the
  // projectile icon on its very first frame instead of waiting for a
  // second position sample. kind ('mortar' | 'grad' | 's5') drives
  // per-type icon + impact radius. team enables firer-colour tint.
  velocity?: Vec3 | null;
  kind?: "mortar" | "grad" | "s5" | null;
  team?: number | null;
  // Name of the player who fired this round, resolved from the instigator
  // controller. Null when world-spawned or unresolvable (no-guess).
  firer?: string | null;
}

export interface TeamState {
  _addr?: string;
  id: number | null;
  tickets: number | null;
  score: number | null;
  objectiveScore: number | null;
  kills: number | null;
  deaths: number | null;
  woundeds: number | null;
  factionId: string | null;
  playerCount: number | null;
  squadCount: number | null;
  vehicleSlotCount: number | null;
  deployableSlotCount: number | null;
  roleSlotCount: number | null;
}

export interface SquadState {
  _addr?: string;
  id: number | null;
  teamId: number | null;
  maxSize: number | null;
  name: string | null;
  kills: number | null;
  deaths: number | null;
  woundeds: number | null;
  score: number | null;
  teamWorkScore: number | null;
  objectiveScore: number | null;
  combatScore: number | null;
  revivedPoints: number | null;
  creationTime: number | null;
  playerCount: number | null;
  leaderStateAddr: string | null;
  creatorName: string | null;
  creatorOnlineId: string | null;
}

export interface DamageEvent {
  victim: string | null;
  victimEosId: string | null;
  victimTeam: number | null;
  victimSoldier: string | null;
  victimPos: Vec3 | null;
  attacker: string | null;
  attackerCtrlAddr: string | null;
  selfInflicted: boolean | null;
  // ---- Optional fields (backend Phase B+ will populate). Kept optional
  // so the killfeed's 5-tier fallback chain naturally degrades to the
  // current minimal data set today and lights up as the backend grows.
  causerWeapon?: string | null;       // resolved weapon class FName
  causerClass?: string | null;        // raw causer actor class (projectile, vehicle, soldier)
  damageType?: string | null;         // UDamageType class FName
  hitDistance?: number | null;        // meters (FHitResult.Distance/100)
  headshot?: boolean | null;          // FHitResult.BoneName === "head"
  wounded?: boolean | null;           // incap (not yet fatal)
  killed?: boolean | null;            // final death (bleed-out or instant)
  ts?: number | null;                 // event tick id (for dedupe)
}

// One row in the kill feed. Derived view computed from tick-over-tick
// diffs of player.stats.kills/deaths, paired with damageEvents for
// metadata enrichment. Pinned values (vehicle, weapon) are captured AT
// PUSH TIME because dismounts / weapon swaps happen within seconds of
// the kill — re-resolving at render time would lose the context.
export interface KillFeedEntry {
  id: string;                            // stable unique key for React lists
  wallClockMs: number;                   // browser-side timestamp at push
  gameTimeSec: number | null;            // in-game elapsed seconds (gs.elapsedSec)
  killer: string | null;                 // null = world-cause / suicide
  killerTeam: number | null;
  killerRoleId: string | null;
  killerVehicleClass: string | null;     // BP_X_C of vehicle if mounted at kill
  weaponClass: string | null;
  weaponApprox?: boolean;                 // weapon came only from the sticky
                                          // last-seen cache — may be wrong
  damageType: string | null;
  hitDistance: number | null;
  headshot: boolean;
  victim: string;
  victimTeam: number | null;
  victimRoleId: string | null;
  victimVehicleClass: string | null;
  tk: boolean;
  suicide: boolean;
  wounded: boolean;                       // incap row (kept distinct from final kill)
}

export interface LayerBounds {
  name?: string;
  mapId?: string;
  mapName?: string;
  gameMode?: string;
  texture?: string;
  topLeft?: [number, number] | { x: number; y: number };
  bottomRight?: [number, number] | { x: number; y: number };
}

export interface LaneEdge {
  from: string | null;
  fromAddr: string | null;
  fromPos?: Vec3 | null;
  to: string | null;
  toAddr: string | null;
  toPos?: Vec3 | null;
}

export interface LaneGraph {
  _initializerAddr?: string;
  initializerClass?: string | null;
  mode?: "AAS" | "RAAS" | null;
  edges?: LaneEdge[];
  nodes?: { name: string | null; addr: string }[];
  routeIndex?: number | null;
  // Static SquadCalc geometry resolved onto the active lane (RAAS, when live
  // captureZones is empty). Attached server-side; shape + position, no ownership.
  staticObjectives?: StaticObjective[];
}

export interface GameState {
  _addr?: string;
  serverName: string | null;
  motd?: string | null;
  maxPlayers: number | null;
  tickRate: number | null;
  matchId: string | null;
  matchState: string | null;
  elapsedSec: number | null;
  isTicketBased: boolean | null;
  gameModeId: string | null;
  numTeams: number | null;
  maxFireTeamCount: number | null;
  maxFireTeamSize: number | null;
  timeOfCompletion: number | null;
  serverStartTimestamp: number | null;
  worldTimeSec: number | null;
  mapName: string | null;
  gameModeName: string | null;
  instanceClass: string | null;
  layer?: LayerBounds | null;
  mapConfig?: unknown;
  lane?: LaneGraph | null;
}

export interface Snapshot {
  timestamp: string;
  server: string;
  schemaVersion: string;
  tick?: number;
  counts: {
    playerStatesNonCDO: number;
    soldiersLive: number;
    vehicleSeatsLive: number;
    totalUObjects: number;
  };
  gameState: GameState | null;
  teams: TeamState[];
  squads: SquadState[];
  players: Player[];
  vehicles: Vehicle[];
  captureZones: CaptureZone[];
  markers: Marker[];
  deployables: Deployable[];
  vehicleSpawners: VehicleSpawner[];
  rallyPoints: RallyPoint[];
  projectiles: Projectile[];
  damageEvents: DamageEvent[];
}

// View transform: same model the old viewer used.
export interface ViewState {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  zoom: number;
  panX: number;
  panY: number;
  userInteracted: boolean;
}

export const DEFAULT_VIEW: ViewState = {
  minX: 0, minY: 0, maxX: 1, maxY: 1,
  zoom: 1, panX: 0, panY: 0,
  userInteracted: false,
};

export type Mode = "home" | "live" | "replay";

export type ConnStatus = "connecting" | "live" | "reconnecting" | "replay" | "idle";

export interface RecordingMeta {
  id: string;
  filename: string;
  sizeBytes: number;
  ticks: number | null;
  durationSec: number | null;
  startedAtUtc: string | null;
  endedAtUtc: string | null;
  serverId: string | null;
  mapName: string | null;
  gameMode: string | null;
  layerName: string | null;
  matchId: string | null;
  peakPlayers: number | null;
  recordingState?: "active" | "finalized" | "unverified";
  inProgress: boolean;
}

// ----- persistent player statistics (backend: /api/players, /api/leaderboard).
// Field casing mirrors the SQL/JSON the backend emits (snake_case for row
// columns, camelCase for the profile envelope).

export interface PlayerSummary {
  eos_id: string;
  last_name: string | null;
  last_clan_tag: string | null;
  last_seen_at: number | null;
  matches: number;
  kills: number;
  deaths: number;
}
/** Server-computed tier for a rating. Never derive this client-side — the bands
 *  live in sqreader/elo.py and must not drift between the two. */
export interface EloBadge {
  rating: number;
  tier: number;
  label: string;
  color: string;
  /** null at the top tier — there is nowhere left to climb. */
  nextAt: number | null;
  /** 0..1 through the current band. */
  progress: number;
  matchesPlayed?: number;
}
export interface LeaderRow extends PlayerSummary {
  value: number;
  /** Present only on the ELO board. */
  elo?: EloBadge;
}

export type StatsPeriod = "daily" | "weekly" | "monthly" | "alltime";

/** One enrolled server, for the stats-page scope picker (/api/servers). */
export interface ServerOption {
  id: string;
  label: string | null;
  matches: number;
}

export interface WeaponMetaRow {
  weapon: string;
  kills: number;
  team_kills: number;
  wounds: number;
  users: number;
  matches: number;
  /** null when no kill with this weapon could be positioned — not zero. */
  avg_distance_m: number | null;
  max_distance_m: number | null;
}

export interface HeatmapPoint {
  ts: number | null;
  attacker_team: number | null;
  victim_team: number | null;
  weapon: string | null;
  attacker_x: number | null; attacker_y: number | null;
  victim_x: number; victim_y: number;
  distance_m: number | null;
  killed: number; wounded: number; team_kill: number;
}
export interface MatchHeatmap {
  matchId: string;
  mapName: string | null;
  layerName: string | null;
  gameMode: string | null;
  points: HeatmapPoint[];
  bounds: LayerBounds | null;
}

export interface HeatmapLayerOption {
  layer_name: string;
  map_name: string | null;
  matches: number;
  deaths: number;
}

/** cell_x/cell_y are the cell's lower-left corner, in world centimetres. */
export interface HeatmapCell { cell_x: number; cell_y: number; n: number; }
export interface LayerHeatmap {
  layerName: string;
  period: string;
  cellCm: number;
  maxCount: number;
  cells: HeatmapCell[];
  bounds: LayerBounds | null;
}
export interface PlayerMatchRow {
  match_id: string;
  team_id: number | null;
  squad_name: string | null;
  faction: string | null;
  role_id: string | null;
  kills: number; deaths: number; woundeds: number; team_kills: number;
  vehicle_kills: number; revived_points: number;
  combat_score: number; objective_score: number; score: number;
  playtime_sec: number;
  /** null = this match was never rated (too small/short, or ELO is off). */
  elo_change: number | null;
  map_name: string | null;
  game_mode: string | null;
  layer_name: string | null;
  started_at: number | null;
  winner_team: number | null;
  status: string | null;
}
export interface WeaponStat { weapon: string; kills: number; }
export interface MapStat { map_name: string; matches: number; kills: number; deaths: number; }
export interface NemesisRow { eos: string; name: string | null; c: number; }
export interface PlayerLifetime {
  matches: number; kills: number; deaths: number; woundeds: number;
  wounds: number; team_kills: number; vehicle_kills: number;
  revives: number; heals: number;
  combat_score: number; objective_score: number; team_work_score: number;
  // Squad stats-collector totals (memory-only counters, not in RCON).
  captures: number; defenses: number;
  fobs_built: number; fobs_destroyed: number;
  supplies_delivered: number; vehicle_damage: number;
  playtime_sec: number;
}
export interface MatchSummaryRow {
  match_id: string;
  map_name: string | null;
  layer_name: string | null;
  game_mode: string | null;
  started_at: number | null;
  duration_sec: number | null;
  status: string | null;
  winner_team: number | null;
  team1_faction: string | null; team2_faction: string | null;
  team1_tickets: number | null; team2_tickets: number | null;
  peak_players: number | null;
  players: number;
}
export interface MatchDetailPlayer {
  eos_id: string; name: string | null; clan_tag: string | null;
  team_id: number | null; squad_name: string | null; faction: string | null;
  role_id: string | null;
  kills: number; deaths: number; woundeds: number; team_kills: number;
  vehicle_kills: number; revived_points: number; heal_points: number;
  combat_score: number; objective_score: number; team_work_score: number;
  score: number;
  captures: number; defenses: number; fobs_built: number;
  fobs_destroyed: number; supplies_delivered: number; vehicle_damage: number;
  playtime_sec: number;
}
export interface MatchDetail {
  match_id: string;
  map_name: string | null; layer_name: string | null; game_mode: string | null;
  started_at: number | null; ended_at: number | null; duration_sec: number | null;
  status: string | null; winner_team: number | null;
  team1_faction: string | null; team2_faction: string | null;
  team1_tickets: number | null; team2_tickets: number | null;
  peak_players: number | null;
  players: MatchDetailPlayer[];
}

export interface MostPlayedRole { role: string; matches: number; }
export interface BestMatchEntry {
  value: number; kills: number; deaths: number;
  map_name: string | null; started_at: number | null;
}
export interface PeriodStat { kills: number; deaths: number; matches: number; }
export interface PeriodBreakdown {
  weekly: PeriodStat; monthly: PeriodStat; alltime: PeriodStat;
}
export interface FactionRecord {
  faction: string; matches: number; kills: number; deaths: number; wins: number;
}
export interface MapRecord {
  map_name: string; matches: number; wins: number; kills: number; deaths: number;
}
export interface SquadmateRow { eos: string; name: string | null; c: number; }
export interface VehicleUsedRow {
  vehicle_class: string; sessions: number; time_s: number; distance_m: number;
}
export interface ActivityCell { dow: number; hour: number; n: number; }

export interface PlayerProfile {
  eosId: string;
  name: string | null;
  clanTag: string | null;
  firstSeenAt: number | null;
  lastSeenAt: number | null;
  mostPlayedRole?: MostPlayedRole | null;
  longestKillInfM?: number | null;
  bestMatch?: { byKills: BestMatchEntry | null; byScore: BestMatchEntry | null };
  periodBreakdown?: PeriodBreakdown;
  mapRecords?: MapRecord[];
  factions?: FactionRecord[];
  squadmates?: SquadmateRow[];
  vehiclesUsed?: VehicleUsedRow[];
  activity?: ActivityCell[];
  /** null = unrated. An unrated player is NOT "1000" — the UI must distinguish
   *  "has not played a ratable match yet" from "sits at the starting rating". */
  elo: EloBadge | null;
  lifetime: PlayerLifetime;
  recentMatches: PlayerMatchRow[];
  topWeapons: WeaponStat[];
  favoriteMaps: MapStat[];
  nemeses: NemesisRow[];
  victims: NemesisRow[];
}
