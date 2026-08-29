/**
 * Regression tests for a defect found during the 2291/2304 investigation and reported in
 * FINDINGS.md rather than in either ticket: SPEC.md 2 says the party may not exceed the
 * room type's capacity, and nothing enforced it.
 *
 * The reference fixture does not catch this. Its CREATE_GUESTS rows only try guests: 9,
 * which trips the generic 1..8 bound in validate.js and never reaches the capacity rule,
 * so both rows pass while the rule is unimplemented. These tests exercise the values that
 * matter: one guest over each room type's real capacity, and exactly at it.
 *
 * Dates are in April 2026, which no seeded reservation touches, so occupancy never
 * interferes with the assertion under test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const api = startServer();
test.after(() => api.close());

const book = (roomTypeId, guests, checkIn = '2026-04-10', checkOut = '2026-04-12') =>
  api.post('/reservations', { guestName: 'Capacity probe', roomTypeId, checkIn, checkOut, guests });

// SPEC.md 1: STD sleeps 2, DLX sleeps 3, SUI sleeps 4.

test('capacity: a Standard Twin does not sleep three', async () => {
  const { status, body } = await book('STD', 3);
  assert.ok(status >= 400 && status < 500, `expected a 4xx, got ${status}`);
  assert.ok(body?.error?.code);
  assert.doesNotMatch(JSON.stringify(body), /at \/|\.js:\d|SELECT /i);
});

test('capacity: a Deluxe King does not sleep four', async () => {
  assert.ok((await book('DLX', 4)).status >= 400);
});

test('capacity: a Riverside Suite does not sleep five', async () => {
  assert.ok((await book('SUI', 5)).status >= 400);
});

test('capacity guard: a party exactly at capacity is accepted', async () => {
  // The rule is "may not exceed", so the boundary itself must still book. Getting this
  // wrong would turn an unenforced rule into an off-by-one that refuses real bookings.
  assert.equal((await book('STD', 2, '2026-04-14', '2026-04-16')).status, 201);
  assert.equal((await book('DLX', 3, '2026-04-14', '2026-04-16')).status, 201);
  assert.equal((await book('SUI', 4, '2026-04-14', '2026-04-16')).status, 201);
});

test('capacity guard: the generic guests bound still applies first', async () => {
  // guests: 9 is outside the 1..8 request bound, so it stays a 400 INVALID_INPUT and does
  // not become a capacity rejection. This is what the fixture's CREATE_GUESTS rows assert.
  const { status, body } = await book('SUI', 9);
  assert.equal(status, 400);
  assert.equal(body.error.code, 'INVALID_INPUT');
});
