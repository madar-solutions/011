import { getDb } from '../db/index.js';

/**
 * The single definition of occupancy for a room type over a date range.
 *
 * This is the only place in the system that decides whether a reservation occupies a room
 * on given dates. It used to be one of two: reservationService carried a second, parallel
 * implementation in JavaScript, and the two drifted apart on two axes at once — the
 * interval convention and the status filter — which is incident 2304. The second copy was
 * deleted rather than corrected, so they cannot disagree again.
 *
 * Three rules, all from SPEC.md:
 *
 *   half-open ranges (2)  Both a stay and the query window are [check_in, check_out), so
 *                         the overlap test is strict at both ends. "A stay's departure date
 *                         may be the same as the next stay's arrival date": a booking that
 *                         leaves on the arrival date, or arrives on the departure date,
 *                         occupies nothing.
 *   confirmed only  (5)   "A cancelled reservation frees the room immediately and does not
 *                         count towards occupancy thereafter."
 *   who is asking   (2)   A reservation must not be counted against itself when its own
 *                         dates change, or it competes with itself and can never be moved.
 *                         `r.id IS NOT ?` is null-safe, so with no exclusion the clause is
 *                         `IS NOT NULL` and every reservation is kept.
 */
export function countOverlapping(roomTypeId, checkIn, checkOut, { excludeReservationId = null } = {}) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS booked
         FROM reservations r
        WHERE r.room_type_id = ?
          AND r.status       = 'confirmed'
          AND r.check_in     <  ?
          AND r.check_out    >  ?
          AND r.id           IS NOT ?`
    )
    .get(roomTypeId, checkOut, checkIn, excludeReservationId);
  return row.booked;
}
