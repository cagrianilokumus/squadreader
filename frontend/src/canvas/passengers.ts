// Heuristic passenger join: when a soldier has `attached=true`, their
// world position is the seat position which is essentially the same as
// the parent vehicle's position. So nearest-vehicle-within-threshold
// reliably identifies who's in which vehicle, without the backend
// needing to walk SQVehicleSeat reflection.
//
// Two soldiers parked within 5 m of each other in DIFFERENT vehicles
// would mis-attribute, but that scenario barely exists in Squad —
// vehicles have physical separation, and seats inside one vehicle
// are all within ~3 m of each other.

import type { Player, Snapshot, Vehicle } from "../state/types";

// 500 UE units = 5 m. Comfortable margin around seat → root-component offset.
const PASSENGER_RADIUS_SQ = 500 * 500;

export function passengersOf(snap: Snapshot | null, vehicle: Vehicle): Player[] {
  if (!snap || !vehicle.position) return [];
  const vx = vehicle.position.x, vy = vehicle.position.y;
  const out: Player[] = [];
  for (const p of snap.players ?? []) {
    const s = p.soldier;
    if (!s || s.stale || !s.attached || !s.position) continue;
    const dx = s.position.x - vx;
    const dy = s.position.y - vy;
    if (dx * dx + dy * dy <= PASSENGER_RADIUS_SQ) out.push(p);
  }
  return out;
}
