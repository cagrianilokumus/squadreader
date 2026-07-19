// Squad ticket-cost constants, ported from data/static/squad_pools.json (which
// is backend-only). Used by the ticket-timeline attribution to price destroyed
// vehicles and FOB radios. Per-team TOTALS stay exact regardless of these — the
// costs only shape how an observed ticket drop is SPLIT across causes.

import type { Vehicle } from "./types";

// Per vehicle-pool ticket cost — used as a per-kind CAP when attributing a
// destruction to the observed ticket drop. Set slightly generous vs the
// squad_pools.json baseline (real servers run a touch higher, e.g. an ACV-15
// Light IFV cost 10 in observed data) because the attribution clamps every
// claim to the ACTUAL tick delta anyway, so a generous cap can never over-count
// — it only avoids under-counting a real lump. A Vehicle's `kind` (attached
// server-side) is exactly one of these keys.
export const VEHICLE_TICKETS: Record<string, number> = {
  MBT: 20, "Heavy IFV": 15, "Light IFV": 12, APC: 10, Scout: 8, Heli: 20, Transport: 6,
};

// Per-className exceptions (short class form — no BP_ prefix / _C suffix).
export const VEHICLE_TICKET_OVERRIDES: Record<string, number> = {
  BTR82A_RUS: 10, BTR82A_RUS_Desert: 10, LAV6_Desert: 10, LAV6_Woodland: 10,
};

export const TICKET_COSTS = {
  infantryWound: 1, commanderKill: 2, rallyDestroy: 1,
  fobDestroy: 20, neutralFlagCap: 20, enemyFlagCap: 60,
};

export const DEATH_COST = 1;

const DEFAULT_VEHICLE_COST = 8;

// BP_BMP2_Desert_C -> BMP2_Desert (override keys use this short form).
function normClass(c: string | null | undefined): string {
  return (c ?? "").replace(/^BP_/, "").replace(/_C$/, "");
}

// Ticket cost of losing this vehicle: className override first, else its pool
// `kind`, else a middling default.
export function vehicleTicketCost(v: Vehicle): number {
  const key = normClass(v.classShort);
  if (key in VEHICLE_TICKET_OVERRIDES) return VEHICLE_TICKET_OVERRIDES[key];
  if (v.kind && v.kind in VEHICLE_TICKETS) return VEHICLE_TICKETS[v.kind];
  return DEFAULT_VEHICLE_COST;
}
