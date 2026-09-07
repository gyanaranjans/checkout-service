import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer } from '../src/server';
import { makeService } from './helpers';

let server: ReturnType<typeof createServer>;
let base: string;

beforeAll(async () => {
  const service = makeService();
  server = createServer(service);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  base = `http://localhost:${address.port}`;
});

afterAll(() => {
  server.close();
});

async function api(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  return { status: res.status, json };
}

describe('HTTP API', () => {
  test('lists products', async () => {
    const { status, json } = await api('GET', '/products');
    expect(status).toBe(200);
    expect(json.products.length).toBeGreaterThanOrEqual(5);
  });

  test('full cart lifecycle over HTTP', async () => {
    const { json: cart } = await api('POST', '/carts');
    expect(cart.id).toBeTruthy();

    const add = await api('POST', `/carts/${cart.id}/items`, { productId: 'p-100', quantity: 2 });
    expect(add.status).toBe(200);
    expect(add.json.subtotalCents).toBe(5000);

    const update = await api('PATCH', `/carts/${cart.id}/items/p-100`, { quantity: 3 });
    expect(update.json.subtotalCents).toBe(7500);

    const checkout = await api('POST', `/carts/${cart.id}/checkout`, {});
    expect(checkout.status).toBe(201);
    expect(checkout.json.totalCents).toBe(7500);

    const order = await api('GET', `/orders/${checkout.json.id}`);
    expect(order.status).toBe(200);
    expect(order.json.id).toBe(checkout.json.id);
  });

  test('returns distinguishable error bodies', async () => {
    const { json: cart } = await api('POST', '/carts');

    const badProduct = await api('POST', `/carts/${cart.id}/items`, { productId: 'nope', quantity: 1 });
    expect(badProduct.status).toBe(404);
    expect(badProduct.json.error.code).toBe('PRODUCT_NOT_FOUND');

    const badQuantity = await api('POST', `/carts/${cart.id}/items`, { productId: 'p-100', quantity: 0 });
    expect(badQuantity.status).toBe(400);
    expect(badQuantity.json.error.code).toBe('INVALID_QUANTITY');

    const missingCart = await api('GET', '/carts/does-not-exist');
    expect(missingCart.status).toBe(404);
    expect(missingCart.json.error.code).toBe('CART_NOT_FOUND');
  });

  test('idempotency key header makes checkout retries safe', async () => {
    const { json: cart } = await api('POST', '/carts');
    await api('POST', `/carts/${cart.id}/items`, { productId: 'p-100', quantity: 1 });

    const first = await api('POST', `/carts/${cart.id}/checkout`, {}, { 'Idempotency-Key': 'http-key-1' });
    const retry = await api('POST', `/carts/${cart.id}/checkout`, {}, { 'Idempotency-Key': 'http-key-1' });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.json.id).toBe(first.json.id);
  });

  test('admin coupon generation and report', async () => {
    const before = await api('POST', '/admin/coupons');
    expect(before.status).toBe(409);
    expect(before.json.error.code).toBe('MILESTONE_NOT_REACHED');

    const report = await api('GET', '/admin/report');
    expect(report.status).toBe(200);
    expect(typeof report.json.netRevenueCents).toBe('number');
  });

  test('unknown route returns 404', async () => {
    const res = await api('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.json.error.code).toBe('NOT_FOUND');
  });
});
