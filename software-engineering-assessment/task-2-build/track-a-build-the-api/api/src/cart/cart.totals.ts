export type CouponType = 'percent' | 'amount';

export type CouponInput = {
  code: string;
  type: CouponType;
  value: { toString(): string } | string | number;
  minOrder: { toString(): string } | string | number | null;
  maxRedemptions: number | null;
  perUserLimit: number | null;
  expiresAt: Date | null;
};

export type RedemptionCounts = {
  global: number;
  user: number;
};

export type CouponFailure =
  | 'COUPON_EXPIRED'
  | 'COUPON_MIN_ORDER'
  | 'COUPON_LIMIT';

export type CartLineInput = {
  priceCents: number;
  quantity: number;
};

export type CartTotals = {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
};

export function toCents(
  value: { toString(): string } | string | number,
): number {
  return Math.round(Number(value.toString()) * 100);
}

export function formatMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function lineSubtotalCents(priceCents: number, quantity: number): number {
  return priceCents * quantity;
}

function percentOf(subtotalCents: number, percent: number): number {
  return Math.round((subtotalCents * percent) / 100);
}

function amountDiscountCents(
  subtotalCents: number,
  coupon: CouponInput,
): number {
  return Math.min(subtotalCents, toCents(coupon.value));
}

export function couponDiscount(
  coupon: CouponInput,
  subtotalCents: number,
  now: Date,
  redemptions: RedemptionCounts = { global: 0, user: 0 },
): { ok: true; discountCents: number } | { ok: false; reason: CouponFailure } {
  if (coupon.expiresAt && coupon.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'COUPON_EXPIRED' };
  }
  if (
    coupon.maxRedemptions != null &&
    redemptions.global >= coupon.maxRedemptions
  ) {
    return { ok: false, reason: 'COUPON_LIMIT' };
  }
  if (
    coupon.perUserLimit != null &&
    redemptions.user >= coupon.perUserLimit
  ) {
    return { ok: false, reason: 'COUPON_LIMIT' };
  }
  if (coupon.minOrder != null && subtotalCents < toCents(coupon.minOrder)) {
    return { ok: false, reason: 'COUPON_MIN_ORDER' };
  }
  const discountCents =
    coupon.type === 'percent'
      ? percentOf(subtotalCents, Number(coupon.value.toString()))
      : amountDiscountCents(subtotalCents, coupon);
  return { ok: true, discountCents };
}

export function cartTotals(
  lines: CartLineInput[],
  coupon: CouponInput | null,
  now: Date,
  redemptions?: RedemptionCounts,
): CartTotals {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + lineSubtotalCents(line.priceCents, line.quantity),
    0,
  );
  let discountCents = 0;
  if (coupon) {
    const result = couponDiscount(coupon, subtotalCents, now, redemptions);
    if (result.ok) discountCents = result.discountCents;
  }
  return {
    subtotalCents,
    discountCents,
    totalCents: Math.max(0, subtotalCents - discountCents),
  };
}
