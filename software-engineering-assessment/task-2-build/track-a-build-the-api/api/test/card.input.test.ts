import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  compactExpiry,
  digitsOnly,
  isCvc,
  isSixteenDigitPan,
  isValidCardExpiry,
} from '../src/orders/card.input';

const now = new Date('2026-08-29T12:00:00Z');

describe('card input', () => {
  it('accepts a 16-digit PAN and strips spaces', () => {
    assert.equal(digitsOnly('4242 4242 4242 4242'), '4242424242424242');
    assert.equal(isSixteenDigitPan('4242424242424242'), true);
    assert.equal(isSixteenDigitPan('424242424242424'), false);
    assert.equal(isSixteenDigitPan('42424242424242421'), false);
  });

  it('accepts a 3 or 4 digit CVC', () => {
    assert.equal(isCvc('123'), true);
    assert.equal(isCvc('1234'), true);
    assert.equal(isCvc('12'), false);
    assert.equal(isCvc('12a'), false);
  });

  it('requires MM/YY and rejects a past month', () => {
    assert.equal(compactExpiry(' 12 / 29 '), '12/29');
    assert.equal(isValidCardExpiry('12/29', now), true);
    assert.equal(isValidCardExpiry('08/26', now), true);
    assert.equal(isValidCardExpiry('07/26', now), false);
    assert.equal(isValidCardExpiry('13/29', now), false);
    assert.equal(isValidCardExpiry('not-a-date', now), false);
  });
});
