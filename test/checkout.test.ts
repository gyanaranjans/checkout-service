import { describe, expect, test } from 'bun:test';
import { expectError, makeService } from './helpers';

describe('checkout', () => {
  test('creates an order, decrements inventory, and snapshots prices', async () => {
    const service = makeService();
    const cart = service.createCart();
    service.addItem(cart.id, 'p-100', 2);
    service.addItem(cart.id, 'p-101', 1);

    const order = await service.checkout(cart.id, undefined, undefined);

    expect(order.subtotalCents).toBe(2 * 2500 + 8999);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(order.subtotalCents);
    expect(order.lines).toHaveLength(2);
    expect(service.getOrder(order.id).id).toBe(order.id);

    expect(service.store.products.get('p-100')!.inventory).toBe(48);
    expect(service.store.products.get('p-101')!.inventory).toBe(29);
  });

  test('refuses to oversell limited inventory', async () => {
    const service = makeService();
    const cart = service.createCart();
    service.addItem(cart.id, 'p-104', 3); // only 2 in stock
    await expectError(service.checkout(cart.id, undefined, undefined), 'INSUFFICIENT_INVENTORY');
    expect(service.store.products.get('p-104')!.inventory).toBe(2);
  });

  test('refuses an empty cart', async () => {
    const service = makeService();
    const cart = service.createCart();
    await expectError(service.checkout(cart.id, undefined, undefined), 'CART_EMPTY');
  });

  test('refuses a cart that was already checked out', async () => {
    const service = makeService();
    const cart = service.createCart();
    service.addItem(cart.id, 'p-100', 1);
    await service.checkout(cart.id, undefined, undefined);
    await expectError(service.checkout(cart.id, undefined, undefined), 'CART_ALREADY_CHECKED_OUT');
  });

  test('uses the price at checkout time and the order keeps a snapshot', async () => {
    const service = makeService();
    const cart = service.createCart();
    service.addItem(cart.id, 'p-100', 1); // 2500 at add time

    service.store.products.get('p-100')!.priceCents = 3000;
    const order = await service.checkout(cart.id, undefined, undefined);
    expect(order.lines[0]!.unitPriceCents).toBe(3000);
    expect(order.totalCents).toBe(3000);

    service.store.products.get('p-100')!.priceCents = 1000;
    expect(service.getOrder(order.id).totalCents).toBe(3000);
  });

  test('retry with the same idempotency key returns the same order', async () => {
    const service = makeService();
    const cart = service.createCart();
    service.addItem(cart.id, 'p-100', 2);

    const first = await service.checkout(cart.id, undefined, 'key-1');
    const second = await service.checkout(cart.id, undefined, 'key-1');

    expect(second.id).toBe(first.id);
    expect(service.store.orders.size).toBe(1);
    expect(service.store.products.get('p-100')!.inventory).toBe(48);
  });

  test('rejects an idempotency key reused for a different cart', async () => {
    const service = makeService();
    const cartA = service.createCart();
    const cartB = service.createCart();
    service.addItem(cartA.id, 'p-100', 1);
    service.addItem(cartB.id, 'p-100', 1);

    await service.checkout(cartA.id, undefined, 'key-1');
    await expectError(service.checkout(cartB.id, undefined, 'key-1'), 'IDEMPOTENCY_KEY_REUSED');
  });
});
