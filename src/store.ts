import type { Cart, Config, Coupon, Order, Product } from './types';

export class Store {
  readonly products = new Map<string, Product>();
  readonly carts = new Map<string, Cart>();
  readonly orders = new Map<string, Order>();
  readonly coupons = new Map<string, Coupon>();
  readonly couponByMilestone = new Map<number, string>();
  readonly idempotency = new Map<string, { orderId: string; cartId: string }>();
  config: Config = { n: 5, x: 10 };
}

/**
 * A promise-chain mutex. In a single-threaded runtime every synchronous block
 * is already atomic, but the mutex makes the serialization of critical
 * sections explicit and would carry over to a multi-threaded runtime. The
 * queued functions are synchronous, so no await points can interleave inside
 * a critical section.
 */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => T): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    return prev.then(() => {
      try {
        return fn();
      } finally {
        release();
      }
    });
  }
}
