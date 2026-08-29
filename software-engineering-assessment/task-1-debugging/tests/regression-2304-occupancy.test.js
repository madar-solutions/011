/**
 * Regression tests for incident 2304 — "the room shows unavailable on a turnover day".
 *
 * Written against SPEC.md, not against current behaviour. They cover the root cause —
 * one definition of "overlapping" owned by the system — rather than the reported symptom.
 *
 * Three quick fixes were measured against the reference fixture during the investigation
 * and rejected (evidence/2304-rejected-quick-fixes.md). Each block names the one it
 * catches, so that a change which merely raises the fixture score cannot pass here:
 *
 *   D1  availabilityRepo SQL only          590/596  — REVERSES the contradiction
 *   D2  both overlap predicates            592/596  — ignores SPEC 5 (cancelled bookings)
 *   D3  both predicates + status filter    594/596  — leaves half the ticket unfixed
 *
 * Phase 3 established an isolating witness row for each defect, and the tests below are
 * built on those four: A0456 (departure end), A0405 (arrival end), A0479/A0487 (cancelled
 * bookings counted), E0593/E0594 (a reservation competing with itself).
 *
 * ORDERING MATTERS. The database is in-memory and shared across this file, so every
 * non-mutating assertion comes first and the two mutating blocks come last.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const api = startServer();
test.after(() => api.close());

async function availability(roomTypeId, checkIn, checkOut) {
  const { status, body } = await api.get(
    `/availability?roomTypeId=${roomTypeId}&checkIn=${checkIn}&checkOut=${checkOut}`
  );
  assert.equal(status, 200);
  return body.roomTypes.find((r) => r.roomTypeId === roomTypeId);
}

// ---------------------------------------------------------------------------
// A. A stay is [checkIn, checkOut). Two stays that merely touch do not overlap.
//    SPEC.md 2: "a stay's departure date may be the same as the next stay's arrival date."
// ---------------------------------------------------------------------------

test('2304: a booking departing on the arrival date does not occupy the room', async () => {
  // RES-10999 (STD) checks out on 2026-11-10, so the room is free from that morning.
  // Witness row A0456 — isolates the DEPARTURE end of the comparison.
  assert.equal((await availability('STD', '2026-11-10', '2026-11-12')).available, 1); // today: 0
});

test('2304: a booking arriving on the departure date does not occupy the room either', async () => {
  // RES-10861 (STD) arrives 2026-03-02, which is this query's own checkout date.
  // Witness row A0405 — isolates the ARRIVAL end. A fix that corrects only one
  // comparison leaves exactly one of these two tests red.
  assert.equal((await availability('STD', '2026-02-27', '2026-03-02')).available, 6); // today: 5
});

test('2304: a one-night turnover counts neither the departure nor the arrival', async () => {
  // The night of 2026-11-10 alone: RES-10999 leaves that morning and RES-11004 arrives
  // on the 11th. Both ends are wrong today, so this window over-counts by two.
  assert.equal((await availability('STD', '2026-11-10', '2026-11-11')).available, 2); // today: 0
});

// ---------------------------------------------------------------------------
// B. SPEC.md 5: "a cancelled reservation frees the room immediately and does not
//    count towards occupancy thereafter."
//    These windows genuinely overlap a cancelled booking, so no amount of care with
//    the interval convention rescues them — this is what catches D1 and D2.
// ---------------------------------------------------------------------------

test('2304: a cancelled reservation does not occupy a room', async () => {
  // RES-11081 (SUI, 2026-10-06..10-08) is cancelled. Witness row A0479.
  assert.equal((await availability('SUI', '2026-10-05', '2026-10-09')).available, 1); // today: 0
});

test('2304: cancelled reservations are excluded on every room type', async () => {
  // RES-11082 (DLX, 2026-10-14..10-18) is cancelled. Witness row A0487.
  assert.equal((await availability('DLX', '2026-10-14', '2026-10-18')).available, 1); // today: 0
});

// ---------------------------------------------------------------------------
// Guards: occupancy that is real must keep being reported and enforced.
//    A fix that relaxes counting too far would oversell the hotel, which is worse
//    than the defect being fixed.
// ---------------------------------------------------------------------------

test('2304 guard: a genuinely full room type still reports zero', async () => {
  // SUI has two rooms; RES-11150 (12-02..12-05) and RES-11151 (12-01..12-09) both
  // genuinely overlap these dates.
  assert.equal((await availability('SUI', '2026-12-02', '2026-12-05')).available, 0);
});

test('2304 guard: booking into a genuinely full window is still refused', async () => {
  const { status, body } = await api.post('/reservations', {
    guestName: 'Guard 2304',
    roomTypeId: 'SUI',
    checkIn: '2026-12-02',
    checkOut: '2026-12-05',
    guests: 2
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'NO_ROOMS_AVAILABLE');
});

// ---------------------------------------------------------------------------
// C. The two surfaces must answer the same question the same way.
//    This is what catches D1: correcting only availabilityRepo does not remove the
//    contradiction, it reverses it — the screen starts offering a room that the
//    booking endpoint then refuses to sell.
// ---------------------------------------------------------------------------

test('2304: what availability offers, the booking endpoint sells', async () => {
  const before = await availability('STD', '2026-11-10', '2026-11-12');
  assert.ok(before.available > 0, 'precondition: the turnover-day room is on offer');

  const created = await api.post('/reservations', {
    guestName: 'Walk-in 2304',
    roomTypeId: 'STD',
    checkIn: '2026-11-10',
    checkOut: '2026-11-12',
    guests: 2
  });
  assert.equal(
    created.status,
    201,
    `availability offered ${before.available} room(s) and the booking was refused with ${created.status}`
  );

  const after = await availability('STD', '2026-11-10', '2026-11-12');
  assert.equal(after.available, before.available - 1, 'the sale must show up in availability');
});

// ---------------------------------------------------------------------------
// D. A reservation must not compete with itself when its dates change.
//    Witness rows E0593/E0594 — the ticket's second complaint, and the only thing
//    D3 leaves broken while scoring 594/596.
// ---------------------------------------------------------------------------

test('2304: a guest can extend their own booking', async () => {
  // RES-11150 (SUI, 2026-12-02..12-05) extended to the 7th. SUI has two rooms and only
  // RES-11151 genuinely overlaps, so one room is free — unless the booking is counted
  // against itself.
  const { status, body } = await api.patch('/reservations/RES-11150', {
    checkIn: '2026-12-02',
    checkOut: '2026-12-07'
  });
  assert.equal(status, 200, `extending RES-11150 was refused with ${status}`);
  assert.equal(body.checkOut, '2026-12-07');
});

test('2304: a guest can shorten their own booking', async () => {
  const { status, body } = await api.patch('/reservations/RES-11150', {
    checkIn: '2026-12-02',
    checkOut: '2026-12-04'
  });
  assert.equal(status, 200);
  assert.equal(body.checkOut, '2026-12-04');
});

test('2304 guard: excluding a reservation from its own count excludes only that one', async () => {
  // After the two patches above, RES-11150 occupies 12-02..12-04 and RES-11151 occupies
  // 12-01..12-09. Both rooms of the suite are taken, so a THIRD booking must still fail.
  // A self-exclusion implemented as "ignore existing bookings" would oversell here.
  const { status, body } = await api.post('/reservations', {
    guestName: 'Third Suite 2304',
    roomTypeId: 'SUI',
    checkIn: '2026-12-03',
    checkOut: '2026-12-06',
    guests: 2
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, 'NO_ROOMS_AVAILABLE');
});
