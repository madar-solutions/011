export type ChargeCard = {
  name: string;
  number: string;
  expiry: string;
  cvc: string;
};

export type ChargeResult =
  | { kind: 'approved'; chargeId: string }
  | { kind: 'declined'; chargeId: string | null }
  | { kind: 'unavailable' };

export type ChargeLookup =
  | { kind: 'approved'; chargeId: string }
  | { kind: 'declined' }
  | { kind: 'none' }
  | { kind: 'unknown' };

function digits(number: string): string {
  return number.replace(/\D/g, '');
}

function paymentsOrigin(url: string): string {
  return url.replace(/\/$/, '');
}

export async function chargeCard(input: {
  url: string;
  timeoutMs: number;
  amount: string;
  card: ChargeCard;
  reference: string;
}): Promise<ChargeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const res = await fetch(`${paymentsOrigin(input.url)}/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: input.amount,
        reference: input.reference,
        card: {
          name: input.card.name,
          number: digits(input.card.number),
          expiry: input.card.expiry,
          cvc: input.card.cvc,
        },
      }),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      status?: string;
      chargeId?: string;
    } | null;
    if (res.status === 200 && json?.status === 'approved' && json.chargeId) {
      return { kind: 'approved', chargeId: json.chargeId };
    }
    if (res.status === 402) {
      return { kind: 'declined', chargeId: json?.chargeId ?? null };
    }
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** Ledger check before compensating a reservation. Never treat a fetch error as "no charge". */
export async function lookupCharge(input: {
  url: string;
  reference: string;
}): Promise<ChargeLookup> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${paymentsOrigin(input.url)}/charges`, {
      signal: controller.signal,
    });
    if (!res.ok) return { kind: 'unknown' };
    const body = (await res.json()) as {
      charges?: Array<{
        id?: string;
        reference?: string | null;
        status?: string;
      }>;
    };
    const match = [...(body.charges ?? [])]
      .reverse()
      .find((c) => c.reference === input.reference);
    if (!match) return { kind: 'none' };
    if (match.status === 'approved' && match.id) {
      return { kind: 'approved', chargeId: match.id };
    }
    if (match.status === 'declined') return { kind: 'declined' };
    return { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}
