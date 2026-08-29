import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { envelope, jsonGet, loginAsSeedUser } from './helpers';

type ProductJson = {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: string;
  stock: number;
  imageUrl: string;
  description: string;
};

function itemsOf(json: unknown): ProductJson[] {
  assert.ok(json && typeof json === 'object' && 'items' in json);
  const items = (json as { items: ProductJson[] }).items;
  assert.ok(Array.isArray(items));
  return items;
}

function assertProductShape(product: ProductJson): void {
  assert.equal(typeof product.id, 'string');
  assert.equal(typeof product.sku, 'string');
  assert.equal(typeof product.name, 'string');
  assert.equal(typeof product.price, 'string');
  assert.match(product.price, /^\d+\.\d{2}$/);
  assert.equal(typeof product.stock, 'number');
}

describe('products catalog (through nginx /api)', () => {
  it('rejects the catalog without a bearer token', async () => {
    const { status, json } = await jsonGet('/products');
    assert.equal(status, 401);
    assert.equal(envelope(json).code, 'UNAUTHORIZED');
  });

  it('lists twenty seeded products with two-decimal prices including zero stock', async () => {
    const token = await loginAsSeedUser();
    const { status, json } = await jsonGet('/products', token);
    assert.equal(status, 200);
    const items = itemsOf(json);
    assert.equal(items.length, 20);
    for (const product of items) {
      assertProductShape(product);
    }
    const umbrella = items.find((p) => p.id === 'p_012');
    assert.ok(umbrella);
    assert.equal(umbrella.stock, 0);
  });

  it('finds the copper kettle by Arabic query and treats blank q as the full list', async () => {
    const token = await loginAsSeedUser();
    const found = await jsonGet(
      `/products?q=${encodeURIComponent('إبريق')}`,
      token,
    );
    assert.equal(found.status, 200);
    const hits = itemsOf(found.json);
    assert.ok(hits.some((p) => p.id === 'p_002'));

    const blank = await jsonGet('/products?q=%20%20', token);
    assert.equal(blank.status, 200);
    assert.equal(itemsOf(blank.json).length, 20);
  });

  it('does not execute a SQL payload in q', async () => {
    const token = await loginAsSeedUser();
    const { status, json } = await jsonGet(
      `/products?q=${encodeURIComponent("'; DROP TABLE products; --")}`,
      token,
    );
    assert.equal(status, 200);
    const items = itemsOf(json);
    assert.ok(items.length < 20);
    const stillThere = await jsonGet('/products', token);
    assert.equal(itemsOf(stillThere.json).length, 20);
  });

  it('returns one product by id and 404 with the shared envelope when missing', async () => {
    const token = await loginAsSeedUser();
    const ok = await jsonGet('/products/p_002', token);
    assert.equal(ok.status, 200);
    const product = ok.json as ProductJson;
    assert.equal(product.id, 'p_002');
    assertProductShape(product);

    const missing = await jsonGet('/products/nope', token);
    assert.equal(missing.status, 404);
    const error = envelope(missing.json);
    assert.equal(error.code, 'NOT_FOUND');
    assert.equal(error.message, 'المنتج غير موجود.');
  });
});
