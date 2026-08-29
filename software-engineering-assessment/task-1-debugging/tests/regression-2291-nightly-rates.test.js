/**
 * Regression tests for incident 2291 — "a six-night stay is charged as seven".
 *
 * These tests are written against SPEC.md, not against the current implementation.
 * They all fail on the code as it stands today and must pass once the pricing path
 * resolves a rate per NIGHT OF THE STAY instead of per SEASON OF THE CALENDAR.
 *
 * Scope note: they cover the ROOT CAUSE, not just the reported symptom. Three quick
 * fixes were measured against the reference fixture during the investigation and
 * rejected (see FINDINGS.md / evidence/rejected-quick-fixes.md). Each block below
 * names the rejected fix it is designed to catch, so that a future change that
 * "makes the ticket green" cannot pass here:
 *
 *   candidate 1  `date < segmentEnd`                     20/596  — breaks correct stays
 *   candidate 2  `addDays(season.end_date, -1)`         481/596  — leaves unpriced nights free
 *   candidate 3  `nights.slice(0, diffDays(...))`       320/596  — right count, wrong money
 *
 * Error codes are deliberately NOT asserted. SPEC.md 7 requires a client/business
 * rejection to be distinguishable from a system fault, so these tests assert the 4xx
 * class and the presence of an error envelope, and leave the choice of code to the fix.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { enumerateNights } from '../src/lib/dates.js';

const api = startServer();
test.after(() => api.close());

const quote = (roomTypeId, checkIn, checkOut) => api.post('/quotes', { roomTypeId, checkIn, checkOut });

/** SPEC.md 7: a business rejection is a 4xx carrying an error envelope — never a 200, never a 500. */
function assertBusinessRejection({ status, body }, what) {
  assert.ok(status >= 400 && status < 500, `${what}: expected a 4xx business rejection, got ${status}`);
  assert.ok(body?.error?.code, `${what}: expected an error envelope with a code`);
  assert.equal(typeof body.error.message, 'string');
  assert.doesNotMatch(
    JSON.stringify(body),
    /at \/|\.js:\d|SELECT |FROM rate_calendar/i,
    `${what}: the error must not leak stack traces, SQL or file paths (SPEC.md 7)`
  );
}

// ---------------------------------------------------------------------------
// A. The reported defect: a season boundary that falls on a night of the stay
//    is billed twice — once by the outgoing season, once by the incoming one.
// ---------------------------------------------------------------------------

test('2291: RES-10842 — DLX 2026-08-28..2026-09-03 is six nights, not seven', async () => {
  const { status, body } = await quote('DLX', '2026-08-28', '2026-09-03');

  assert.equal(status, 200);
  assert.equal(body.nights.length, 6);
  assert.equal(body.roomTotal, '1410.00'); // 4 x 210.00 HIGH + 2 x 285.00 FESTIVAL
  assert.equal(body.tax, '169.20');
  assert.equal(body.total, '1594.20'); // today: 1829.40 — a 235.20 overcharge per booking
});

test('2291: no date is priced twice — the boundary night belongs to exactly one season', async () => {
  // The mechanism, asserted directly. Candidate 3 makes the COUNT right while leaving
  // 2026-09-01 in the list twice, so a count-only assertion would let it through.
  const { body } = await quote('DLX', '2026-08-28', '2026-09-03');
  const dates = body.nights.map((n) => n.date);

  assert.deepEqual(dates, [...new Set(dates)], `a date was priced more than once: ${dates.join(' ')}`);
  assert.equal(dates.filter((d) => d === '2026-09-01').length, 1);
  assert.equal(body.nights.find((n) => n.date === '2026-09-01').season, 'FESTIVAL');
  assert.equal(body.nights.find((n) => n.date === '2026-08-31').season, 'HIGH');
});

test('2291: the priced nights are exactly the nights slept, in order', async () => {
  // The invariant behind the whole defect: the rate calendar prices the stay, it does
  // not decide how long the stay is. availabilityService.js already computes this count
  // correctly and independently, which is why the two disagree today.
  for (const [roomTypeId, checkIn, checkOut] of [
    ['DLX', '2026-08-28', '2026-09-03'], // crosses one boundary
    ['SUI', '2026-06-01', '2026-06-02'], // boundary ON the arrival date
    ['DLX', '2026-08-27', '2026-09-10'], // crosses two boundaries
    ['DLX', '2026-07-10', '2026-07-15'], // no boundary at all — must stay correct
    ['DLX', '2026-08-28', '2026-09-01']  // ends exactly on a boundary — must stay correct
  ]) {
    const { body } = await quote(roomTypeId, checkIn, checkOut);
    assert.deepEqual(
      body.nights.map((n) => n.date),
      enumerateNights(checkIn, checkOut),
      `${roomTypeId} ${checkIn}..${checkOut}`
    );
  }
});

test('2291: a stay whose ARRIVAL falls on a season boundary is one night', async () => {
  // The case the first pass of this investigation missed: rateRepo.findSeasons selects the
  // already-expired season (`end_date >= from`), and pricingService then gives it a
  // one-night segment on the arrival date. Both layers have to be fixed.
  const { status, body } = await quote('SUI', '2026-06-01', '2026-06-02');

  assert.equal(status, 200);
  assert.equal(body.nights.length, 1);
  assert.equal(body.nights[0].season, 'HIGH');
  assert.equal(body.total, '418.20'); // today: 687.00, the LOW season is billed as well
});

test('2291: crossing two boundaries adds two duplicates, so it must be caught too', async () => {
  const { body } = await quote('DLX', '2026-08-27', '2026-09-10');

  assert.equal(body.nights.length, 14); // today: 16
  assert.equal(body.total, '3795.00');
});

// ---------------------------------------------------------------------------
// Guards: stays that are CORRECT today and must remain correct.
// Candidate 1 (`date < segmentEnd`) takes the suite from 320/596 to 20/596 — it is
// caught here rather than only by the reference fixture.
// ---------------------------------------------------------------------------

test('2291 guard: a single-season stay is unchanged', async () => {
  const { body } = await quote('DLX', '2026-07-10', '2026-07-15');
  assert.equal(body.nights.length, 5);
  assert.equal(body.roomTotal, '1050.00');
});

test('2291 guard: a one-night stay still costs one night', async () => {
  const { body } = await quote('STD', '2026-02-02', '2026-02-03');
  assert.equal(body.nights.length, 1);
  assert.equal(body.total, '115.80');
});

test('2291 guard: a stay ending exactly on a boundary is unchanged', async () => {
  const { body } = await quote('DLX', '2026-08-28', '2026-09-01');
  assert.equal(body.nights.length, 4);
  assert.equal(body.roomTotal, '840.00');
});

// ---------------------------------------------------------------------------
// B1. SPEC.md 3: "the system must not invent a price for a night that has no rate,
//     and must not price or bill such a stay. Revenue prefers refusing the booking."
//     The seed leaves 2026-12-20..2026-12-26 uncovered on purpose.
//     Candidate 2 fixes the ticket and still fails every one of these.
// ---------------------------------------------------------------------------

test('2291/B1: a night with no tariff is never invented', async () => {
  // 2026-12-20 is SHOULDER's EXCLUSIVE end, so it has no rate at all — yet today it is
  // quoted at the SHOULDER rate of 110.00. This is the same defect pointing the other way.
  const res = await quote('STD', '2026-12-20', '2026-12-21');
  assertBusinessRejection(res, 'a stay on an unpriced night');
});

test('2291/B1: a stay straddling a gap is refused, not silently short-billed', async () => {
  // Today: 200, seven nights billed out of thirteen, jumping 2026-12-20 -> 2026-12-27.
  const res = await quote('STD', '2026-12-18', '2026-12-31');
  assertBusinessRejection(res, 'a stay straddling the rate gap');
});

test('2291/B1: a stay beyond the end of the rate calendar is refused', async () => {
  // Today: 200 with nights=0 and total=15.00 — thirteen nights for a resort fee.
  const res = await quote('DLX', '2027-01-07', '2027-01-20');
  assertBusinessRejection(res, 'a stay past the last defined season');
});

test('2291/B1: the rate preview refuses an unpriced range as well', async () => {
  const res = await api.get('/rates/preview?roomTypeId=STD&from=2026-12-11&to=2026-12-21');
  assertBusinessRejection(res, '/rates/preview over the rate gap');
});

// ---------------------------------------------------------------------------
// B2/B3/B4. The same non-total function accepts stays and rooms that do not exist.
// ---------------------------------------------------------------------------

test('2291/B2: a zero-night stay is refused, not billed a resort fee', async () => {
  assertBusinessRejection(await quote('DLX', '2026-08-28', '2026-08-28'), 'checkIn == checkOut');
});

test('2291/B2: a reversed date range is refused', async () => {
  assertBusinessRejection(await quote('DLX', '2026-09-03', '2026-08-28'), 'checkOut < checkIn');
});

test('2291/B3: an unknown room type is refused, not quoted at 15.00', async () => {
  assertBusinessRejection(await quote('XXX', '2026-08-28', '2026-09-03'), 'unknown room type');
});

test('2291/B4: a stay longer than 180 nights is refused (SPEC.md 2)', async () => {
  // 2026-01-01..2026-12-20 is 353 nights and every one of them is covered by a season,
  // so this isolates the length rule from the rate-calendar gap.
  assertBusinessRejection(await quote('STD', '2026-01-01', '2026-12-20'), 'a 353-night stay');
});

// ---------------------------------------------------------------------------
// Blast radius: the same wrong night list reaches availability, the folio and
// cancellation. Fixing the quote endpoint alone is not enough.
// ---------------------------------------------------------------------------

test('2291: /availability stops contradicting itself', async () => {
  // Today this single JSON object reports nights=6 next to a total priced over 7 nights.
  const { body } = await api.get('/availability?roomTypeId=DLX&checkIn=2026-08-28&checkOut=2026-09-03');
  const dlx = body.roomTypes.find((r) => r.roomTypeId === 'DLX');

  assert.equal(dlx.nights, 6);
  assert.equal(dlx.quotedTotal, '1594.20');
});

test('2291: the folio carries one room line per night slept and the right balance', async () => {
  const created = await api.post('/reservations', {
    guestName: 'Regression 2291',
    roomTypeId: 'DLX',
    checkIn: '2026-08-28',
    checkOut: '2026-09-03',
    guests: 2
  });
  assert.equal(created.status, 201);

  const { body } = await api.get(`/reservations/${created.body.id}/folio`);
  const roomLines = body.lines.filter((l) => l.kind === 'room');
  const dates = roomLines.map((l) => l.date);

  assert.equal(roomLines.length, 6); // today: 7
  assert.deepEqual(dates, [...new Set(dates)], `the folio bills a date twice: ${dates.join(' ')}`);
  assert.deepEqual(dates, enumerateNights('2026-08-28', '2026-09-03'));
  assert.equal(body.balanceDue, '1594.20'); // today: 1829.40
});

test('2291: a stay that cannot be priced cannot be booked either', async () => {
  // Closes the crash path at its source. Today this returns 201 with a folio of nothing
  // but a resort fee, and a later FLEX cancellation reads nights[0] of an empty array:
  //   TypeError: Cannot read properties of undefined (reading 'rateCents')  -> HTTP 500
  // SPEC.md 7 requires a business rejection to be distinguishable from a system fault.
  const res = await api.post('/reservations', {
    guestName: 'Regression 2291 unpriceable',
    roomTypeId: 'DLX',
    checkIn: '2027-01-07',
    checkOut: '2027-01-20',
    guests: 1
  });
  assertBusinessRejection(res, 'booking a stay with no tariff');
});
