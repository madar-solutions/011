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

function digits(number: string): string {
  return number.replace(/\D/g, '');
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
    const res = await fetch(`${input.url.replace(/\/$/, '')}/charge`, {
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
