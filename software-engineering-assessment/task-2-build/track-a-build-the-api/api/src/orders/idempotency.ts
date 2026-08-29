import { errorEnvelope, type StoredHttp } from '../common/error-envelope';

export type SnapshotLine = {
  productId: string;
  name: string;
  quantity: number;
  priceCents: number;
};

export type CheckoutSnapshot = {
  userId: string;
  lines: SnapshotLine[];
  totalCents: number;
  couponCode: string | null;
};

export type CheckoutPhase =
  | { kind: 'claimed' }
  | { kind: 'reserved'; snapshot: CheckoutSnapshot }
  | { kind: 'charged'; snapshot: CheckoutSnapshot; chargeId: string };

export const CLAIMED = JSON.stringify({ kind: 'claimed' } satisfies CheckoutPhase);

export function isStoredHttp(value: unknown): value is StoredHttp {
  return (
    typeof value === 'object' &&
    value !== null &&
    'statusCode' in value &&
    typeof (value as StoredHttp).statusCode === 'number' &&
    'body' in value
  );
}

export function parseIdempotency(
  raw: string | null,
): StoredHttp | CheckoutPhase | null {
  if (!raw) return null;
  if (raw === 'pending') return { kind: 'claimed' };
  try {
    const value = JSON.parse(raw) as unknown;
    if (isStoredHttp(value)) return value;
    if (value && typeof value === 'object' && 'kind' in value) {
      const kind = (value as { kind: unknown }).kind;
      if (kind === 'claimed' || kind === 'reserved' || kind === 'charged') {
        return value as CheckoutPhase;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function processingUnavailable(): StoredHttp {
  return {
    statusCode: 503,
    body: errorEnvelope(
      'UNAVAILABLE',
      'الطلب ما زال قيد المعالجة. حاول مرة أخرى.',
    ),
  };
}
