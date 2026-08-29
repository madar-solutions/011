import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  abortedPost,
  envelope,
  jsonDelete,
  jsonGet,
  jsonPost,
  loginAs,
  seedUser,
  seedUsers,
} from './helpers';

const paymentsUrl = (
  process.env.PAYMENTS_URL ?? 'http://payments:9090'
).replace(/\/$/, '');

const mug = { id: 'p_001', quantity: 1 };
const candle = { id: 'p_015', quantity: 1 };

const approvedCard = {
  name: 'سلمى الحسيني',
  number: '4242424242424242',
  expiry: '12/29',
  cvc: '123',
};

function checkoutBody(
  card: typeof approvedCard,
  total = '0.01',
): unknown {
  return {
    coupon: 'SAVE10',
    card,
    summary: { subtotal: '0.01', discount: '0.00', total },
  };
}

type CartJson = {
  items: Array<{ id: string }>;
};

async function resetCart(token: string): Promise<void> {
  const { json } = await jsonGet('/cart', token);
  const cart = json as CartJson;
  for (const item of cart.items ?? []) {
    await jsonDelete(`/cart/items/${item.id}`, token);
  }
  await jsonPost('/cart/coupon', { code: '' }, token);
}

async function addAndCheckout(
  token: string,
  product: { id: string; quantity: number },
  card: typeof approvedCard,
  requestId = randomUUID(),
): Promise<{ status: number; json: unknown; requestId: string }> {
  const added = await jsonPost('/cart/items', product, token);
  assert.equal(added.status, 201);
  const result = await jsonPost('/orders', checkoutBody(card), token, {
    'X-Request-Id': requestId,
  });
  return { ...result, requestId };
}

async function chargesFor(reference: string): Promise<unknown[]> {
  const res = await fetch(`${paymentsUrl}/charges`);
  assert.equal(res.ok, true);
  const body = (await res.json()) as {
    charges: Array<{ reference: string | null }>;
  };
  return body.charges.filter((c) => c.reference === reference);
}

async function productStock(token: string, id: string): Promise<number> {
  const { status, json } = await jsonGet(`/products/${id}`, token);
  assert.equal(status, 200);
  return (json as { stock: number }).stock;
}

describe('orders checkout (through nginx /api)', () => {
  const salma = seedUser();
  let token = '';

  before(async () => {
    token = await loginAs(salma);
    await resetCart(token);
  });

  it('rejects checkout without a bearer token', async () => {
    const { status, json } = await jsonPost(
      '/orders',
      checkoutBody(approvedCard),
      undefined,
      { 'X-Request-Id': randomUUID() },
    );
    assert.equal(status, 401);
    assert.equal(envelope(json).code, 'UNAUTHORIZED');
  });

  it('rejects checkout without X-Request-Id', async () => {
    const { status, json } = await jsonPost(
      '/orders',
      checkoutBody(approvedCard),
      token,
    );
    assert.equal(status, 400);
    assert.equal(envelope(json).code, 'VALIDATION');
  });

  it('rejects a non-date card expiry without calling the gateway', async () => {
    const requestId = randomUUID();
    const { status, json } = await jsonPost(
      '/orders',
      checkoutBody({ ...approvedCard, expiry: 'not-a-date' }),
      token,
      { 'X-Request-Id': requestId },
    );
    assert.equal(status, 400);
    assert.equal(envelope(json).code, 'VALIDATION');
    assert.match(envelope(json).message, /تاريخ/);
    assert.equal((await chargesFor(requestId)).length, 0);
  });

  it('rejects a card number that is not 16 digits without calling the gateway', async () => {
    const requestId = randomUUID();
    const { status, json } = await jsonPost(
      '/orders',
      checkoutBody({ ...approvedCard, number: '4242' }),
      token,
      { 'X-Request-Id': requestId },
    );
    assert.equal(status, 400);
    assert.equal(envelope(json).code, 'VALIDATION');
    assert.match(envelope(json).message, /16/);
    assert.equal((await chargesFor(requestId)).length, 0);
  });

  it('rejects an expired card month without calling the gateway', async () => {
    const requestId = randomUUID();
    const { status, json } = await jsonPost(
      '/orders',
      checkoutBody({ ...approvedCard, expiry: '01/20' }),
      token,
      { 'X-Request-Id': requestId },
    );
    assert.equal(status, 400);
    assert.equal(envelope(json).code, 'VALIDATION');
    assert.equal((await chargesFor(requestId)).length, 0);
  });

  it('charges catalog total not the client summary and lists the order', async () => {
    await resetCart(token);
    const stockBefore = await productStock(token, mug.id);
    const placed = await addAndCheckout(token, mug, approvedCard);
    assert.equal(placed.status, 201);
    const created = placed.json as {
      id: string;
      status: string;
      total: string;
      createdAt: string;
    };
    assert.match(created.id, /^o_/);
    assert.equal(created.status, 'paid');
    assert.equal(created.total, '18.00');
    assert.equal(typeof created.createdAt, 'string');

    const cart = await jsonGet('/cart', token);
    assert.equal((cart.json as CartJson).items.length, 0);
    assert.equal(await productStock(token, mug.id), stockBefore - 1);

    const list = await jsonGet('/orders', token);
    assert.equal(list.status, 200);
    const items = (list.json as { items: Array<{ id: string }> }).items;
    assert.ok(items.some((o) => o.id === created.id));

    const detail = await jsonGet(`/orders/${created.id}`, token);
    assert.equal(detail.status, 200);
    const order = detail.json as {
      items: Array<{ productId: string; price: string; quantity: number }>;
    };
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0]?.productId, mug.id);
    assert.equal(order.items[0]?.price, '18.00');
    assert.equal(order.items[0]?.quantity, 1);

    const billed = await chargesFor(placed.requestId);
    assert.equal(billed.length, 1);
  });

  it('does not keep a declined charge or drop stock', async () => {
    await resetCart(token);
    const stockBefore = await productStock(token, mug.id);
    const listed = await jsonGet('/orders', token);
    const beforeCount = (listed.json as { items: unknown[] }).items.length;

    const declined = await addAndCheckout(token, mug, {
      ...approvedCard,
      number: '4000000000000002',
    });
    assert.equal(declined.status, 402);
    assert.equal(envelope(declined.json).code, 'CARD_DECLINED');
    assert.equal(await productStock(token, mug.id), stockBefore);
    const cart = await jsonGet('/cart', token);
    assert.equal((cart.json as CartJson).items.length, 1);

    const after = await jsonGet('/orders', token);
    assert.equal(
      (after.json as { items: unknown[] }).items.length,
      beforeCount,
    );
  });

  it(
    'retries the same X-Request-Id after abort without a second charge',
    { timeout: 25_000 },
    async () => {
      await resetCart(token);
      const added = await jsonPost('/cart/items', candle, token);
      assert.equal(added.status, 201);
      const requestId = randomUUID();
      const body = checkoutBody({
        ...approvedCard,
        number: '4000000000000069',
      });

      await abortedPost(
        '/orders',
        body,
        token,
        { 'X-Request-Id': requestId },
        1000,
      );

      const retried = await jsonPost('/orders', body, token, {
        'X-Request-Id': requestId,
      });
      assert.equal(retried.status, 201);
      const created = retried.json as { id: string; total: string };
      assert.equal(created.total, '16.00');
      assert.equal((await chargesFor(requestId)).length, 1);

      const again = await jsonPost('/orders', body, token, {
        'X-Request-Id': requestId,
      });
      assert.equal(again.status, 201);
      assert.equal((again.json as { id: string }).id, created.id);
      assert.equal((await chargesFor(requestId)).length, 1);
    },
  );

  it('returns 404 with the shared envelope when the order is missing', async () => {
    const missing = await jsonGet('/orders/nope', token);
    assert.equal(missing.status, 404);
    const error = envelope(missing.json);
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, 'الطلب غير موجود.');
  });

  it(
    'takes the cart on the first request id so a second uuid cannot charge twice',
    { timeout: 25_000 },
    async () => {
    await resetCart(token);
    const added = await jsonPost('/cart/items', mug, token);
    assert.equal(added.status, 201);
    const idA = randomUUID();
    const idB = randomUUID();
    const body = checkoutBody(approvedCard);
    const [a, b] = await Promise.all([
      jsonPost('/orders', body, token, { 'X-Request-Id': idA }),
      jsonPost('/orders', body, token, { 'X-Request-Id': idB }),
    ]);
    const pair = [
      { id: idA, ...a },
      { id: idB, ...b },
    ];
    const paid = pair.filter((r) => r.status === 201);
    const empty = pair.filter(
      (r) => r.status === 400 && envelope(r.json).code === 'VALIDATION',
    );
    assert.equal(paid.length, 1);
    assert.equal(empty.length, 1);
    assert.equal((await chargesFor(paid[0].id)).length, 1);
    assert.equal((await chargesFor(empty[0].id)).length, 0);
    },
  );

  it(
    'lets only one paid order redeem WELCOME',
    { timeout: 25_000 },
    async () => {
    const users = seedUsers();
    const karim = users[1];
    assert.ok(karim);
    const karimToken = await loginAs(karim);
    await resetCart(token);
    await resetCart(karimToken);
    assert.equal((await jsonPost('/cart/items', mug, token)).status, 201);
    assert.equal(
      (await jsonPost('/cart/items', { id: 'p_011', quantity: 1 }, karimToken))
        .status,
      201,
    );
    assert.equal(
      (await jsonPost('/cart/coupon', { code: 'WELCOME' }, token)).status,
      200,
    );
    assert.equal(
      (await jsonPost('/cart/coupon', { code: 'WELCOME' }, karimToken)).status,
      200,
    );

    const idA = randomUUID();
    const idB = randomUUID();
    const [a, b] = await Promise.all([
      jsonPost('/orders', checkoutBody(approvedCard), token, {
        'X-Request-Id': idA,
      }),
      jsonPost('/orders', checkoutBody(approvedCard), karimToken, {
        'X-Request-Id': idB,
      }),
    ]);
    const pair = [a, b];
    const paid = pair.filter((r) => r.status === 201);
    const limited = pair.filter(
      (r) => r.status === 400 && envelope(r.json).code === 'COUPON_LIMIT',
    );
    assert.equal(paid.length + limited.length, 2);
    assert.ok(paid.length <= 1);
    assert.ok(limited.length >= 1);
    },
  );
});
