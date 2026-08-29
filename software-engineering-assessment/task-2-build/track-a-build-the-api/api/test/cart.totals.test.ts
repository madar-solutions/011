import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cartTotals,
  couponDiscount,
  formatMoney,
  toCents,
  type CouponInput,
} from '../src/cart/cart.totals';

const now = new Date('2026-08-29T12:00:00Z');

function save10(): CouponInput {
  return {
    code: 'SAVE10',
    type: 'percent',
    value: '10',
    minOrder: '50.00',
    maxRedemptions: null,
    perUserLimit: null,
    expiresAt: null,
  };
}

function flat20(): CouponInput {
  return {
    code: 'FLAT20',
    type: 'amount',
    value: '20.00',
    minOrder: null,
    maxRedemptions: null,
    perUserLimit: null,
    expiresAt: null,
  };
}

describe('cart totals (domain, no HTTP)', () => {
  it('matches the storefront SAVE10 example: two kettles at 89.50', () => {
    const totals = cartTotals(
      [{ priceCents: toCents('89.50'), quantity: 2 }],
      save10(),
      now,
    );
    assert.equal(formatMoney(totals.subtotalCents), '179.00');
    assert.equal(formatMoney(totals.discountCents), '17.90');
    assert.equal(formatMoney(totals.totalCents), '161.10');
  });

  it('caps an amount coupon at the subtotal and never goes negative', () => {
    const totals = cartTotals(
      [{ priceCents: toCents('18.00'), quantity: 1 }],
      flat20(),
      now,
    );
    assert.equal(formatMoney(totals.discountCents), '18.00');
    assert.equal(formatMoney(totals.totalCents), '0.00');
  });

  it('rejects SAVE10 below min order and expired codes', () => {
    const tooSmall = couponDiscount(save10(), toCents('18.00'), now);
    assert.equal(tooSmall.ok, false);
    if (!tooSmall.ok) assert.equal(tooSmall.reason, 'COUPON_MIN_ORDER');

    const expired = couponDiscount(
      {
        ...save10(),
        code: 'EXPIRED2024',
        minOrder: null,
        expiresAt: new Date('2024-12-31T23:59:59Z'),
      },
      toCents('179.00'),
      now,
    );
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.equal(expired.reason, 'COUPON_EXPIRED');
  });

  it('enforces redemption limits so checkout can pass counts later', () => {
    const welcome: CouponInput = {
      code: 'WELCOME',
      type: 'percent',
      value: '15',
      minOrder: null,
      maxRedemptions: 1,
      perUserLimit: null,
      expiresAt: null,
    };
    const usedUp = couponDiscount(welcome, toCents('100.00'), now, {
      global: 1,
      user: 0,
    });
    assert.equal(usedUp.ok, false);
    if (!usedUp.ok) assert.equal(usedUp.reason, 'COUPON_LIMIT');
  });
});
