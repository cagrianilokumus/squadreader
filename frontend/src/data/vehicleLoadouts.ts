// Auto-generated wrapper around cota.squadreplay.com/static/data/vehicle-loadouts.js?v=2
// Body is the verbatim JS source (slightly retyped to satisfy TS strict).
//   - outer IIFE replaced with a typed initialiser
//   - initial `const VEHICLE_LOADOUTS` annotated as Record<string, any>
//     so subsequent `VEHICLE_LOADOUTS[key] = {...}` mutations type-check
//   - window publish stripped (not used in our React app)

interface LoadoutSeat {
  index: number;
  role: string;
  turretClass: string | null;
}
interface LoadoutWeapon {
  name: string;
  class: string;
  mags?: number;
  magSize?: number;
  type?: string;
  caliber?: string;
}
export interface VehicleLoadout {
  seats: LoadoutSeat[];
  turrets: Record<string, LoadoutWeapon[]>;
}

const VEHICLE_LOADOUTS_RAW: Record<string, VehicleLoadout> = (function () {
// Static weapon loadouts per vehicle. Keyed by vehicle className.
//   seats[]: fixed seat roster (driver/gunner/commander/...) with the turret
//     class each seat controls. Maps to the live TURRET array read from memory.
//   turrets{}: every turret's available weapons. Matched at runtime against
//     the live turret's currentWeapon.class to identify the selected round.
// type legend: kinetic (AP/sabot), heat (HESH/HEAT), smoke, mg, he, atgm, aa
const VEHICLE_LOADOUTS: Record<string, any> = {
  // FV4034 Challenger 2 — all variants share the same turret rigging
  'BP_FV4034_C': {
    seats: [
      { index: 0, role: 'Driver',       turretClass: null },
      { index: 1, role: 'Gunner',       turretClass: 'BP_FV4034_Turret_C' },
      { index: 2, role: 'Commander',    turretClass: 'BP_FV4034_Commander_Periscope_C' }, // periscope, silahsız
      { index: 3, role: 'RWS Operator', turretClass: 'BP_EnforcerRWS_Turret_L37A2_C' },
    ],
    turrets: {
      // Driver smoke (no turret, attached to hull)
      'Driver': [
        { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
      ],
      'BP_FV4034_Turret_C': [
        { name: 'L27A1 CHARM 120mm APFSDS',  class: 'BP_L30A1_AP',            mags: 25, magSize: 1,    type: 'kinetic', caliber: '120mm' },
        { name: 'L31A7 120mm HESH',          class: 'BP_L30A1_HESH',          mags: 16, magSize: 1,    type: 'heat',    caliber: '120mm' },
        { name: 'L34 120mm Smoke',           class: 'BP_L30A1_Smoke',         mags: 6,  magSize: 1,    type: 'smoke',   caliber: '120mm' },
        { name: 'L94A1 Coaxial MG',          class: 'BP_L94A1_coax',          mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
        { name: '40mm Smoke Launchers',      class: 'BP_Smoke_Launcher_FV4034', mags: 1, magSize: 2,   type: 'smoke' },
      ],
      'BP_EnforcerRWS_Turret_L37A2_C': [
        { name: 'L37A2 RWS 7.62mm',          class: 'BP_EnforcerRWS_L37A2',   mags: 1,  magSize: 750,  type: 'mg',      caliber: '7.62mm' },
      ],
    },
  },
};
// Lynx 8x8 Logistics (PLA/PLANMC/PLAAGF) — Driver smoke only
VEHICLE_LOADOUTS['BP_LynxATV_Logistic_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
  },
};
// FV4034 Challenger 2 — Woodland variant (all turret classes + RWS weapon class have _Woodland suffix)
VEHICLE_LOADOUTS['BP_FV4034_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_FV4034_Turret_Woodland_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_FV4034_Commander_Periscope_Woodland_C' }, // periscope, silahsız
    { index: 3, role: 'RWS Operator', turretClass: 'BP_EnforcerRWS_Turret_L37A2_Woodland_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_FV4034_Turret_Woodland_C': [
      { name: 'L27A1 CHARM 120mm APFSDS', class: 'BP_L30A1_AP',                     mags: 25, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'L31A7 120mm HESH',         class: 'BP_L30A1_HESH',                   mags: 16, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'L34 120mm Smoke',          class: 'BP_L30A1_Smoke',                  mags: 6,  magSize: 1,    type: 'smoke',   caliber: '120mm' },
      { name: 'L94A1 Coaxial MG',         class: 'BP_L94A1_coax',                   mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_FV4034',        mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_EnforcerRWS_Turret_L37A2_Woodland_C': [
      { name: 'L37A2 RWS 7.62mm',         class: 'BP_EnforcerRWS_L37A2_Woodland',   mags: 1,  magSize: 750,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// Leopard 2A6M CAN — Desert variant (CAF arid maps)
VEHICLE_LOADOUTS['BP_2A6_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_2A6_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_2a6_Commander_Periscope_Desert_C' }, // periscope only, silahsız
    { index: 3, role: 'Loader',    turretClass: 'BP_2A6_Loaders_Turret_Desert_C' },
  ],
  turrets: {
    // Driver hull smoke (seat has no turret; shown for reference, not rendered)
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_2A6_Turret_Desert_C': [
      { name: 'DM53 120mm APFSDS',     class: 'BP_L55_AP',                          mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'DM12 120mm HEAT',       class: 'BP_L55_HEAT',                        mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_L55_coax',                        mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_2A6',              mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_2A6_Loaders_Turret_Desert_C': [
      { name: 'C6A1 FLEX 7.62mm',      class: 'BP_2A6_C6_Loaders_Weapon_Desert',    mags: 1,  magSize: 500,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};
// Leopard 2A6M CAN — Desert Cage variant
// Only diff vs non-cage: gunner turret class has "_Cage" suffix. Weapons/commander/loader identical.
VEHICLE_LOADOUTS['BP_2A6_Desert_Cage_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_2A6_Turret_Desert_Cage_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_2a6_Commander_Periscope_Desert_C' },
    { index: 3, role: 'Loader',    turretClass: 'BP_2A6_Loaders_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_2A6_Turret_Desert_Cage_C': [
      { name: 'DM53 120mm APFSDS',     class: 'BP_L55_AP',                          mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'DM12 120mm HEAT',       class: 'BP_L55_HEAT',                        mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_L55_coax',                        mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_2A6',              mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_2A6_Loaders_Turret_Desert_C': [
      { name: 'C6A1 FLEX 7.62mm',      class: 'BP_2A6_C6_Loaders_Weapon_Desert',    mags: 1,  magSize: 500,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};
// Leopard 2A6M CAN — Woodland variant
// Woodland is the "base" — Commander/Loader turrets and C6A1 weapon class use NO suffix.
// Only gunner turret carries the _Woodland_C suffix.
VEHICLE_LOADOUTS['BP_2A6_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_2A6_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_2a6_Commander_Periscope_C' }, // periscope, silahsız
    { index: 3, role: 'Loader',    turretClass: 'BP_2A6_Loaders_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_2A6_Turret_Woodland_C': [
      { name: 'DM53 120mm APFSDS',     class: 'BP_L55_AP',                          mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'DM12 120mm HEAT',       class: 'BP_L55_HEAT',                        mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_L55_coax',                        mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_2A6',              mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_2A6_Loaders_Turret_C': [
      { name: 'C6A1 FLEX 7.62mm',      class: 'BP_2A6_C6_Loaders_Weapon',           mags: 1,  magSize: 500,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};
// Leopard 2A6M CAN — Woodland Cage variant
// Only diff vs Woodland: gunner turret class has "_Cage" suffix. Weapons/commander/loader identical.
VEHICLE_LOADOUTS['BP_2A6_Woodland_Cage_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_2A6_Turret_Woodland_Cage_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_2a6_Commander_Periscope_C' },
    { index: 3, role: 'Loader',    turretClass: 'BP_2A6_Loaders_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_2A6_Turret_Woodland_Cage_C': [
      { name: 'DM53 120mm APFSDS',     class: 'BP_L55_AP',                          mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'DM12 120mm HEAT',       class: 'BP_L55_HEAT',                        mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_L55_coax',                        mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_2A6',              mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_2A6_Loaders_Turret_C': [
      { name: 'C6A1 FLEX 7.62mm',      class: 'BP_2A6_C6_Loaders_Weapon',           mags: 1,  magSize: 500,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// M1A1 Abrams — USMC variant
VEHICLE_LOADOUTS['BP_M1A1_USMC_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1A1_USMC_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M1A1_USMC_Commander_Turret_C' },
  ],
  turrets: {
    // Driver hull smoke (seat has no turret; shown for reference, not rendered)
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M1A1_USMC_Turret_C': [
      { name: 'M829A4 120mm APFSDS',   class: 'BP_M256A1_AP',                       mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M830A1 120mm HEAT',     class: 'BP_M256A1_HEAT',                     mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_M256A1_coax',                     mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M1A2',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M1A1_USMC_Commander_Turret_C': [
      { name: 'M2A1 Browning .50cal',  class: 'BP_M1A1_USMC_Cmdr_M2',               mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};
// M1A1 Abrams — USMC Woodland variant
// Differs from Desert: gunner/commander turret classes have "_Woodland" suffix, M2A1 CWS weapon class also "_Woodland". Weapons/magazines identical.
VEHICLE_LOADOUTS['BP_M1A1_USMC_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1A1_USMC_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M1A1_USMC_Commander_Turret_Woodland_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M1A1_USMC_Turret_Woodland_C': [
      { name: 'M829A4 120mm APFSDS',   class: 'BP_M256A1_AP',                       mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M830A1 120mm HEAT',     class: 'BP_M256A1_HEAT',                     mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_M256A1_coax',                     mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M1A2',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M1A1_USMC_Commander_Turret_Woodland_C': [
      { name: 'M2A1 Browning .50cal',  class: 'BP_M1A1_USMC_Cmdr_M2_Woodland',      mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// M1A1 Abrams — AUS (Australian ADF) variant
// Differs from USMC: Mag58 coax, KEW-A2 APFSDS, CWS commander MG (7×100 instead of 1×400)
VEHICLE_LOADOUTS['BP_AUS_M1A1_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_AUS_M1A1_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M1A1_Cupola_Turret_ADF_C' },
  ],
  turrets: {
    // Driver hull smoke (seat has no turret; shown for reference, not rendered)
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_AUS_M1A1_Turret_C': [
      { name: 'KEW-A2 120mm APFSDS',   class: 'BP_M256A1_AP_ADF',                   mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M830A1 120mm HEAT',     class: 'BP_M256A1_HEAT',                     mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'Mag58 Coaxial MG',      class: 'BP_M256A1_coax_ADF',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M1A2',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M1A1_Cupola_Turret_ADF_C': [
      { name: 'M2A1 Browning CWS',     class: 'BP_M1A1_FLEX_M2',                    mags: 7,  magSize: 100,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// M1A2 Abrams — Desert variant
// Differs from M1A1 USMC: CROWS RWS commander (separate BP_CROWS_M1A2_C turret, not Cmdr_M2), plus 4th seat loader with M240B (10×250)
VEHICLE_LOADOUTS['BP_M1A2_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1A2_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_CROWS_M1A2_C' },
    { index: 3, role: 'Loader',    turretClass: 'BP_M1A2_Loaders_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M1A2_Turret_C': [
      { name: 'M829A4 120mm APFSDS',   class: 'BP_M256A1_AP',                       mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M830A1 120mm HEAT',     class: 'BP_M256A1_HEAT',                     mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_M256A1_coax',                     mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M1A2',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_CROWS_M1A2_C': [
      { name: 'M2A1 Browning CROWS',   class: 'BP_CROWS_M2',                        mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
    'BP_M1A2_Loaders_Turret_C': [
      { name: 'M240B',                 class: 'BP_M240_Loaders_Weapon',             mags: 10, magSize: 250,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// M1A2 Abrams — Woodland variant
// All 3 turret classes + CROWS M2 weapon + Loader M240 weapon suffixed with "_Woodland" (CROWS suffix is actually "_Woodland_Green"). Magazines identical.
VEHICLE_LOADOUTS['BP_M1A2_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1A2_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_CROWS_Woodland_M1A2_C' },
    { index: 3, role: 'Loader',    turretClass: 'BP_M1A2_Loaders_Turret_Woodland_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M1A2_Turret_Woodland_C': [
      { name: 'M829A4 120mm APFSDS',   class: 'BP_M256A1_AP',                       mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M830A1 120mm HEAT',     class: 'BP_M256A1_HEAT',                     mags: 21, magSize: 1,    type: 'heat',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_M256A1_coax',                     mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M1A2',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_CROWS_Woodland_M1A2_C': [
      { name: 'M2A1 Browning CROWS',   class: 'BP_CROWS_M2_Woodland_Green',         mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
    'BP_M1A2_Loaders_Turret_Woodland_C': [
      { name: 'M240B',                 class: 'BP_M240_Loaders_Weapon_Woodland',    mags: 10, magSize: 250,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// M60T Sabra — WPMC (Turkish Land Forces) variant
// Unique: has LAHAT ATGM (gun-launched guided missile), M339 HE round instead of HEAT, M85 HMG commander (not M2)
VEHICLE_LOADOUTS['BP_M60T_WPMC_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M60T_Turret_WPMC_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M60T_Commander_Turret_WPMC_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M60T_Turret_WPMC_C': [
      { name: 'M322 120mm APFSDS',     class: 'BP_MG253_AP_WPMC',                   mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M339 120mm HE',         class: 'BP_MG253_Frag_WPMC',                 mags: 20, magSize: 1,    type: 'he',      caliber: '120mm' },
      { name: 'LAHAT Guided Missile',  class: 'BP_MG253_LAHAT_ATGM_WPMC',           mags: 2,  magSize: 1,    type: 'atgm',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_MG253_coax_WPMC',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M60T_WPMC',        mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M60T_Commander_Turret_WPMC_C': [
      { name: 'M85 HMG',               class: 'BP_M60T_M85_WPMC',                   mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// M60T Sabra — standard variant (no WPMC/Desert suffix)
// Same loadout as WPMC but turret + all weapon classes drop the "_WPMC" suffix.
VEHICLE_LOADOUTS['BP_M60T_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M60T_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M60T_Commander_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M60T_Turret_C': [
      { name: 'M322 120mm APFSDS',     class: 'BP_MG253_AP',                        mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M339 120mm HE',         class: 'BP_MG253_Frag',                      mags: 20, magSize: 1,    type: 'he',      caliber: '120mm' },
      { name: 'LAHAT Guided Missile',  class: 'BP_MG253_LAHAT_ATGM',                mags: 2,  magSize: 1,    type: 'atgm',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_MG253_coax',                      mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M60T',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M60T_Commander_Turret_C': [
      { name: 'M85 HMG',               class: 'BP_M60T_M85',                        mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// M60T Sabra — Desert variant
// Turret classes get "_Desert" suffix; M85 HMG weapon also gets "_Desert". Main gun + coax + smoke launcher use BASE class names.
VEHICLE_LOADOUTS['BP_M60T_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M60T_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M60T_Commander_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M60T_Turret_Desert_C': [
      { name: 'M322 120mm APFSDS',     class: 'BP_MG253_AP',                        mags: 21, magSize: 1,    type: 'kinetic', caliber: '120mm' },
      { name: 'M339 120mm HE',         class: 'BP_MG253_Frag',                      mags: 20, magSize: 1,    type: 'he',      caliber: '120mm' },
      { name: 'LAHAT Guided Missile',  class: 'BP_MG253_LAHAT_ATGM',                mags: 2,  magSize: 1,    type: 'atgm',    caliber: '120mm' },
      { name: 'M240 Coaxial MG',       class: 'BP_MG253_coax',                      mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_M60T',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M60T_Commander_Turret_Desert_C': [
      { name: 'M85 HMG',               class: 'BP_M60T_M85_Desert',                 mags: 1,  magSize: 400,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-62 — standard variant
// Soviet 115mm 2A20 gun. No 40mm smoke launchers. Separate DshK cupola (BP_Cupola_Dshk_Turret_C) as 4th seat, not commander.
// Commander has periscope-only (BP_T62_Commander_Periscope_C) with no weapons.
VEHICLE_LOADOUTS['BP_T62_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T62_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_T62_Commander_Periscope_C' },
    { index: 3, role: 'DshK',      turretClass: 'BP_Cupola_Dshk_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T62_Turret_C': [
      { name: '3BM-4 115mm APFSDS',    class: 'BP_2A20_AP',                         mags: 12, magSize: 1,    type: 'kinetic', caliber: '115mm' },
      { name: 'BK-4M 115mm HEAT',      class: 'BP_2A20_HEAT',                       mags: 8,  magSize: 1,    type: 'heat',    caliber: '115mm' },
      { name: 'OF-11 115mm Frag',      class: 'BP_2A20_Frag',                       mags: 20, magSize: 1,    type: 'he',      caliber: '115mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A20_coax',                       mags: 1,  magSize: 2500, type: 'mg',      caliber: '7.62mm' },
    ],
    'BP_Cupola_Dshk_Turret_C': [
      { name: 'DshK HMG',              class: 'BP_Cupola_Dshk',                     mags: 6,  magSize: 100,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-62 — GFI (Global Forces Insurgent) variant
// Same 2A20 gun as standard. Differs: 4th seat uses Kord cupola (BP_T62_Kord_Cupola_Turret_C) with NSVT instead of DshK.
// NSVT weapon class shared with T-72S (BP_T72S_Kord_Cupola_Weapon), 2×150 magazines (not 6×100 like DshK).
VEHICLE_LOADOUTS['BP_T62_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T62_Turret_GFI_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_T62_GFI_Commander_Periscope_C' },
    { index: 3, role: 'NSVT',      turretClass: 'BP_T62_Kord_Cupola_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T62_Turret_GFI_C': [
      { name: '3BM-4 115mm APFSDS',    class: 'BP_2A20_AP',                         mags: 12, magSize: 1,    type: 'kinetic', caliber: '115mm' },
      { name: 'BK-4M 115mm HEAT',      class: 'BP_2A20_HEAT',                       mags: 8,  magSize: 1,    type: 'heat',    caliber: '115mm' },
      { name: 'OF-11 115mm Frag',      class: 'BP_2A20_Frag',                       mags: 20, magSize: 1,    type: 'he',      caliber: '115mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A20_coax',                       mags: 1,  magSize: 2500, type: 'mg',      caliber: '7.62mm' },
    ],
    'BP_T62_Kord_Cupola_Turret_C': [
      { name: 'NSVT HMG',              class: 'BP_T72S_Kord_Cupola_Weapon',         mags: 2,  magSize: 150,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-62 — MIL (Irregular Militia Forces) variant
// NOTE: Vehicle class is "_MIL" but turret classes all use "_IMF" suffix (BP_T62_IMF_Turret_C etc.).
// Same as standard T-62 (DshK cupola as 4th seat), just with "_IMF" suffix on turrets and "_MIL" suffix on DshK weapon class.
VEHICLE_LOADOUTS['BP_T62_MIL_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T62_IMF_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_T62_IMF_Commander_Periscope_C' },
    { index: 3, role: 'DshK',      turretClass: 'BP_Cupola_Dshk_IMF_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T62_IMF_Turret_C': [
      { name: '3BM-4 115mm APFSDS',    class: 'BP_2A20_AP',                         mags: 12, magSize: 1,    type: 'kinetic', caliber: '115mm' },
      { name: 'BK-4M 115mm HEAT',      class: 'BP_2A20_HEAT',                       mags: 8,  magSize: 1,    type: 'heat',    caliber: '115mm' },
      { name: 'OF-11 115mm Frag',      class: 'BP_2A20_Frag',                       mags: 20, magSize: 1,    type: 'he',      caliber: '115mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A20_coax',                       mags: 1,  magSize: 2500, type: 'mg',      caliber: '7.62mm' },
    ],
    'BP_Cupola_Dshk_IMF_Turret_C': [
      { name: 'DshK HMG',              class: 'BP_Cupola_Dshk_MIL',                 mags: 6,  magSize: 100,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-64BM2 — Cage variant (Ukrainian)
// Modern 125mm KBA3 gun with 9M119M Refleks gun-launched ATGM. 3 seats: driver, gunner, commander (NSVT cupola).
// No separate commander periscope — the Kord cupola IS the commander seat.
VEHICLE_LOADOUTS['BP_T64BM2_Cage_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T64BM2_Turret_Cage_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Kord_Cupola_Turret_T64BM2_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T64BM2_Turret_Cage_C': [
      { name: '3BM42 125mm APFSDS',    class: 'BP_KBA3_AP',                         mags: 20, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK18M 125mm HEAT',     class: 'BP_KBA3_HEAT',                       mags: 10, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF26 125mm Frag',      class: 'BP_KBA3_Frag',                       mags: 7,  magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',   class: 'BP_Kombat_ATGM',                     mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_KBA3_coax',                       mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T64BM2',           mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Kord_Cupola_Turret_T64BM2_C': [
      { name: 'NSVT HMG',              class: 'BP_Kord_Cupola_Weapon_T64BM2',       mags: 2,  magSize: 150,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-72A — IMF (Insurgent Militia Forces) variant
// Russian 125mm 2A46 (T-72A tier, no Refleks ATGM unlike T-72B3). 3 seats: driver, gunner, commander (NSVT cupola).
// Weapon classes suffixed "T72A" (BP_2A46_T72A_*). Coax uses 5×250 magazines (unusual for PKT).
VEHICLE_LOADOUTS['BP_T72A_IMF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T72A_IMF_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Kord_Cupola_T72A_IMF_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T72A_IMF_Turret_C': [
      { name: '3BM32 125mm APFSDS',    class: 'BP_2A46_T72A_AP',                    mags: 16, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK18M 125mm HEAT',     class: 'BP_2A46_T72A_HEAT',                  mags: 12, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF26 125mm Frag',      class: 'BP_2A46_T72A_Frag',                  mags: 22, magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A46_T72A_coax',                  mags: 5,  magSize: 250,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T72A',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Kord_Cupola_T72A_IMF_Turret_C': [
      { name: 'NSVT HMG',              class: 'BP_T72A_Kord_Cupola_Weapon',         mags: 2,  magSize: 150,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-72B3 — Desert variant (Russian modernized)
// Unlike T-72A: has 9M119M Refleks ATGM, newer ammo (3BM60 APFSDS, 3BK29M HEAT, 3OF82 Frag).
// Weapon classes use generic BP_2A46_* (no T72A suffix). 3 seats like T-72A.
VEHICLE_LOADOUTS['BP_T72B3_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T72B3_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Kord_Cupola_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T72B3_Turret_Desert_C': [
      { name: '3BM60 125mm APFSDS',    class: 'BP_2A46_AP',                         mags: 20, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK29M 125mm HEAT',     class: 'BP_2A46_HEAT',                       mags: 10, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF82 125mm Frag',      class: 'BP_2A46_Frag',                       mags: 9,  magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',   class: 'BP_9M119MRefleks_ATGM',              mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A46_coax',                       mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T72B3',            mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Kord_Cupola_Turret_Desert_C': [
      { name: 'NSVT HMG',              class: 'BP_Kord_Cupola_Weapon_Desert',       mags: 2,  magSize: 150,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-72B3 — standard variant (no Desert suffix)
// Same loadout as Desert; turret + NSVT weapon class drop "_Desert".
VEHICLE_LOADOUTS['BP_T72B3_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T72B3_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Kord_Cupola_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T72B3_Turret_C': [
      { name: '3BM60 125mm APFSDS',    class: 'BP_2A46_AP',                         mags: 20, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK29M 125mm HEAT',     class: 'BP_2A46_HEAT',                       mags: 10, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF82 125mm Frag',      class: 'BP_2A46_Frag',                       mags: 9,  magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',   class: 'BP_9M119MRefleks_ATGM',              mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A46_coax',                       mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T72B3',            mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Kord_Cupola_Turret_C': [
      { name: 'NSVT HMG',              class: 'BP_Kord_Cupola_Weapon',              mags: 2,  magSize: 150,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-72S — GFI (Global Forces Insurgent) variant
// Export-tier T-72 (no Refleks ATGM). Weapon classes suffixed "T72S" (BP_2A46_T72S_*).
// Like T-72A: coax 5×250 magazines, same 3BM32/BK18M/OF26 ammo family.
// NSVT weapon (BP_T72S_Kord_Cupola_Weapon) is the shared class also used by T-62 GFI's Kord cupola.
VEHICLE_LOADOUTS['BP_T72S_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T72S_GFI_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Kord_Cupola_T72S_GFI_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T72S_GFI_Turret_C': [
      { name: 'BM32 125mm APFSDS',     class: 'BP_2A46_T72S_AP',                    mags: 16, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: 'BK18M 125mm HEAT',      class: 'BP_2A46_T72S_HEAT',                  mags: 12, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: 'OF26 125mm Frag',       class: 'BP_2A46_T72S_Frag',                  mags: 22, magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A46_T72S_coax',                  mags: 5,  magSize: 250,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T72S',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Kord_Cupola_T72S_GFI_Turret_C': [
      { name: 'NSVT HMG',              class: 'BP_T72S_Kord_Cupola_Weapon',         mags: 2,  magSize: 150,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-90A — Desert variant (Russian, upgraded T-72B3 lineage)
// Uses 2A46M gun (distinct from T-72B3's 2A46). Same 3BM60/3BK29M/3OF82 ammo family.
// T-90A-specific Refleks class (BP_9M119MRefleks_ATGM_T90A). NSVT cupola uses 1×300 magazines (not 2×150 like T-72B3).
VEHICLE_LOADOUTS['BP_T90A_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T90A_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_T90A_Kord_Cupola_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T90A_Turret_Desert_C': [
      { name: '3BM60 125mm APFSDS',    class: 'BP_2A46M_AP',                        mags: 20, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK29M 125mm HEAT',     class: 'BP_2A46M_HEAT',                      mags: 10, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF82 125mm Frag',      class: 'BP_2A46M_Frag',                      mags: 9,  magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',   class: 'BP_9M119MRefleks_ATGM_T90A',         mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A46M_coax',                      mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T90A',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_T90A_Kord_Cupola_Turret_Desert_C': [
      { name: 'NSVT HMG',              class: 'BP_T90A_Kord_Cupola_Weapon_Desert',  mags: 1,  magSize: 300,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// T-90A — standard variant
// Same loadout as Desert; turret + NSVT weapon class drop "_Desert".
VEHICLE_LOADOUTS['BP_T90A_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_T90A_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_T90A_Kord_Cupola_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_T90A_Turret_C': [
      { name: '3BM60 125mm APFSDS',    class: 'BP_2A46M_AP',                        mags: 20, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK29M 125mm HEAT',     class: 'BP_2A46M_HEAT',                      mags: 10, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF82 125mm Frag',      class: 'BP_2A46M_Frag',                      mags: 9,  magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',   class: 'BP_9M119MRefleks_ATGM_T90A',         mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',        class: 'BP_2A46M_coax',                      mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_Smoke_Launcher_T90A',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_T90A_Kord_Cupola_Turret_C': [
      { name: 'NSVT HMG',              class: 'BP_T90A_Kord_Cupola_Weapon',         mags: 1,  magSize: 300,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// ZTZ-99A — wCage variant (Chinese PLA MBT)
// Chinese 125mm ZPT-98 gun. DT-series ammo (DTC10/DTP10/DTB12). APS201-125 gun-launched ATGM (4×1, more than Russian 2×1).
// QTJ-02 5.8mm coax (unique Chinese small-arms caliber). QJC-88 RWS commander with 1×450 magazine.
// NOTE: vehicle class has "wCage" prefix but turret class uses "Cage" suffix — asymmetric naming.
VEHICLE_LOADOUTS['BP_ZTZ99_wCage_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZTZ99_Turret_Cage_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_QJZ89_RWS_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZTZ99_Turret_Cage_C': [
      { name: 'DTC10-125 125mm APFSDS', class: 'BP_ZPT-98_AP',                      mags: 15, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: 'DTP10-125 125mm HEAT',   class: 'BP_ZPT-98_HEAT',                    mags: 12, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: 'DTB12-125 125mm HE',     class: 'BP_ZPT-98_HE',                      mags: 12, magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: 'APS201-125 ATGM',        class: 'BP_APS201-125_ATGM',                mags: 4,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'QTJ-02 Coaxial MG',      class: 'BP_ZPT-98_coax',                    mags: 1,  magSize: 3000, type: 'mg',      caliber: '5.8mm' },
      { name: '40mm Smoke Launchers',   class: 'BP_Smoke_Launcher_ZTZ99',           mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_QJZ89_RWS_Turret_C': [
      { name: 'QJC-88 RWS',             class: 'BP_QJZ89_RWS',                      mags: 1,  magSize: 450,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// ZTZ-99A — Desert wCage variant
// Desert-only class changes: gunner turret, RWS turret, and RWS weapon all get "_Desert" suffix. Main gun ammo classes unchanged.
VEHICLE_LOADOUTS['BP_ZTZ99_Desert_wCage_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZTZ99_Turret_Cage_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_QJZ89_RWS_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',       class: 'SmokeGenerator_Tracked',             mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZTZ99_Turret_Cage_Desert_C': [
      { name: 'DTC10-125 125mm APFSDS', class: 'BP_ZPT-98_AP',                      mags: 15, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: 'DTP10-125 125mm HEAT',   class: 'BP_ZPT-98_HEAT',                    mags: 12, magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: 'DTB12-125 125mm HE',     class: 'BP_ZPT-98_HE',                      mags: 12, magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: 'APS201-125 ATGM',        class: 'BP_APS201-125_ATGM',                mags: 4,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'QTJ-02 Coaxial MG',      class: 'BP_ZPT-98_coax',                    mags: 1,  magSize: 3000, type: 'mg',      caliber: '5.8mm' },
      { name: '40mm Smoke Launchers',   class: 'BP_Smoke_Launcher_ZTZ99',           mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_QJZ89_RWS_Turret_Desert_C': [
      { name: 'QJC-88 RWS',             class: 'BP_QJZ89_RWS_Desert',               mags: 1,  magSize: 450,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// ============================================================================
// Attack / CAS helicopters
// ============================================================================

// CH-146 CAS — CAF (Canadian Armed Forces) Close Air Support variant.
// Asymmetric door guns: one GAU-21 .50cal + one M134 minigun. Commander scope
// is observation-only (no weapon). Turret classes shared with UH-1Y Venom.
VEHICLE_LOADOUTS['BP_CH146_CAS_C'] = {
  seats: [
    { index: 0, role: 'Pilot',      turretClass: null },
    { index: 1, role: 'Commander',  turretClass: 'BP_CH146_CmdrScope_C' },
    { index: 2, role: 'Left Door',  turretClass: 'BP_GAU21_UH1Y_Doorgun_Turret_C' },
    { index: 3, role: 'Right Door', turretClass: 'BP_M134_UH1Y_Doorgun_Turret_C' },
  ],
  turrets: {
    'BP_GAU21_UH1Y_Doorgun_Turret_C': [
      { name: 'GAU-21 .50cal',       class: 'BP_GAU21_DoorGun',  mags: 1, magSize: 600,  type: 'mg', caliber: '12.7mm' },
    ],
    'BP_M134_UH1Y_Doorgun_Turret_C': [
      { name: 'GAU-17/A Minigun',    class: 'BP_M134_DoorGun',   mags: 1, magSize: 1500, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// CH-146 CAS Desert — CAF Desert camo variant. Same loadout as BP_CH146_CAS_C
// except commander scope class is BP_CH146_CmdrScope_Desert_C. Doorgun turret
// classes remain shared with UH-1Y (no Desert-specific class).
VEHICLE_LOADOUTS['BP_CH146_Desert_CAS_C'] = {
  seats: [
    { index: 0, role: 'Pilot',      turretClass: null },
    { index: 1, role: 'Commander',  turretClass: 'BP_CH146_CmdrScope_Desert_C' },
    { index: 2, role: 'Left Door',  turretClass: 'BP_GAU21_UH1Y_Doorgun_Turret_C' },
    { index: 3, role: 'Right Door', turretClass: 'BP_M134_UH1Y_Doorgun_Turret_C' },
  ],
  turrets: {
    'BP_GAU21_UH1Y_Doorgun_Turret_C': [
      { name: 'GAU-21 .50cal',       class: 'BP_GAU21_DoorGun',  mags: 1, magSize: 600,  type: 'mg', caliber: '12.7mm' },
    ],
    'BP_M134_UH1Y_Doorgun_Turret_C': [
      { name: 'GAU-17/A Minigun',    class: 'BP_M134_DoorGun',   mags: 1, magSize: 1500, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Loach CAS — WPMC (Western PMC) light attack helicopter (AH-6 Little Bird class).
// Both weapons are pilot-fired (Attached To: Driver) — M151 HEDP rocket pod and
// GAU-17/A minigun, mounted on the airframe and aimed via the pilot. No separate
// door gunner seats: pilot does all the shooting, seat 2 is an unarmed passenger.
VEHICLE_LOADOUTS['BP_Loach_CAS_C'] = {
  seats: [
    { index: 0, role: 'Pilot',     turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'M151 HEDP',        class: 'BP_Hydra_Loach_Small_Single', mags: 1, magSize: 7,   type: 'heat', caliber: '70mm' },
      { name: 'GAU-17/A Minigun', class: 'BP_M134_Loach_Single',        mags: 1, magSize: 200, type: 'mg',   caliber: '7.62mm' },
    ],
  },
};

// Loach CAS Large — WPMC heavy-loadout variant of the Loach. Same pilot-fired
// config as Loach CAS; the only differences are the gun classes (Dual-pod
// variants) and the much bigger rocket magazine (38 vs 7).
VEHICLE_LOADOUTS['BP_Loach_CAS_Large_C'] = {
  seats: [
    { index: 0, role: 'Pilot',     turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'M151 HEDP',        class: 'BP_Hydra_Loach_Large_Dual', mags: 1, magSize: 38,  type: 'heat', caliber: '70mm' },
      { name: 'GAU-17/A Minigun', class: 'BP_M134_Loach_Dual',        mags: 1, magSize: 200, type: 'mg',   caliber: '7.62mm' },
    ],
  },
};

// Loach CAS Small — WPMC asymmetric light-loadout variant. Left rocket pod is
// swapped for a smoke (M156) launcher, right pod keeps HEDP rockets, and the
// minigun uses the Dual-class variant (same magSize as the single). Pilot-fired.
VEHICLE_LOADOUTS['BP_Loach_CAS_Small_C'] = {
  seats: [
    { index: 0, role: 'Pilot',     turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'M156 Smoke',       class: 'BP_Hydra_Loach_Small_Smoke_Single_Left', mags: 1, magSize: 7,   type: 'smoke', caliber: '70mm' },
      { name: 'M151 HEDP',        class: 'BP_Hydra_Loach_Small_Single_Right',      mags: 1, magSize: 7,   type: 'heat',  caliber: '70mm' },
      { name: 'GAU-17/A Minigun', class: 'BP_M134_Loach_Dual',                     mags: 1, magSize: 200, type: 'mg',    caliber: '7.62mm' },
    ],
  },
};

// ============================================================================
// Transport Helicopters
// ============================================================================

// CH-146 Griffon (CAF) — dual C6A1 door guns + commander observation scope. 2 crew + 2 door gunners + 9 passengers.
VEHICLE_LOADOUTS['BP_CH146_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Commander',  turretClass: 'BP_CH146_CmdrScope_C' },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_C6A1_Doorgun_Turret_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_C6A1_Doorgun_Turret1_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_CH146_CmdrScope_C': [],
    'BP_C6A1_Doorgun_Turret_C': [
      { name: 'C6A1', class: 'BP_C6A1_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_C6A1_Doorgun_Turret1_C': [
      { name: 'C6A1', class: 'BP_C6A1_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// CH-146 Griffon Desert (CAF) — desert camo. Commander scope class differs; 4 + 7 seats (not 9).
VEHICLE_LOADOUTS['BP_CH146_Desert_C'] = {
  seats: [
    { index: 0, role: 'Pilot',      turretClass: null },
    { index: 1, role: 'Commander',  turretClass: 'BP_CH146_CmdrScope_Desert_C' },
    { index: 2, role: 'Left Door',  turretClass: 'BP_C6A1_Doorgun_Turret_C' },
    { index: 3, role: 'Right Door', turretClass: 'BP_C6A1_Doorgun_Turret1_C' },
    { index: 4, role: 'Passenger',  turretClass: null },
    { index: 5, role: 'Passenger',  turretClass: null },
    { index: 6, role: 'Passenger',  turretClass: null },
    { index: 7, role: 'Passenger',  turretClass: null },
    { index: 8, role: 'Passenger',  turretClass: null },
    { index: 9, role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CH146_CmdrScope_Desert_C': [],
    'BP_C6A1_Doorgun_Turret_C': [
      { name: 'C6A1', class: 'BP_C6A1_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_C6A1_Doorgun_Turret1_C': [
      { name: 'C6A1', class: 'BP_C6A1_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// CH-178 Chinook (CAF) — dual C6A1 door guns. No commander scope. 1 pilot + 1 passenger + 2 door gunners + 9 passengers.
VEHICLE_LOADOUTS['BP_CH178_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_CH178_Doorgun_Turret_L_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_CH178_Doorgun_Turret_R_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_CH178_Doorgun_Turret_L_C': [
      { name: 'C6A1', class: 'BP_C6A1_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_CH178_Doorgun_Turret_R_C': [
      { name: 'C6A1', class: 'BP_C6A1_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Mi-8MTV-5 VDV — dual PKP door guns. No commander scope. 1 pilot + 1 passenger + 2 door gunners + 9 passengers.
// (Wiki lists a C6A1 on BP_CH178_Doorgun_Turret_L_C — artifact, not in seat layout; Weapons (2) = 2 PKPs.)
VEHICLE_LOADOUTS['BP_MI8_VDV_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_PKP_Doorgun_Turret_L_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_PKP_Doorgun_Turret_R_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_PKP_Doorgun_Turret_L_C': [
      { name: 'PKP', class: 'BP_PKP_DoorGun', mags: 8, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_PKP_Doorgun_Turret_R_C': [
      { name: 'PKP', class: 'BP_PKP_DoorGun', mags: 8, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Mi-8MTV-5 AFU — identical layout to VDV variant.
VEHICLE_LOADOUTS['BP_MI8_AFU_C'] = VEHICLE_LOADOUTS['BP_MI8_VDV_C'];

// Mi-8MTV-5 (USA/RGF) — identical layout to VDV variant.
VEHICLE_LOADOUTS['BP_MI8_C'] = VEHICLE_LOADOUTS['BP_MI8_VDV_C'];

// MRH-90 (ADF) — dual M240H/Mag58 door guns. 1 pilot + 1 passenger + 2 door gunners + 12 passengers.
// (Wiki lists C6A1 on BP_CH178_Doorgun_Turret_L_C and PKP on BP_PKP_Doorgun_Turret_L_C — artifacts; Weapons (2) = 2 Mag58.)
VEHICLE_LOADOUTS['BP_MRH90_Mag58_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_Mag58_Doorgun_Turret_MRH90_L_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_Mag58_Doorgun_Turret_MRH90_R_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
    { index: 13, role: 'Passenger',  turretClass: null },
    { index: 14, role: 'Passenger',  turretClass: null },
    { index: 15, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_Mag58_Doorgun_Turret_MRH90_L_C': [
      { name: 'M240H', class: 'BP_Mag58_DoorGun_MRH90', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_Mag58_Doorgun_Turret_MRH90_R_C': [
      { name: 'M240H', class: 'BP_Mag58_DoorGun_MRH90', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Raven Transport (WPMC) — dual M240H door guns. 1 pilot + 1 passenger + 2 door gunners + 9 passengers.
// (Wiki lists C6A1/PKP/Mag58 on non-seat turrets — all artifacts; Weapons (2) = 2 M240H WPMC.)
VEHICLE_LOADOUTS['BP_CH146_Raven_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_M240H_WPMC_Doorgun_Turret_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_M240H_WPMC_Doorgun_Turret_Reverse_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_M240H_WPMC_Doorgun_Turret_C': [
      { name: 'M240H', class: 'BP_M240H_WPMC_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_M240H_WPMC_Doorgun_Turret_Reverse_C': [
      { name: 'M240H', class: 'BP_M240H_WPMC_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// SA330 Puma (BAF) — dual M240H door guns. 1 pilot + 1 passenger + 2 door gunners + 8 passengers.
// (Wiki lists C6A1/PKP/Mag58/M240H-WPMC on non-seat turrets — all artifacts; Weapons (2) = 2 M240H SA330.)
VEHICLE_LOADOUTS['BP_SA330_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_M240H_Doorgun_Turret_SA330_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_M240H_Doorgun_Turret_SA33_Reverse_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_M240H_Doorgun_Turret_SA330_C': [
      { name: 'M240H', class: 'BP_M240H_DoorGun_SA330', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_M240H_Doorgun_Turret_SA33_Reverse_C': [
      { name: 'M240H', class: 'BP_M240H_DoorGun_SA330', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// UH-1H GFI — dual MG3 door guns. 1 pilot + 1 passenger + 2 door gunners + 9 passengers.
// (Wiki lists C6A1/PKP/Mag58/M240H-WPMC/M240H-SA330 on non-seat turrets — all artifacts; Weapons (2) = 2 MG3.)
VEHICLE_LOADOUTS['BP_UH1H_GFI_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_MG3_UH1H_Doorgun_Turret_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_MG3_UH1H_Doorgun_Turret1_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_MG3_UH1H_Doorgun_Turret_C': [
      { name: 'MG3', class: 'BP_MG3_UH1H_DoorGun', mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_MG3_UH1H_Doorgun_Turret1_C': [
      { name: 'MG3', class: 'BP_MG3_UH1H_DoorGun', mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// UH-1Y Venom (USMC) — dual M240H door guns + commander scope. 4 + 9 seats.
// Both door seats share the same turret class BP_M240H_UH1Y_Doorgun_Turret_C.
// (All other wiki weapon entries are artifacts; Weapons (2) = 2 M240H UH1Y.)
VEHICLE_LOADOUTS['BP_UH1Y_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Commander',  turretClass: 'BP_UH1Y_CmdrScope_C' },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_M240H_UH1Y_Doorgun_Turret_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_M240H_UH1Y_Doorgun_Turret_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_UH1Y_CmdrScope_C': [],
    'BP_M240H_UH1Y_Doorgun_Turret_C': [
      { name: 'M240H', class: 'BP_M240H_UH1Y_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// UH-60M Black Hawk (USA) — dual M240H door guns. 1 pilot + 1 passenger + 2 door gunners + 9 passengers.
// Both door seats share the same turret class BP_M240H_Doorgun_Turret_C.
// (All other wiki weapon entries are artifacts; Weapons (2) = 2 M240H.)
VEHICLE_LOADOUTS['BP_UH60_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_M240H_Doorgun_Turret_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_M240H_Doorgun_Turret_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_M240H_Doorgun_Turret_C': [
      { name: 'M240H', class: 'BP_M240H_DoorGun', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// UH-60M (ADF) — dual M240H door guns. 1 pilot + 1 passenger + 2 door gunners + 9 passengers. Distinct L/R turret classes.
// (All other wiki weapon entries are artifacts; Weapons (2) = 2 M240H ADF.)
VEHICLE_LOADOUTS['BP_UH60_AUS_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_M240H_Doorgun_Turret_ADF_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_M240H_Doorgun_Turret_ADF_Reverse_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_M240H_Doorgun_Turret_ADF_C': [
      { name: 'M240H', class: 'BP_Mag58_DoorGun_MRH90', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_M240H_Doorgun_Turret_ADF_Reverse_C': [
      { name: 'M240H', class: 'BP_Mag58_DoorGun_MRH90', mags: 5, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// UH-60 TLF PKM (TLF) — dual PKM door guns. 1 pilot + 1 passenger + 2 door gunners + 9 passengers.
// Both door seats share the same turret class BP_PKM_Doorgun_Turret_TLF_C.
// (All other wiki weapon entries are artifacts; Weapons (2) = 2 PKM.)
VEHICLE_LOADOUTS['BP_UH60_TLF_PKM_C'] = {
  seats: [
    { index: 0,  role: 'Pilot',      turretClass: null },
    { index: 1,  role: 'Passenger',  turretClass: null },
    { index: 2,  role: 'Left Door',  turretClass: 'BP_PKM_Doorgun_Turret_TLF_C' },
    { index: 3,  role: 'Right Door', turretClass: 'BP_PKM_Doorgun_Turret_TLF_C' },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_PKM_Doorgun_Turret_TLF_C': [
      { name: 'PKM', class: 'BP_PKM_DoorGun', mags: 8, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Z-8G (PLA/PLAAGF) — unarmed heavy transport. 1 pilot + 26 passengers. No turrets.
VEHICLE_LOADOUTS['BP_Z8G_C'] = {
  seats: [
    { index: 0, role: 'Pilot', turretClass: null },
    ...Array.from({ length: 26 }, (_, i) => ({ index: i + 1, role: 'Passenger', turretClass: null })),
  ],
  turrets: {},
};

// Z-8J (PLANMC) — unarmed heavy transport with commander scope. 2 crew + 23 passengers.
VEHICLE_LOADOUTS['BP_Z8J_C'] = {
  seats: [
    { index: 0, role: 'Pilot',     turretClass: null },
    { index: 1, role: 'Commander', turretClass: 'BP_Z8J_CmdrScope_C' },
    ...Array.from({ length: 23 }, (_, i) => ({ index: i + 2, role: 'Passenger', turretClass: null })),
  ],
  turrets: {
    'BP_Z8J_CmdrScope_C': [],
  },
};

// Z-9A (PLA/PLAAGF) — unarmed light transport with commander scope. 2 crew + 8 passengers.
VEHICLE_LOADOUTS['BP_Z9A_C'] = {
  seats: [
    { index: 0, role: 'Pilot',     turretClass: null },
    { index: 1, role: 'Commander', turretClass: 'BP_Z9A_CmdrScope_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Z9A_CmdrScope_C': [],
  },
};

// ============================================================================
// MGS (Mobile Gun System) vehicles
// ============================================================================

// M1128 Stryker MGS — USA. 105mm M68A2 rifled gun on a Stryker chassis.
// Four crew: driver, main gunner (105mm + coax + WP + smoke launcher),
// commander (periscope, weapon-less observation seat), and a rear M2 .50cal
// remote operator. Driver has the standard wheeled smoke generator.
VEHICLE_LOADOUTS['BP_M1128_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1128_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M1128_Commander_Periscope_C' },
    { index: 3, role: 'M2 Gunner', turretClass: 'BP_M1128_M2_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',   mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M1128_Turret_C': [
      { name: 'M900 105mm APFSDS',        class: 'BP_M68A2_AP',              mags: 6,  magSize: 1,    type: 'kinetic', caliber: '105mm' },
      { name: 'M456A2 105mm HEAT',        class: 'BP_M68A2_HEAT',            mags: 10, magSize: 1,    type: 'heat',    caliber: '105mm' },
      { name: 'M416 105mm WP',            class: 'BP_M68A2_Smoke',           mags: 2,  magSize: 1,    type: 'he',      caliber: '105mm' },
      { name: 'M240 Coaxial MG',          class: 'BP_M68A2_coax',            mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_M1128',  mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M1128_M2_Turret_C': [
      { name: 'M2A1 Browning',            class: 'BP_50Cal_M1128',           mags: 10, magSize: 100,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// M1128 MGS Woodland — USA woodland camo variant. Turret, commander periscope,
// and M2 remote turret classes all carry `_Woodland` suffix, and the M2 gun
// class is Woodland-specific (BP_50Cal_M1128_Woodland). Main 105mm ammo
// classes, coax, and the 40mm smoke launcher reuse the base variant's classes.
VEHICLE_LOADOUTS['BP_M1128_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1128_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_M1128_Commander_Periscope_Woodland_C' },
    { index: 3, role: 'M2 Gunner', turretClass: 'BP_M1128_M2_Turret_Woodland_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_M1128_Turret_Woodland_C': [
      { name: 'M900 105mm APFSDS',        class: 'BP_M68A2_AP',                  mags: 6,  magSize: 1,    type: 'kinetic', caliber: '105mm' },
      { name: 'M456A2 105mm HEAT',        class: 'BP_M68A2_HEAT',                mags: 10, magSize: 1,    type: 'heat',    caliber: '105mm' },
      { name: 'M416 105mm WP',            class: 'BP_M68A2_Smoke',               mags: 2,  magSize: 1,    type: 'he',      caliber: '105mm' },
      { name: 'M240 Coaxial MG',          class: 'BP_M68A2_coax',                mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_M1128',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_M1128_M2_Turret_Woodland_C': [
      { name: 'M2A1 Browning',            class: 'BP_50Cal_M1128_Woodland',      mags: 10, magSize: 100,  type: 'mg',      caliber: '12.7mm' },
    ],
  },
};

// Sprut-SDM1 (VDV) — airborne tank destroyer. 125mm 2A45 cannon on main turret
// with APFSDS/HEAT/Fragmentation/ATGM rounds + coax + 40mm smoke launchers.
// Commander operates a PKT RWS with independent turret class.
VEHICLE_LOADOUTS['BP_Sprut_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Sprut_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Sprut_RWS_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Tracked',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_Sprut_Turret_Desert_C': [
      { name: '3BM60 125mm APFSDS',       class: 'BP_2A45_AP',                   mags: 14, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK29M 125mm HEAT',        class: 'BP_2A45_HEAT',                 mags: 6,  magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF82 125mm Fragmentation',class: 'BP_2A45_Frag',                 mags: 14, magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',      class: 'BP_9M119MRefleks_ATGM_Sprut',  mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',           class: 'BP_2A45_coax',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_Sprut',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Sprut_RWS_Turret_Desert_C': [
      { name: 'PKT Remote Weapon Station',class: 'BP_Sprut_RWS_PKT',             mags: 1,  magSize: 1500, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// Sprut-SDM1 (VDV) — base variant (no camo suffix on turret classes). Weapon
// classes (ammo, coax, ATGM, smoke launcher, RWS PKT) are shared with the
// Desert variant.
VEHICLE_LOADOUTS['BP_Sprut_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Sprut_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_Sprut_RWS_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Tracked',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_Sprut_Turret_C': [
      { name: '3BM60 125mm APFSDS',       class: 'BP_2A45_AP',                   mags: 14, magSize: 1,    type: 'kinetic', caliber: '125mm' },
      { name: '3BK29M 125mm HEAT',        class: 'BP_2A45_HEAT',                 mags: 6,  magSize: 1,    type: 'heat',    caliber: '125mm' },
      { name: '3OF82 125mm Fragmentation',class: 'BP_2A45_Frag',                 mags: 14, magSize: 1,    type: 'he',      caliber: '125mm' },
      { name: '9M119M Refleks ATGM',      class: 'BP_9M119MRefleks_ATGM_Sprut',  mags: 2,  magSize: 1,    type: 'atgm',    caliber: '125mm' },
      { name: 'PKT Coaxial MG',           class: 'BP_2A45_coax',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_Sprut',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_Sprut_RWS_Turret_C': [
      { name: 'PKT Remote Weapon Station',class: 'BP_Sprut_RWS_PKT',             mags: 1,  magSize: 1500, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// ZTD05 (PLAAGF / PLA) — amphibious assault gun, woodland variant. 105mm
// ZPL-98A cannon on main turret with APFSDS/HEAT/Fragmentation rounds, PKT
// coax, and 40mm smoke launchers. Commander periscope seat is a sub-entity
// (maxHealth = 0), filtered by isVehicleSubEntity.
VEHICLE_LOADOUTS['BP_ZTD05_WoodLand_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZTD05_Turret_WoodLand_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZTD05_Commander_Periscope_WoodLand_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Tracked',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZTD05_Turret_WoodLand_C': [
      { name: 'DTC-02 105mm APFSDS',      class: 'BP_ZTD05_ZPL-98A_AP',          mags: 12, magSize: 1,    type: 'kinetic', caliber: '105mm' },
      { name: 'DTP-04 105mm HEAT',        class: 'BP_ZTD05_ZPL-98A_HEAT',        mags: 8,  magSize: 1,    type: 'heat',    caliber: '105mm' },
      { name: 'DTB-02 105mm Fragmentation',class:'BP_ZTD05_ZPL-98A_Frag',         mags: 20, magSize: 1,    type: 'he',      caliber: '105mm' },
      { name: 'PKT Coaxial MG',           class: 'BP_2A20_coax',                 mags: 1,  magSize: 2500, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZTD05_Smoke_WoodLand',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZTD05 (PLANMC) — amphibious assault gun, naval/base variant. Shares the
// 105mm ZPL-98A ammo classes with the WoodLand variant, but uses distinct
// coax (BP_ZTD05_coax, QTJ-02) and smoke launcher (BP_ZTD05_Smoke) classes.
VEHICLE_LOADOUTS['BP_ZTD05_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZTD05_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZTD05_Commander_Periscope_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Tracked',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZTD05_Turret_C': [
      { name: 'DTC-02 105mm APFSDS',      class: 'BP_ZTD05_ZPL-98A_AP',          mags: 12, magSize: 1,    type: 'kinetic', caliber: '105mm' },
      { name: 'DTP-04 105mm HEAT',        class: 'BP_ZTD05_ZPL-98A_HEAT',        mags: 8,  magSize: 1,    type: 'heat',    caliber: '105mm' },
      { name: 'DTB-02 105mm Fragmentation',class:'BP_ZTD05_ZPL-98A_Frag',         mags: 20, magSize: 1,    type: 'he',      caliber: '105mm' },
      { name: 'QTJ-02 Coaxial MG',        class: 'BP_ZTD05_coax',                mags: 1,  magSize: 2500, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZTD05_Smoke',               mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ASLAV (ADF) — wheeled IFV with 25mm M242 Bushmaster (APFSDS + HEI), Mag58
// coaxial, and 40mm smoke launchers. Commander seat is a sub-entity
// (maxHealth = 0). Carries 7 passengers in addition to the 3 crew.
VEHICLE_LOADOUTS['BP_ASLAV_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ASLAV_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ASLAV_Commander_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ASLAV_Turret_C': [
      { name: 'M919 25mm APFSDS',         class: 'ASLAV_M252_AP',                mags: 1,  magSize: 70,   type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',           class: 'ASLAV_M252_HE',                mags: 1,  magSize: 230,  type: 'he',      caliber: '25mm' },
      { name: 'Mag58 Coaxial MG',         class: 'ASLAV_762',                    mags: 2,  magSize: 800,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ASLAV_SmokeLauncher',       mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// BTR-4 (AFU) — wheeled IFV with 30mm ZTM-1 autocannon (APDS + HE-T),
// GPD-30 40mm under-barrel grenade launcher, RK-2M-K Skif ATGM, KT-7.62
// coaxial, and 40mm smoke launchers. Commander scope seat is a sub-entity
// (maxHealth = 0). Carries 7 passengers in addition to the 3 crew.
VEHICLE_LOADOUTS['BP_BTR4_AFU_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR4_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BTR4_CmdrScope_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',       mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_BTR4_Turret_C': [
      { name: '3UBR8 30mm APDS',          class: 'BP_BTR4_ZTM1_AP',              mags: 1,  magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '3UOR6 30mm HE-T',          class: 'BP_BTR4_ZTM1_HE',              mags: 1,  magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'GPD-30 40mm Fragmentation',class: 'BP_BTR4_KBA117',               mags: 4,  magSize: 29,   type: 'he',      caliber: '40mm' },
      { name: 'RK-2M-K Skif ATGM',        class: 'BP_BTR4_StugnaP',              mags: 2,  magSize: 2,    type: 'atgm' },
      { name: 'KT-7.62 Coaxial MG',       class: 'BP_BTR4_KT762',                mags: 6,  magSize: 350,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_BTR4_Smoke_Launcher',       mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// Coyote (CAF) — wheeled recon/IFV with 25mm M242 Bushmaster (APFSDS + HEI),
// C6 coax, and 40mm smoke launchers on the main turret, plus a C6A1 FLEX
// remote weapon station on a separate commander turret. Both commander
// seats (periscope + FLEX) are sub-entities (maxHealth = 0).
// Desert variant: turret/smoke/ammo classes carry `_Desert` suffix.
VEHICLE_LOADOUTS['BP_LAV2_Coyote_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_LAV2_Coyote_Turret_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_Coyote_Commander_C' },
    { index: 3, role: 'FLEX Gunner',  turretClass: 'BP_LAV6_Commander_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_LAV2_Coyote_Turret_C': [
      { name: 'M919 25mm APFSDS',         class: 'Coyote_M252_AP_Desert',               mags: 1,  magSize: 75,   type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',           class: 'Coyote_M252_HE_Desert',               mags: 1,  magSize: 135,  type: 'he',      caliber: '25mm' },
      { name: 'C6 Coaxial MG',            class: 'BP_Coyote_762_Desert',                mags: 2,  magSize: 440,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_Coyote_Desert',        mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_LAV6_Commander_Turret_Desert_C': [
      { name: 'C6A1 FLEX',                class: 'BP_C6_Commander_Turret_Weapon_Desert',mags: 10, magSize: 220,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// Coyote (CAF) — Woodland variant. Same structure as the Desert variant
// but turret/smoke/ammo classes carry `_Woodland` suffix, and the FLEX
// turret class has no camo suffix (`BP_LAV6_Commander_Turret_C`).
VEHICLE_LOADOUTS['BP_LAV2_Coyote_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_LAV2_Coyote_Turret_Woodland_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_Coyote_Commander_C' },
    { index: 3, role: 'FLEX Gunner',  turretClass: 'BP_LAV6_Commander_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_LAV2_Coyote_Turret_Woodland_C': [
      { name: 'M919 25mm APFSDS',         class: 'Coyote_M252_AP_Woodland',             mags: 1,  magSize: 75,   type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',           class: 'Coyote_M252_HE_Woodland',             mags: 1,  magSize: 135,  type: 'he',      caliber: '25mm' },
      { name: 'C6 Coaxial MG',            class: 'BP_Coyote_762_Woodland',              mags: 2,  magSize: 440,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_Coyote_Woodland',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_LAV6_Commander_Turret_C': [
      { name: 'C6A1 FLEX',                class: 'BP_C6_Commander_Turret_Weapon',       mags: 10, magSize: 220,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// Coyote (CRF) — Canadian Reserve Force variant. Uses Woodland-suffixed
// weapon classes (ammo/coax/smoke) but turret class carries `_CRF` suffix
// (`BP_LAV2_Coyote_Turret_Woodland_CRF_C`). FLEX turret and periscope
// class are shared with the Woodland variant.
VEHICLE_LOADOUTS['BP_LAV2_Coyote_CRF_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_LAV2_Coyote_Turret_Woodland_CRF_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_Coyote_Commander_C' },
    { index: 3, role: 'FLEX Gunner',  turretClass: 'BP_LAV6_Commander_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_LAV2_Coyote_Turret_Woodland_CRF_C': [
      { name: 'M919 25mm APFSDS',         class: 'Coyote_M252_AP_Woodland',             mags: 1,  magSize: 75,   type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',           class: 'Coyote_M252_HE_Woodland',             mags: 1,  magSize: 135,  type: 'he',      caliber: '25mm' },
      { name: 'C6 Coaxial MG',            class: 'BP_Coyote_762_Woodland',              mags: 2,  magSize: 440,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_Coyote_Woodland',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_LAV6_Commander_Turret_C': [
      { name: 'C6A1 FLEX',                class: 'BP_C6_Commander_Turret_Weapon',       mags: 10, magSize: 220,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// LAV 6 (CAF) — wheeled IFV, desert variant. Same 25mm M242 armament as the
// Coyote but with LAV-specific ammo classes (LAV_M252_AP_Desert, etc.) and
// larger HEI mag (200 vs 135). FLEX turret is shared with the Coyote Desert
// variant. Commander periscope seat is a sub-entity (maxHealth = 0).
// Carries 9 passengers in addition to the 4 crew.
VEHICLE_LOADOUTS['BP_LAV6_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_LAV6_Turret_Desert_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_LAV_Commander_Periscope_C' },
    { index: 3, role: 'FLEX Gunner',  turretClass: 'BP_LAV6_Commander_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_LAV6_Turret_Desert_C': [
      { name: 'M919 25mm APFSDS',         class: 'LAV_M252_AP_Desert',                  mags: 1,  magSize: 75,   type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',           class: 'LAV_M252_HE_Desert',                  mags: 1,  magSize: 200,  type: 'he',      caliber: '25mm' },
      { name: 'C6 Coaxial MG',            class: 'BP_LAV_762_Desert',                   mags: 2,  magSize: 440,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_LAV_Desert',           mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_LAV6_Commander_Turret_Desert_C': [
      { name: 'C6A1 FLEX',                class: 'BP_C6_Commander_Turret_Weapon_Desert',mags: 10, magSize: 220,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// LAV 6 (CAF) — Woodland variant. Same armament as the Desert variant but
// all weapon/turret classes are camo-suffix-less (BP_LAV6_Turret_Woodland_C
// for the main turret; ammo/coax/smoke classes have no suffix at all).
// FLEX turret class `BP_LAV6_Commander_Turret_C` is shared with the Coyote
// Woodland variant. Commander periscope class `BP_LAV_Commander_Periscope_C`
// is shared with the Desert variant.
VEHICLE_LOADOUTS['BP_LAV6_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_LAV6_Turret_Woodland_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_LAV_Commander_Periscope_C' },
    { index: 3, role: 'FLEX Gunner',  turretClass: 'BP_LAV6_Commander_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_LAV6_Turret_Woodland_C': [
      { name: 'M919 25mm APFSDS',         class: 'LAV_M252_AP',                         mags: 1,  magSize: 75,   type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',           class: 'LAV_M252_HE',                         mags: 1,  magSize: 200,  type: 'he',      caliber: '25mm' },
      { name: 'C6 Coaxial MG',            class: 'BP_LAV_762',                          mags: 2,  magSize: 440,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_LAV',                  mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_LAV6_Commander_Turret_C': [
      { name: 'C6A1 FLEX',                class: 'BP_C6_Commander_Turret_Weapon',       mags: 10, magSize: 220,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// PARS III 25mm (TLF) — Turkish wheeled IFV with 25mm M242 Bushmaster
// (APFSDS + HEI), M240C coax, and dual 40mm smoke launcher banks (one on
// driver, one on turret). No commander seat — just Driver and Gunner.
// Carries 12 passengers in addition to the 2 crew.
VEHICLE_LOADOUTS['BP_PARS3_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_IFV25_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_PARS3_Driver',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_IFV25_Turret_C': [
      { name: 'M791 25mm APFSDS',         class: 'IFV25_M252_AP',                       mags: 1,  magSize: 70,   type: 'kinetic', caliber: '25mm' },
      { name: 'M792 25mm HEI',            class: 'IFV25_M252_HE',                       mags: 1,  magSize: 230,  type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',         class: 'BP_IFV25_762',                        mags: 2,  magSize: 800,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_Turret_IFV25',         mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// PARS III 25mm (TLF) — Desert variant. Same structure as the base variant
// but turret + weapon classes carry `_Desert` suffix. Driver smoke bank
// class `BP_Smoke_Launcher_PARS3_Driver` is shared with the base variant.
VEHICLE_LOADOUTS['BP_PARS3_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_IFV25_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
      { name: '40mm Smoke Launchers',     class: 'BP_Smoke_Launcher_PARS3_Driver',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_IFV25_Turret_Desert_C': [
      { name: 'M791 25mm APFSDS',         class: 'IFV25_M252_AP_Desert',                mags: 1,  magSize: 70,   type: 'kinetic', caliber: '25mm' },
      { name: 'M792 25mm HEI',            class: 'IFV25_M252_HE_Desert',                mags: 1,  magSize: 230,  type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',         class: 'BP_IFV25_762_Desert',                 mags: 2,  magSize: 800,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'Smoke_Launcher_Turret_IFV25_Desert',  mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZBL08 HJ73C (PLAAGF / PLANMC) — Chinese wheeled IFV with 30mm ZPT-99
// autocannon (APFSDS + HE-Frag), QTJ-02 coaxial, HJ-73C Red Arrow ATGM, and
// 40mm smoke launchers. Naval camo variant. Commander periscope seat has a
// real health pool (150 HP) rather than being a sub-entity. Carries 7
// passengers in addition to the 3 crew.
VEHICLE_LOADOUTS['BP_ZBL08_HJ73C_Naval_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBL08_Turret_HJ73C_Naval_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBL08_Commander_Periscope_Naval_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZBL08_Turret_HJ73C_Naval_C': [
      { name: 'DTC041A-30 30mm APFSDS',   class: 'BP_ZBL08_ZPT-99_APFSDS',              mags: 1,  magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',    class: 'BP_ZBL08_ZPT-99_HEFrag',              mags: 1,  magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'QTJ-02 Coaxial MG',        class: 'BP_ZBL08_QTJ02',                      mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: 'HJ-73C Red Arrow ATGM',    class: 'BP_ZBL08_HJ73C_ATGM',                 mags: 1,  magSize: 2,    type: 'atgm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZBL08_Smoke_Launcher',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZBL08 HJ73C (PLA) — Desert camo variant. Identical armament and seat
// layout to the Naval variant; all turret/weapon classes carry `_Desert`.
VEHICLE_LOADOUTS['BP_ZBL08_HJ73C_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBL08_Turret_HJ73C_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBL08_Commander_Periscope_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZBL08_Turret_HJ73C_Desert_C': [
      { name: 'DTC041A-30 30mm APFSDS',   class: 'BP_ZBL08_ZPT-99_APFSDS_Desert',       mags: 1,  magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',    class: 'BP_ZBL08_ZPT-99_HEFrag_Desert',       mags: 1,  magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'QTJ-02 Coaxial MG',        class: 'BP_ZBL08_QTJ02_Desert',               mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: 'HJ-73C Red Arrow ATGM',    class: 'BP_ZBL08_HJ73C_ATGM_Desert',          mags: 1,  magSize: 2,    type: 'atgm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZBL08_Smoke_Launcher_Desert',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZBL08 HJ73C (PLA) — base variant (no camo suffix). Identical armament to
// the Naval variant; turret/periscope classes have no suffix, weapon
// classes are the same as Naval (no suffix).
VEHICLE_LOADOUTS['BP_ZBL08_HJ73C_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBL08_Turret_HJ73C_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBL08_Commander_Periscope_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZBL08_Turret_HJ73C_C': [
      { name: 'DTC041A-30 30mm APFSDS',   class: 'BP_ZBL08_ZPT-99_APFSDS',              mags: 1,  magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',    class: 'BP_ZBL08_ZPT-99_HEFrag',              mags: 1,  magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'QTJ-02 Coaxial MG',        class: 'BP_ZBL08_QTJ02',                      mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: 'HJ-73C Red Arrow ATGM',    class: 'BP_ZBL08_HJ73C_ATGM',                 mags: 1,  magSize: 2,    type: 'atgm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZBL08_Smoke_Launcher',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZSL92 IFV (PLAAGF / PLA) — Desert variant. BP class uses the industrial
// designation WZ551A. 25mm ZPT-90 autocannon (APDS + HE-Tracer), Type 86
// coaxial, and 40mm smoke launchers on the main turret. 2 crew (no
// commander) + 9 passengers.
VEHICLE_LOADOUTS['BP_WZ551A_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_ZSL92_turret_Interior_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZSL92_turret_Interior_Desert_C': [
      { name: '25mm APDS',                class: 'BP_ZSL92_ZPT90_AP_Desert',            mags: 1,  magSize: 80,   type: 'kinetic', caliber: '25mm' },
      { name: '25mm HE-Tracer',           class: 'BP_ZSL92_ZPT90_HE_Desert',            mags: 1,  magSize: 120,  type: 'he',      caliber: '25mm' },
      { name: 'Type 86 Coaxial MG',       class: 'BP_ZSL92_Type86_Desert',              mags: 4,  magSize: 250,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZSL92_Smoke_Launcher_Desert',      mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZSL92 IFV (PLAAGF / PLA) — base variant (no camo suffix). Same structure
// as the Desert variant; all turret/weapon classes are suffix-less.
VEHICLE_LOADOUTS['BP_WZ551A_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_ZSL92_turret_Interior_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',          class: 'SmokeGenerator_Wheeled',              mags: 1,  magSize: 30,   type: 'smoke' },
    ],
    'BP_ZSL92_turret_Interior_C': [
      { name: '25mm APDS',                class: 'BP_ZSL92_ZPT90_AP',                   mags: 1,  magSize: 80,   type: 'kinetic', caliber: '25mm' },
      { name: '25mm HE-Tracer',           class: 'BP_ZSL92_ZPT90_HE',                   mags: 1,  magSize: 120,  type: 'he',      caliber: '25mm' },
      { name: 'Type 86 Coaxial MG',       class: 'BP_ZSL92_Type86',                     mags: 4,  magSize: 250,  type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',     class: 'BP_ZSL92_Smoke_Launcher',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
  },
};

// ============================================================
// TRACKED IFVs
// ============================================================

// ACV-15 25mm (TLF) — Turkish tracked IFV (FNSS / M113-family chassis) with
// 25mm M242 Bushmaster (APDS + HEI), M240C coax, driver smoke launcher, and
// a second smoke launcher on the turret. Weapon classes use the "ACV_M252_*"
// (gun) and "BP_ACV_*" / "Smoke_Launcher_Turret_ACV" naming seen in the BP.
// 2 crew (Driver, Gunner) + 9 passengers; no commander/RWS seat.
VEHICLE_LOADOUTS['BP_ACV-15_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ACV15_Turret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',            class: 'SmokeGenerator_Tracked',              mags: 1, magSize: 30,  type: 'smoke' },
      { name: '40mm Smoke Launchers',       class: 'BP_Smoke_Launcher_ACV15_Driver_Front',mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_ACV15_Turret_C': [
      { name: 'M791 25mm APDS',             class: 'ACV_M252_AP',                         mags: 1, magSize: 70,  type: 'kinetic', caliber: '25mm' },
      { name: 'M792 25mm HEI',              class: 'ACV_M252_HE',                         mags: 1, magSize: 230, type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',           class: 'BP_ACV_762',                          mags: 2, magSize: 800, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'Smoke_Launcher_Turret_ACV',           mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// ACV-15 25mm Desert (TLF) — desert camo variant. Identical loadout to base
// ACV-15 but with '_Desert' suffixed turret/weapon classes.
VEHICLE_LOADOUTS['BP_ACV-15_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ACV15_Turret_Desert_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',            class: 'SmokeGenerator_Tracked',              mags: 1, magSize: 30,  type: 'smoke' },
      { name: '40mm Smoke Launchers',       class: 'BP_Smoke_Launcher_ACV15_Driver_Front',mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_ACV15_Turret_Desert_C': [
      { name: 'M791 25mm APDS',             class: 'ACV_M252_AP_Desert',                  mags: 1, magSize: 70,  type: 'kinetic', caliber: '25mm' },
      { name: 'M792 25mm HEI',              class: 'ACV_M252_HE_Desert',                  mags: 1, magSize: 230, type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',           class: 'BP_ACV_762_Desert',                   mags: 2, magSize: 800, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'Smoke_Launcher_Turret_ACV_Desert',    mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// BMD-1M (VDV) — Soviet airborne tracked IFV with a 73mm 2A28 "Grom" low-
// velocity smoothbore (HEAT + Frag rounds), coaxial PKT MG, and smoke
// launchers. Distinctive for TWO separate bow-gunner seats with their own
// PKT turrets in addition to the main turret.
// 4 crew (Driver, Gunner, Bow Gunner L, Bow Gunner R) + 4 passengers.
VEHICLE_LOADOUTS['BP_BMD1M_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_BMD1M_Turret_C' },
    { index: 2, role: 'Bow Gunner L', turretClass: 'BP_BMD1M_BowGun_L_Turret_C' },
    { index: 3, role: 'Bow Gunner R', turretClass: 'BP_BMD1M_BowGun_R_Turret_C' },
  ],
  turrets: {
    'BP_BMD1M_Turret_C': [
      { name: '73mm 2A28 HEAT',             class: 'BP_BMD1M_2A28_HEAT',                  mags: 24, magSize: 1,   type: 'heat', caliber: '73mm' },
      { name: '73mm 2A28 Frag',             class: 'BP_BMD1M_2A28_Frag',                  mags: 16, magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMD1M_PKT',                        mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
      { name: '81mm Smoke Launchers',       class: 'BP_BMD1M_Smoke_Launcher',             mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_BMD1M_BowGun_L_Turret_C': [
      { name: 'Bow PKT MG',                 class: 'BP_BMD1M_Bow_PKT',                    mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
    'BP_BMD1M_BowGun_R_Turret_C': [
      { name: 'Bow PKT MG',                 class: 'BP_BMD1M_Bow_PKT',                    mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
  },
};

// BMD-1M Desert (VDV) — desert camo variant. Main turret and bow gun turrets
// use '_Desert' suffixed class names ('BP_BMD1M_Turret_Desert_C',
// 'BP_BMD1M_Bowgun_L_Desert_C', 'BP_BMD1M_Bowgun_R_Desert_C'). Weapon classes
// stay identical to the base BMD-1M (no _Desert suffix on weapons).
VEHICLE_LOADOUTS['BP_BMD1M_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_BMD1M_Turret_Desert_C' },
    { index: 2, role: 'Bow Gunner L', turretClass: 'BP_BMD1M_Bowgun_L_Desert_C' },
    { index: 3, role: 'Bow Gunner R', turretClass: 'BP_BMD1M_Bowgun_R_Desert_C' },
  ],
  turrets: {
    'BP_BMD1M_Turret_Desert_C': [
      { name: '73mm 2A28 HEAT',             class: 'BP_BMD1M_2A28_HEAT',                  mags: 24, magSize: 1,   type: 'heat', caliber: '73mm' },
      { name: '73mm 2A28 Frag',             class: 'BP_BMD1M_2A28_Frag',                  mags: 16, magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMD1M_PKT',                        mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
      { name: '81mm Smoke Launchers',       class: 'BP_BMD1M_Smoke_Launcher',             mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_BMD1M_Bowgun_L_Desert_C': [
      { name: 'Bow PKT MG',                 class: 'BP_BMD1M_Bow_PKT',                    mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
    'BP_BMD1M_Bowgun_R_Desert_C': [
      { name: 'Bow PKT MG',                 class: 'BP_BMD1M_Bow_PKT',                    mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
  },
};

// BMD-4M Desert (VDV) — upgraded airborne IFV with a Bakhcha-U dual-gun
// turret: 100mm 2A70 (HE-Frag rounds + 9M117M1 Bastion laser-guided ATGM via
// gun tube) plus a coaxial 30mm 2A72 autocannon (APDS + HE-Frag). Coaxial
// 7.62mm PKT MG, smoke launchers, and an unmanned commander periscope. One
// surviving bow PKT (left side only; right bow gun was removed in the
// upgrade). Seats layout: 3 crew + 5 passengers per in-game data.
// The bow PKT turret ('BP_BMD1M_Bowgun_L_Desert_C') carries a weapon in the
// BP but is not listed as a dedicated crew seat — registered in turrets only
// so that if a passenger mans it, ammo still resolves correctly.
VEHICLE_LOADOUTS['BP_BMD4M_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMD4M_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMD4M_Commander_Periscope_Desert_C' },
  ],
  turrets: {
    'BP_BMD4M_Turret_Desert_C': [
      { name: '100mm 2A70 HE-Frag',         class: 'BP_BMD4M_2A70_HEFrag',                mags: 22, magSize: 1,    type: 'he',      caliber: '100mm' },
      { name: '9M117M1 Bastion ATGM',       class: 'BP_BMD4M_APS03-100ATGM',              mags: 3,  magSize: 1,    type: 'atgm',    caliber: '100mm' },
      { name: '30mm 2A72 APDS',             class: 'BP_BMD4M_2A72_AP',                    mags: 1,  magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A72 HE-Frag',          class: 'BP_BMD4M_2A72_HE',                    mags: 1,  magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMD4M_2A70_coax',                  mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMD4M_Smoke_Launcher',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    // Commander periscope has no weapons (optics-only station).
    'BP_BMD4M_Commander_Periscope_Desert_C': [],
    // Vestigial left bow PKT inherited from BMD-1M chassis.
    'BP_BMD1M_Bowgun_L_Desert_C': [
      { name: 'Bow PKT MG',                 class: 'BP_BMD1M_Bow_PKT',                    mags: 8,  magSize: 250,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// BMD-4M (VDV) — woodland/base variant. Main turret 'BP_BMD4M_Turret_C' and
// commander periscope 'BP_BMD4M_Commander_Periscope_C' without '_Desert'
// suffix. The left bow PKT turret still uses the shared
// 'BP_BMD1M_Bowgun_L_Desert_C' class across both camo variants (per BP).
VEHICLE_LOADOUTS['BP_BMD4M_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMD4M_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMD4M_Commander_Periscope_C' },
  ],
  turrets: {
    'BP_BMD4M_Turret_C': [
      { name: '100mm 2A70 HE-Frag',         class: 'BP_BMD4M_2A70_HEFrag',                mags: 22, magSize: 1,    type: 'he',      caliber: '100mm' },
      { name: '9M117M1 Bastion ATGM',       class: 'BP_BMD4M_APS03-100ATGM',              mags: 3,  magSize: 1,    type: 'atgm',    caliber: '100mm' },
      { name: '30mm 2A72 APDS',             class: 'BP_BMD4M_2A72_AP',                    mags: 1,  magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A72 HE-Frag',          class: 'BP_BMD4M_2A72_HE',                    mags: 1,  magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMD4M_2A70_coax',                  mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMD4M_Smoke_Launcher',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_BMD4M_Commander_Periscope_C': [],
    // Shared bow PKT class (kept as _Desert in the BP even for non-desert).
    'BP_BMD1M_Bowgun_L_Desert_C': [
      { name: 'Bow PKT MG',                 class: 'BP_BMD1M_Bow_PKT',                    mags: 8,  magSize: 250,  type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// BMP-1 (MEI / Insurgent) — classic Soviet tracked IFV with a 73mm 2A28 Grom
// low-velocity gun (HEAT + Frag), PKT coaxial MG, and a rail-launched 9M14P
// Malyutka-P wire-guided ATGM above the main gun. Commander periscope has no
// weapons. 3 crew + 12 passengers (the infamous BMP benches).
// Turret class is 'BP_BMP1_Turret_MEI_C' — MEI faction suffix, not a camo tag.
VEHICLE_LOADOUTS['BP_BMP1_INS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP1_Turret_MEI_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP1_Periscope_MEI_C' },
  ],
  turrets: {
    'BP_BMP1_Turret_MEI_C': [
      { name: '73mm 2A28 HEAT',             class: 'BP_BMP1_2A28_HEAT',                   mags: 24, magSize: 1,   type: 'heat', caliber: '73mm' },
      { name: '73mm 2A28 Frag',             class: 'BP_BMP1_2A28_Frag',                   mags: 16, magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: '9M14P Malyutka-P ATGM',      class: 'BP_BMP1_AT3',                         mags: 4,  magSize: 1,   type: 'atgm', caliber: '125mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP1_PKT',                         mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
    'BP_BMP1_Periscope_MEI_C': [],
  },
};

// BMP-1 (AFU — Ukrainian Armed Forces) — identical armament to the MEI BMP-1,
// just faction-suffixed turret class names ('_AFU_C').
VEHICLE_LOADOUTS['BP_BMP1_AFU_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP1_Turret_AFU_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP1_Periscope_AFU_C' },
  ],
  turrets: {
    'BP_BMP1_Turret_AFU_C': [
      { name: '73mm 2A28 HEAT',             class: 'BP_BMP1_2A28_HEAT',                   mags: 24, magSize: 1,   type: 'heat', caliber: '73mm' },
      { name: '73mm 2A28 Frag',             class: 'BP_BMP1_2A28_Frag',                   mags: 16, magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: '9M14P Malyutka-P ATGM',      class: 'BP_BMP1_AT3',                         mags: 4,  magSize: 1,   type: 'atgm', caliber: '125mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP1_PKT',                         mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
    'BP_BMP1_Periscope_AFU_C': [],
  },
};

// BMP-1 (GFI) — same as other BMP-1 variants with '_GFI_C' turret suffix.
VEHICLE_LOADOUTS['BP_BMP1_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP1_Turret_GFI_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP1_Periscope_GFI_C' },
  ],
  turrets: {
    'BP_BMP1_Turret_GFI_C': [
      { name: '73mm 2A28 HEAT',             class: 'BP_BMP1_2A28_HEAT',                   mags: 24, magSize: 1,   type: 'heat', caliber: '73mm' },
      { name: '73mm 2A28 Frag',             class: 'BP_BMP1_2A28_Frag',                   mags: 16, magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: '9M14P Malyutka-P ATGM',      class: 'BP_BMP1_AT3',                         mags: 4,  magSize: 1,   type: 'atgm', caliber: '125mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP1_PKT',                         mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
    'BP_BMP1_Periscope_GFI_C': [],
  },
};

// BMP-1 (IMF — Insurgent / Middle East Forces) — class name uses '_MIL_C'
// suffix while the sub-components use '_IMF_C'. Same armament as the other
// BMP-1 variants.
VEHICLE_LOADOUTS['BP_BMP1_MIL_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP1_Turret_IMF_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP1_Periscope_IMF_C' },
  ],
  turrets: {
    'BP_BMP1_Turret_IMF_C': [
      { name: '73mm 2A28 HEAT',             class: 'BP_BMP1_2A28_HEAT',                   mags: 24, magSize: 1,   type: 'heat', caliber: '73mm' },
      { name: '73mm 2A28 Frag',             class: 'BP_BMP1_2A28_Frag',                   mags: 16, magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: '9M14P Malyutka-P ATGM',      class: 'BP_BMP1_AT3',                         mags: 4,  magSize: 1,   type: 'atgm', caliber: '125mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP1_PKT',                         mags: 8,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
    ],
    'BP_BMP1_Periscope_IMF_C': [],
  },
};

// BMP-1AM "Basurmanin" (RGF) — modernized BMP-1 refit that swaps the low-
// velocity 73mm 2A28 Grom for the BTR-82A's one-man BPPU turret housing a
// 30mm 2A72 autocannon (APDS + HE-Frag), coaxial PKT MG, and smoke. Turret
// class reuses the BTR-82A's 'BP_BTR82A_turret_C' identifier (lowercase 't'
// per the BP). Only 2 crew (Driver + Gunner, no commander) + 7 passengers.
VEHICLE_LOADOUTS['BP_BMP1AM_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_BTR82A_turret_C' },
  ],
  turrets: {
    'BP_BTR82A_turret_C': [
      { name: '30mm 2A72 APDS',             class: 'BP_BTR82A_RUS_2A72_AP',               mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A72 HE-Frag',          class: 'BP_BTR82A_RUS_2A72_HE',               mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BTR82A_PKT',                       mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BTR82A_RUS_Smoke_Launcher',        mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

// BMP-1AM Desert (RGF) — desert camo variant. Turret and weapon classes get
// a trailing '_Desert' / '_desert' suffix (turret: 'BP_BTR82A_turret_desert_C'
// — note the lowercase 'd' on the camo suffix matches the BP exactly).
VEHICLE_LOADOUTS['BP_BMP1AM_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_BTR82A_turret_desert_C' },
  ],
  turrets: {
    'BP_BTR82A_turret_desert_C': [
      { name: '30mm 2A72 APDS',             class: 'BP_BTR82A_RUS_2A72_AP_Desert',        mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A72 HE-Frag',          class: 'BP_BTR82A_RUS_2A72_HE_Desert',        mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BTR82A_PKT_desert',                mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BTR82A_RUS_Smoke_Launcher_Desert', mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

// BMP-1TS (AFU) — Ukrainian deep-modernization of the BMP-1 with a new
// Shturm-M remote turret: 30mm ZTM-1 autocannon (APDS + HE-Frag), KT-7.62
// coaxial MG, KBA-117 30mm automatic grenade launcher (GPD-30), Stugna-P
// laser-guided ATGM (RK-2M-K "Skif"), and smoke launchers. Turret class
// 'BP_BMP1TS_Turret_C' has NO faction suffix; the commander periscope
// reuses the BMP-1 AFU periscope class 'BP_BMP1_Periscope_AFU_C'.
// 3 crew + 12 passengers.
VEHICLE_LOADOUTS['BP_BMP1TS_AFU_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP1TS_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP1_Periscope_AFU_C' },
  ],
  turrets: {
    'BP_BMP1TS_Turret_C': [
      { name: '30mm ZTM-1 APDS',            class: 'BP_BMP1TS_ZTM1_AP',                   mags: 1, magSize: 150, type: 'kinetic', caliber: '30mm' },
      { name: '30mm ZTM-1 HE-Frag',         class: 'BP_BMP1TS_ZTM1_HE',                   mags: 1, magSize: 150, type: 'he',      caliber: '30mm' },
      { name: 'RK-2M-K Skif ATGM',          class: 'BP_BMP1TS_StugnaP',                   mags: 2, magSize: 2,   type: 'atgm',    caliber: '130mm' },
      { name: 'KBA-117 30mm GPD',           class: 'BP_BMP1TS_KBA117',                    mags: 4, magSize: 29,  type: 'he',      caliber: '30mm' },
      { name: 'KT-7.62 Coaxial MG',         class: 'BP_BMP1TS_KT762',                     mags: 6, magSize: 350, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP1TS_Smoke_Launcher',            mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_BMP1_Periscope_AFU_C': [],
  },
};

// BMP-2 (AFU) — Ukrainian variant of the Soviet BMP-2 with 30mm 2A42
// autocannon (APDS + HE-Frag), PKT coaxial MG, roof-mounted 9M113 Konkurs
// wire-guided ATGM, and smoke launchers. Turret 'BP_BMP2_Turret_AFU_C' plus
// commander periscope 'BP_BMP2_Commander_Periscope_AFU_C' (no weapons).
// 3 crew + 7 passengers.
VEHICLE_LOADOUTS['BP_BMP2_AFU_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2_Turret_AFU_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2_Commander_Periscope_AFU_C' },
  ],
  turrets: {
    'BP_BMP2_Turret_AFU_C': [
      { name: '30mm 2A42 APDS',             class: 'BP_BMP2_AFU_2A42_AP',                 mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2_AFU_2A42_HE',                 mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: '9M113 Konkurs ATGM',         class: 'BP_BMP2_AFU_Konkurs',                 mags: 4, magSize: 1,    type: 'atgm',    caliber: '135mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2_AFU_PKT',                     mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2_AFU_Smoke_Launcher',          mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2_Commander_Periscope_AFU_C': [],
  },
};

// BMP-2 (GFI) — faction variant with 'GFI_' as a PREFIX on turret/weapon
// sub-classes ('BP_BMP2_GFI_Turret_C'). Uses the older 3UBR6 APDS round
// (70mm pen vs. the 95mm 3UBR8 on the AFU/IMF variants) — same displayed
// APDS name kept in UI, only the weapon class string differs.
VEHICLE_LOADOUTS['BP_BMP2_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2_GFI_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2_GFI_Commander_Periscope_C' },
  ],
  turrets: {
    'BP_BMP2_GFI_Turret_C': [
      { name: '30mm 2A42 AP',               class: 'BP_BMP2_GFI_2A42_AP',                 mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2_GFI_2A42_HE',                 mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: '9M113 Konkurs ATGM',         class: 'BP_BMP2_GFI_Konkurs',                 mags: 4, magSize: 1,    type: 'atgm',    caliber: '135mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2_GFI_PKT',                     mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2_GFI_Smoke_Launcher',          mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2_GFI_Commander_Periscope_C': [],
  },
};

// BMP-2 (IMF — Insurgent) — 'IMF' as SUFFIX on turret/periscope classes, but
// weapon classes have NO faction tag (plain 'BP_BMP2_2A42_*'). Lacks the
// Konkurs ATGM — only 5 weapons total.
VEHICLE_LOADOUTS['BP_BMP2_IMF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2_Turret_IMF_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2_Commander_Periscope_IMF_C' },
  ],
  turrets: {
    'BP_BMP2_Turret_IMF_C': [
      { name: '30mm 2A42 APDS',             class: 'BP_BMP2_2A42_AP',                     mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2_2A42_HE',                     mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2_PKT',                         mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2_Smoke_Launcher',              mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2_Commander_Periscope_IMF_C': [],
  },
};

// BMP-2 (RGF — woodland) — base RGF variant with no faction tag on
// turret/weapon classes. Turret 'BP_BMP2_Turret_C', commander periscope
// 'BP_BMP2_Commander_Periscope_C'. Same armament as AFU/Desert variants:
// 30mm 2A42 APDS + HE-Frag, Konkurs ATGM, PKT coax, smoke.
VEHICLE_LOADOUTS['BP_BMP2_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2_Commander_Periscope_C' },
  ],
  turrets: {
    'BP_BMP2_Turret_C': [
      { name: '30mm 2A42 APDS',             class: 'BP_BMP2_2A42_AP',                     mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2_2A42_HE',                     mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: '9M113 Konkurs ATGM',         class: 'BP_BMP2_Konkurs',                     mags: 4, magSize: 1,    type: 'atgm',    caliber: '135mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2_PKT',                         mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2_Smoke_Launcher',              mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2_Commander_Periscope_C': [],
  },
};

// BMP-2 Desert (RGF) — desert camo variant. Identical armament to the base
// RGF BMP-2 but with '_Desert' suffix on turret, periscope, and weapon
// classes.
VEHICLE_LOADOUTS['BP_BMP2_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2_Commander_Periscope_Desert_C' },
  ],
  turrets: {
    'BP_BMP2_Turret_Desert_C': [
      { name: '30mm 2A42 APDS',             class: 'BP_BMP2_2A42_AP_Desert',              mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2_2A42_HE_Desert',              mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: '9M113 Konkurs ATGM',         class: 'BP_BMP2_Konkurs_Desert',              mags: 4, magSize: 1,    type: 'atgm',    caliber: '135mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2_PKT_Desert',                  mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2_Smoke_Launcher_Desert',       mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2_Commander_Periscope_Desert_C': [],
  },
};

// BMP-2M "Berezhok" (RGF — woodland) — upgraded BMP-2 with a new Berezhok
// turret module: four-round Kornet ATGM launcher (much more potent than the
// older Konkurs), 30mm AGS-30 automatic grenade launcher (GPD-30 frag),
// retains the 30mm 2A42 autocannon (APDS + HE-Frag), PKT coax, and smoke.
// Turret 'BP_BMP2M_Turret_C' + commander periscope (no weapons).
// 3 crew + 7 passengers.
VEHICLE_LOADOUTS['BP_BMP2M_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2M_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2M_Commander_Periscope_C' },
  ],
  turrets: {
    'BP_BMP2M_Turret_C': [
      { name: '30mm 2A42 APDS',             class: 'BP_BMP2M_2A42_AP',                    mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2M_2A42_HE',                    mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: '9M133 Kornet ATGM',          class: 'BP_BMP2M_Kornet',                     mags: 1, magSize: 4,    type: 'atgm',    caliber: '152mm' },
      { name: 'AGS-30 30mm GPD',            class: 'BP_BMP2M_AGS30',                      mags: 1, magSize: 120,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2M_PKT',                        mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2M_Smoke_Launcher',             mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2M_Commander_Periscope_C': [],
  },
};

// BMP-2M Desert (RGF) — desert camo variant. Identical Berezhok armament
// with '_Desert' suffix on turret, periscope, and all weapon classes.
VEHICLE_LOADOUTS['BP_BMP2M_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP2M_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BMP2M_Commander_Periscope_Desert_C' },
  ],
  turrets: {
    'BP_BMP2M_Turret_Desert_C': [
      { name: '30mm 2A42 APDS',             class: 'BP_BMP2M_2A42_AP_Desert',             mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A42 HE-Frag',          class: 'BP_BMP2M_2A42_HE_Desert',             mags: 1, magSize: 340,  type: 'he',      caliber: '30mm' },
      { name: '9M133 Kornet ATGM',          class: 'BP_BMP2M_Kornet_Desert',              mags: 1, magSize: 4,    type: 'atgm',    caliber: '152mm' },
      { name: 'AGS-30 30mm GPD',            class: 'BP_BMP2M_AGS30_Desert',               mags: 1, magSize: 120,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP2M_PKT_Desert',                 mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_BMP2M_Smoke_Launcher_Desert',      mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP2M_Commander_Periscope_Desert_C': [],
  },
};

// BMP-3M (RGF — woodland) — heavy Russian tracked IFV with a dual-gun main
// turret: 100mm 2A70 (HE-Frag rounds + 9M117M1 Bastion laser-guided ATGM
// through the gun tube), coaxial 30mm 2A72 autocannon (APDS + HE-Frag),
// PKT coax MG, and smoke. Distinctive for having TWO bow PKTM gunner seats
// in addition to the main turret and commander. 5 crew + 7 passengers.
// Note: left bow turret uses the '_Left_New_C' suffix (an in-engine rename)
// while right is plain '_Right_C' — both share the same BP_BMP3M_BowGun_PKT
// weapon class.
VEHICLE_LOADOUTS['BP_BMP3M_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_BMP3M_Turret_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_BMP3M_Commander_Periscope_C' },
    { index: 3, role: 'Bow Gunner L', turretClass: 'BP_BMP3M_BowTurret_Left_New_C' },
    { index: 4, role: 'Bow Gunner R', turretClass: 'BP_BMP3M_BowTurret_Right_C' },
  ],
  turrets: {
    'BP_BMP3M_Turret_C': [
      { name: '100mm 2A70 HE-Frag',         class: 'BP_BMP3M_2A70_HEFrag',                mags: 22, magSize: 1,    type: 'he',      caliber: '100mm' },
      { name: '9M117M1 Bastion ATGM',       class: 'BP_9M117M1BastionATGM',               mags: 3,  magSize: 1,    type: 'atgm',    caliber: '100mm' },
      { name: '30mm 2A72 APDS',             class: 'BP_BMP3M_2A72_AP',                    mags: 1,  magSize: 195,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A72 HE-Frag',          class: 'BP_BMP3M_2A72_HE',                    mags: 1,  magSize: 305,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP3M_2A70_coax',                  mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_Smoke_Launcher_BMP3M',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP3M_Commander_Periscope_C': [],
    'BP_BMP3M_BowTurret_Left_New_C': [
      { name: 'Bow PKTM MG',                class: 'BP_BMP3M_BowGun_PKT',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
    ],
    'BP_BMP3M_BowTurret_Right_C': [
      { name: 'Bow PKTM MG',                class: 'BP_BMP3M_BowGun_PKT',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// BMP-3M Desert (RGF) — desert camo variant. Only turret/periscope/bow
// turret classes get '_Desert' suffix; all six main weapon classes
// (100mm 2A70, Bastion ATGM, 2A72 AP/HE, coax PKT, smoke launcher) are
// SHARED with the base variant — they don't carry '_Desert' tags per the BP.
// Bow turret suffix becomes '_Desert_C' in place of the base's '_New_C' on
// the left side (left: '_Left_Desert_C', right: '_Right_Desert_C').
VEHICLE_LOADOUTS['BP_BMP3M_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_BMP3M_Turret_Desert_C' },
    { index: 2, role: 'Commander',    turretClass: 'BP_BMP3M_Commander_Periscope_Desert_C' },
    { index: 3, role: 'Bow Gunner L', turretClass: 'BP_BMP3M_BowTurret_Left_Desert_C' },
    { index: 4, role: 'Bow Gunner R', turretClass: 'BP_BMP3M_BowTurret_Right_Desert_C' },
  ],
  turrets: {
    'BP_BMP3M_Turret_Desert_C': [
      { name: '100mm 2A70 HE-Frag',         class: 'BP_BMP3M_2A70_HEFrag',                mags: 22, magSize: 1,    type: 'he',      caliber: '100mm' },
      { name: '9M117M1 Bastion ATGM',       class: 'BP_9M117M1BastionATGM',               mags: 3,  magSize: 1,    type: 'atgm',    caliber: '100mm' },
      { name: '30mm 2A72 APDS',             class: 'BP_BMP3M_2A72_AP',                    mags: 1,  magSize: 195,  type: 'kinetic', caliber: '30mm' },
      { name: '30mm 2A72 HE-Frag',          class: 'BP_BMP3M_2A72_HE',                    mags: 1,  magSize: 305,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',             class: 'BP_BMP3M_2A70_coax',                  mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_Smoke_Launcher_BMP3M',             mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_BMP3M_Commander_Periscope_Desert_C': [],
    'BP_BMP3M_BowTurret_Left_Desert_C': [
      { name: 'Bow PKTM MG',                class: 'BP_BMP3M_BowGun_PKT',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
    ],
    'BP_BMP3M_BowTurret_Right_Desert_C': [
      { name: 'Bow PKTM MG',                class: 'BP_BMP3M_BowGun_PKT',                 mags: 1,  magSize: 2000, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// FV510 Warrior (BAF — British) — tan/desert variant. Rarden 30mm L21A1
// autocannon (APDS + HE-Frag, fed from 3-round clips — hence the 19 mags ×
// 6 rounds layout), L94A1 EX-34 coaxial MG, and smoke launchers. Unarmed
// commander station. Weapons carry a '_Tan' camo suffix on the tan variant.
// 3 crew + 9 passengers.
// NOTE: the extracted weapon dump erroneously lists a BP_BMP3M_BowGun_PKT
// attached to the FV510 — that's an extractor cross-wire (the Warrior has
// no bow gun). It's excluded from the loadout here.
VEHICLE_LOADOUTS['BP_FV510_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_FV510_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_FV510_Commander_C' },
  ],
  turrets: {
    'BP_FV510_Turret_C': [
      { name: 'NM225 30mm APDS',            class: 'BP_Warrior_Rarden_AP_Tan',            mags: 19, magSize: 6,   type: 'kinetic', caliber: '30mm' },
      { name: 'NM232 30mm HE-T',            class: 'BP_Warrior_Rarden_HE_Tan',            mags: 19, magSize: 6,   type: 'he',      caliber: '30mm' },
      { name: 'L94A1 EX-34 Coaxial MG',     class: 'BP_Warrior_762_Tan',                  mags: 10, magSize: 200, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_Warrior_Smoke_Launcher_Tan',       mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_FV510_Commander_C': [],
  },
};

// FV510 Warrior Woodland (BAF) — woodland camo variant. Turret class gets
// '_Woodland' suffix ('BP_FV510_Turret_Woodland_C') but weapon classes DROP
// the '_Tan' tag entirely (plain 'BP_Warrior_*'). The commander station
// reuses the same 'BP_FV510_Commander_C' class across both variants.
VEHICLE_LOADOUTS['BP_FV510_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_FV510_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_FV510_Commander_C' },
  ],
  turrets: {
    'BP_FV510_Turret_Woodland_C': [
      { name: 'NM225 30mm APDS',            class: 'BP_Warrior_Rarden_AP',                mags: 19, magSize: 6,   type: 'kinetic', caliber: '30mm' },
      { name: 'NM232 30mm HE-T',            class: 'BP_Warrior_Rarden_HE',                mags: 19, magSize: 6,   type: 'he',      caliber: '30mm' },
      { name: 'L94A1 EX-34 Coaxial MG',     class: 'BP_Warrior_762',                      mags: 10, magSize: 200, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_Warrior_Smoke_Launcher',           mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_FV510_Commander_C': [],
  },
};

// FV510 Warrior UA (BAF) — Ukrainian-service variant of the Warrior. Uses
// the EXACT same turret / commander / weapon classes as the base FV510
// (turret 'BP_FV510_Turret_C', commander 'BP_FV510_Commander_C', Rarden +
// coax + smoke with '_Tan' suffix) — only the vehicle hull class differs.
VEHICLE_LOADOUTS['BP_FV510UA_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_FV510_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_FV510_Commander_C' },
  ],
  turrets: {
    'BP_FV510_Turret_C': [
      { name: 'NM225 30mm APDS',            class: 'BP_Warrior_Rarden_AP_Tan',            mags: 19, magSize: 6,   type: 'kinetic', caliber: '30mm' },
      { name: 'NM232 30mm HE-T',            class: 'BP_Warrior_Rarden_HE_Tan',            mags: 19, magSize: 6,   type: 'he',      caliber: '30mm' },
      { name: 'L94A1 EX-34 Coaxial MG',     class: 'BP_Warrior_762_Tan',                  mags: 10, magSize: 200, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_Warrior_Smoke_Launcher_Tan',       mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_FV510_Commander_C': [],
  },
};

// FV510 Warrior UA Woodland (BAF) — woodland camo UA variant. Shares the
// woodland turret 'BP_FV510_Turret_Woodland_C' and the same weapon classes
// (plain, no '_Tan') with the base BP_FV510_Woodland_C.
VEHICLE_LOADOUTS['BP_FV510UA_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_FV510_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_FV510_Commander_C' },
  ],
  turrets: {
    'BP_FV510_Turret_Woodland_C': [
      { name: 'NM225 30mm APDS',            class: 'BP_Warrior_Rarden_AP',                mags: 19, magSize: 6,   type: 'kinetic', caliber: '30mm' },
      { name: 'NM232 30mm HE-T',            class: 'BP_Warrior_Rarden_HE',                mags: 19, magSize: 6,   type: 'he',      caliber: '30mm' },
      { name: 'L94A1 EX-34 Coaxial MG',     class: 'BP_Warrior_762',                      mags: 10, magSize: 200, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',       class: 'BP_Warrior_Smoke_Launcher',           mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_FV510_Commander_C': [],
  },
};

// M2A3 Bradley . USA — BP_BFV_C (base / tan)
// NOTE: extractor cross-wires the spurious BP_BMP3M_BowGun_PKT / BP_BMP3M_BowTurret_Left_New_C
// pair onto Bradley dumps; excluded here (same as FV510).
VEHICLE_LOADOUTS['BP_BFV_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BFV_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BFV_CmdrScope_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BFV_Turret_C': [
      { name: 'M919 25mm APDS',             class: 'BFV_M252_AP',               mags: 1,  magSize: 70,  type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',             class: 'BFV_M252_HE',               mags: 1,  magSize: 230, type: 'he',      caliber: '25mm' },
      { name: 'BGM-71 TOW ATGM',            class: 'BP_BFV_vehicleTOW',         mags: 1,  magSize: 2,   type: 'atgm' },
      { name: 'M240C Coaxial MG',           class: 'BP_BFV_762',                mags: 2,  magSize: 800, type: 'mg',      caliber: '7.62mm' },
      { name: 'Smoke Launcher',             class: 'Smoke_Launcher_BFV',        mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_BFV_CmdrScope_C': [],
  },
};

// M2A3 Bradley . USA — BP_BFV_Woodland_C (all sub-classes get _Woodland)
VEHICLE_LOADOUTS['BP_BFV_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BFV_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BFV_CmdrScope_Woodland_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BFV_Turret_Woodland_C': [
      { name: 'M919 25mm APDS',             class: 'BFV_M252_AP_Woodland',          mags: 1,  magSize: 70,  type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',             class: 'BFV_M252_HE_Woodland',          mags: 1,  magSize: 230, type: 'he',      caliber: '25mm' },
      { name: 'BGM-71 TOW ATGM',            class: 'BP_BFV_vehicleTOW_Woodland',    mags: 1,  magSize: 2,   type: 'atgm' },
      { name: 'M240C Coaxial MG',           class: 'BP_BFV_762_Woodland',           mags: 2,  magSize: 800, type: 'mg',      caliber: '7.62mm' },
      { name: 'Smoke Launcher',             class: 'Smoke_Launcher_BFV_Woodland',   mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_BFV_CmdrScope_Woodland_C': [],
  },
};

// M7A3 . USA — BP_M7A3_IFV_C (base / tan). Shares BFV commander scope + weapon classes;
// only the turret wrapper (BP_M7A3_Turret_C) is M7A3-specific.
// NOTE: extractor cross-wires the spurious BP_BMP3M_BowGun_PKT / BP_BMP3M_BowTurret_Left_New_C
// pair onto M7A3 dumps; excluded here (same as BFV/FV510).
VEHICLE_LOADOUTS['BP_M7A3_IFV_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M7A3_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BFV_CmdrScope_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M7A3_Turret_C': [
      { name: 'M919 25mm APDS',             class: 'BFV_M252_AP',               mags: 1,  magSize: 70,  type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',             class: 'BFV_M252_HE',               mags: 1,  magSize: 230, type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',           class: 'BP_BFV_762',                mags: 2,  magSize: 800, type: 'mg',      caliber: '7.62mm' },
      { name: 'Smoke Launcher',             class: 'Smoke_Launcher_BFV',        mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_BFV_CmdrScope_C': [],
  },
};

// M7A3 . USA — BP_M7A3_IFV_Woodland_C (all sub-classes get _Woodland)
VEHICLE_LOADOUTS['BP_M7A3_IFV_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M7A3_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BFV_CmdrScope_Woodland_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M7A3_Turret_Woodland_C': [
      { name: 'M919 25mm APDS',             class: 'BFV_M252_AP_Woodland',          mags: 1,  magSize: 70,  type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',             class: 'BFV_M252_HE_Woodland',          mags: 1,  magSize: 230, type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',           class: 'BP_BFV_762_Woodland',           mags: 2,  magSize: 800, type: 'mg',      caliber: '7.62mm' },
      { name: 'Smoke Launcher',             class: 'Smoke_Launcher_BFV_Woodland',   mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_BFV_CmdrScope_Woodland_C': [],
  },
};

// MT-LBM 6MB . IMF — BP_MTLBM_6MB_MIL_C (30mm autocannon turreted MT-LB IFV variant)
// NOTE: extractor cross-wires the spurious BP_BMP3M_BowGun_PKT / BP_BMP3M_BowTurret_Left_New_C
// pair; excluded here.
VEHICLE_LOADOUTS['BP_MTLBM_6MB_MIL_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_MTLB_30mm_turret_MIL_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_MTLB_30mm_turret_MIL_C': [
      { name: '3UBR6 30mm AP',             class: 'BP_MTLB_30mm_AP_gun',                mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '3UOR6 30mm HE-Frag',        class: 'BP_MTLB_30mm_HE_gun',                mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',            class: 'BP_MTLB30mm_PKT',                    mags: 1, magSize: 2500, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_Smoke_Launcher_MTLB30mm_Militia', mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

// MT-LBM 6MB . RGF — BP_MTLBM_6MB_RUS_Desert_C (all sub-classes get _Desert / _desert)
VEHICLE_LOADOUTS['BP_MTLBM_6MB_RUS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_MTLB_30mm_turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    // NOTE: PKT class uses lowercase '_desert'; all other sub-classes use capitalized '_Desert'.
    'BP_MTLB_30mm_turret_Desert_C': [
      { name: '3UBR6 30mm AP',             class: 'BP_MTLB_30mm_AP_gun_Desert',         mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '3UOR6 30mm HE-Frag',        class: 'BP_MTLB_30mm_HE_gun_Desert',         mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',            class: 'BP_MTLB30mm_PKT_desert',             mags: 1, magSize: 2500, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_Smoke_Launcher_MTLB30mm_Desert',  mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

// MT-LBM 6MB . RGF — BP_MTLBM_6MB_RUS_C (base / green variant; all sub-classes use _Green / _green)
VEHICLE_LOADOUTS['BP_MTLBM_6MB_RUS_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_MTLB_30mm_turret_Green_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    // NOTE: smoke launcher class drops the '_Green' suffix (BP_Smoke_Launcher_MTLB30mm);
    // PKT class uses lowercase '_green'; gun classes use capitalized '_Green'.
    'BP_MTLB_30mm_turret_Green_C': [
      { name: '3UBR6 30mm AP',             class: 'BP_MTLB_30mm_AP_gun_Green',          mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '3UOR6 30mm HE-Frag',        class: 'BP_MTLB_30mm_HE_gun_Green',          mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',            class: 'BP_MTLB30mm_PKT_green',              mags: 1, magSize: 2500, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_Smoke_Launcher_MTLB30mm',         mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

// ZBD04A . PLA/PLAAGF — BP_ZBD04A_Desert_C (big-gun tracked IFV: 100mm HE-Frag + AT-10 ATGM + 30mm AP/HE)
// NOTE: extractor cross-wires the spurious BP_BMP3M_BowGun_PKT / BP_BMP3M_BowTurret_Left_New_C
// pair; excluded here.
VEHICLE_LOADOUTS['BP_ZBD04A_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBD04A_Turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBD04A_Commander_Periscope_Desert_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_ZBD04A_Turret_Desert_C': [
      { name: 'DTC10-30 30mm AP',          class: 'BP_ZBD04A_ZPT99_AP',          mags: 1,  magSize: 200,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',     class: 'BP_ZBD04A_ZPT99_HEFrag',      mags: 1,  magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'DTB02-100 100mm HE-Frag',   class: 'BP_ZBD04A_2A70_HEFrag',       mags: 22, magSize: 1,    type: 'he',      caliber: '100mm' },
      { name: 'APS03-100 ATGM',            class: 'BP_ZBD04A_APS03-100ATGM',     mags: 3,  magSize: 1,    type: 'atgm' },
      { name: 'QTJ-02 Coaxial MG',         class: 'BP_ZBD04A_2A70_coax',         mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_Smoke_Launcher_ZBD04A',    mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_ZBD04A_Commander_Periscope_Desert_C': [],
  },
};

// ZBD04A . PLA/PLAAGF — BP_ZBD04A_C (base variant; sub-classes drop _Desert suffix)
VEHICLE_LOADOUTS['BP_ZBD04A_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBD04A_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBD04A_Commander_Periscope_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    // NOTE: ZBD04A weapon classes are SHARED between base and desert (no suffix);
    // only turret and commander periscope wrappers differ.
    'BP_ZBD04A_Turret_C': [
      { name: 'DTC10-30 30mm AP',          class: 'BP_ZBD04A_ZPT99_AP',          mags: 1,  magSize: 200,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',     class: 'BP_ZBD04A_ZPT99_HEFrag',      mags: 1,  magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'DTB02-100 100mm HE-Frag',   class: 'BP_ZBD04A_2A70_HEFrag',       mags: 22, magSize: 1,    type: 'he',      caliber: '100mm' },
      { name: 'APS03-100 ATGM',            class: 'BP_ZBD04A_APS03-100ATGM',     mags: 3,  magSize: 1,    type: 'atgm' },
      { name: 'QTJ-02 Coaxial MG',         class: 'BP_ZBD04A_2A70_coax',         mags: 1,  magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_Smoke_Launcher_ZBD04A',    mags: 1,  magSize: 2,    type: 'smoke' },
    ],
    'BP_ZBD04A_Commander_Periscope_C': [],
  },
};

// ZBD05 HJ-73C . PLAAGF — BP_ZBD05_HJ73C_Woodland_C (amphibious tracked IFV;
// 30mm APFSDS/HE + HJ-73C ATGM; no 100mm gun unlike ZBD04A)
// NOTE: extractor cross-wires the spurious BP_BMP3M_BowGun_PKT / BP_BMP3M_BowTurret_Left_New_C
// pair; excluded here.
VEHICLE_LOADOUTS['BP_ZBD05_HJ73C_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBD05_Turret_HJ73C_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBD05_Commander_Periscope_Woodland_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_ZBD05_Turret_HJ73C_Woodland_C': [
      { name: 'DTC041A-30 30mm APFSDS',    class: 'BP_ZBD05_ZPT-99_APFSDS',     mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',     class: 'BP_ZBD05_ZPT-99_HE',         mags: 1, magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'HJ-73C Red Arrow ATGM',     class: 'BP_ZBD05_HJ73C_ATGM',        mags: 1, magSize: 2,    type: 'atgm' },
      { name: 'QTJ-02 Coaxial MG',         class: 'BP_ZBD05_QTJ02',             mags: 1, magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_ZBD05_Smoke_Launcher',    mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_ZBD05_Commander_Periscope_Woodland_C': [],
  },
};

// ZBD05 HJ-73C . PLANMC — BP_ZBD05_HJ73C_C (base variant; weapon classes are SHARED
// with _Woodland variant, only turret wrapper + commander periscope drop _Woodland).
VEHICLE_LOADOUTS['BP_ZBD05_HJ73C_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZBD05_Turret_HJ73C_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_ZBD05_Commander_Periscope_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_ZBD05_Turret_HJ73C_C': [
      { name: 'DTC041A-30 30mm APFSDS',    class: 'BP_ZBD05_ZPT-99_APFSDS',     mags: 1, magSize: 160,  type: 'kinetic', caliber: '30mm' },
      { name: 'DTB02-30 30mm HE-Frag',     class: 'BP_ZBD05_ZPT-99_HE',         mags: 1, magSize: 300,  type: 'he',      caliber: '30mm' },
      { name: 'HJ-73C Red Arrow ATGM',     class: 'BP_ZBD05_HJ73C_ATGM',        mags: 1, magSize: 2,    type: 'atgm' },
      { name: 'QTJ-02 Coaxial MG',         class: 'BP_ZBD05_QTJ02',             mags: 1, magSize: 3000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',      class: 'BP_ZBD05_Smoke_Launcher',    mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_ZBD05_Commander_Periscope_C': [],
  },
};

// ZSD89II IFV . PLA/PLAAGF — BP_ZSD89II_Desert_C (25mm-turreted tracked IFV;
// reuses the wheeled ZSL92 IFV's BP_ZSL92_turret_C).
// NOTE: extractor cross-wires the spurious BP_BMP3M_BowGun_PKT / BP_BMP3M_BowTurret_Left_New_C
// pair; excluded here.
VEHICLE_LOADOUTS['BP_ZSD89II_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_ZSL92_turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers',    class: 'BP_Smoke_Launcher_ZSD89_Driver',  mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_ZSL92_turret_Desert_C': [
      { name: '25mm APDS',               class: 'BP_ZSL92_ZPT90_AP_Desert',        mags: 1, magSize: 80,  type: 'kinetic', caliber: '25mm' },
      { name: '25mm Frag Tracer',        class: 'BP_ZSL92_ZPT90_HE_Desert',        mags: 1, magSize: 120, type: 'he',      caliber: '25mm' },
      { name: 'Type 86 Coaxial MG',      class: 'BP_ZSL92_Type86_Desert',          mags: 4, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_ZSL92_Smoke_Launcher_Desert',  mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// ZSD89II IFV . PLA/PLAAGF — BP_ZSD89II_C (base variant; sub-classes drop _Desert)
VEHICLE_LOADOUTS['BP_ZSD89II_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_ZSL92_turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers',    class: 'BP_Smoke_Launcher_ZSD89_Driver',  mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_ZSL92_turret_C': [
      { name: '25mm APDS',               class: 'BP_ZSL92_ZPT90_AP',               mags: 1, magSize: 80,  type: 'kinetic', caliber: '25mm' },
      { name: '25mm Frag Tracer',        class: 'BP_ZSL92_ZPT90_HE',               mags: 1, magSize: 120, type: 'he',      caliber: '25mm' },
      { name: 'Type 86 Coaxial MG',      class: 'BP_ZSL92_Type86',                 mags: 4, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_ZSL92_Smoke_Launcher',         mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// BTR-82A . RGF — BP_BTR82A_RUS_Desert_C (30mm-turreted wheeled IFV derived from BTR-80 hull;
// reuses BTR-80's commander periscope class).
VEHICLE_LOADOUTS['BP_BTR82A_RUS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    // NOTE: BTR-82A turret class uses lowercase 'turret_desert' (matches BMP-1AM convention).
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR82A_turret_desert_C' },
    // NOTE: commander periscope is SHARED with BTR-80 RGF desert (BP_BTR80_RUS_Periscope_Desert_C).
    { index: 2, role: 'Commander', turretClass: 'BP_BTR80_RUS_Periscope_Desert_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BTR82A_turret_desert_C': [
      { name: '3UBR8 30mm APDS',         class: 'BP_BTR82A_RUS_2A72_AP_Desert',           mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '3UOR6 30mm Frag Tracer',  class: 'BP_BTR82A_RUS_2A72_HE_Desert',           mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      // NOTE: PKT class uses lowercase '_desert'; all other sub-classes use capitalized '_Desert'.
      { name: 'PKT Coaxial MG',          class: 'BP_BTR82A_PKT_desert',                   mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_BTR82A_RUS_Smoke_Launcher_Desert',    mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BTR80_RUS_Periscope_Desert_C': [],
  },
};

// BTR-82A . RGF — BP_BTR82A_RUS_C (base variant; sub-classes drop _Desert / _desert)
VEHICLE_LOADOUTS['BP_BTR82A_RUS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR82A_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BTR80_RUS_Periscope_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BTR82A_turret_C': [
      { name: '3UBR8 30mm APDS',         class: 'BP_BTR82A_RUS_2A72_AP',           mags: 1, magSize: 150,  type: 'kinetic', caliber: '30mm' },
      { name: '3UOR6 30mm Frag Tracer',  class: 'BP_BTR82A_RUS_2A72_HE',           mags: 1, magSize: 150,  type: 'he',      caliber: '30mm' },
      { name: 'PKT Coaxial MG',          class: 'BP_BTR82A_PKT',                   mags: 1, magSize: 2000, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_BTR82A_RUS_Smoke_Launcher',    mags: 1, magSize: 2,    type: 'smoke' },
    ],
    'BP_BTR80_RUS_Periscope_C': [],
  },
};

// LAV-25 . USMC — BP_LAV25_C (base / desert variant; sub-classes carry _Desert suffix
// because the base class is effectively the desert camo. Commander class has no
// suffix and is SHARED between base and woodland variants.)
VEHICLE_LOADOUTS['BP_LAV25_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_LAV25_Turret_C' },
    // NOTE: commander class is SHARED between base and woodland variants (no suffix).
    { index: 2, role: 'Commander', turretClass: 'BP_LAV25_Commander_C' },
    // NOTE: base variant's pintle turret & M240G weapon use _Desert suffix.
    { index: 3, role: 'Pintle',    turretClass: 'BP_LAV25_Pintle_Turret_Desert_C' },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_LAV25_Turret_C': [
      { name: 'M919 25mm APDS',        class: 'LAV25_M252_AP',                mags: 1, magSize: 60,  type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',        class: 'LAV25_M252_HE',                mags: 1, magSize: 150, type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',      class: 'BP_LAV25_M240C',               mags: 2, magSize: 225, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_LAV25_Smoke_Launcher',      mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_LAV25_Commander_C': [],
    'BP_LAV25_Pintle_Turret_Desert_C': [
      { name: 'M240G Pintle MG',       class: 'BP_M240G_MGO_Turret_Weapon_Desert', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// LAV-25 . USMC — BP_LAV25_Woodland_C (woodland camo; sub-classes carry _Woodland suffix.
// Commander class is SHARED with base variant.)
VEHICLE_LOADOUTS['BP_LAV25_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_LAV25_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_LAV25_Commander_C' },
    { index: 3, role: 'Pintle',    turretClass: 'BP_LAV25_Pintle_Turret_Woodland_C' },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_LAV25_Turret_Woodland_C': [
      { name: 'M919 25mm APDS',        class: 'LAV25_M252_AP_Woodland',                mags: 1, magSize: 60,  type: 'kinetic', caliber: '25mm' },
      { name: 'MK210 25mm HEI',        class: 'LAV25_M252_HE_Woodland',                mags: 1, magSize: 150, type: 'he',      caliber: '25mm' },
      { name: 'M240C Coaxial MG',      class: 'BP_LAV25_M240C_Woodland',               mags: 2, magSize: 225, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',  class: 'BP_LAV25_Smoke_Launcher_Woodland',      mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_LAV25_Commander_C': [],
    'BP_LAV25_Pintle_Turret_Woodland_C': [
      { name: 'M240G Pintle MG',       class: 'BP_M240G_MGO_Turret_Weapon_Woodland', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// ==============================================================================
// WHEELED APCs — rendered as single map_apc.png icon, no turret-direction arrow.
// ==============================================================================

// BTR-80 . IMF — BP_BTR80_Militia_C (KPVT 14.5mm + PKT coax)
VEHICLE_LOADOUTS['BP_BTR80_Militia_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR80_MIL_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BTR80_RUS_Periscope_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BTR80_MIL_turret_C': [
      { name: 'KPVT 14.5mm BZT API',     class: 'BP_BTR80_Militia_KPVT',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial MG',          class: 'BP_BTR80_Militia_PKT',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_BTR80_Militia_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_BTR80_RUS_Periscope_C': [],
  },
};

// BTR-80 — IMF (Insurgent Militia Forces) variant. Same KPVT 14.5mm + PKT
// 7.62mm coax + 40mm smoke launcher kit as the Militia/RGF BTR-80, but the
// turret/weapon classes are suffixed _INS instead of _MIL/_RUS.
VEHICLE_LOADOUTS['BP_BTR80_INS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR80_INS_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BTR80_INS_Periscope_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BTR80_INS_turret_C': [
      { name: 'KPVT 14.5mm BZT API',     class: 'BP_BTR80_INS_KPVT',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial MG',          class: 'BP_BTR80_INS_PKT',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_BTR80_INS_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_BTR80_INS_Periscope_C': [],
  },
};

// BTR-80 . RGF — BP_BTR80_RUS_Desert_C (all sub-classes get _Desert)
VEHICLE_LOADOUTS['BP_BTR80_RUS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR80_RUS_turret_Desert_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BTR80_RUS_Periscope_Desert_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BTR80_RUS_turret_Desert_C': [
      { name: 'KPVT 14.5mm BZT API',     class: 'BP_BTR80_RUS_KPVT_Desert',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial MG',          class: 'BP_BTR80_RUS_PKT_Desert',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_BTR80_RUS_Smoke_Launcher_Desert', mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_BTR80_RUS_Periscope_Desert_C': [],
  },
};

// BTR-80 . RGF — BP_BTR80_RUS_C (base variant; sub-classes drop _Desert)
VEHICLE_LOADOUTS['BP_BTR80_RUS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BTR80_RUS_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BTR80_RUS_Periscope_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BTR80_RUS_turret_C': [
      { name: 'KPVT 14.5mm BZT API',     class: 'BP_BTR80_RUS_KPVT',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial MG',          class: 'BP_BTR80_RUS_PKT',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',    class: 'BP_BTR80_RUS_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_BTR80_RUS_Periscope_C': [],
  },
};

// LAV III C6 RWS . CAF — BP_LAV_RWS_C6_Desert_C (Canadian APC: C6 CROWS RWS +
// manned C6A1 FLEX pintle)
// NOTE: extractor cross-wires the spurious BP_BMD1M_Bow_PKT / BP_BTRD_Bowgun_L_C pair
// (shows up as two duplicated PKTs); excluded here.
VEHICLE_LOADOUTS['BP_LAV_RWS_C6_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',     turretClass: null },
    { index: 1, role: 'Gunner',     turretClass: 'BP_CROWS_LAV_C6_Desert_C' },
    { index: 2, role: 'Crew',       turretClass: 'BP_LAV_C6_Manned_Turret_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_LAV_C6_Desert_C': [
      { name: 'C6 CROWS',             class: 'BP_CROWS_C6_LAV_Desert',         mags: 1,  magSize: 750, type: 'mg',    caliber: '7.62mm' },
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_Nanuk_C6_Desert', mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_LAV_C6_Manned_Turret_C': [
      { name: 'C6A1 FLEX',            class: 'BP_C6_LAV_Manned_Turret',        mags: 10, magSize: 250, type: 'mg',    caliber: '7.62mm' },
    ],
  },
};

// LAV III C6 RWS . CAF — BP_LAV_RWS_C6_C (base variant; sub-classes drop _Desert)
VEHICLE_LOADOUTS['BP_LAV_RWS_C6_C'] = {
  seats: [
    { index: 0, role: 'Driver',     turretClass: null },
    { index: 1, role: 'Gunner',     turretClass: 'BP_CROWS_LAV_C6_C' },
    // NOTE: manned C6 FLEX pintle is SHARED with desert variant (no suffix).
    { index: 2, role: 'Crew',       turretClass: 'BP_LAV_C6_Manned_Turret_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_LAV_C6_C': [
      { name: 'C6 CROWS',             class: 'BP_CROWS_C6_LAV',         mags: 1,  magSize: 750, type: 'mg',    caliber: '7.62mm' },
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_Nanuk_C6',  mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_LAV_C6_Manned_Turret_C': [
      { name: 'C6A1 FLEX',            class: 'BP_C6_LAV_Manned_Turret',  mags: 10, magSize: 250, type: 'mg',    caliber: '7.62mm' },
    ],
  },
};

// LAV III M2 RWS . CAF — BP_LAV_RWS_M2_Desert_C (M2A1 Browning .50cal CROWS instead of C6)
// NOTE: extractor cross-wires the spurious BP_BMD1M_Bow_PKT / BP_BTRD_Bowgun_L_C pair; excluded here.
VEHICLE_LOADOUTS['BP_LAV_RWS_M2_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',     turretClass: null },
    { index: 1, role: 'Gunner',     turretClass: 'BP_CROWS_Nanuk_Desert_C' },
    { index: 2, role: 'Crew',       turretClass: 'BP_LAV_C6_Manned_Turret_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Nanuk_Desert_C': [
      { name: 'M2A1 Browning CROWS',  class: 'BP_CROWS_M2_Nanuk_Desert',       mags: 1,  magSize: 400, type: 'kinetic', caliber: '.50cal' },
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_Nanuk_M2_Desert', mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_LAV_C6_Manned_Turret_C': [
      { name: 'C6A1 FLEX',            class: 'BP_C6_LAV_Manned_Turret',        mags: 10, magSize: 250, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// LAV III M2 RWS . CAF — BP_LAV_RWS_M2_C (base variant; sub-classes drop _Desert,
// manned C6 FLEX pintle shared with all LAV variants)
VEHICLE_LOADOUTS['BP_LAV_RWS_M2_C'] = {
  seats: [
    { index: 0, role: 'Driver',     turretClass: null },
    { index: 1, role: 'Gunner',     turretClass: 'BP_CROWS_Nanuk_C' },
    { index: 2, role: 'Crew',       turretClass: 'BP_LAV_C6_Manned_Turret_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Nanuk_C': [
      { name: 'M2A1 Browning CROWS',  class: 'BP_CROWS_M2_Nanuk',              mags: 1,  magSize: 400, type: 'kinetic', caliber: '.50cal' },
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_Nanuk_M2',        mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_LAV_C6_Manned_Turret_C': [
      { name: 'C6A1 FLEX',            class: 'BP_C6_LAV_Manned_Turret',        mags: 10, magSize: 250, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// M1126 CROWS M2 . USA — BP_M1126_C (base) and BP_M1126_Woodland_C (woodland).
// Both variants share the same turret class BP_M1126_CROWS_Turret_C (no variant suffix
// on turret/weapons), so the two loadouts are identical in content.
// Seats: Driver + Turret (CROWS M2) + 9 passengers = 11 total.
VEHICLE_LOADOUTS['BP_M1126_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_M1126_CROWS_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1126_CROWS_Turret_C': [
      { name: 'M2A1 Browning CROWS',  class: 'BP_M1126_CROWS_M2',       mags: 1, magSize: 400, type: 'kinetic', caliber: '.50cal' },
      { name: '40mm Smoke Launchers', class: 'BP_M1126_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_M1126_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_M1126_CROWS_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1126_CROWS_Turret_C': [
      { name: 'M2A1 Browning CROWS',  class: 'BP_M1126_CROWS_M2',       mags: 1, magSize: 400, type: 'kinetic', caliber: '.50cal' },
      { name: '40mm Smoke Launchers', class: 'BP_M1126_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// M1126 CROWS M240 . USA — BP_M1126_M240_C (base) and BP_M1126_M240_Woodland_C.
// Same chassis as M1126 CROWS M2 but swaps the .50cal CROWS for an M240B CROWS.
// Both variants share the same turret class BP_M1126_CROWS_M240_Turret_C (no camo suffix).
VEHICLE_LOADOUTS['BP_M1126_M240_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_M1126_CROWS_M240_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1126_CROWS_M240_Turret_C': [
      { name: 'M240B CROWS',          class: 'BP_M1126_CROWS_M240',          mags: 1, magSize: 750, type: 'mg',    caliber: '7.62mm' },
      { name: '40mm Smoke Launchers', class: 'BP_M1126_M240_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_M1126_M240_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_M1126_CROWS_M240_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1126_CROWS_M240_Turret_C': [
      { name: 'M240B CROWS',          class: 'BP_M1126_CROWS_M240',          mags: 1, magSize: 750, type: 'mg',    caliber: '7.62mm' },
      { name: '40mm Smoke Launchers', class: 'BP_M1126_M240_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// PARS III M2 RWS . TLF — BP_PARS3_M2_C (base/woodland) and BP_PARS3_M2_Desert_C.
// Sancak RWS carrying M2HB .50cal. Seats: Driver + Turret + 12 passengers = 14 total.
// NOTE: Driver smoke launcher (BP_Smoke_Launcher_PARS3_Driver) — same class across
// both camo variants (no _Desert suffix), attached to the driver seat not the turret.
VEHICLE_LOADOUTS['BP_PARS3_M2_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_SancakRWS_M2_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_SancakRWS_M2_Turret_C': [
      { name: 'RWS M2HB',             class: 'BP_SancakRWS_M2',               mags: 1, magSize: 800, type: 'kinetic', caliber: '.50cal' },
      // Driver-mounted smoke launcher — shared class across both camo variants.
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_PARS3_Driver', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_PARS3_M2_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_SancakRWS_M2_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_SancakRWS_M2_Turret_Desert_C': [
      { name: 'RWS M2HB',             class: 'BP_SancakRWS_M2_Desert',        mags: 1, magSize: 800, type: 'kinetic', caliber: '.50cal' },
      // Driver smoke launcher class has no _Desert suffix — shared with base variant.
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_PARS3_Driver', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// PARS III MG3 RWS . TLF — BP_PARS3_MG3_C (base/woodland) and BP_PARS3_MG3_Desert_C.
// Same chassis as PARS III M2 RWS; swaps the M2HB for an MG3 (7.62mm, high RoF).
// Driver smoke launcher (BP_Smoke_Launcher_PARS3_Driver) shared across variants.
VEHICLE_LOADOUTS['BP_PARS3_MG3_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_SancakRWS_MG3_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_SancakRWS_MG3_Turret_C': [
      { name: 'RWS MG3',              class: 'BP_SancakRWS_MG3',              mags: 1, magSize: 1500, type: 'mg',    caliber: '7.62mm' },
      // Driver-mounted smoke launcher — shared class across both camo variants.
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_PARS3_Driver', mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_PARS3_MG3_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_SancakRWS_MG3_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_SancakRWS_MG3_Turret_Desert_C': [
      { name: 'RWS MG3',              class: 'BP_SancakRWS_MG3_Desert',       mags: 1, magSize: 1500, type: 'mg',    caliber: '7.62mm' },
      // Driver smoke launcher class has no _Desert suffix — shared with base variant.
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_PARS3_Driver', mags: 1, magSize: 2,    type: 'smoke' },
    ],
  },
};

// PARS III Mk19 RWS . TLF — BP_PARS3_MK19_C (base/woodland) and BP_PARS3_MK19_Desert_C.
// Same chassis as PARS III M2/MG3 RWS; carries a Mk19 40mm automatic grenade launcher.
// NOTE: base variant has magSize 120 while desert variant has magSize 96 — this is
// recorded as observed in the game data, not a transcription error.
VEHICLE_LOADOUTS['BP_PARS3_MK19_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_SancakRWS_MK19_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_SancakRWS_MK19_Turret_C': [
      // Mk19 AGL: HEAT-category 40mm grenades (fits existing 'heat' type convention).
      { name: 'RWS MK19',             class: 'BP_SancakRWS_MK19',             mags: 1, magSize: 120, type: 'heat',  caliber: '40mm' },
      // Driver-mounted smoke launcher — shared class across both camo variants.
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_PARS3_Driver', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_PARS3_MK19_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_SancakRWS_MK19_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_SancakRWS_MK19_Turret_Desert_C': [
      // Desert variant magSize 96 (differs from base 120) — intentional per game data.
      { name: 'RWS MK19',             class: 'BP_SancakRWS_MK19_Desert',      mags: 1, magSize: 96,  type: 'heat',  caliber: '40mm' },
      // Driver smoke launcher class has no _Desert suffix — shared with base variant.
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_PARS3_Driver', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// ZSL10 QJZ-89 — PLANMC naval & PLAAGF/PLA desert. Wheeled APC carrying a QJZ-89
// 12.7mm cupola HMG. Seats: Driver + Turret + 7 passengers = 9 total.
// NOTE: className contains a literal hyphen ('QJZ-89'). VEHICLE_LOADOUTS / CATEGORIES /
// DISPLAY_NAMES / ICON_OVERRIDES all key on the raw class name so the hyphen is
// preserved. The keyword router normalizes (lowercase + strip hyphens) so 'zsl10'
// still matches.
VEHICLE_LOADOUTS['BP_ZSL10_QJZ-89_Naval_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_Cupola_QJZ89_Turret_Naval_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Cupola_QJZ89_Turret_Naval_C': [
      { name: 'QJZ-89 HMG', class: 'BP_Cupola_QJZ89_Naval', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_ZSL10_QJZ-89_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_Cupola_QJZ89_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Cupola_QJZ89_Turret_Desert_C': [
      // Desert weapon class drops any suffix — just 'BP_Cupola_QJZ89' (not _Desert).
      { name: 'QJZ-89 HMG', class: 'BP_Cupola_QJZ89', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSL10 QJZ-89 base (woodland/green) — PLAAGF & PLA. Shares the cupola turret class
// with the desert variant's WEAPON (BP_Cupola_QJZ89), but has its own turret-mount
// class BP_Cupola_QJZ89_Turret_C (no _Desert / _Naval suffix).
VEHICLE_LOADOUTS['BP_ZSL10_QJZ-89_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_Cupola_QJZ89_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Cupola_QJZ89_Turret_C': [
      { name: 'QJZ-89 HMG', class: 'BP_Cupola_QJZ89', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSL92A APC QJZ-89 (PLAAGF / PLA) — BP class uses the industrial designation
// WZ551B (distinct from WZ551A, which is the 25mm ZSL92 IFV). Wheeled APC with
// a single QJZ-89 12.7mm HMG cupola turret, 2 + 9 passenger seats. Desert camo.
VEHICLE_LOADOUTS['BP_WZ551B_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZSD_QJZ89_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_ZSD_QJZ89_Turret_Desert_C': [
      { name: 'QJZ-89 HMG', class: 'BP_ZSD_QJZ89_Desert', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSL92A APC QJZ-89 (PLA / PLAAGF) — base variant (no camo suffix).
VEHICLE_LOADOUTS['BP_WZ551B_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_ZSD_QJZ89_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_ZSD_QJZ89_Turret_C': [
      { name: 'QJZ-89 HMG', class: 'BP_ZSD_QJZ89', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSL92A APC QLZ-87 (PLA / PLAAGF) — BP class BP_WZ551B_QLZ-87_Desert_C. Same
// WZ551B wheeled APC chassis as the QJZ-89 variant, but fitted with an
// open-top QLZ-87 35mm AGL (HEDP, HEAT damage type) instead of the HMG cupola.
// Turret class is camo-agnostic (no _Desert suffix on turret).
VEHICLE_LOADOUTS['BP_WZ551B_QLZ-87_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QLZ87_WZ551_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_QLZ87_WZ551_OpenTop_Turret_C': [
      // QLZ-87 HEDP 35mm AGL: HEAT damage with 80mm armor pen.
      { name: 'QLZ-87 AGL (HEDP)', class: 'BP_QLZ87_Weapon_WZ551', mags: 15, magSize: 15, type: 'heat', caliber: '35mm' },
    ],
  },
};

// ZSL92A APC QLZ-87 (PLAAGF / PLA) — base variant (no camo suffix).
VEHICLE_LOADOUTS['BP_WZ551B_QLZ-87_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QLZ87_WZ551_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_QLZ87_WZ551_OpenTop_Turret_C': [
      { name: 'QLZ-87 AGL (HEDP)', class: 'BP_QLZ87_Weapon_WZ551', mags: 15, magSize: 15, type: 'heat', caliber: '35mm' },
    ],
  },
};

// AAVP-7A1 (USMC) — amphibious tracked APC with a manned turret mounting both
// an MK19 40mm AGL and an M2A1 Browning HMG, plus 4-shot 40mm smoke launchers.
// 2 + 10 passengers = 12 seats. Base/desert variant.
VEHICLE_LOADOUTS['BP_AAVP7A1_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_AAVP7A1_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_AAVP7A1_Turret_C': [
      { name: 'M2A1 Browning',         class: 'BP_AAVP7A1_M2',          mags: 5, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
      { name: 'MK19 AGL (HEDP)',       class: 'BP_AAVP7A1_MK19',        mags: 6, magSize: 32,  type: 'heat',    caliber: '40mm' },
      { name: '40mm Smoke Launchers',  class: 'Smoke_Launcher_AAVP7A1', mags: 1, magSize: 4,   type: 'smoke' },
    ],
  },
};

// AAVC-7A1 Logistics (USMC) — unarmed logi variant, driver smoke only.
VEHICLE_LOADOUTS['BP_AAVP7A1_Logi_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
  },
};
// AAVC-7A1 Logistics (USMC) — woodland variant, driver smoke only.
VEHICLE_LOADOUTS['BP_AAVP7A1_Woodland_Logi_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Passenger', turretClass: null },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
  },
};
// BTR-DG Logistics (VDV) — driver smoke + 40mm smoke launchers. 1 + 2 seats.
VEHICLE_LOADOUTS['BP_BTR-DG_Logistics_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};
// BTR-DG Logistics (VDV) — desert variant, identical weapons to base.
VEHICLE_LOADOUTS['BP_BTR-DG_Logistics_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};
// M113A2 Logistics (TLF) — driver smoke + 40mm smoke launchers. 1 + 4 seats.
VEHICLE_LOADOUTS['BP_M113A2T_Logistics_TLF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',       mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};
// M113A2 Logistics Desert (TLF) — identical weapons to base variant.
VEHICLE_LOADOUTS['BP_M113A2T_Logistics_TLF_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};
// M113A3 Logistics (USA/CAF/TLF) — driver smoke + 40mm smoke launchers. 1 + 4 seats.
VEHICLE_LOADOUTS['BP_M113A3_Logistics_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};
// M113A3 Logistics Desert (USA/CAF/TLF) — identical weapons to base variant.
VEHICLE_LOADOUTS['BP_M113A3_Logistics_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};
// AAVP-7A1 (USMC) — woodland camo variant. Sub-class weapon names carry
// _Woodland suffix; turret class is BP_AAVP7A1_Turret_Woodland_C.
VEHICLE_LOADOUTS['BP_AAVP7A1_Woodland_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_AAVP7A1_Turret_Woodland_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_AAVP7A1_Turret_Woodland_C': [
      { name: 'M2A1 Browning',         class: 'BP_AAVP7A1_M2_Woodland',          mags: 5, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
      { name: 'MK19 AGL (HEDP)',       class: 'BP_AAVP7A1_MK19_Woodland',        mags: 6, magSize: 32,  type: 'heat',    caliber: '40mm' },
      { name: '40mm Smoke Launchers',  class: 'Smoke_Launcher_AAVP7A1_Woodland', mags: 1, magSize: 4,   type: 'smoke' },
    ],
  },
};

// ACV-15 M2 (TLF) — Turkish tracked APC variant of the FNSS ACV-15 family
// (M113-derived hull). Unlike the 25mm Bushmaster IFV variant, this one has
// an open-top cupola with a single M2A1 Browning HMG. Driver gets front
// smoke launchers. Base/woodland variant.
VEHICLE_LOADOUTS['BP_ACV-15_M2_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ACV15_OpenTurret_M2_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ACV15_Driver_Front', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ACV-15 M2 (TLF) — desert camo variant. Turret class gets _Desert suffix,
// but the M2 weapon class is shared across both variants.
VEHICLE_LOADOUTS['BP_ACV-15_M2_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ACV15_OpenTurret_M2_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ACV15_Driver_Front', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_M2_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ACV-15 MG3 (TLF) — same ACV-15 APC chassis as the M2 variant, but with a
// single MG3 7.62mm GPMG in the open-top cupola instead of the M2 Browning.
// Base/woodland variant.
VEHICLE_LOADOUTS['BP_ACV-15_MG3_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ACV15_OpenTurret_MG3_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ACV15_Driver_Front', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_MG3_Turret_C': [
      { name: 'MG3', class: 'BP_ACV15_OpenTurret_MG3_Weapon', mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// ACV-15 MG3 (TLF) — desert camo variant. Turret class gets _Desert suffix;
// MG3 weapon class is shared across both camo variants.
VEHICLE_LOADOUTS['BP_ACV-15_MG3_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ACV15_OpenTurret_MG3_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ACV15_Driver_Front', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_MG3_Turret_Desert_C': [
      { name: 'MG3', class: 'BP_ACV15_OpenTurret_MG3_Weapon', mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D (VDV) — Soviet airborne tracked APC. Unusual layout: driver plus TWO
// hull-mounted bow PKT gunners (left + right), 3 crew + 8 passengers = 11
// seats. Both bowguns share the BMD-1M PKT weapon class. Base/woodland variant.
VEHICLE_LOADOUTS['BP_BTR-D_Transport_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_C' },
    { index: 2,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_C' },
    { index: 3,  role: 'Passenger',    turretClass: null },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTRD_Bowgun_L_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D (VDV) — desert camo variant. Bowgun turret classes get _Desert suffix;
// PKT weapon class is shared across both variants.
VEHICLE_LOADOUTS['BP_BTR-D_Transport_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_Desert_C' },
    { index: 2,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_Desert_C' },
    { index: 3,  role: 'Passenger',    turretClass: null },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTRD_Bowgun_L_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D AGS-17 (VDV) — AGS-17 Plamya 30mm AGL variant of the BTR-D. Adds a
// third weapon station on top of the standard twin bow PKT setup: driver +
// AGS-17 gunner + L bowgun + R bowgun = 4 crew + 7 passengers = 11 seats.
// AGS-17 turret and bowgun classes are shared across base/desert (no _Desert
// suffix on either in the dump — the desert variant literally reuses the base
// turret assets), only the root vehicle class differs.
VEHICLE_LOADOUTS['BP_BTR-D_AGS17_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Gunner',       turretClass: 'BP_BTR-D_AGS17_Turret_C' },
    { index: 2,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_C' },
    { index: 3,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_C' },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTR-D_AGS17_Turret_C': [
      // AGS-17 Plamya 30mm AGL: HEAT damage type, 11mm armor pen.
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_OpenTurret_Weapon', mags: 10, magSize: 29, type: 'heat', caliber: '30mm' },
    ],
    'BP_BTRD_Bowgun_L_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D AGS-17 (VDV) — desert camo variant. Turret and bowgun classes do NOT
// get _Desert suffixes (shared with the base variant per the dump); only the
// vehicle class carries the _Desert discriminator.
VEHICLE_LOADOUTS['BP_BTR-D_AGS17_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Gunner',       turretClass: 'BP_BTR-D_AGS17_Turret_C' },
    { index: 2,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_C' },
    { index: 3,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_C' },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTR-D_AGS17_Turret_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_OpenTurret_Weapon', mags: 10, magSize: 29, type: 'heat', caliber: '30mm' },
    ],
    'BP_BTRD_Bowgun_L_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D Kord (VDV) — Kord 12.7mm HMG variant of the BTR-D. Same chassis and
// twin bow PKT layout as the AGS-17 variant: driver + Kord gunner + L bowgun +
// R bowgun = 4 crew + 7 passengers = 11 seats. The Kord main turret class is
// camo-agnostic (no _Desert suffix even on the desert variant), but the
// bowguns DO carry _Desert suffixes on the desert variant.
VEHICLE_LOADOUTS['BP_BTR-D_Kord_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Gunner',       turretClass: 'BP_BTR-D_Kord_Turret_C' },
    { index: 2,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_C' },
    { index: 3,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_C' },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTR-D_Kord_Turret_C': [
      { name: 'Kord', class: 'BP_Kord_BTR-D', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
    'BP_BTRD_Bowgun_L_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D Kord (VDV) — desert camo variant. Kord main turret class is shared
// with the base variant (no _Desert), but the bowgun turret classes carry the
// _Desert suffix.
VEHICLE_LOADOUTS['BP_BTR-D_Kord_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Gunner',       turretClass: 'BP_BTR-D_Kord_Turret_C' },
    { index: 2,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_Desert_C' },
    { index: 3,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_Desert_C' },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTR-D_Kord_Turret_C': [
      { name: 'Kord', class: 'BP_Kord_BTR-D', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
    'BP_BTRD_Bowgun_L_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D PKM (VDV) — PKM pintle-mount variant of the BTR-D. Same 4 crew + 7
// passenger layout (driver + PKM gunner + L bowgun + R bowgun = 11 seats).
// This variant is the cleanest of the three BTR-D dumps: both camo variants
// carry fully consistent _Desert suffixes on every turret class.
// Note: the in-game BP_PKM_BTR-D weapon ships with HMG-like penetration and
// damage values despite the PKM (7.62mm) name — encoded faithfully as 'mg'.
VEHICLE_LOADOUTS['BP_BTR-D_PKM_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Gunner',       turretClass: 'BP_BTR-D_PKM_Turret_C' },
    { index: 2,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_C' },
    { index: 3,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_C' },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTR-D_PKM_Turret_C': [
      { name: 'PKM', class: 'BP_PKM_BTR-D', mags: 10, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_L_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-D PKM (VDV) — desert camo variant. All turret classes (main + both
// bowguns) consistently carry the _Desert suffix.
VEHICLE_LOADOUTS['BP_BTR-D_PKM_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Gunner',       turretClass: 'BP_BTR-D_PKM_Turret_Desert_C' },
    { index: 2,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_Desert_C' },
    { index: 3,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_Desert_C' },
    { index: 4,  role: 'Passenger',    turretClass: null },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_BTR-D_PKM_Turret_Desert_C': [
      { name: 'PKM', class: 'BP_PKM_BTR-D', mags: 10, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_L_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-MDM (VDV) — successor to BTR-D. Single RWS main turret (Kord-pattern PKT
// on RWS mount, not a manned cupola) + single bow PKT + 12 passengers (vs BTR-D's
// twin bowguns + 7 passengers). Turret classes are camo-agnostic — both base and
// desert variants reference the SAME turret BPs. Bow PKT uses a BTR-MDM-specific
// weapon class (BP_BTRMDM_Bow_PKT), DIFFERENT from BTR-D's BP_BMD1M_Bow_PKT.
// RWS main gun BP_PK_RWS_Gun has an unusual 1×750 single-mag profile (30s reload).
VEHICLE_LOADOUTS['BP_BTRMDM_PKT_RWS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',     turretClass: null },
    { index: 1,  role: 'Gunner',     turretClass: 'BP_PK_Kord_RWS_Turret_C' },
    { index: 2,  role: 'Bow Gunner', turretClass: 'BP_BTRMDM_Bowgun_C' },
    { index: 3,  role: 'Passenger',  turretClass: null },
    { index: 4,  role: 'Passenger',  turretClass: null },
    { index: 5,  role: 'Passenger',  turretClass: null },
    { index: 6,  role: 'Passenger',  turretClass: null },
    { index: 7,  role: 'Passenger',  turretClass: null },
    { index: 8,  role: 'Passenger',  turretClass: null },
    { index: 9,  role: 'Passenger',  turretClass: null },
    { index: 10, role: 'Passenger',  turretClass: null },
    { index: 11, role: 'Passenger',  turretClass: null },
    { index: 12, role: 'Passenger',  turretClass: null },
    { index: 13, role: 'Passenger',  turretClass: null },
    { index: 14, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRMDM_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_PK_Kord_RWS_Turret_C': [
      { name: 'PKT RWS', class: 'BP_PK_RWS_Gun', mags: 1, magSize: 750, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRMDM_Bowgun_C': [
      { name: 'PKT Machine Gun', class: 'BP_BTRMDM_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// Desert camo variant shares the same turret/weapon classes (camo-agnostic).
VEHICLE_LOADOUTS['BP_BTRMDM_PKT_RWS_Desert_C'] = VEHICLE_LOADOUTS['BP_BTRMDM_PKT_RWS_C'];

// FV107 Scimitar (BAF) — CVR(T) tracked recon with 30mm Rarden autocannon.
// 3 seats: Driver + Main Gunner (FV107_Turret_C) + Commander (periscope only,
// unarmed). Main turret carries AP sabot (kinetic, 105mm pen @ 0m), HE-T
// (fragmentation), L94A1 7.62mm coax MG, and 40mm smoke launchers. Driver
// has a tracked smoke generator (not a launcher).
// NOTE: The extractor dump lists 4 spurious PKT "bow guns" attached to BTR-D
// bowgun classes (BP_BTRD_Bowgun_L_[Desert_]C). These are shared-BP artifacts
// from the extractor — the authoritative Seats section has only 3 seats on
// FV107. We ignore the spurious entries here.
VEHICLE_LOADOUTS['BP_FV107_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_FV107_Turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_FV107_Commander_C' }, // periscope only, silahsız
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_FV107_Turret_C': [
      { name: '30mm AP Sabot',   class: 'BP_Scimitar_Rarden_AP',      mags: 14, magSize: 6,   type: 'kinetic', caliber: '30mm' },
      { name: '30mm HE Tracer',  class: 'BP_Scimitar_Rarden_HE',      mags: 14, magSize: 6,   type: 'he',      caliber: '30mm' },
      { name: 'L94A1 Coax MG',   class: 'BP_Scimitar_762',            mags: 15, magSize: 200, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers', class: 'BP_Scimitar_Smoke_Launcher', mags: 1, magSize: 2, type: 'smoke' },
    ],
  },
};
// Woodland variant — main turret class and all Rarden/coax/smoke weapon
// classes carry the _Woodland suffix. Commander periscope is camo-agnostic
// (same BP_FV107_Commander_C on both variants per dump).
VEHICLE_LOADOUTS['BP_FV107_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_FV107_Turret_Woodland_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_FV107_Commander_C' }, // shared periscope class
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_FV107_Turret_Woodland_C': [
      { name: '30mm AP Sabot',   class: 'BP_Scimitar_Rarden_AP_Woodland',      mags: 14, magSize: 6,   type: 'kinetic', caliber: '30mm' },
      { name: '30mm HE Tracer',  class: 'BP_Scimitar_Rarden_HE_Woodland',      mags: 14, magSize: 6,   type: 'he',      caliber: '30mm' },
      { name: 'L94A1 Coax MG',   class: 'BP_Scimitar_762_Woodland',            mags: 15, magSize: 200, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers', class: 'BP_Scimitar_Smoke_Launcher_Woodland', mags: 1, magSize: 2, type: 'smoke' },
    ],
  },
};

// FV432 L11A1 (BAF) — tracked APC with M2A1 Browning HMG cupola (L11A1 is the
// British designation for M2 Browning). 11 seats: Driver + Gunner + 9 passengers.
// NOTE: the woodland variant uses unusual class casing — vehicle class is
// BP_FV432_woodland_C (lowercase 'w'), turret class is
// BP_M2A1Browning_FV432_turret_woodland_C (uppercase M2A1 but lowercase
// 'turret' and 'woodland'), weapon class is BP_M2a1Browning_FV432_woodland
// (lowercase 'a'). Encoded literally from the dump.
VEHICLE_LOADOUTS['BP_FV432_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M2a1Browning_FV432_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_M2a1Browning_FV432_Turret_C': [
      { name: 'L11A1 (M2A1 Browning)', class: 'BP_M2a1Browning_FV432', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
VEHICLE_LOADOUTS['BP_FV432_woodland_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M2A1Browning_FV432_turret_woodland_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_M2A1Browning_FV432_turret_woodland_C': [
      { name: 'L11A1 (M2A1 Browning)', class: 'BP_M2a1Browning_FV432_woodland', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// FV432 L11A1 RWS (BAF) — RWS variant of the FV432 M2 APC. 11 seats: Driver +
// Gunner (RWS operator, Heavy Vehicle kit, Health 300) + 9 passengers.
// NOTE: The extractor dump for this variant is INCOMPLETE — it lists only the
// driver smoke generator and gives the gunner seat as unnamed "Seat 2" with no
// turret BP class and no attached weapons. Seat 1's turretClass is left null
// until the RWS turret/weapon classes are identified from a complete dump.
// Icon routing via the 'fv432' keyword → tracked APC split render is unaffected.
VEHICLE_LOADOUTS['BP_FV432_M2_RWS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: null }, // RWS — turret BP class unknown (dump incomplete)
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
  },
};
// Woodland variant shares the same (incomplete) layout; both reference the same loadout.
VEHICLE_LOADOUTS['BP_FV432_M2_RWS_Woodland_C'] = VEHICLE_LOADOUTS['BP_FV432_M2_RWS_C'];

// FV432 L37A2 RWS (BAF) — L37A2 GPMG RWS variant. Dump lists 1 crew (Driver,
// Light Vehicle kit) + 10 passengers = 11 seats total.
// NOTE: Like the L11A1 M2 RWS variant, this dump is INCOMPLETE — the extractor
// shows ONLY the driver smoke generator and no gunner seat or RWS turret class
// in the Seats section (just "Driver" followed by "+ 10 additional passenger
// seats"). If the in-game vehicle has a functioning L37A2 RWS, its turret and
// weapon classes are unknown from this dump. Encoded literally (11 seats, only
// driver armed) — RWS data can be added when a complete dump is available.
VEHICLE_LOADOUTS['BP_FV432_L37A2_RWS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Passenger', turretClass: null },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
  },
};
VEHICLE_LOADOUTS['BP_FV432_L37A2_RWS_Woodland_C'] = VEHICLE_LOADOUTS['BP_FV432_L37A2_RWS_C'];

// M113A2T M2 (TLF) — Turkish Land Forces M113A2T tracked APC with M2 HMG
// open-turret. 13 seats total (2 + 11): Driver + Gunner + 11 passengers.
// Turret + weapon classes are SHARED with the ACV-15 M2 variant (same
// BP_ACV15_OpenTurret_M2_* assets) — a common pattern for TLF tracked APCs.
// Driver has BOTH a tracked smoke generator AND a separate 40mm smoke launcher
// (BP_Smoke_Launcher_Tigr_Driver, shared with the Tigr wheeled family).
VEHICLE_LOADOUTS['BP_M113A2T_M2_TLF_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ACV15_OpenTurret_M2_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// M113A2T M2 (TLF) — desert camo variant. Turret class carries the _Desert suffix
// (BP_ACV15_OpenTurret_M2_Turret_Desert_C), but the M2 weapon class is camo-agnostic
// (shared with the base TLF variant).
VEHICLE_LOADOUTS['BP_M113A2T_M2_TLF_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ACV15_OpenTurret_M2_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_M2_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// M113A2T Mk19 (TLF) — Turkish Land Forces M113A2T with Mk19 40mm AGL open-turret.
// Uses a TLF-specific turret class (BP_M113A2T_TLF_OpenTurret_Mk19_Turret_C) with
// the generic open-turret Mk19 weapon (BP_Mk19_OpenTurret_Weapon, HEAT damage type,
// 12mm pen, 40mm grenade). 13 seats: Driver + Gunner + 11 passengers. Only one
// camo variant supplied in the dump.
VEHICLE_LOADOUTS['BP_M113A2T_MK19_TLF_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A2T_TLF_OpenTurret_Mk19_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A2T_TLF_OpenTurret_Mk19_Turret_C': [
      { name: 'Mk19 AGL', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'heat', caliber: '40mm' },
    ],
  },
};

// M113A2T Mk19 (TLF) — desert camo variant. NOTE the unusual turret class
// naming: _Desert_ is inserted BETWEEN the TLF and OpenTurret tokens
// (BP_M113A2T_TLF_Desert_OpenTurret_Mk19_Turret_C), not appended at the end.
// The Mk19 weapon class is camo-agnostic (shared with the base TLF variant).
VEHICLE_LOADOUTS['BP_M113A2T_MK19_TLF_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A2T_TLF_Desert_OpenTurret_Mk19_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A2T_TLF_Desert_OpenTurret_Mk19_Turret_C': [
      { name: 'Mk19 AGL', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'heat', caliber: '40mm' },
    ],
  },
};

// M113A3 M2 (CRF) — Canadian M113A3 with M2 HMG open-turret. Uses a CRF-specific
// turret class (BP_M113A3_OpenTurret_M2_Turret_C) but shares the generic
// BP_ACV15_OpenTurret_M2_Weapon asset with the TLF M113A2T M2 variant.
// 13 seats (2 + 11): Driver + Gunner + 11 passengers.
VEHICLE_LOADOUTS['BP_M113A3_M2_CRF_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A3_OpenTurret_M2_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// M113A3 C6 (CAF) — Canadian M113A3 with C6A1 FLEX 7.62mm MG turret. Reuses the
// LUVW turret+weapon BP assets (BP_LUVW_Turret_C6_Desert_C + BP_C6_LUVW_Desert).
// Seat count differs from the M2 variant: 11 seats (2 + 9) vs 13 for M2.
// Driver has ONLY a tracked smoke generator — no 40mm smoke launcher on this
// variant (dump confirms 2 weapons total, not 3 like the M2 variants).
VEHICLE_LOADOUTS['BP_M113A3_CAF_C6_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_LUVW_Turret_C6_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_LUVW_Turret_C6_Desert_C': [
      { name: 'C6A1 FLEX', class: 'BP_C6_LUVW_Desert', mags: 10, magSize: 220, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// M113A3 C6 (CAF) — base/woodland camo variant. LUVW turret+weapon classes
// drop the _Desert suffix. Only 2 weapons (no Tigr 40mm smoke launcher on
// this variant either — dump is consistent with the desert variant).
VEHICLE_LOADOUTS['BP_M113A3_CAF_C6_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_LUVW_Turret_C6_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_LUVW_Turret_C6_C': [
      { name: 'C6A1 FLEX', class: 'BP_C6_LUVW', mags: 10, magSize: 220, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// M113A3 M2 (WPMC) — private military contractor M113A3 in black camo.
// Turret class carries the _Black camo suffix (BP_M113A3_OpenTurret_M2_Turret_Black_C)
// and uses a DIFFERENT weapon class than the CRF/TLF M113 variants: it shares
// the Humvee M1151 .50cal class (BP_50Cal_M1151_Black) rather than the ACV-15
// open-turret weapon. 13 seats (2 + 11).
VEHICLE_LOADOUTS['BP_M113A3_WPMC_M2_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A3_OpenTurret_M2_Turret_Black_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_M2_Turret_Black_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151_Black', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M113A3 MSV (WPMC) — unarmed MSV, driver has tracked smoke + 40mm smoke launchers. 1 + 4 seats.
VEHICLE_LOADOUTS['BP_M113A3_MSV_WPMC_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};

// M113A3 M2 (USA) — US Army desert camo variant. 13 seats (2 + 11): Driver +
// Gunner + 11 passengers. Turret shared with the _Cage variant (same BP),
// weapon class is BP_50Cal_M1151 (no _Black suffix — that's the WPMC asset).
VEHICLE_LOADOUTS['BP_M113A3_M2_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A3_OpenTurret_M2_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_M2_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Slat-armor "Cage" variant shares the identical turret+weapon loadout.
VEHICLE_LOADOUTS['BP_M113A3_M2_Desert_Cage_C'] = VEHICLE_LOADOUTS['BP_M113A3_M2_Desert_C'];

// M113A3 M2 (USA base/woodland) — same CRF turret class
// (BP_M113A3_OpenTurret_M2_Turret_C) and ACV-15 weapon
// (BP_ACV15_OpenTurret_M2_Weapon) as the CRF variant. 13 seats (2 + 11).
// Driver gets both tracked smoke generator and the Tigr 40mm smoke launcher.
VEHICLE_LOADOUTS['BP_M113A3_M2_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A3_OpenTurret_M2_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// M113A3 M2 (CAF) — Canadian M2 variant using the shared LUVW manned turret BP
// (BP_LUVW_Turret_Desert_C) with the LUVW .50cal weapon (BP_50Cal_LUVW_Desert).
// 11 seats (2 + 9), like the other CAF M113A3 variants. Only tracked smoke
// on the driver — no Tigr 40mm launcher.
VEHICLE_LOADOUTS['BP_M113A3_CAF_M2_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_LUVW_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_LUVW_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_LUVW_Desert', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// M113A3 M2 (CAF base/woodland) — non-desert LUVW manned turret pair
// (BP_LUVW_Turret_C + BP_50Cal_LUVW). 11 seats (2 + 9). Only tracked smoke
// on the driver — no Tigr 40mm launcher.
VEHICLE_LOADOUTS['BP_M113A3_CAF_M2_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_LUVW_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_LUVW_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_LUVW', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// M113A3 Mk19 (USA) — desert camo with the Mk19 40mm automatic grenade
// launcher open turret (BP_M113A3_OpenTurret_Mk19_Turret_Desert_C). Weapon
// class BP_Mk19_OpenTurret_Weapon — HEAT damage type, 40mm caliber.
// 13 seats (2 + 11), driver has both tracked smoke + Tigr 40mm launcher.
VEHICLE_LOADOUTS['BP_M113A3_MK19_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A3_OpenTurret_Mk19_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_Mk19_Turret_Desert_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'heat', caliber: '40mm' },
    ],
  },
};

// Slat-armor "Cage" desert Mk19 shares the identical turret+weapon loadout
// (same BP_M113A3_OpenTurret_Mk19_Turret_Desert_C asset).
VEHICLE_LOADOUTS['BP_M113A3_MK19_Desert_Cage_C'] = VEHICLE_LOADOUTS['BP_M113A3_MK19_Desert_C'];

// M113A3 Mk19 (USA base/woodland) — non-desert Mk19 open turret
// (BP_M113A3_OpenTurret_Mk19_Turret_C). Same BP_Mk19_OpenTurret_Weapon class
// as the desert variant. 13 seats, driver has tracked smoke + Tigr 40mm.
VEHICLE_LOADOUTS['BP_M113A3_MK19_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_M113A3_OpenTurret_Mk19_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_Mk19_Turret_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'heat', caliber: '40mm' },
    ],
  },
};

// M113A3 TLAV (CAF) — enclosed Cadillac Gage-style turret replacing the
// open cupola. Main armament is M2A1 Browning with a coax C6 7.62mm. Unlike
// the open-turret M2/Mk19 variants, the 40mm smoke launchers are mounted on
// the TURRET (not the driver). 11 seats (2 + 9). Turret is armored
// (health 600, 25% repair limit). Desert asset pair.
VEHICLE_LOADOUTS['BP_M113A3_CAF_TLAV_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_TLAV_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_TLAV_Turret_Desert_C': [
      { name: 'M2A1 Browning',          class: 'BP_TLAV_M2_Desert',        mags: 5, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
      { name: 'C6 Coaxial Machine Gun', class: 'BP_TLAV_M240_Desert',      mags: 5, magSize: 220, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',   class: 'Smoke_Launcher_TLAV_Desert', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};

// M113A3 TLAV (CAF base/woodland) — non-desert asset pair: BP_TLAV_Turret_C +
// BP_TLAV_M2 / BP_TLAV_M240 / Smoke_Launcher_TLAV. Same seating layout and
// weapon stats as the desert variant.
VEHICLE_LOADOUTS['BP_M113A3_CAF_TLAV_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_TLAV_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_TLAV_Turret_C': [
      { name: 'M2A1 Browning',          class: 'BP_TLAV_M2',          mags: 5, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
      { name: 'C6 Coaxial Machine Gun', class: 'BP_TLAV_M240',        mags: 5, magSize: 220, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',   class: 'Smoke_Launcher_TLAV', mags: 1, magSize: 2,  type: 'smoke' },
    ],
  },
};

// MT-LB PKT (MEI) — Middle Eastern Insurgent PKT-armed MT-LB. 18 seats
// (2 + 16). Turret is a small PKT coax in a lightly armored cupola
// (health 300, 25% repair limit). Driver has only tracked smoke.
VEHICLE_LOADOUTS['BP_MTLB_INS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// MT-LB PKT (RGF) — Russian Ground Forces woodland-camo variant with
// RUS-suffixed turret/weapon assets (BP_MTLB_turret_PKT_RUS_Woodland_C +
// BP_MTLB_PKT_RUS_Woodland). Same seating and stats as the MEI variant.
VEHICLE_LOADOUTS['BP_MTLB_RGF_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_RUS_Woodland_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_RUS_Woodland_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_RUS_Woodland', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// MT-LB PKT (RGF desert "LowAmmo") — reduced ammo variant with only 2
// magazines of PKT. Asset class carries the _LowAmmo suffix on both the
// turret and the weapon. 18 seats (2 + 16).
VEHICLE_LOADOUTS['BP_MTLB_RGF_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_RUS_Desert_LowAmmo_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_RUS_Desert_LowAmmo_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_RUS_Desert_LowAmmo', mags: 2, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// MT-LB Logistics (MEI) — smoke + PKT coax (5 mags). 2 + 16 seats.
VEHICLE_LOADOUTS['BP_MTLB_LOGI_INS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// MT-LB Logistics (IMF) — smoke + PKT Militia coax (5 mags). 2 + 16 seats.
VEHICLE_LOADOUTS['BP_MTLB_LOGI_IMF_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_Militia_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_Militia_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_Militia', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// MT-LB Logistics (RGF woodland) — smoke + PKT coax LowAmmo. 2 + 16 seats.
VEHICLE_LOADOUTS['BP_MTLB_LOGI_RUS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_RUS_Woodland_LowAmmo_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_RUS_Woodland_LowAmmo_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_RUS_Woodland_LowAmmo', mags: 2, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// MT-LB Logistics (RGF desert) — smoke + PKT coax LowAmmo. 2 + 16 seats.
VEHICLE_LOADOUTS['BP_MTLB_LOGI_RUS_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_RUS_Desert_LowAmmo_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_RUS_Desert_LowAmmo_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_RUS_Desert_LowAmmo', mags: 2, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// MT-LB Logistics (AFU) — smoke + PKT AFU LowAmmo coax. 2 + 16 seats.
VEHICLE_LOADOUTS['BP_MTLB_LOGI_AFU_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_AFU_LowAmmo_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_AFU_LowAmmo_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_AFU_LowAmmo', mags: 2, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// MT-LB Logistics (GFI) — smoke + PKT GFI coax. 2 + 16 seats.
VEHICLE_LOADOUTS['BP_MTLB_LOGI_GFI_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_GFI_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_GFI_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_GFI', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// MT-LB VMK (IMF) — Irregular Militia Forces variant armed with an NSVT
// 12.7mm HMG. Higher armor penetration (28mm) and damage (162@0m) than the
// PKT variants. Same 18-seat layout and 300HP turret.
VEHICLE_LOADOUTS['BP_MTLB_VMK_MIL_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_NSV_MIL_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_NSV_MIL_C': [
      { name: 'NSVT', class: 'BP_MTLB_NSV', mags: 5, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// MT-LB VMK (RGF desert) — desert-camo NSVT 12.7mm variant with the
// _Desert-suffixed asset pair (BP_MTLB_turret_NSV_Desert_C +
// BP_MTLB_NSV_Desert). 18 seats.
VEHICLE_LOADOUTS['BP_MTLB_VMK_RUS_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_NSV_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_NSV_Desert_C': [
      { name: 'NSVT', class: 'BP_MTLB_NSV_Desert', mags: 5, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// MT-LB VMK (RGF base/woodland) — reuses the IMF NSVT asset pair
// (BP_MTLB_turret_NSV_MIL_C + BP_MTLB_NSV); loadout aliased to the IMF entry.
VEHICLE_LOADOUTS['BP_MTLB_VMK_RUS_C'] = VEHICLE_LOADOUTS['BP_MTLB_VMK_MIL_C'];

// MT-LBM 6MA (RGF desert) — upgraded MT-LB with BTR-80 enclosed turret.
// Main armament is KPVT 14.5mm with a PKT 7.62mm coax and turret-mounted
// 40mm smoke launchers. 12 seats (2 + 10) — fewer passengers than the base
// MT-LB (16). Turret class drops the leading "BP_" and uses lowercase
// "turret" (MTLB_6MA_turret_Desert_C) — preserved literally.
VEHICLE_LOADOUTS['BP_MTLBM_6MA_RUS_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'MTLB_6MA_turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'MTLB_6MA_turret_Desert_C': [
      { name: 'KPVT BZT Armor-Piercing Incendiary', class: 'BP_BTR80_RUS_KPVT_Desert',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial Machine Gun',            class: 'BP_BTR80_RUS_PKT_Desert',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',               class: 'BP_BTR80_RUS_Smoke_Launcher_Desert', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// MT-LBM 6MA (RGF base/woodland) — non-desert BTR-80 turret assets.
// Turret class uses the conventional BP_-prefixed capitalized form
// (BP_MTLB_6MA_Turret_C). Same seating and stats as the desert variant.
VEHICLE_LOADOUTS['BP_MTLBM_6MA_RUS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_6MA_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_6MA_Turret_C': [
      { name: 'KPVT BZT Armor-Piercing Incendiary', class: 'BP_BTR80_RUS_KPVT',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial Machine Gun',            class: 'BP_BTR80_RUS_PKT',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: '40mm Smoke Launchers',               class: 'BP_BTR80_RUS_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// MT-LBM 6MA UB-32 (GFI) — MT-LBM 6MA fitted with a UB-32 S5 rocket pod
// alongside the BTR-80-style KPVT/PKT/smoke turret. S5 rockets: 32-round
// single magazine, 130mm armor pen, HEAT damage. 12 seats (2 + 10).
VEHICLE_LOADOUTS['BP_MTLBM_6MA_GFI_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_BTR80_UB32_GFI_turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_BTR80_UB32_GFI_turret_C': [
      { name: 'KPVT BZT Armor-Piercing Incendiary', class: 'BP_BTR80_GFI_KPVT',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
      { name: 'PKT Coaxial Machine Gun',            class: 'BP_BTR80_GFI_PKT',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: 'S5 Rockets',                         class: 'BP_KPVT_UB32',                mags: 1, magSize: 32,  type: 'heat',    caliber: '57mm' },
      { name: '40mm Smoke Launchers',               class: 'BP_BTR80_GFI_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
    ],
  },
};

// MT-LB PKT (AFU) — Ukrainian Armed Forces PKT variant. 18 seats (2 + 16).
// Turret BP_MTLB_turret_PKT_AFU_C + weapon BP_MTLB_PKT_AFU.
VEHICLE_LOADOUTS['BP_MTLB_AFU_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_AFU_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_AFU_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_AFU', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// MT-LB VMK (GFI) — Georgian Freedom Insurgents NSVT variant. Turret class
// is GFI-specific (BP_MTLB_turret_NSV_GFI_C) but the weapon class is the
// shared BP_MTLB_NSV (same asset as the IMF variant). 18 seats.
VEHICLE_LOADOUTS['BP_MTLB_VMK_GFI_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_NSV_GFI_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
    { index: 15, role: 'Passenger', turretClass: null },
    { index: 16, role: 'Passenger', turretClass: null },
    { index: 17, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_NSV_GFI_C': [
      { name: 'NSVT', class: 'BP_MTLB_NSV', mags: 5, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSD05 QJZ-89 (PLANMC) — Chinese marine corps amphibious APC with a
// QJZ-89 12.7mm cupola HMG (BP_Cupola_QJZ89_Turret_Naval_C +
// BP_Cupola_QJZ89_Naval). Class name contains a hyphen. 10 seats (2 + 8).
VEHICLE_LOADOUTS['BP_ZSD05_QJZ-89_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Cupola_QJZ89_Turret_Naval_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_Cupola_QJZ89_Turret_Naval_C': [
      { name: 'QJZ-89', class: 'BP_Cupola_QJZ89_Naval', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSD05 QJZ-89 (PLAAGF woodland) — same 10-seat ZSD05 layout using the
// non-naval turret/weapon pair (BP_Cupola_QJZ89_Turret_C + BP_Cupola_QJZ89).
VEHICLE_LOADOUTS['BP_ZSD05_QJZ-89_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Cupola_QJZ89_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_Cupola_QJZ89_Turret_C': [
      { name: 'QJZ-89', class: 'BP_Cupola_QJZ89', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSD05 Logistics (PLANMC) — smoke + QJY88 open-top turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_ZSD05_Logi_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJY88_OpenTop_Turret_Naval_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_QJY88_OpenTop_Turret_Naval_C': [
      { name: 'QJY88', class: 'BP_QJY88_CSK131_Weapon', mags: 5, magSize: 200, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// ZSD05 Logistics (PLAAGF woodland) — smoke + QJY88 open-top turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_ZSD05_Logi_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJY88_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_QJY88_OpenTop_Turret_C': [
      { name: 'QJY88', class: 'BP_QJY88_CSK131_Weapon', mags: 5, magSize: 200, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// RHIB AGS-17 (VDV / AFU / RGF) — armed RHIB with AGS-17 AGL. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_AGS17_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_AGS17_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_AGS17_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_RHIB_Weapon', mags: 10, magSize: 29, type: 'he', caliber: '30mm' },
    ],
  },
};
// RHIB DShK (AFU / MEI / IMF) — armed RHIB with DShK HMG. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_DSHK_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_DSHK_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_DSHK_C': [
      { name: 'DShK', class: 'BP_DShK_Technical_Shield', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// RHIB M134 (WPMC) — armed RHIB with GAU-17/A Minigun. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_US_M134_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_M134_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_M134_C': [
      { name: 'GAU-17/A Minigun', class: 'BP_M134_Weapon', mags: 1, magSize: 1500, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// RHIB M2 (WPMC / USMC / USA / TLF / CRF / ADF / CAF / BAF) — armed RHIB with M2A1. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_US_M2_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_M2_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_M2_C': [
      { name: 'M2A1 Browning', class: 'BP_M2_RHIB_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// RHIB M240 (USMC / USA / CRF / ADF / CAF / BAF) — armed RHIB with M240B. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_US_M240_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_M240_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_M240_C': [
      { name: 'M240B', class: 'BP_M240_RHIB_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// RHIB MG3 (TLF / GFI) — armed RHIB with MG3. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_GFI_MG3_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_MG3_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_MG3_C': [
      { name: 'MG3', class: 'BP_MG3_RHIB_Weapon', mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// RHIB Mk19 (WPMC / USMC) — armed RHIB with Mk19 GMG. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_US_Mk19_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_Mk19_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_Mk19_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_RHIB_Weapon', mags: 10, magSize: 32, type: 'he', caliber: '40mm' },
    ],
  },
};
// RHIB NSV (VDV / RGF / GFI) — armed RHIB with Kord/NSV HMG. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_RUS_NSV_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_NSV_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_NSV_C': [
      { name: 'Kord', class: 'BP_NSV_RHIB_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// RHIB PKM (AFU / MEI / IMF) — armed RHIB with PKM. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_PKM_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_PKM_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_PKM_C': [
      { name: 'PKM', class: 'BP_PKM_RHIB_Weapon', mags: 8, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// RHIB PKP (VDV / RGF) — armed RHIB with PKP. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_RUS_PKP_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_PKP_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_PKP_C': [
      { name: 'PKP', class: 'BP_PKP_RHIB_Weapon', mags: 8, magSize: 100, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// RHIB QJY88 (PLA / PLANMC / PLAAGF) — armed RHIB with QJY88 GPMG. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_QJY88_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_QJY88_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_QJY88_C': [
      { name: 'QJY88', class: 'BP_QJY88_RHIB_Weapon', mags: 5, magSize: 200, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// RHIB QJZ89 (PLA / PLANMC / PLAAGF) — armed RHIB with QJZ-89 HMG. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_RHIB_QJZ89_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_RHIB_Turret_QJZ89_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_RHIB_Turret_QJZ89_C': [
      { name: 'QJZ-89', class: 'BP_QJZ-89_RHIB_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSD89 (PLA/PLAAGF) — tracked APC with QJZ-89 cupola. Uses a different
// turret asset family than ZSD05 (BP_ZSD_QJZ89_Turret_Desert_C +
// BP_ZSD_QJZ89_Desert) and has a faster 5.9s reload (vs 8.0s on ZSD05).
// Driver carries a ZSD89-specific 40mm smoke launcher alongside tracked
// smoke. 15 seats (2 + 13).
VEHICLE_LOADOUTS['BP_ZSD89_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ZSD_QJZ89_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',         mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_ZSD_QJZ89_Turret_Desert_C': [
      { name: 'QJZ-89', class: 'BP_ZSD_QJZ89_Desert', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSD89 QJZ-89 (PLA/PLAAGF base/woodland) — non-desert asset pair
// (BP_ZSD_QJZ89_Turret_C + BP_ZSD_QJZ89). Same 15-seat layout and driver
// loadout as the desert variant.
VEHICLE_LOADOUTS['BP_ZSD89_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_ZSD_QJZ89_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',         mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_ZSD_QJZ89_Turret_C': [
      { name: 'QJZ-89', class: 'BP_ZSD_QJZ89', mags: 10, magSize: 150, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// ZSD89 QLZ-87 (PLA/PLAAGF desert) — ZSD89 chassis fitted with a QLZ-87
// 40mm AGL in an open-top turret reused from the WZ551 asset family
// (BP_QLZ87_WZ551_OpenTop_Turret_Desert_C + BP_QLZ87_Weapon_WZ551).
// HEAT damage, 80mm armor pen. 15 seats (2 + 13).
VEHICLE_LOADOUTS['BP_ZSD89_QLZ-87_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_QLZ87_WZ551_OpenTop_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',         mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_QLZ87_WZ551_OpenTop_Turret_Desert_C': [
      { name: 'QLZ-87 Automatic Grenade Launcher - HEDP', class: 'BP_QLZ87_Weapon_WZ551', mags: 15, magSize: 15, type: 'heat', caliber: '40mm' },
    ],
  },
};

// ZSD89 QLZ-87 (PLA/PLAAGF base/woodland) — non-desert turret BP
// (BP_QLZ87_WZ551_OpenTop_Turret_C) with the same shared WZ551 weapon
// class (BP_QLZ87_Weapon_WZ551). Same 15-seat layout as the desert variant.
VEHICLE_LOADOUTS['BP_ZSD89_QLZ-87_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_QLZ87_WZ551_OpenTop_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
    { index: 13, role: 'Passenger', turretClass: null },
    { index: 14, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',         mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_ZSD89_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_QLZ87_WZ551_OpenTop_Turret_C': [
      { name: 'QLZ-87 Automatic Grenade Launcher - HEDP', class: 'BP_QLZ87_Weapon_WZ551', mags: 15, magSize: 15, type: 'heat', caliber: '40mm' },
    ],
  },
};

// ---- SPAA ----
// MT-LB ZU-23 (AFU) — MT-LB chassis with the ZU-23-2 twin autocannon in a
// second turret alongside the standard MT-LB PKT coax. 13 seats (3 + 10).
// Seat 1 = PKT coax in BP_MTLB_turret_PKT_AFU_C (shared with BP_MTLB_AFU_C);
// Seat 2 = ZU-23 in BP_ZU23Vehicle_Base_C. Driver only has tracked smoke.
VEHICLE_LOADOUTS['BP_MTLB_ZU23_AFU_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_AFU_C' },
    { index: 2,  role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_AFU_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_AFU', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_ZU23Vehicle_Base_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
  },
};

// BMP-1 ZU-23-2 (IMF) — BMP-1 chassis with the 73mm turret replaced by a
// ZU-23-2 twin autocannon. Includes a commander periscope (unarmed) as a
// 3rd crew position. 11 seats (3 + 8). Seat 1 = AA gun, Seat 2 = Commander.
VEHICLE_LOADOUTS['BP_BMP1_MIL_ZU23_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_C' },
    { index: 2,  role: 'Commander', turretClass: 'BP_BMP1_Periscope_IMF_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_ZU23Vehicle_Base_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
    // Commander periscope is unarmed.
    'BP_BMP1_Periscope_IMF_C': [],
  },
};

// BMP-1 ZU-23-2 (MEI) — INS-suffixed asset pair (BP_ZU23Vehicle_Base_INS_C +
// BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS) with the MEI periscope
// (BP_BMP1_Periscope_MEI_C). Same 11-seat layout.
VEHICLE_LOADOUTS['BP_BMP1_INS_ZU23_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_INS_C' },
    { index: 2,  role: 'Commander', turretClass: 'BP_BMP1_Periscope_MEI_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_ZU23Vehicle_Base_INS_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
    'BP_BMP1_Periscope_MEI_C': [],
  },
};

// BTR-ZD (VDV base/woodland) — BTR-D airborne chassis with 4 gun positions:
// Kord 12.7mm turret, ZU-23-2 AA autocannon turret, and twin bow-mounted
// PKTs (L/R). 12 seats (5 + 7). Driver carries tracked smoke + BTRD-specific
// 40mm smoke launcher.
VEHICLE_LOADOUTS['BP_BTR-ZD_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Kord Gunner',  turretClass: 'BP_BTR-D_Kord_Turret_BTR-ZD_C' },
    { index: 2,  role: 'AA Gunner',    turretClass: 'BP_ZU23Vehicle_Base_BTR-ZD_C' },
    { index: 3,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_C' },
    { index: 4,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_C' },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
    { index: 11, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_BTR-D_Kord_Turret_BTR-ZD_C': [
      { name: 'Kord', class: 'BP_Kord_BTR-D', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
    'BP_ZU23Vehicle_Base_BTR-ZD_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
    'BP_BTRD_Bowgun_L_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// BTR-ZD (VDV desert) — reuses the non-desert Kord turret class
// (BP_BTR-D_Kord_Turret_BTR-ZD_C) but has desert-suffixed ZU-23 + bow-gun
// turret classes. ZU-23 weapon uses the _INS variant class shared with MEI
// (BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS).
VEHICLE_LOADOUTS['BP_BTR-ZD_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',       turretClass: null },
    { index: 1,  role: 'Kord Gunner',  turretClass: 'BP_BTR-D_Kord_Turret_BTR-ZD_C' },
    { index: 2,  role: 'AA Gunner',    turretClass: 'BP_ZU23Vehicle_Base_BTR-ZD_Desert_C' },
    { index: 3,  role: 'Bow Gunner L', turretClass: 'BP_BTRD_Bowgun_L_Desert_C' },
    { index: 4,  role: 'Bow Gunner R', turretClass: 'BP_BTRD_Bowgun_R_Desert_C' },
    { index: 5,  role: 'Passenger',    turretClass: null },
    { index: 6,  role: 'Passenger',    turretClass: null },
    { index: 7,  role: 'Passenger',    turretClass: null },
    { index: 8,  role: 'Passenger',    turretClass: null },
    { index: 9,  role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',    turretClass: null },
    { index: 11, role: 'Passenger',    turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_BTRD_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_BTR-D_Kord_Turret_BTR-ZD_C': [
      { name: 'Kord', class: 'BP_Kord_BTR-D', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
    'BP_ZU23Vehicle_Base_BTR-ZD_Desert_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
    'BP_BTRD_Bowgun_L_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_BTRD_Bowgun_R_Desert_C': [
      { name: 'PKT Machine Gun', class: 'BP_BMD1M_Bow_PKT', mags: 8, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// MT-LB ZU-23-2 (IMF) — Militia MT-LB with the standard PKT coax turret
// (Militia-suffixed turret/weapon classes) plus a ZU-23-2 autocannon turret.
// 13 seats (3 + 10). The extractor also lists three BTRD bow-gun entries
// referencing BP_BTRD_Bowgun_L_C / _L_Desert_C with PKT; those are artifacts
// from unused class references — authoritative seat list has only the three
// crew positions (Driver + PKT coax + ZU-23).
VEHICLE_LOADOUTS['BP_MTLB_ZU23_MIL_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_Militia_C' },
    { index: 2,  role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
    { index: 12, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_Militia_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT_Militia', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_ZU23Vehicle_Base_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
  },
};

// MT-LB ZU-23-2 (MEI) — Middle Eastern Insurgent variant. Uses the base
// BP_MTLB_turret_PKT_C + BP_MTLB_PKT pair and the INS-suffixed ZU-23 asset
// classes. 12 seats (3 + 9) — one fewer passenger than the IMF variant.
// Same extractor artifact regarding BTRD bow guns; ignored.
VEHICLE_LOADOUTS['BP_MTLB_ZU23_INS_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_MTLB_turret_PKT_C' },
    { index: 2,  role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_INS_C' },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_MTLB_turret_PKT_C': [
      { name: 'PKT Coaxial Machine Gun', class: 'BP_MTLB_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_ZU23Vehicle_Base_INS_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
  },
};

// ---- SPA (Self-Propelled Artillery) ----

// KrAZ-6322 BM-21 Grad (AFU) — KrAZ-6322 truck chassis with a 40-tube
// BM-21 Grad 122mm rocket launcher on the bed. 3 seats (2 + 1):
// Driver, Grad gunner, 1 rear passenger.
VEHICLE_LOADOUTS['BP_Kraz_6322_BM21Grad_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BM21Grad_Turret_Kraz_AFU_C' },
    { index: 2, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BM21Grad_Turret_Kraz_AFU_C': [
      { name: '9M22U 122mm Rocket', class: 'BP_BM21Grad_Weapon_AFU_Kraz', mags: 1, magSize: 40, type: 'heat', caliber: '122mm' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_BM21Grad_MEI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BM21Grad_Turret_MEI_C' },
    { index: 2, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BM21Grad_Turret_MEI_C': [
      { name: '9M22U 122mm Rocket', class: 'BP_BM21Grad_Weapon_MEI', mags: 1, magSize: 40, type: 'heat', caliber: '122mm' },
    ],
  },
};

// BM-21 Grad — IMF (Irregular Militia Forces, Insurgent) variant.
// rules: Catalog (vehicle_weapons_static.json) carries BP_BM21Grad_Weapon_IMF
// + matching display-names entry BP_BM21Grad_IMF_C; loadout was missing so
// the vehicle panel rendered 0 seats / no weapon when an IMF Grad spawned
// (operator report May 2026). Turret class name follows the MEI naming
// pattern — if Squad uses a different suffix on Linux (e.g. Kraz_IMF),
// the panel will fall through to the live-class-name fallback (vehicle-
// panel.js line ~449), which is still better than the previous silent
// nothing. Mirrors MEI for seat layout (driver + gunner + passenger).
VEHICLE_LOADOUTS['BP_BM21Grad_IMF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BM21Grad_Turret_IMF_C' },
    { index: 2, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BM21Grad_Turret_IMF_C': [
      { name: '9M22U 122mm Rocket', class: 'BP_BM21Grad_Weapon_IMF', mags: 1, magSize: 40, type: 'heat', caliber: '122mm' },
    ],
  },
};

// M1064A3 M121 (USA, desert) — M113-family tracked APC with an M121 120mm
// mortar turret plus an M2 Browning open turret. 3 seats: Driver, M2 gunner,
// Mortar gunner. Driver carries tracked smoke + Tigr-asset 40mm smoke
// launchers (shared asset). M2 turret uses desert-suffixed turret class and
// the M1151-shared 50Cal weapon class.
VEHICLE_LOADOUTS['BP_M1064A3_M121_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',         turretClass: null },
    { index: 1, role: 'M2 Gunner',      turretClass: 'BP_M113A3_OpenTurret_M2_Turret_Desert_C' },
    { index: 2, role: 'Mortar Gunner',  turretClass: 'BP_M1064A3_MortarTurret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_M2_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151', mags: 10, magSize: 100, type: 'mg', caliber: '12.7mm' },
    ],
    'BP_M1064A3_MortarTurret_C': [
      { name: 'M929 120mm White Smoke',                 class: 'BP_M1064A3_M121mortar_Smoke',    mags: 1, magSize: 15, type: 'smoke', caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Near-Surface', class: 'BP_M1064A3_M121mortar_Airburst', mags: 1, magSize: 15, type: 'he',    caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Impact',     class: 'BP_M1064A3_M121mortar',          mags: 1, magSize: 30, type: 'he',    caliber: '120mm' },
    ],
  },
};

// M1064A3 M121 (USA, woodland) — same layout as the desert variant but uses
// the non-Desert M2 open-turret class and the ACV15 open-turret M2 weapon
// class (shared with the M113A3 M2 woodland variant).
VEHICLE_LOADOUTS['BP_M1064A3_M121_C'] = {
  seats: [
    { index: 0, role: 'Driver',         turretClass: null },
    { index: 1, role: 'M2 Gunner',      turretClass: 'BP_M113A3_OpenTurret_M2_Turret_C' },
    { index: 2, role: 'Mortar Gunner',  turretClass: 'BP_M1064A3_MortarTurret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_M113A3_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'mg', caliber: '12.7mm' },
    ],
    'BP_M1064A3_MortarTurret_C': [
      { name: 'M929 120mm White Smoke',                 class: 'BP_M1064A3_M121mortar_Smoke',    mags: 1, magSize: 15, type: 'smoke', caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Near-Surface', class: 'BP_M1064A3_M121mortar_Airburst', mags: 1, magSize: 15, type: 'he',    caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Impact',     class: 'BP_M1064A3_M121mortar',          mags: 1, magSize: 30, type: 'he',    caliber: '120mm' },
    ],
  },
};

// ---- Tank Destroyers (ATGM / SPG carriers) ----

// M1151 Light TOW (USA / USMC / ADF / CAF / BAF, desert) — open-top Humvee
// TOW carrier. Reuses the same BP_M1151_TOW_Turret_C turret class as the
// M-ATV TOW desert variant, but carries 5 rear passengers (7 seats total).
VEHICLE_LOADOUTS['BP_M1151_Light_TOW_C'] = {
  seats: [
    { index: 0, role: 'Driver',     turretClass: null },
    { index: 1, role: 'TOW Gunner', turretClass: 'BP_M1151_TOW_Turret_C' },
    { index: 2, role: 'Passenger',  turretClass: null },
    { index: 3, role: 'Passenger',  turretClass: null },
    { index: 4, role: 'Passenger',  turretClass: null },
    { index: 5, role: 'Passenger',  turretClass: null },
    { index: 6, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_M1151_TOW_Turret_C': [
      { name: 'BGM-71 TOW High Explosive Anti-Tank', class: 'BP_BGM71TOW_MATV', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// M1151 Light TOW (USA / USMC / ADF / CAF / BAF, woodland) — woodland-camo
// variant using the _Woodland suffixed turret class.
VEHICLE_LOADOUTS['BP_M1151_Light_TOW_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',     turretClass: null },
    { index: 1, role: 'TOW Gunner', turretClass: 'BP_M1151_TOW_Turret_Woodland_C' },
    { index: 2, role: 'Passenger',  turretClass: null },
    { index: 3, role: 'Passenger',  turretClass: null },
    { index: 4, role: 'Passenger',  turretClass: null },
    { index: 5, role: 'Passenger',  turretClass: null },
    { index: 6, role: 'Passenger',  turretClass: null },
  ],
  turrets: {
    'BP_M1151_TOW_Turret_Woodland_C': [
      { name: 'BGM-71 TOW High Explosive Anti-Tank', class: 'BP_BGM71TOW_MATV', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// M-ATV TOW (USA, woodland) — woodland-camo variant using the _Woodland
// suffixed turret class. Shares the base BP_BGM71TOW_MATV weapon class.
VEHICLE_LOADOUTS['BP_MATV_TOW_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'TOW Gunner',  turretClass: 'BP_M1151_TOW_Turret_Woodland_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_M1151_TOW_Turret_Woodland_C': [
      { name: 'BGM-71 TOW High Explosive Anti-Tank', class: 'BP_BGM71TOW_MATV', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// M1151 TOW (WPMC) — M1151 Humvee variant with a BGM-71 TOW turret
// (Black1-suffixed turret class). 5 seats (2 + 3). Shared TOW weapon class.
// M1151 Light TOW (CRF) — CRF-suffixed open-top variant that reuses the
// shared BP_M1151_TOW_Turret_Woodland_C turret class. Identical layout to
// the USA/USMC/ADF/CAF/BAF Light TOW woodland variant (7 seats, 2 + 5).
VEHICLE_LOADOUTS['BP_M1151_Light_TOW_Woodland_CRF_C'] = VEHICLE_LOADOUTS['BP_M1151_Light_TOW_Woodland_C'];

// M-ATV TOW (USMC) — USMC-suffixed M-ATV variants that reuse the shared
// BP_M1151_TOW_Turret_{C,Woodland_C} turret classes. Identical layout to
// the USA M-ATV TOW variants (5 seats, 2 + 3).
VEHICLE_LOADOUTS['BP_MATV_USMC_TOW_C']          = VEHICLE_LOADOUTS['BP_MATV_TOW_C'];
VEHICLE_LOADOUTS['BP_MATV_USMC_TOW_Woodland_C'] = VEHICLE_LOADOUTS['BP_MATV_TOW_Woodland_C'];

// Technical AGS-17 (MEI, unarmored) — Toyota Hilux technical with a pintle-
// mounted AGS-17 Plamya 30mm AGL (BP_Technical_Turret_AGS17_C +
// BP_AGS-17_Technical_Weapon). 5 seats (2 + 3).
VEHICLE_LOADOUTS['BP_Technical2Seater_White_AGS17_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'AGS-17 Gunner', turretClass: 'BP_Technical_Turret_AGS17_C' },
    { index: 2, role: 'Passenger',     turretClass: null },
    { index: 3, role: 'Passenger',     turretClass: null },
    { index: 4, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_AGS17_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_Technical_Weapon', mags: 10, magSize: 29, type: 'heat', caliber: '30mm' },
    ],
  },
};

// Technical AGS-17 (MEI, armored) — armored Hilux variant that reuses the
// same turret + weapon classes as the unarmored version. Identical loadout.
VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_White_AGS17_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_White_AGS17_C'];

// M1151 Technical AGS-17 (MEI) — M1151 Humvee chassis with a different
// open-top AGS-17 turret (BP_M1151_AGS17_Turret_C + BP_AGS-17_OpenTurret_Weapon).
// 5 seats (2 + 3).
VEHICLE_LOADOUTS['BP_M1151_Technical_AGS17_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'AGS-17 Gunner', turretClass: 'BP_M1151_AGS17_Turret_C' },
    { index: 2, role: 'Passenger',     turretClass: null },
    { index: 3, role: 'Passenger',     turretClass: null },
    { index: 4, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_M1151_AGS17_Turret_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_OpenTurret_Weapon', mags: 10, magSize: 29, type: 'heat', caliber: '30mm' },
    ],
  },
};

// Technical BMP-1 (MEI) — Toyota Hilux technical with a salvaged BMP-1
// turret (BP_BMP1_Turret_Technical_C). Three weapons on the turret:
// 73mm 2A28 Grom firing OG-15V HE-Frag and PG-15V HEAT rounds, plus a
// coaxial 7.62mm PKT. 5 seats (2 + 3).
VEHICLE_LOADOUTS['BP_Technical2Seater_White_BMP1_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BMP1_Turret_Technical_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BMP1_Turret_Technical_C': [
      { name: 'PKT Coaxial Machine Gun',           class: 'BP_Technical_BMP1_PKT',       mags: 4,  magSize: 250, type: 'mg',   caliber: '7.62mm' },
      { name: 'OG-15V Fragmentation',              class: 'BP_Technical_BMP1_2A28_Frag', mags: 8,  magSize: 1,   type: 'he',   caliber: '73mm' },
      { name: 'PG-15V High Explosive Anti-Tank',   class: 'BP_Technical_BMP1_2A28_HEAT', mags: 12, magSize: 1,   type: 'heat', caliber: '73mm' },
    ],
  },
};

// Technical Kornet (AFU) — Hilux technical with a pintle-mounted 9M133
// Kornet ATGM launcher (BP_Technical_Turret_Kornet_1_C + BP_Kornet_Safir_Weapon,
// shared with the Safir Kornet). 3 seats (2 + 1): Driver, Kornet gunner, 1 passenger.
VEHICLE_LOADOUTS['BP_Technical2Seater_AFU_Kornet_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'Kornet Gunner', turretClass: 'BP_Technical_Turret_Kornet_1_C' },
    { index: 2, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_Kornet_1_C': [
      { name: '9M133 Kornet High Explosive Anti-Tank', class: 'BP_Kornet_Safir_Weapon', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// Technical Kornet (IMF) — camo-scheme variant reusing the exact same turret
// and weapon classes. Identical loadout to the AFU variant.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_Kornet_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_AFU_Kornet_C'];

// Technical Kornet (MEI) — white-scheme variant reusing the exact same turret
// and weapon classes. Identical loadout to the AFU variant.
VEHICLE_LOADOUTS['BP_Technical2Seater_White_Kornet_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_AFU_Kornet_C'];

// Technical SPG-9 (IMF, armored) — armored Hilux technical with a salvaged
// 73mm SPG-9 recoilless gun (BP_Technical_Turret_SPG9_C). Two weapons on
// the turret: OG-9V HE-Fragmentation and PG-9V HEAT. 5 seats (2 + 3).
VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_SPG9_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Technical_Turret_SPG9_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_SPG9_C': [
      { name: 'SPG-9 OG-9V Fragmentation', class: 'BP_SPG9_Frag', mags: 8, magSize: 1, type: 'he',   caliber: '73mm' },
      { name: 'SPG-9 PG-9V HEAT',          class: 'BP_SPG9',      mags: 8, magSize: 1, type: 'heat', caliber: '73mm' },
    ],
  },
};

// Technical SPG-9 (IMF, unarmored) — reuses the same turret + weapon classes
// as the armored variant. Identical loadout.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_SPG9_C'] = VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_SPG9_C'];

// Technical SPG-9 (MEI, unarmored) — white-scheme variant sharing the exact
// same turret + weapon classes. Identical loadout.
VEHICLE_LOADOUTS['BP_Technical2Seater_White_SPG9_C'] = VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_SPG9_C'];

// Technical SPG-9 (MEI, armored) — INS_Armoured-suffixed className, same
// turret + weapon classes. Identical loadout.
VEHICLE_LOADOUTS['BP_Technical_SPG9_INS_Armoured_C'] = VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_SPG9_C'];

// Safir Kornet (GFI) — Iranian light 4x4 with a roof-mounted 9M133 Kornet
// ATGM turret (BP_Safir_Turret_Kornet_C + BP_Kornet_Safir_Weapon).
// 5 seats (2 + 3): Driver, Kornet gunner, 3 rear passengers.
VEHICLE_LOADOUTS['BP_Safir_Kornet_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'Kornet Gunner', turretClass: 'BP_Safir_Turret_Kornet_C' },
    { index: 2, role: 'Passenger',     turretClass: null },
    { index: 3, role: 'Passenger',     turretClass: null },
    { index: 4, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_Safir_Turret_Kornet_C': [
      { name: '9M133 Kornet High Explosive Anti-Tank', class: 'BP_Kornet_Safir_Weapon', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// M1151 TOW (GFI) — closed-top Humvee variant with a GFI-suffixed turret
// class (BP_M1151_TOW_Turret_GFI_C). 5 seats (2 + 3). Shares the base
// BP_BGM71TOW_MATV weapon class.
VEHICLE_LOADOUTS['BP_M1151_TOW_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'TOW Gunner',  turretClass: 'BP_M1151_TOW_Turret_GFI_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_M1151_TOW_Turret_GFI_C': [
      { name: 'BGM-71 TOW High Explosive Anti-Tank', class: 'BP_BGM71TOW_MATV', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

VEHICLE_LOADOUTS['BP_M1151_TOW_WPMC_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'TOW Gunner',  turretClass: 'BP_M1151_TOW_Turret_Black1_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_M1151_TOW_Turret_Black1_C': [
      { name: 'BGM-71 TOW High Explosive Anti-Tank', class: 'BP_BGM71TOW_MATV', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// M-ATV CROWS M2 (USA, base) — M2A1 Browning CROWS. 2 + 2 seats.
VEHICLE_LOADOUTS['BP_MATV_CROWS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CROWS_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Turret_C': [
      { name: 'M2A1 Browning CROWS', class: 'BP_CROWS_M2', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M-ATV CROWS M2 (USA, woodland) — woodland-suffixed turret/weapon. 2 + 2 seats.
VEHICLE_LOADOUTS['BP_MATV_CROWS_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CROWS_Turret_Woodland_Green_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Turret_Woodland_Green_C': [
      { name: 'M2A1 Browning CROWS', class: 'BP_CROWS_M2_Woodland_Green', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M-ATV CROWS M240 (USA, base) — M240B CROWS. 2 + 2 seats.
VEHICLE_LOADOUTS['BP_MATV_CROWS_M240_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CROWS_Turret_M240_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Turret_M240_C': [
      { name: 'M240B CROWS', class: 'BP_CROWS_M240', mags: 1, magSize: 750, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// M-ATV CROWS M240 (USA, woodland) — woodland-suffixed turret/weapon. 2 + 2 seats.
VEHICLE_LOADOUTS['BP_MATV_CROWS_M240_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CROWS_Turret_M240_Woodland_Green_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Turret_M240_Woodland_Green_C': [
      { name: 'M240B CROWS', class: 'BP_CROWS_M240_Woodland_Green', mags: 1, magSize: 750, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// M1151 CROWS M2 (USA / USMC, base) — M2A1 Browning CROWS. Shares BP_CROWS_Turret_C / BP_CROWS_M2
// with M-ATV CROWS base. 2 + 2 seats.
VEHICLE_LOADOUTS['BP_M1151_CROWS_C'] = VEHICLE_LOADOUTS['BP_MATV_CROWS_C'];
// M1151 CROWS M2 (USA / USMC, woodland) — BP_CROWS_Turret_Woodland_C (no _Green suffix). 2 + 2 seats.
VEHICLE_LOADOUTS['BP_M1151_CROWS_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CROWS_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CROWS_Turret_Woodland_C': [
      { name: 'M2A1 Browning CROWS', class: 'BP_CROWS_M2_Woodland', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M-ATV USMC CROWS M2 (USMC, base) — same BP_CROWS_Turret_C / BP_CROWS_M2 as M-ATV CROWS base. 2 + 2 seats.
VEHICLE_LOADOUTS['BP_MATV_USMC_CROWS_C'] = VEHICLE_LOADOUTS['BP_MATV_CROWS_C'];
// M-ATV USMC CROWS M2 (USMC, woodland) — same turret class as M1151 woodland (BP_CROWS_Turret_Woodland_C). 2 + 2 seats.
VEHICLE_LOADOUTS['BP_MATV_USMC_CROWS_Woodland_C'] = VEHICLE_LOADOUTS['BP_M1151_CROWS_Woodland_C'];

// PMV RWS M2 (ADF) — M2A1 Browning RWS. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_PMV_RWS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_PMV_RWS_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_PMV_RWS_Turret_C': [
      { name: 'M2A1 Browning RWS', class: 'BP_PMV_RWS_M2', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// TAPV (CAF, desert) — Protector C16 Mk19 AGL + C6 GPMG + smoke. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_TAPV_C16_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_C16_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_C16_Turret_Desert_C': [
      { name: '40mm Smoke Launchers',   class: 'BP_C16_Smoke_Launcher_Desert', mags: 1, magSize: 2,    type: 'smoke' },
      { name: 'Protector C16 Mk19 AGL', class: 'BP_C16_MK19_Desert',           mags: 1, magSize: 32,   type: 'he',      caliber: '40mm' },
      { name: 'Protector C6 GPMG',      class: 'BP_C16_C6_Desert',             mags: 1, magSize: 1000, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};
// TAPV (CAF, woodland) — same weapons, woodland turret class. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_TAPV_C16_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_C16_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_C16_Turret_C': [
      { name: '40mm Smoke Launchers',   class: 'BP_C16_Smoke_Launcher', mags: 1, magSize: 2,    type: 'smoke' },
      { name: 'Protector C16 Mk19 AGL', class: 'BP_C16_MK19',           mags: 1, magSize: 32,   type: 'he',      caliber: '40mm' },
      { name: 'Protector C6 GPMG',      class: 'BP_C16_C6',             mags: 1, magSize: 1000, type: 'mg',      caliber: '7.62mm' },
    ],
  },
};

// Tigr-M RWS Kord (RGF, desert) — Arbalet-DM RWS: Kord 12.7mm + smoke. 2 + 7 seats.
VEHICLE_LOADOUTS['BP_Tigr_RWS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Arbalet_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Arbalet_Turret_Desert_C': [
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_Arbalet_Desert', mags: 1, magSize: 2,   type: 'smoke' },
      { name: 'Arbalet Kord',         class: 'BP_Arbalet_Kord_Desert',        mags: 1, magSize: 450, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Tigr-M RWS Kord (RGF, woodland) — same Arbalet-DM RWS, woodland turret class. 2 + 7 seats.
VEHICLE_LOADOUTS['BP_Tigr_RWS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Arbalet_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Arbalet_Turret_C': [
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_Arbalet', mags: 1, magSize: 2,   type: 'smoke' },
      { name: 'Arbalet Kord',         class: 'BP_Arbalet_Kord',        mags: 1, magSize: 450, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// Kozak-2M1 Kord (AFU) — Kord 12.7mm HMG + driver smoke. 2 + 7 seats.
VEHICLE_LOADOUTS['BP_Kozak_2M1_Kord_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Kozak_Kord_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Kozak_Driver', mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_Kozak_Kord_Turret_C': [
      { name: 'Kord',                 class: 'BP_Kord_Kozak',                  mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// Light FSV (CRF, Technical M2) — M2A1 Browning open-top. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Technical_Turret_M2_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_M2_C': [
      { name: 'M2A1 Browning', class: 'BP_M2_Technical', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Light FSV M1151 (CRF, woodland) — M2A1 Browning on Humvee chassis. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_M1151_Light_Woodland_CRF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_Woodland_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151_Woodland', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Lynx 8x8 QJZ89 (PLA / PLANMC / PLAAGF) — QJZ-89 12.7mm HMG + driver smoke. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_LynxATV_Rollcage_QJZ89_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_Lynx8x8_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator', class: 'SmokeGenerator_Tracked', mags: 1, magSize: 30, type: 'smoke' },
    ],
    'BP_QJZ89_Lynx8x8_OpenTop_Turret_C': [
      { name: 'QJZ89', class: 'BP_QJZ89_Weapon_Lynx8x8', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// Lynx 8x8 QLZ87 (PLA / PLANMC / PLAAGF) — QLZ-87 35mm AGL + driver smoke. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_LynxATV_Rollcage_QLZ87_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QLZ87_Lynx8x8_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',             class: 'SmokeGenerator_Tracked',     mags: 1,  magSize: 30, type: 'smoke' },
    ],
    'BP_QLZ87_Lynx8x8_OpenTop_Turret_C': [
      { name: 'QLZ-87 AGL HEDP',             class: 'BP_QLZ87_Weapon_Lynx8x8',   mags: 15, magSize: 15, type: 'he', caliber: '35mm' },
    ],
  },
};
// M1151 M2 (WPMC) — M2A1 Browning. 2 + 3 seats.
// M1151 M2 (USA / USMC standard) — base armed Humvee with M2A1 Browning.
// Reader emits turret.name='BP_M1151_Turret' (no _C suffix) so the
// loadout key carries _C as everywhere else; killfeed's _norm() handles
// the suffix mismatch.
VEHICLE_LOADOUTS['BP_M1151_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
VEHICLE_LOADOUTS['BP_M1151_WPMC_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Turret_Black_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_Black_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151_Black', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M1151 M240 (WPMC) — M240B GPMG. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_M1151_M240_WPMC_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_M240_Turret_Black_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_M240_Turret_Black_C': [
      { name: 'M240B', class: 'BP_M240_Loaders_Weapon_WPMC', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// M1151 Technical DShK (OpFor / MEI) — DShK 12.7mm HMG. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_M1151_Technical_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Dshk_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Dshk_Turret_C': [
      { name: 'DShK', class: 'BP_M1151_Technical_DShK_Shield', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Safir AGS-17 (GFI) — AGS-17 Plamya 30mm AGL. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Safir_AGS-17_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Safir_Turret_AGS-17_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Safir_Turret_AGS-17_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_Safir_Weapon', mags: 10, magSize: 29, type: 'he', caliber: '30mm' },
    ],
  },
};
// Safir Kord (GFI) — Kord 12.7mm HMG. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Safir_Kord_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Safir_Turret_Kord_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Safir_Turret_Kord_C': [
      { name: 'Kord', class: 'BP_Kord_Safir_Weapon', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Safir MG3 (GFI) — MG3 7.62mm GPMG. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Safir_MG3_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Safir_Turret_MG3_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Safir_Turret_MG3_C': [
      { name: 'MG3', class: 'BP_MG3_Safir_Weapon', mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Technical AGS-17 (IMF, armored camo) — AGS-17 Plamya 30mm AGL. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_AGS17_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Technical_Turret_AGS17_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_AGS17_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_Technical_Weapon', mags: 10, magSize: 29, type: 'he', caliber: '30mm' },
    ],
  },
};
// Technical AGS-17 (IMF, unarmored camo) — same turret/weapon as armored variant. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_AGS17_C'] = VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_AGS17_C'];
// Technical HMG (OpFor / MEI, armored) — DShK 12.7mm shielded. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical_Dshk_INS_Armoured_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Technical_Turret_Shielded_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_Shielded_C': [
      { name: 'DShK', class: 'BP_DShK_Technical_Shield', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Technical HMG (OpFor / MEI, unarmored white) — same turret/weapon as armored variant. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_White_Dshk_C'] = VEHICLE_LOADOUTS['BP_Technical_Dshk_INS_Armoured_C'];
// Technical HMG (OpFor / MEI, white M2) — same BP_Technical_Turret_M2_C / BP_M2_Technical. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_White_M2_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'];
// Technical HMG (IMF, armored camo DShK) — same BP_Technical_Turret_Shielded_C. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_DSHK_C'] = VEHICLE_LOADOUTS['BP_Technical_Dshk_INS_Armoured_C'];
// Technical HMG (IMF, armored camo M2) — same BP_Technical_Turret_M2_C / BP_M2_Technical. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Armored_Technical2Seater_Camo_M2_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'];
// Technical HMG (IMF, unarmored camo DShK) — same BP_Technical_Turret_Shielded_C. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_DSHK_C'] = VEHICLE_LOADOUTS['BP_Technical_Dshk_INS_Armoured_C'];
// Technical HMG (IMF, unarmored camo M2) — same BP_Technical_Turret_M2_C / BP_M2_Technical. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'];
// Technical M134 Minigun (WPMC, 2-seater black) — GAU-17/A Minigun, FullRotation turret. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_M134_Black_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Technical_Turret_M134_FullRotation_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_M134_FullRotation_C': [
      { name: 'GAU-17/A Minigun', class: 'BP_M134_Weapon', mags: 1, magSize: 1500, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// Technical M134 Minigun (WPMC, 2-seater grey/tan) — same FullRotation turret. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_M134_Grey_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_M134_Black_C'];
VEHICLE_LOADOUTS['BP_Technical2Seater_M134_Tan_C']  = VEHICLE_LOADOUTS['BP_Technical2Seater_M134_Black_C'];
// Technical M134 Minigun (WPMC, 4-seater black) — GAU-17/A Minigun, standard M134 turret. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_Technical4Seater_M134_Black_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Technical_Turret_M134_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_M134_C': [
      { name: 'GAU-17/A Minigun', class: 'BP_M134_Weapon', mags: 1, magSize: 1500, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// Technical M134 Minigun (WPMC, 4-seater grey/tan) — same standard M134 turret. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_Technical4Seater_M134_Grey_C'] = VEHICLE_LOADOUTS['BP_Technical4Seater_M134_Black_C'];
VEHICLE_LOADOUTS['BP_Technical4Seater_M134_Tan_C']  = VEHICLE_LOADOUTS['BP_Technical4Seater_M134_Black_C'];
// Technical M2 (WPMC) — same BP_Technical_Turret_M2_C / BP_M2_Technical. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_Technical2Seater_M2_Black_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'];
VEHICLE_LOADOUTS['BP_Technical2Seater_M2_Grey_C']  = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'];
VEHICLE_LOADOUTS['BP_Technical2Seater_M2_Tan_C']   = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_M2_CRF_C'];
// Cobra II M2 (TLF, woodland) — open-top M2A1 + driver smoke. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_M2_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Cobra_II_OpenTurret_M2_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver',     mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_Cobra_II_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning',        class: 'BP_Cobra_II_OpenTurret_M2_Weapon',    mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Cobra II M2 (TLF, desert) — desert-suffixed turret, same weapon class. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_M2_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Cobra_II_OpenTurret_M2_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver',          mags: 1,  magSize: 2,   type: 'smoke' },
    ],
    'BP_Cobra_II_OpenTurret_M2_Turret_Desert_C': [
      { name: 'M2A1 Browning',        class: 'BP_Cobra_II_OpenTurret_M2_Weapon',         mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Cobra II MG3 (TLF, woodland) — open-top MG3 + driver smoke. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_MG3_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Cobra_II_OpenTurret_MG3_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver',      mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_Cobra_II_OpenTurret_MG3_Turret_C': [
      { name: 'MG3',                  class: 'BP_Cobra_II_OpenTurret_MG3_Weapon',    mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// Cobra II MG3 (TLF, desert) — desert-suffixed turret, same weapon class. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_MG3_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Cobra_II_OpenTurret_MG3_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver',           mags: 1, magSize: 2,   type: 'smoke' },
    ],
    'BP_Cobra_II_OpenTurret_MG3_Turret_Desert_C': [
      { name: 'MG3',                  class: 'BP_Cobra_II_OpenTurret_MG3_Weapon',         mags: 6, magSize: 120, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// CPV M134 Minigun (WPMC, base) — M134 Minigun FullRotation turret. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_CPV_M134_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CPV_Turret_M134_FullRotation_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CPV_Turret_M134_FullRotation_C': [
      { name: 'M134 Minigun', class: 'BP_M134_Weapon_CPV', mags: 1, magSize: 800, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// CPV M134 Minigun (WPMC, blue) — Blue-suffixed turret, same weapon. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_CPV_M134_Blue_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CPV_Turret_M134_FullRotation_Blue_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CPV_Turret_M134_FullRotation_Blue_C': [
      { name: 'M134 Minigun', class: 'BP_M134_Weapon_CPV', mags: 1, magSize: 800, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// CPV M134 Minigun (WPMC, red) — Red-suffixed turret, same weapon. 2 + 8 seats.
VEHICLE_LOADOUTS['BP_CPV_M134_Red_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_CPV_Turret_M134_FullRotation_Red_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_CPV_Turret_M134_FullRotation_Red_C': [
      { name: 'M134 Minigun', class: 'BP_M134_Weapon_CPV', mags: 1, magSize: 800, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// CSK131 QJY88 (PLA / PLAAGF, woodland) — QJY88 7.62mm GPMG. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QJY88_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJY88_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJY88_OpenTop_Turret_C': [
      { name: 'QJY88', class: 'BP_QJY88_CSK131_Weapon', mags: 5, magSize: 200, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// CSK131 QJY88 (PLA / PLAAGF, desert) — desert-suffixed turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QJY88_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJY88_OpenTop_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJY88_OpenTop_Turret_Desert_C': [
      { name: 'QJY88', class: 'BP_QJY88_CSK131_Weapon', mags: 5, magSize: 200, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// CSK131 QJY88 (PLANMC, naval) — naval-suffixed turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QJY88_Naval_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJY88_OpenTop_Turret_Naval_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJY88_OpenTop_Turret_Naval_C': [
      { name: 'QJY88', class: 'BP_QJY88_CSK131_Weapon', mags: 5, magSize: 200, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// CSK131 QJZ89 (PLA / PLAAGF, woodland) — QJZ-89 12.7mm HMG. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QJZ89_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJZ89_OpenTop_Turret_C': [
      { name: 'QJZ89', class: 'BP_QJZ89_CSK131', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// CSK131 QJZ89 (PLA / PLAAGF, desert) — desert-suffixed turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QJZ89_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_OpenTop_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJZ89_OpenTop_Turret_Desert_C': [
      { name: 'QJZ89', class: 'BP_QJZ89_CSK131', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// CSK131 QJZ89 Naval (PLANMC) — naval-suffixed turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QJZ89_Naval_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_OpenTop_Turret_Naval_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJZ89_OpenTop_Turret_Naval_C': [
      { name: 'QJZ89', class: 'BP_QJZ89_CSK131', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// CSK131 QLZ87 (PLA, woodland) — QLZ-87 35mm HEDP AGL. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QLZ87_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QLZ87_CSK_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QLZ87_CSK_OpenTop_Turret_C': [
      { name: 'QLZ-87 AGL HEDP', class: 'BP_QLZ87_OpenTurret_Weapon', mags: 15, magSize: 15, type: 'he', caliber: '35mm' },
    ],
  },
};
// CSK131 QLZ87 (PLA, desert) — desert-suffixed turret. 2 + 5 seats.
VEHICLE_LOADOUTS['BP_CSK131_QLZ87_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QLZ87_CSK_OpenTop_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QLZ87_CSK_OpenTop_Turret_Desert_C': [
      { name: 'QLZ-87 AGL HEDP', class: 'BP_QLZ87_OpenTurret_Weapon', mags: 15, magSize: 15, type: 'he', caliber: '35mm' },
    ],
  },
};
// Kozak-2M1 AGS-17 (AFU) — AGS-17 Plamya 30mm AGL + driver smoke. 2 + 7 seats.
VEHICLE_LOADOUTS['BP_Kozak_2M1_AGS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Kozak_AGS-17_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Kozak_Driver', mags: 1,  magSize: 2,  type: 'smoke' },
    ],
    'BP_Kozak_AGS-17_Turret_C': [
      { name: 'AGS-17 Plamya',        class: 'BP_AGS-17_OpenTurret_Weapon',   mags: 10, magSize: 29, type: 'he', caliber: '30mm' },
    ],
  },
};
// LPPV (BAF, base) — dual L7A2 GPMG (left + right turrets). 3 + 3 seats.
VEHICLE_LOADOUTS['BP_LPPV_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'Left Gunner',   turretClass: 'BP_GPMG_Turret_L_C' },
    { index: 2, role: 'Right Gunner',  turretClass: 'BP_GPMG_Turret_R_C' },
    { index: 3, role: 'Passenger',     turretClass: null },
    { index: 4, role: 'Passenger',     turretClass: null },
    { index: 5, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_GPMG_Turret_L_C': [
      { name: 'L7A2 GPMG', class: 'BP_GPMG', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_GPMG_Turret_R_C': [
      { name: 'L7A2 GPMG', class: 'BP_GPMG', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// LPPV (BAF, woodland) — woodland-suffixed turret classes. 3 + 3 seats.
VEHICLE_LOADOUTS['BP_LPPV_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'Left Gunner',   turretClass: 'BP_GPMG_Turret_L_Woodland_C' },
    { index: 2, role: 'Right Gunner',  turretClass: 'BP_GPMG_Turret_R_Woodland_C' },
    { index: 3, role: 'Passenger',     turretClass: null },
    { index: 4, role: 'Passenger',     turretClass: null },
    { index: 5, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_GPMG_Turret_L_Woodland_C': [
      { name: 'L7A2 GPMG', class: 'BP_GPMG_Woodland', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_GPMG_Turret_R_Woodland_C': [
      { name: 'L7A2 GPMG', class: 'BP_GPMG_Woodland', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// LUVW C6 Desert (CAF) — C6A1 FLEX 7.62mm GPMG. 2 + 3 seats.
// L7A2 entries on BP_GPMG_Turret_L_C / _Woodland_C are wiki artifacts;
// the actual gunner seat uses BP_LUVW_Turret_C6_Desert_C.
VEHICLE_LOADOUTS['BP_LUVW_C6_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_LUVW_Turret_C6_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_LUVW_Turret_C6_Desert_C': [
      { name: 'C6A1 FLEX', class: 'BP_C6_LUVW_Desert', mags: 10, magSize: 220, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// LUVW C6 Woodland (CAF) — same weapon, woodland-suffixed turret class.
VEHICLE_LOADOUTS['BP_LUVW_C6_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_LUVW_Turret_C6_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_LUVW_Turret_C6_C': [
      { name: 'C6A1 FLEX', class: 'BP_C6_LUVW', mags: 10, magSize: 220, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// LUVW M2 Desert (CAF) — M2A1 Browning 12.7mm HMG. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_LUVW_M2_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_LUVW_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_LUVW_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_LUVW_Desert', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// LUVW M2 Woodland (CAF) — woodland-suffixed turret class.
VEHICLE_LOADOUTS['BP_LUVW_M2_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_LUVW_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_LUVW_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_LUVW', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M-ATV M2 (USA) — M-ATV MRAP with M2A1 HMG (BP_M1151_Turret_C). 2 + 3 seats.
VEHICLE_LOADOUTS['BP_MATV_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_M1151_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M-ATV M2 Woodland (USA) — woodland-green-suffixed turret class.
VEHICLE_LOADOUTS['BP_MATV_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_M1151_Turret_Woodland_Green_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_Woodland_Green_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151_USMC_Woodland', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M-ATV M240 (USA) — M-ATV MRAP with M240B GPMG (BP_M1151_M240_Turret_C). 2 + 3 seats.
VEHICLE_LOADOUTS['BP_MATV_M240_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_M1151_M240_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_M240_Turret_C': [
      { name: 'M240B', class: 'BP_M240_Loaders_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// M-ATV M240 Woodland (USA) — woodland-suffixed turret class.
VEHICLE_LOADOUTS['BP_MATV_M240_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',  turretClass: null },
    { index: 1, role: 'Gunner',  turretClass: 'BP_M1151_M240_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_M240_Turret_Woodland_C': [
      { name: 'M240B', class: 'BP_M240_Loaders_Weapon_Woodland', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// M-ATV Mk19 (USA) — Mk19 40mm grenade machine gun. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_MATV_Mk19_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Mk19_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Mk19_Turret_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'he', caliber: '40mm' },
    ],
  },
};
// M-ATV Mk19 Woodland (USA) — woodland-green-suffixed turret class; same weapon.
VEHICLE_LOADOUTS['BP_MATV_Mk19_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Mk19_Turret_Green_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Mk19_Turret_Green_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'he', caliber: '40mm' },
    ],
  },
};
// M1151 M2 standard (USA / USMC) — same BP_M1151_Turret_C / BP_50Cal_M1151 as BP_MATV_C,
// same 2 + 3 seat layout. Alias directly.
VEHICLE_LOADOUTS['BP_M1151_C'] = VEHICLE_LOADOUTS['BP_MATV_C'];
// M1151 M2 Light (USA / USMC) — same turret as BP_M1151_C but 2 + 5 passenger seats.
VEHICLE_LOADOUTS['BP_M1151_Light_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M1151 M2 Woodland (USA / USMC) — woodland turret class, 2 + 3 seats.
VEHICLE_LOADOUTS['BP_M1151_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_Woodland_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151_Woodland', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M1151 M2 Light Woodland (USMC) — same turret class and 2 + 5 layout as
// BP_M1151_Light_Woodland_CRF_C. Alias directly.
VEHICLE_LOADOUTS['BP_M1151_Light_Woodland_C'] = VEHICLE_LOADOUTS['BP_M1151_Light_Woodland_CRF_C'];
// M1151 M2 GFI (GFI) — GFI-suffixed turret class; otherwise identical M2A1 HMG. 2 + 3 seats.
VEHICLE_LOADOUTS['BP_M1151_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Turret_GFI_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Turret_GFI_C': [
      { name: 'M2A1 Browning', class: 'BP_50Cal_M1151_GFI', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M1151 M240 (USA / USMC) — same BP_M1151_M240_Turret_C / BP_M240_Loaders_Weapon as
// BP_MATV_M240_C, same 2 + 3 seat layout. Alias directly.
VEHICLE_LOADOUTS['BP_M1151_M240_C'] = VEHICLE_LOADOUTS['BP_MATV_M240_C'];
// M1151 M240 Woodland (USA / USMC) — same BP_M1151_M240_Turret_Woodland_C as
// BP_MATV_M240_Woodland_C, same 2 + 3 seat layout. Alias directly.
VEHICLE_LOADOUTS['BP_M1151_M240_Woodland_C'] = VEHICLE_LOADOUTS['BP_MATV_M240_Woodland_C'];
// M1151 M240 Light (USMC) — same BP_M1151_M240_Turret_C / BP_M240_Loaders_Weapon
// as BP_MATV_M240_C but 2 + 5 passenger seats.
VEHICLE_LOADOUTS['BP_M1151_Light_M240_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_M240_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_M240_Turret_C': [
      { name: 'M240B', class: 'BP_M240_Loaders_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// M1151 M240 Light Woodland (USMC) — woodland turret class, 2 + 5 seats.
VEHICLE_LOADOUTS['BP_M1151_Light_M240_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_M240_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_M240_Turret_Woodland_C': [
      { name: 'M240B', class: 'BP_M240_Loaders_Weapon_Woodland', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// M1151 Mk19 standard (USA / USMC) — same BP_M1151_Mk19_Turret_C as BP_MATV_Mk19_C,
// same 2 + 3 seat layout. Alias directly.
VEHICLE_LOADOUTS['BP_M1151_Mk19_C'] = VEHICLE_LOADOUTS['BP_MATV_Mk19_C'];
// M1151 Mk19 Light (USMC) — same turret class as BP_MATV_Mk19_C but 2 + 5 seats.
VEHICLE_LOADOUTS['BP_M1151_Light_Mk19_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Mk19_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Mk19_Turret_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'he', caliber: '40mm' },
    ],
  },
};
// M1151 Mk19 Woodland (USA / USMC) — woodland-suffixed turret class, 2 + 3 seats.
VEHICLE_LOADOUTS['BP_M1151_Mk19_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Mk19_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Mk19_Turret_Woodland_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'he', caliber: '40mm' },
    ],
  },
};
// M1151 Mk19 Light Woodland (USMC) — same woodland turret class, 2 + 5 seats.
VEHICLE_LOADOUTS['BP_M1151_Light_Mk19_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1151_Mk19_Turret_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1151_Mk19_Turret_Woodland_C': [
      { name: 'Mk19 Grenade Machine Gun', class: 'BP_Mk19_OpenTurret_Weapon', mags: 10, magSize: 32, type: 'he', caliber: '40mm' },
    ],
  },
};
// MATV USMC M2 (USMC) — same BP_M1151_Turret_C / 2+3 layout as BP_MATV_C. Alias.
VEHICLE_LOADOUTS['BP_MATV_USMC_C'] = VEHICLE_LOADOUTS['BP_MATV_C'];
// MATV USMC M2 Woodland (USMC) — same BP_M1151_Turret_Woodland_C / 2+3 as BP_M1151_Woodland_C. Alias.
VEHICLE_LOADOUTS['BP_MATV_USMC_Woodland_C'] = VEHICLE_LOADOUTS['BP_M1151_Woodland_C'];
// MATV Mk19 USMC (USMC) — same BP_M1151_Mk19_Turret_C / 2+3 as BP_MATV_Mk19_C. Alias.
VEHICLE_LOADOUTS['BP_MATV_Mk19_USMC_C'] = VEHICLE_LOADOUTS['BP_MATV_Mk19_C'];
// MATV Mk19 USMC Woodland (USMC) — same BP_M1151_Mk19_Turret_Woodland_C / 2+3
// as BP_M1151_Mk19_Woodland_C. Alias directly.
VEHICLE_LOADOUTS['BP_MATV_Mk19_USMC_Woodland_C'] = VEHICLE_LOADOUTS['BP_M1151_Mk19_Woodland_C'];
// PMV Mag58 (ADF) — Bushmaster PMV with front Mag58 7.62mm GPMG. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_PMV_Mag58_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_PMV_Mag58_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
    { index: 9, role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_PMV_Mag58_Turret_C': [
      { name: 'Mag58', class: 'BP_PMV_Mag58_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// PMV Mag58 x3 (ADF) — front Mag58 + two rear Mag58 gunners. 4 + 7 seats.
// Rear guns use BP_ASLAV_Mag58_Cmdr_Weapon (wiki labels them M240B, same weapon family).
VEHICLE_LOADOUTS['BP_PMV_Mag58x3_C'] = {
  seats: [
    { index: 0, role: 'Driver',       turretClass: null },
    { index: 1, role: 'Gunner',       turretClass: 'BP_PMV_Mag58_Turret_C' },
    { index: 2, role: 'Left Gunner',  turretClass: 'BP_PMV_Turret_Rear_L_C' },
    { index: 3, role: 'Right Gunner', turretClass: 'BP_PMV_Turret_Rear_R_C' },
    { index: 4, role: 'Passenger',    turretClass: null },
    { index: 5, role: 'Passenger',    turretClass: null },
    { index: 6, role: 'Passenger',    turretClass: null },
    { index: 7, role: 'Passenger',    turretClass: null },
    { index: 8, role: 'Passenger',    turretClass: null },
    { index: 9, role: 'Passenger',    turretClass: null },
    { index: 10, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_PMV_Mag58_Turret_C': [
      { name: 'Mag58', class: 'BP_PMV_Mag58_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_PMV_Turret_Rear_L_C': [
      { name: 'Mag58', class: 'BP_ASLAV_Mag58_Cmdr_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
    'BP_PMV_Turret_Rear_R_C': [
      { name: 'Mag58', class: 'BP_ASLAV_Mag58_Cmdr_Weapon', mags: 10, magSize: 250, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// Tigr-M AGS-17 Desert (RGF / VDV) — driver smoke + AGS-17 Plamya 30mm AGL. 2 + 6 seats.
// BP_PMV_Turret_Rear_L_C / BP_ASLAV_Mag58_Cmdr_Weapon entry in wiki is an artifact.
VEHICLE_LOADOUTS['BP_Tigr_AGS17_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Tigr_AGS17_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_Tigr_AGS17_Turret_Desert_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_OpenTurret_Weapon', mags: 10, magSize: 29, type: 'he', caliber: '30mm' },
    ],
  },
};
// Tigr-M AGS-17 Woodland (RGF / VDV) — woodland-suffixed turret class, same layout.
VEHICLE_LOADOUTS['BP_Tigr_AGS17_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Tigr_AGS17_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_Tigr_AGS17_Turret_C': [
      { name: 'AGS-17 Plamya', class: 'BP_AGS-17_OpenTurret_Weapon', mags: 10, magSize: 29, type: 'he', caliber: '30mm' },
    ],
  },
};
// Tigr-M Kord Desert (RGF / VDV) — driver smoke + Kord 12.7mm HMG. Desert. 2 + 6 seats.
// BP_PMV_Turret_Rear_L_C entry in wiki is an artifact; Weapons (2) = smoke + Kord.
VEHICLE_LOADOUTS['BP_Tigr_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Tigr_Kord_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_Tigr_Kord_Turret_Desert_C': [
      { name: 'Kord', class: 'BP_Kord_Tigr', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Tigr-M Kord Woodland (RGF / VDV) — woodland-suffixed turret class, same layout.
VEHICLE_LOADOUTS['BP_Tigr_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Tigr_Kord_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_Tigr_Kord_Turret_C': [
      { name: 'Kord', class: 'BP_Kord_Tigr', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Tigr-M Kord MIL (IMF) — MIL-suffixed turret class, same layout.
VEHICLE_LOADOUTS['BP_Tigr_MIL_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_Tigr_Kord_Turret_MIL_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_Tigr_Kord_Turret_MIL_C': [
      { name: 'Kord', class: 'BP_Kord_Tigr', mags: 10, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// M1117 Guardian (WPMC) — BP_M1117_Turret_C carries 3 weapons: smoke + MK19 + M2A1.
// L7A2 and BP_PMV_Turret_Rear_L_C wiki entries are artifacts; Weapons (3) = the three
// turret-mounted weapons. LTV icon (map_jeep_turret.png) per user spec. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_M1117_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_M1117_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_M1117_Turret_C': [
      { name: '40mm Smoke Launchers', class: 'Smoke_Launcher_M1117',  mags: 1, magSize: 2,   type: 'smoke' },
      { name: 'MK19',                 class: 'BP_M1117_MK19',         mags: 6, magSize: 48,  type: 'he',      caliber: '40mm' },
      { name: 'M2A1 Browning',        class: 'BP_M1117_M2',           mags: 5, magSize: 100, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// CPV Transport (WPMC) — unarmed troop transport, no weapons. 1 + 11 seats.
VEHICLE_LOADOUTS['BP_CPV_Transport_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Passenger', turretClass: null },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
    { index: 11, role: 'Passenger', turretClass: null },
  ],
  turrets: {},
};
VEHICLE_LOADOUTS['BP_CPV_Transport_Blue_C'] = VEHICLE_LOADOUTS['BP_CPV_Transport_C'];
VEHICLE_LOADOUTS['BP_CPV_Transport_Red_C']  = VEHICLE_LOADOUTS['BP_CPV_Transport_C'];
// Light Transport CRF (CRF) — unarmed pickup transport, 1 + 8 seats.
VEHICLE_LOADOUTS['BP_Technical4Seater_Transport_CRF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {},
};
// LUVW Transport CRF (CRF) — unarmed LUVW, 1 + 3 seats.
VEHICLE_LOADOUTS['BP_LUVW_CRF_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Passenger', turretClass: null },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {},
};
// CPV Transport CRF (CRF) — same structure as BP_CPV_Transport_C (1+11, no weapons). Alias.
VEHICLE_LOADOUTS['BP_CPV_Transport_CRF_C'] = VEHICLE_LOADOUTS['BP_CPV_Transport_C'];

// M-ATV TOW (USA) — M-ATV MRAP with a roof-mounted BGM-71 TOW ATGM turret
// (BP_M1151_TOW_Turret_C + BP_BGM71TOW_MATV). 5 seats (2 + 3): Driver,
// TOW gunner, 3 rear passengers.
VEHICLE_LOADOUTS['BP_MATV_TOW_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'TOW Gunner',  turretClass: 'BP_M1151_TOW_Turret_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_M1151_TOW_Turret_C': [
      { name: 'BGM-71 TOW High Explosive Anti-Tank', class: 'BP_BGM71TOW_MATV', mags: 6, magSize: 1, type: 'atgm', caliber: '152mm' },
    ],
  },
};

// CSK131 QJC-88 RWS (PLANMC) — QJC-88 12.7mm RWS, naval turret class. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_CSK131_RWS_Naval_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_RWS_Turret_Naval_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJZ89_RWS_Turret_Naval_C': [
      { name: 'QJC-88 RWS', class: 'BP_QJZ89_RWS_Naval', mags: 1, magSize: 450, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// CSK131 QJC-88 RWS (PLA woodland) — QJC-88 12.7mm RWS, base turret class. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_CSK131_RWS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_RWS_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJZ89_RWS_Turret_C': [
      { name: 'QJC-88 RWS', class: 'BP_QJZ89_RWS', mags: 1, magSize: 450, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// CSK131 QJC-88 RWS (PLA desert) — QJC-88 12.7mm RWS, desert turret class. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_CSK131_RWS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_QJZ89_RWS_Turret_Desert_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QJZ89_RWS_Turret_Desert_C': [
      { name: 'QJC-88 RWS', class: 'BP_QJZ89_RWS_Desert', mags: 1, magSize: 450, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// LPPV RWS (BAF, base) — L11A1 CROWS M2 12.7mm RWS. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_LPPV_M2RWS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_EnforcerRWS_Turret_M2_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_EnforcerRWS_Turret_M2_C': [
      { name: 'L11A1 CROWS', class: 'BP_EnforcerRWS_M2', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// LPPV RWS (BAF, woodland) — woodland-suffixed turret/weapon. 2 + 4 seats.
VEHICLE_LOADOUTS['BP_LPPV_M2RWS_Woodland_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_EnforcerRWS_Turret_M2_Woodland_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_EnforcerRWS_Turret_M2_Woodland_C': [
      { name: 'L11A1 CROWS', class: 'BP_EnforcerRWS_M2_Woodland', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};

// CSK131 HJ-8 (PLANMC / PLAAGF, naval) — Naval-suffixed turret class; same
// weapon + 7-seat layout as the other camo variants.
VEHICLE_LOADOUTS['BP_CSK131_HJ-8ATGM_Naval_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'ATGM Gunner', turretClass: 'BP_HJ8ATGM_OpenTop_Turret_Naval_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
    { index: 5, role: 'Passenger',   turretClass: null },
    { index: 6, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_HJ8ATGM_OpenTop_Turret_Naval_C': [
      { name: 'HJ8L High Explosive Anti-Tank', class: 'BP_HJ8ATGM_CSK131', mags: 6, magSize: 1, type: 'atgm', caliber: '120mm' },
    ],
  },
};

// CSK131 HJ-8 (PLA / PLAAGF, woodland) — Chinese jeep-class 4x4 with an
// open-top HJ-8 ATGM turret. 7 seats (2 + 5): Driver, ATGM gunner,
// 5 rear passengers. HJ8L HEAT ATGM, 6×1.
VEHICLE_LOADOUTS['BP_CSK131_HJ-8ATGM_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'ATGM Gunner', turretClass: 'BP_HJ8ATGM_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
    { index: 5, role: 'Passenger',   turretClass: null },
    { index: 6, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_HJ8ATGM_OpenTop_Turret_C': [
      { name: 'HJ8L High Explosive Anti-Tank', class: 'BP_HJ8ATGM_CSK131', mags: 6, magSize: 1, type: 'atgm', caliber: '120mm' },
    ],
  },
};

// CSK131 HJ-8 (PLA / PLAAGF, desert) — same layout, Desert-suffixed turret
// class. Weapon class is shared with the woodland variant.
VEHICLE_LOADOUTS['BP_CSK131_HJ8ATGM_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'ATGM Gunner', turretClass: 'BP_HJ8ATGM_OpenTop_Turret_Desert_C' },
    { index: 2, role: 'Passenger',   turretClass: null },
    { index: 3, role: 'Passenger',   turretClass: null },
    { index: 4, role: 'Passenger',   turretClass: null },
    { index: 5, role: 'Passenger',   turretClass: null },
    { index: 6, role: 'Passenger',   turretClass: null },
  ],
  turrets: {
    'BP_HJ8ATGM_OpenTop_Turret_Desert_C': [
      { name: 'HJ8L High Explosive Anti-Tank', class: 'BP_HJ8ATGM_CSK131', mags: 6, magSize: 1, type: 'atgm', caliber: '120mm' },
    ],
  },
};

// BRDM-2 Spandrel (GFI) — BRDM-2 wheeled recon chassis with a 9M113 Konkurs
// ATGM launcher turret (BP_Spandrel_GFI_Turret_Static_C) plus an unarmed
// commander periscope station. 3 seats: Driver, ATGM gunner, Commander.
VEHICLE_LOADOUTS['BP_BRDM-2_GFI_Spandrel_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'ATGM Gunner', turretClass: 'BP_Spandrel_GFI_Turret_Static_C' },
    { index: 2, role: 'Commander',   turretClass: 'BP_BRDM-2_periscope_Spandrel_GFI_C' },
  ],
  turrets: {
    'BP_Spandrel_GFI_Turret_Static_C': [
      { name: '9M113 Konkurs Guided Missile', class: 'BP_Spandrel_GFI_9M113_Konkurs', mags: 1, magSize: 5, type: 'atgm', caliber: '135mm' },
    ],
    // Commander periscope is unarmed.
    'BP_BRDM-2_periscope_Spandrel_GFI_C': [],
  },
};

// BRDM-2 Spandrel (RGF, woodland) — Russian Ground Forces green-camo variant.
// Turret class BP_Spandrel_Turret_C + weapon BP_Spandrel_9M113_Konkurs.
VEHICLE_LOADOUTS['BP_BRDM-2_Spandrel_RUS_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'ATGM Gunner', turretClass: 'BP_Spandrel_Turret_C' },
    { index: 2, role: 'Commander',   turretClass: 'BP_BRDM-2_periscope_Spandrel_Rus_Green_C' },
  ],
  turrets: {
    'BP_Spandrel_Turret_C': [
      { name: '9M113 Konkurs Guided Missile', class: 'BP_Spandrel_9M113_Konkurs', mags: 1, magSize: 5, type: 'atgm', caliber: '135mm' },
    ],
    'BP_BRDM-2_periscope_Spandrel_Rus_Green_C': [],
  },
};

// BRDM-2 Spandrel (RGF, desert) — Tan-camo variant. Turret/weapon/periscope
// all carry the _Tan suffix.
VEHICLE_LOADOUTS['BP_BRDM-2_Spandrel_RUS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',      turretClass: null },
    { index: 1, role: 'ATGM Gunner', turretClass: 'BP_Spandrel_Turret_Tan_C' },
    { index: 2, role: 'Commander',   turretClass: 'BP_BRDM-2_periscope_Spandrel_Rus_Tan_C' },
  ],
  turrets: {
    'BP_Spandrel_Turret_Tan_C': [
      { name: '9M113 Konkurs Guided Missile', class: 'BP_Spandrel_9M113_Konkurs_Tan', mags: 1, magSize: 5, type: 'atgm', caliber: '135mm' },
    ],
    'BP_BRDM-2_periscope_Spandrel_Rus_Tan_C': [],
  },
};

// BRDM-2 (MEI / OpFor) — KPVT 14.5mm + PKT coax turret + smoke launchers.
// 3 active seats (Driver, Gunner, Commander periscope) + 2 passengers.
VEHICLE_LOADOUTS['BP_BRDM-2_Insurgents_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BRDM2_INS_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BRDM-2_periscope_Insurgents_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BRDM2_INS_turret_C': [
      { name: '40mm Smoke Launchers', class: 'BP_BRDM2_INS_Smoke_Launcher', mags: 1, magSize: 2, type: 'smoke' },
      { name: 'PKT Coaxial Machine Gun', class: 'BP_BRDM2_INS_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
      { name: 'KPVT BZT', class: 'BP_BRDM2_INS_KPVT', mags: 9, magSize: 50, type: 'kinetic', caliber: '14.5mm' },
    ],
    'BP_BRDM-2_periscope_Insurgents_C': [],
  },
};
// BRDM-2 (VDV / RGF desert) — desert-suffixed KPVT + PKT + smoke. 3 + 2 seats.
VEHICLE_LOADOUTS['BP_BRDM-2_RUS_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BRDM2_RUS_Desert_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BRDM-2_periscope_Rus_Desert_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BRDM2_RUS_Desert_turret_C': [
      { name: '40mm Smoke Launchers', class: 'BP_BRDM2_RUS_Desert_Smoke_Launcher', mags: 1, magSize: 2, type: 'smoke' },
      { name: 'PKT Coaxial Machine Gun', class: 'BP_BRDM2_RUS_Desert_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
      { name: 'KPVT BZT', class: 'BP_BRDM2_RUS_Desert_KPVT', mags: 9, magSize: 50, type: 'kinetic', caliber: '14.5mm' },
    ],
    'BP_BRDM-2_periscope_Rus_Desert_C': [],
  },
};
// BRDM-2 (VDV / RGF woodland) — woodland/base KPVT + PKT + smoke. 3 + 2 seats.
VEHICLE_LOADOUTS['BP_BRDM-2_RUS_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BRDM2_RUS_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BRDM-2_periscope_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BRDM2_RUS_turret_C': [
      { name: '40mm Smoke Launchers', class: 'BP_BRDM2_RUS_Smoke_Launcher', mags: 1, magSize: 2, type: 'smoke' },
      { name: 'PKT Coaxial Machine Gun', class: 'BP_BRDM2_RUS_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
      { name: 'KPVT BZT', class: 'BP_BRDM2_RUS_KPVT', mags: 9, magSize: 50, type: 'kinetic', caliber: '14.5mm' },
    ],
    'BP_BRDM-2_periscope_C': [],
  },
};
// BRDM-2 (IMF) — MIL-suffixed KPVT + PKT + smoke. 3 + 2 seats.
VEHICLE_LOADOUTS['BP_BRDM-2_MIL_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BRDM2_MIL_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BRDM-2_periscope_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BRDM2_MIL_turret_C': [
      { name: '40mm Smoke Launchers', class: 'BP_BRDM2_MIL_Smoke_Launcher', mags: 1, magSize: 2, type: 'smoke' },
      { name: 'PKT Coaxial Machine Gun', class: 'BP_BRDM2_MIL_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
      { name: 'KPVT BZT', class: 'BP_BRDM2_MIL_KPVT', mags: 9, magSize: 50, type: 'kinetic', caliber: '14.5mm' },
    ],
    'BP_BRDM-2_periscope_C': [],
  },
};
// BRDM-2L1 (AFU) — AFU-suffixed KPVT + PKT + smoke. 3 + 5 seats.
VEHICLE_LOADOUTS['BP_BRDM-2L1_AFU_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BRDM2_AFU_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BRDM-2_periscope_AFU_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BRDM2_AFU_turret_C': [
      { name: '40mm Smoke Launchers', class: 'BP_BRDM2_AFU_Smoke_Launcher', mags: 1, magSize: 2, type: 'smoke' },
      { name: 'PKT Coaxial Machine Gun', class: 'BP_BRDM2_AFU_PKT', mags: 5, magSize: 250, type: 'mg', caliber: '7.62mm' },
      { name: 'KPVT BZT', class: 'BP_BRDM2_AFU_KPVT', mags: 9, magSize: 50, type: 'kinetic', caliber: '14.5mm' },
    ],
    'BP_BRDM-2_periscope_AFU_C': [],
  },
};
// BRDM-2 UB-32 (GFI) — KPVT + PKT + UB-32 S5 rockets + smoke. 3 + 2 seats.
VEHICLE_LOADOUTS['BP_BRDM-2_GFI_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'Gunner',    turretClass: 'BP_BRDM2_GFI_turret_C' },
    { index: 2, role: 'Commander', turretClass: 'BP_BRDM-2_periscope_GFI_C' },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_BRDM2_GFI_turret_C': [
      { name: '40mm Smoke Launchers',          class: 'BP_BRDM2_GFI_Smoke_Launcher', mags: 1, magSize: 2,   type: 'smoke' },
      { name: 'PKT Coaxial Machine Gun',        class: 'BP_BRDM2_GFI_PKT',            mags: 5, magSize: 250, type: 'mg',      caliber: '7.62mm' },
      { name: 'S5 Rockets (UB-32)',             class: 'BP_BRDM2_GFI_UB32',           mags: 1, magSize: 32,  type: 'heat',    caliber: '57mm' },
      { name: 'KPVT BZT',                       class: 'BP_BRDM2_GFI_KPVT',           mags: 9, magSize: 50,  type: 'kinetic', caliber: '14.5mm' },
    ],
    'BP_BRDM-2_periscope_GFI_C': [],
  },
};
// Cobra II M2 RWS (TLF) — RWS M2HB + driver smoke. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_RWS_M2_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_CobraRWS_M2_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_CobraRWS_M2_Turret_C': [
      { name: 'RWS M2HB', class: 'BP_CobraRWS_M2', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Cobra II M2 RWS Desert (TLF) — desert-suffixed turret/weapon. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_RWS_M2_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_CobraRWS_M2_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_CobraRWS_M2_Turret_Desert_C': [
      { name: 'RWS M2HB', class: 'BP_CobraRWS_M2_Desert', mags: 1, magSize: 400, type: 'kinetic', caliber: '12.7mm' },
    ],
  },
};
// Cobra II MG3 RWS (TLF) — RWS MG3 + driver smoke. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_RWS_MG3_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_CobraRWS_MG3_Turret_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_CobraRWS_MG3_Turret_C': [
      { name: 'RWS MG3', class: 'BP_CobraRWS_MG3', mags: 1, magSize: 750, type: 'mg', caliber: '7.62mm' },
    ],
  },
};
// Cobra II MG3 RWS Desert (TLF) — desert-suffixed turret/weapon. 2 + 9 seats.
VEHICLE_LOADOUTS['BP_Cobra2_RWS_MG3_Desert_C'] = {
  seats: [
    { index: 0,  role: 'Driver',    turretClass: null },
    { index: 1,  role: 'Gunner',    turretClass: 'BP_CobraRWS_MG3_Turret_Desert_C' },
    { index: 2,  role: 'Passenger', turretClass: null },
    { index: 3,  role: 'Passenger', turretClass: null },
    { index: 4,  role: 'Passenger', turretClass: null },
    { index: 5,  role: 'Passenger', turretClass: null },
    { index: 6,  role: 'Passenger', turretClass: null },
    { index: 7,  role: 'Passenger', turretClass: null },
    { index: 8,  role: 'Passenger', turretClass: null },
    { index: 9,  role: 'Passenger', turretClass: null },
    { index: 10, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'Driver': [
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Cobra2_Driver', mags: 1, magSize: 2, type: 'smoke' },
    ],
    'BP_CobraRWS_MG3_Turret_Desert_C': [
      { name: 'RWS MG3', class: 'BP_CobraRWS_MG3_Desert', mags: 1, magSize: 750, type: 'mg', caliber: '7.62mm' },
    ],
  },
};

// Technical Mortar (WPMC, black) — 2-seater pickup with an M252 81mm
// mortar turret on the bed. 3 seats (2 + 1): Driver, Mortar gunner,
// 1 rear passenger. Two ammo types: Smoke + HE.
VEHICLE_LOADOUTS['BP_Technical2Seater_Mortar_Black_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'Mortar Gunner', turretClass: 'BP_Technical_MortarTurret_M252_C' },
    { index: 2, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_Technical_MortarTurret_M252_C': [
      { name: 'M819 81mm Smoke',          class: 'BP_Technical_M252mortar_Smoke', mags: 7, magSize: 3, type: 'smoke', caliber: '81mm' },
      { name: 'M821A1 81mm High Explosive', class: 'BP_Technical_M252mortar',     mags: 7, magSize: 3, type: 'he',    caliber: '81mm' },
    ],
  },
};

// Technical Mortar (WPMC, grey) — identical loadout to the black variant.
VEHICLE_LOADOUTS['BP_Technical2Seater_Mortar_Grey_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_Mortar_Black_C'];
VEHICLE_LOADOUTS['BP_Technical2Seater_Mortar_Tan_C']  = VEHICLE_LOADOUTS['BP_Technical2Seater_Mortar_Black_C'];

// Modern Technical UB-32 (IMF) — camo 2-seater pickup with a UB-32 S5
// rocket pod mounted on the bed. 4 seats (2 + 2): Driver, UB-32 gunner,
// 2 rear passengers.
VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_UB32_C'] = {
  seats: [
    { index: 0, role: 'Driver',        turretClass: null },
    { index: 1, role: 'Rocket Gunner', turretClass: 'BP_Technical_Turret_UB32_C' },
    { index: 2, role: 'Passenger',     turretClass: null },
    { index: 3, role: 'Passenger',     turretClass: null },
  ],
  turrets: {
    'BP_Technical_Turret_UB32_C': [
      { name: 'S5 Rockets', class: 'BP_UB32', mags: 2, magSize: 32, type: 'heat', caliber: '57mm' },
    ],
  },
};

// Technical UB-32 (white skin variant). Same UB-32 S5 rocket pod loadout as
// the Camo variant; only the body texture differs.
VEHICLE_LOADOUTS['BP_Technical2Seater_White_UB32_C'] = VEHICLE_LOADOUTS['BP_Technical2Seater_Camo_UB32_C'];

// M113A2T M121 (TLF, woodland) — Turkish Land Forces variant of the M1064
// 120mm mortar carrier. Shares the exact mortar turret/weapon classes as
// the US M1064A3. M2 turret uses the ACV15-shared open-turret class.
// 3 seats: Driver, M2 gunner, Mortar gunner.
VEHICLE_LOADOUTS['BP_M1064_M121_TLF_C'] = {
  seats: [
    { index: 0, role: 'Driver',         turretClass: null },
    { index: 1, role: 'M2 Gunner',      turretClass: 'BP_ACV15_OpenTurret_M2_Turret_C' },
    { index: 2, role: 'Mortar Gunner',  turretClass: 'BP_M1064A3_MortarTurret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_M2_Turret_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'mg', caliber: '12.7mm' },
    ],
    'BP_M1064A3_MortarTurret_C': [
      { name: 'M929 120mm White Smoke',                 class: 'BP_M1064A3_M121mortar_Smoke',    mags: 1, magSize: 15, type: 'smoke', caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Near-Surface', class: 'BP_M1064A3_M121mortar_Airburst', mags: 1, magSize: 15, type: 'he',    caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Impact',     class: 'BP_M1064A3_M121mortar',          mags: 1, magSize: 30, type: 'he',    caliber: '120mm' },
    ],
  },
};

// M113A2T M121 (TLF, desert) — desert camo variant using the Desert-suffixed
// ACV15 open-turret class. Same M2 weapon + mortar classes as the woodland.
VEHICLE_LOADOUTS['BP_M1064_M121_TLF_Desert_C'] = {
  seats: [
    { index: 0, role: 'Driver',         turretClass: null },
    { index: 1, role: 'M2 Gunner',      turretClass: 'BP_ACV15_OpenTurret_M2_Turret_Desert_C' },
    { index: 2, role: 'Mortar Gunner',  turretClass: 'BP_M1064A3_MortarTurret_C' },
  ],
  turrets: {
    'Driver': [
      { name: 'Smoke Generator',      class: 'SmokeGenerator_Tracked',        mags: 1, magSize: 30, type: 'smoke' },
      { name: '40mm Smoke Launchers', class: 'BP_Smoke_Launcher_Tigr_Driver', mags: 1, magSize: 2,  type: 'smoke' },
    ],
    'BP_ACV15_OpenTurret_M2_Turret_Desert_C': [
      { name: 'M2A1 Browning', class: 'BP_ACV15_OpenTurret_M2_Weapon', mags: 10, magSize: 100, type: 'mg', caliber: '12.7mm' },
    ],
    'BP_M1064A3_MortarTurret_C': [
      { name: 'M929 120mm White Smoke',                 class: 'BP_M1064A3_M121mortar_Smoke',    mags: 1, magSize: 15, type: 'smoke', caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Near-Surface', class: 'BP_M1064A3_M121mortar_Airburst', mags: 1, magSize: 15, type: 'he',    caliber: '120mm' },
      { name: 'M934A1 120mm High Explosive Impact',     class: 'BP_M1064A3_M121mortar',          mags: 1, magSize: 30, type: 'he',    caliber: '120mm' },
    ],
  },
};

// Ural-375D ZU-23-2 (MEI) — Ural-375 truck with a bed-mounted ZU-23-2
// autocannon. Uses the INS-suffixed ZU-23 asset pair. 4 seats (2 + 2):
// Driver, ZU-23 gunner, 2 rear passengers.
VEHICLE_LOADOUTS['BP_Ural_375_ZU23_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_INS_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_ZU23Vehicle_Base_INS_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
  },
};

// Ural-375D ZU-23-2 (IMF) — Militia variant with the base ZU-23 asset pair
// (BP_ZU23Vehicle_Base_C + BP_Emplaced_ZU23-2_Antiaircannon_Weapon).
// Same 4-seat (2 + 2) layout as the MEI variant.
VEHICLE_LOADOUTS['BP_Ural_375_ZU23_MIL_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'AA Gunner', turretClass: 'BP_ZU23Vehicle_Base_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_ZU23Vehicle_Base_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
  },
};

// Technical ZU-23-2 (MEI) — 2-seater white pickup (BP_Technical2Seater_White_ZU23)
// with a single ZU-23-2 twin autocannon turret on the bed. 3 seats total
// (2 crew + 1 passenger): Driver, ZU-23 gunner, 1 rear passenger.
VEHICLE_LOADOUTS['BP_Technical2Seater_White_ZU23_C'] = {
  seats: [
    { index: 0, role: 'Driver',    turretClass: null },
    { index: 1, role: 'AA Gunner', turretClass: 'BP_ZU23_Turret_Technical_INS_C' },
    { index: 2, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_ZU23_Turret_Technical_INS_C': [
      { name: 'ZU-23 OFZT Fragmentation Tracer', class: 'BP_Emplaced_ZU23-2_Antiaircannon_Weapon_INS', mags: 10, magSize: 100, type: 'aa', caliber: '23mm' },
    ],
  },
};

// ZSL10 QLZ-87 — PLA. Same ZSL10 chassis fitted with an open-top QLZ-87 35mm
// automatic grenade launcher instead of the QJZ-89 cupola HMG.
VEHICLE_LOADOUTS['BP_ZSL10_QLZ-87_C'] = {
  seats: [
    { index: 0, role: 'Driver', turretClass: null },
    { index: 1, role: 'Gunner', turretClass: 'BP_QLZ87_ZBL08_OpenTop_Turret_C' },
    { index: 2, role: 'Passenger', turretClass: null },
    { index: 3, role: 'Passenger', turretClass: null },
    { index: 4, role: 'Passenger', turretClass: null },
    { index: 5, role: 'Passenger', turretClass: null },
    { index: 6, role: 'Passenger', turretClass: null },
    { index: 7, role: 'Passenger', turretClass: null },
    { index: 8, role: 'Passenger', turretClass: null },
  ],
  turrets: {
    'BP_QLZ87_ZBL08_OpenTop_Turret_C': [
      // QLZ-87 HEDP 35mm AGL: HEAT damage type with 80mm armor pen.
      { name: 'QLZ-87 AGL (HEDP)', class: 'BP_QLZ87_Weapon_ZBL08', mags: 15, magSize: 15, type: 'heat', caliber: '35mm' },
    ],
  },
};
  return VEHICLE_LOADOUTS as Record<string, VehicleLoadout>;
})();

export const VEHICLE_LOADOUTS = VEHICLE_LOADOUTS_RAW;

export function vehicleLoadout(classShort: string | null | undefined): VehicleLoadout | null {
  if (!classShort) return null;
  return VEHICLE_LOADOUTS[classShort] ?? null;
}
