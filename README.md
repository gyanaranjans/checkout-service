# Checkout & Rewards Service

A backend for an ecommerce store: carts, checkout, orders, and a discount-coupon
reward system. Built with **TypeScript on [Bun](https://bun.sh)** - zero runtime
dependencies (the HTTP server uses `node:http`, tests use `bun:test`).

The point of this exercise is not CRUD; it is that the system stays correct when
requests are **retried**, **concurrent**, or **competing for the same coupon**.
See [`DECISIONS.md`](./DECISIONS.md) for the invariants, ambiguities, and
trade-offs behind the design.

## Requirements

- [Bun](https://bun.sh) `>= 1.1` (developed against 1.4.0)

## Setup & run

```sh
bun install        # installs dev-only types (typescript, @types/bun)
bun run start      # start the server on http://localhost:3000
PORT=8080 bun run start   # or on another port
```

## Tests

```sh
bun test           # 38 tests across 7 files
bun run typecheck  # tsc --noEmit
```

The tests deliberately include competing/repeated operations: concurrent
checkouts against limited inventory, concurrent redemption of the same coupon,
concurrent coupon generation, and repeated checkout with the same idempotency
key.

## Seed data

Six products are seeded at startup (`src/seed.ts`), including one with limited
inventory:

| id     | name                    | price (cents) | inventory |
|--------|-------------------------|---------------|-----------|
| p-100  | Wireless Mouse          | 2500          | 50        |
| p-101  | Mechanical Keyboard     | 8999          | 30        |
| p-102  | 27-inch 4K Monitor      | 39999         | 10        |
| p-103  | USB-C Hub               | 4999          | 100       |
| p-104  | Limited Edition Desk Mat| 3500          | **2**     |
| p-105  | HD Webcam               | 5999          | 25        |

Coupon configuration: `n = 5`, `x = 10` (every 5th order earns a 10% coupon).

## API

All money values are **integer cents**. All responses are JSON. Errors use a
uniform shape: `{ "error": { "code": "...", "message": "..." } }`.

### Public operations

| Method | Path                          | Description |
|--------|-------------------------------|-------------|
| GET    | `/products`                   | List products |
| POST   | `/carts`                      | Create a cart |
| GET    | `/carts/:id`                  | View a cart with line totals and subtotal |
| POST   | `/carts/:id/items`            | Add an item |
| PATCH  | `/carts/:id/items/:productId` | Change an item's quantity |
| DELETE | `/carts/:id/items/:productId` | Remove an item |
| POST   | `/carts/:id/checkout`         | Check out (optional coupon, optional idempotency key) |
| GET    | `/orders/:id`                 | Retrieve an order |

### Administrative operations

The following are treated as **admin** (no auth implemented):

| Method | Path             | Description |
|--------|------------------|-------------|
| POST   | `/admin/coupons` | Generate a coupon for an eligible, unrewarded milestone |
| GET    | `/admin/report`  | Sales/coupon summary (read-only) |

### Endpoint details

#### `POST /carts` -> `201`

Creates an empty cart.

```json
{ "id": "...uuid...", "items": [], "createdAt": "2026-09-07T...Z" }
```

#### `GET /carts/:id` -> `200`

Returns the cart plus computed line prices and subtotal. Prices shown are the
**current** product prices; the authoritative price is fixed at checkout.

```json
{
  "id": "...", "createdAt": "...",
  "items": [
    { "productId": "p-100", "name": "Wireless Mouse", "quantity": 2,
      "unitPriceCents": 2500, "lineTotalCents": 5000 }
  ],
  "subtotalCents": 5000
}
```

Errors: `404 CART_NOT_FOUND`.

#### `POST /carts/:id/items` -> `200`

Body: `{ "productId": "p-100", "quantity": 2 }`. Adds `quantity` to the line
(accumulates if the product is already present).

Errors: `404 CART_NOT_FOUND`, `404 PRODUCT_NOT_FOUND`, `400 INVALID_QUANTITY`
(non-positive or non-integer), `409 CART_ALREADY_CHECKED_OUT`.

#### `PATCH /carts/:id/items/:productId` -> `200`

Body: `{ "quantity": 5 }`. Replaces the line quantity.

Errors: `404 CART_NOT_FOUND`, `404 PRODUCT_NOT_FOUND`, `404 ITEM_NOT_IN_CART`,
`400 INVALID_QUANTITY`, `409 CART_ALREADY_CHECKED_OUT`.

#### `DELETE /carts/:id/items/:productId` -> `200`

Removes the line. Errors: `404 CART_NOT_FOUND`, `404 ITEM_NOT_IN_CART`,
`409 CART_ALREADY_CHECKED_OUT`.

#### `POST /carts/:id/checkout` -> `201`

Body: `{ "couponCode": "SAVE10-..." }` (optional).

Header: `Idempotency-Key: <opaque string>` (optional but recommended).

Validates the cart, reserves inventory, and creates an order. Returns the order:

```json
{
  "id": "...", "cartId": "...",
  "lines": [ { "productId": "p-100", "name": "Wireless Mouse", "quantity": 2,
               "unitPriceCents": 2500, "lineTotalCents": 5000 } ],
  "subtotalCents": 5000, "discountCents": 500, "totalCents": 4500,
  "couponCode": "SAVE10-...", "createdAt": "..."
}
```

Errors: `400 CART_EMPTY`, `404 CART_NOT_FOUND`, `404 COUPON_NOT_FOUND`,
`409 CART_ALREADY_CHECKED_OUT`, `409 INSUFFICIENT_INVENTORY`,
`409 COUPON_ALREADY_REDEEMED`, `409 IDEMPOTENCY_KEY_REUSED`.

Retrying with the same `Idempotency-Key` returns the **same order** and never
charges inventory twice.

#### `GET /orders/:id` -> `200`

Returns the order snapshot (line names, unit prices, totals). Errors:
`404 ORDER_NOT_FOUND`.

#### `POST /admin/coupons` -> `201`

Generates one coupon for the **oldest reached-but-unrewarded** milestone.
Idempotent: if every reached milestone is already rewarded, returns the most
recently generated coupon (same body).

```json
{ "code": "SAVE10-3AE26A87", "percent": 10, "milestone": 5,
  "status": "available", "createdAt": "..." }
```

Errors: `409 MILESTONE_NOT_REACHED` (fewer than `n` orders placed).

#### `GET /admin/report` -> `200`

```json
{
  "purchasedQuantityByProduct": { "p-100": 2 },
  "grossRevenueCents": 5000,
  "totalDiscountCents": 500,
  "netRevenueCents": 4500,
  "couponsGenerated": 1,
  "couponsAvailable": 0,
  "couponsRedeemed": 1,
  "totalOrders": 6
}
```

Read-only; repeated calls never mutate state and always reconcile with the
orders and coupons returned by the other endpoints.

## Error codes

| HTTP | code                     | Meaning |
|------|--------------------------|---------|
| 400  | `INVALID_REQUEST`        | Malformed request body/field |
| 400  | `INVALID_JSON`           | Body is not valid JSON |
| 400  | `INVALID_QUANTITY`       | Quantity not a positive integer |
| 400  | `CART_EMPTY`             | Checkout of an empty cart |
| 404  | `NOT_FOUND`              | Unknown route |
| 404  | `PRODUCT_NOT_FOUND`      | Unknown product |
| 404  | `CART_NOT_FOUND`         | Unknown cart |
| 404  | `ORDER_NOT_FOUND`        | Unknown order |
| 404  | `ITEM_NOT_IN_CART`       | Product not present in cart |
| 404  | `COUPON_NOT_FOUND`       | Unknown coupon code |
| 409  | `INSUFFICIENT_INVENTORY` | Not enough stock to fulfil the cart |
| 409  | `CART_ALREADY_CHECKED_OUT` | Cart already used for an order |
| 409  | `COUPON_ALREADY_REDEEMED`  | Coupon already consumed |
| 409  | `MILESTONE_NOT_REACHED`  | No eligible order milestone yet |
| 409  | `IDEMPOTENCY_KEY_REUSED` | Same key used for a different checkout |
