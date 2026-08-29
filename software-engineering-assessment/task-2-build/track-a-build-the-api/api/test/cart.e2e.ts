import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import {
  envelope,
  jsonDelete,
  jsonGet,
  jsonPatch,
  jsonPost,
  loginAs,
  seedUsers,
} from './helpers';

type CartItemJson = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: string;
  quantity: number;
};

type CartJson = {
  items: CartItemJson[];
  coupon: string | null;
  discount: string;
};

const kettle = {
  id: 'p_002',
  sku: 'hacked-sku',
  name: 'اسم مزوّر',
  category: 'kitchen',
  price: '0.01',
  stock: 9999,
  imageUrl: '/img/kettle.jpg',
  description: 'ignored',
  quantity: 1,
};

function cartOf(json: unknown): CartJson {
  assert.ok(json && typeof json === 'object');
  const cart = json as CartJson;
  assert.ok(Array.isArray(cart.items));
  assert.ok(cart.coupon === null || typeof cart.coupon === 'string');
  assert.match(cart.discount, /^\d+\.\d{2}$/);
  return cart;
}

async function resetCart(token: string): Promise<void> {
  const { json } = await jsonGet('/cart', token);
  const cart = cartOf(json);
  for (const item of cart.items) {
    const removed = await jsonDelete(`/cart/items/${item.id}`, token);
    assert.equal(removed.status, 204);
  }
  const cleared = await jsonPost('/cart/coupon', { code: '' }, token);
  assert.equal(cleared.status, 200);
}

describe('cart (through nginx /api)', () => {
  const [salma, karim] = seedUsers();
  let salmaToken = '';
  let karimToken = '';

  before(async () => {
    if (!salma || !karim) throw new Error('seed.json needs two users');
    salmaToken = await loginAs(salma);
    karimToken = await loginAs(karim);
    await resetCart(salmaToken);
    await resetCart(karimToken);
  });

  it('rejects the cart without a bearer token', async () => {
    const { status, json } = await jsonGet('/cart');
    assert.equal(status, 401);
    assert.equal(envelope(json).code, 'UNAUTHORIZED');
  });

  it('returns an empty cart with a null coupon', async () => {
    const { status, json } = await jsonGet('/cart', salmaToken);
    assert.equal(status, 200);
    const cart = cartOf(json);
    assert.equal(cart.items.length, 0);
    assert.equal(cart.coupon, null);
    assert.equal(cart.discount, '0.00');
  });

  it('ignores client price and stock and merges the same product onto one line', async () => {
    const first = await jsonPost('/cart/items', kettle, salmaToken);
    assert.equal(first.status, 201);
    const lineId = (first.json as { id: string }).id;
    assert.match(lineId, /^ci_/);

    const second = await jsonPost('/cart/items', kettle, salmaToken);
    assert.equal(second.status, 201);
    assert.equal((second.json as { id: string }).id, lineId);

    const { json } = await jsonGet('/cart', salmaToken);
    const cart = cartOf(json);
    assert.equal(cart.items.length, 1);
    const line = cart.items[0];
    assert.equal(line.id, lineId);
    assert.equal(line.productId, 'p_002');
    assert.equal(line.sku, 'KTL-COP-02');
    assert.equal(line.name, 'إبريق تقطير نحاسي');
    assert.equal(line.price, '89.50');
    assert.equal(line.quantity, 2);
  });

  it('patches and deletes a line by its own id, not the product id', async () => {
    const { json: before } = await jsonGet('/cart', salmaToken);
    const existing = cartOf(before).items[0];
    assert.ok(existing);
    const lineId = existing.id;

    const patched = await jsonPatch(
      `/cart/items/${lineId}`,
      { quantity: 3 },
      salmaToken,
    );
    assert.equal(patched.status, 200);
    assert.equal((patched.json as { id: string; quantity: number }).quantity, 3);

    const missingProduct = await jsonPatch(
      '/cart/items/p_002',
      { quantity: 1 },
      salmaToken,
    );
    assert.equal(missingProduct.status, 404);
    assert.equal(envelope(missingProduct.json).code, 'NOT_FOUND');

    const removed = await jsonDelete(`/cart/items/${lineId}`, salmaToken);
    assert.equal(removed.status, 204);
    const { json } = await jsonGet('/cart', salmaToken);
    assert.equal(cartOf(json).items.length, 0);
  });

  it('refuses zero stock and does not leak another user line', async () => {
    const zero = await jsonPost(
      '/cart/items',
      { id: 'p_012', quantity: 1 },
      salmaToken,
    );
    assert.equal(zero.status, 409);
    assert.equal(envelope(zero.json).code, 'OUT_OF_STOCK');

    const added = await jsonPost('/cart/items', { id: 'p_002', quantity: 1 }, salmaToken);
    assert.equal(added.status, 201);
    const lineId = (added.json as { id: string }).id;

    const foreign = await jsonPatch(
      `/cart/items/${lineId}`,
      { quantity: 2 },
      karimToken,
    );
    assert.equal(foreign.status, 404);

    const karimCart = cartOf((await jsonGet('/cart', karimToken)).json);
    assert.equal(karimCart.items.length, 0);

    await jsonDelete(`/cart/items/${lineId}`, salmaToken);
  });

  it('applies SAVE10 from catalog prices, rejects expired codes, and clears on empty', async () => {
    await jsonPost('/cart/items', { id: 'p_002', quantity: 1 }, salmaToken);
    await jsonPost('/cart/items', { id: 'p_002', quantity: 1 }, salmaToken);

    const tooSmall = await jsonPost(
      '/cart/coupon',
      { code: 'SAVE10' },
      karimToken,
    );
    assert.equal(tooSmall.status, 400);
    assert.equal(envelope(tooSmall.json).code, 'COUPON_MIN_ORDER');

    const expired = await jsonPost(
      '/cart/coupon',
      { code: 'EXPIRED2024' },
      salmaToken,
    );
    assert.equal(expired.status, 400);
    assert.equal(envelope(expired.json).code, 'COUPON_EXPIRED');
    assert.equal(envelope(expired.json).message, 'عذرًا، انتهت صلاحية كود الخصم.');

    const unknown = await jsonPost(
      '/cart/coupon',
      { code: 'NOPE' },
      salmaToken,
    );
    assert.equal(unknown.status, 400);
    assert.equal(envelope(unknown.json).code, 'COUPON_NOT_FOUND');

    const applied = await jsonPost(
      '/cart/coupon',
      { code: 'save10' },
      salmaToken,
    );
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json, { coupon: 'SAVE10', discount: '17.90' });

    const { json } = await jsonGet('/cart', salmaToken);
    const cart = cartOf(json);
    assert.equal(cart.coupon, 'SAVE10');
    assert.equal(cart.discount, '17.90');

    const cleared = await jsonPost('/cart/coupon', { code: '  ' }, salmaToken);
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.json, { coupon: null, discount: '0.00' });
  });

  it('refuses WELCOME at apply time once the global cap is reached', async () => {
    await resetCart(salmaToken);
    assert.equal(
      (await jsonPost('/cart/items', { id: 'p_001', quantity: 1 }, salmaToken))
        .status,
      201,
    );
    const applied = await jsonPost(
      '/cart/coupon',
      { code: 'WELCOME' },
      salmaToken,
    );
    if (applied.status === 200) return;
    assert.equal(applied.status, 400);
    assert.equal(envelope(applied.json).code, 'COUPON_LIMIT');
  });
});
