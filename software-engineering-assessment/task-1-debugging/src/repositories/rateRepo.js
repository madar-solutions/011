import { getDb } from '../db/index.js';

/**
 * Seasons overlapping the half-open stay [from, to).
 *
 * Both season bounds and stay bounds are half-open (SPEC.md 2 and 3, and the comment on
 * rate_calendar in schema.sql), so the overlap test is strict on both sides. Reading
 * either end as inclusive selects a season that covers none of the stay's nights: with
 * `end_date >= from` a season that ended ON the arrival date was returned, and the
 * pricing loop then billed the arrival night at that expired season's rate — the second
 * half of incident 2291.
 */
export function findSeasons(roomTypeId, from, to) {
  return getDb()
    .prepare(
      `SELECT season, start_date, end_date, nightly_rate_cents
         FROM rate_calendar
        WHERE room_type_id = ?
          AND start_date < ?
          AND end_date   > ?
        ORDER BY start_date`
    )
    .all(roomTypeId, to, from);
}
