# DECISIONS.md

## System invariants

These are the properties the implementation must never violate, regardless of
retries, concurrency, or admin mistakes:

1. **Inventory is never oversold.** The sum of ordered quantities for a product
   never exceeds its seeded inventory.
2. **A cart is checked out at most once.** One cart -> at most one order.
3. **A retried checkout never creates a second order or double-charges
   inventory.** Enforced via idempotency keys and the checked-out flag.
4. **A coupon is generated at most once per milestone.**
5. **A coupon is redeemed at most once**, and never by two concurrent checkouts.
6. **A coupon is never consumed by a checkout that fails.**
7. **Order totals are exact integer cents** - no floating-point rounding - and
   are never negative.
8. **An order is an immutable snapshot**: it records names, quantities, unit
   prices, and totals so it can be explained even after product data changes.
9. **The report reconciles with orders and coupons and never mutates state.**

Where each invariant is enforced is noted inline in `src/service.ts`
(`checkoutSync` and `generateCouponSync`).

## Ambiguities and selected semantics

- **Price changes after add but before checkout.** I resolve prices at
  **checkout time** using the product's current price, and the order stores the
  unit price it actually used. Rationale: the cart is a wishlist, not a price
  lock; the order snapshot preserves explainability. A price lock at add-time
  would be equally defensible but complicates the cart view.
- **Availability changes after add but before checkout.** Inventory is
  validated at checkout, not at add. You may add more than is in stock to a
  cart; checkout rejects with `INSUFFICIENT_INVENTORY`. Add-time checks would
  not help anyway (stock can change between add and checkout).
- **Coupon scope.** A coupon is a percentage off the **whole order**, not per
  line. Nothing in the spec implied per-line or per-product coupons.
- **Coupon value.** `x` is a percent. `discount = floor(subtotal * x / 100)`,
  clamped to the subtotal so a misconfigured `x > 100` can never make a total
  negative.
- **Which milestone does the admin generate for?** The **oldest reached-but-
  unrewarded** milestone, so a lazy admin can never skip a milestone. Repeated
  calls are idempotent (see Decision 4).
- **Coupon availability.** Only `available` coupons are valid at checkout; a
  coupon has no expiry (not specified, so none invented).
- **Payment.** No real payment integration. Successful checkout is treated as
  payment success (see Decision 5).

## Material decisions

### Decision 1: In-memory store with a single-process mutex

**Context:** The assignment allows in-memory storage, but only if it still
demonstrates how invariants survive overlapping requests.

**Options considered:**
- SQLite/Postgres with real transactions and row locks.
- In-memory store with no explicit synchronization, relying on Node's
  single-threaded event loop.
- In-memory store plus an explicit mutex serializing the critical sections.

**Choice:** In-memory store plus a promise-chain `Mutex` (`src/store.ts`)
wrapping `checkout` and `generateCoupon`. Critical sections run **fully
synchronously** - every validation happens before any mutation, and all
mutations happen in one uninterrupted block.

**Why:** A database would be more "production-like" but adds setup friction and
obscures the invariants behind SQL. The mutex makes serialization explicit and
reviewable, while the synchronous critical section guarantees atomicity in a
single-threaded runtime. This is the smallest design that provably holds the
invariants.

**Consequences:** Single-instance only. The multi-instance story is documented
in "Production evolution" below. The mutex is a coarse global lock; under high
contention it serializes checkouts, which is acceptable at this scale and
trivially replaceable with per-resource locking later.

### Decision 2: Idempotency via client-supplied `Idempotency-Key`

**Context:** A client that times out and retries checkout must not create two
orders or charge inventory twice.

**Options considered:**
- No idempotency; rely on the cart's checked-out flag (a retry would 409).
- Server-generated idempotency from cart state.
- Client-supplied `Idempotency-Key` header, stored key -> order.

**Choice:** Client-supplied `Idempotency-Key`. On replay the stored order is
returned unchanged; a key reused for a different cart returns
`IDEMPOTENCY_KEY_REUSED` (409).

**Why:** The checked-out flag alone makes retries *fail* (409) rather than
*succeed*, which is hostile to a client that simply lost the response. A
server-derived key cannot distinguish "same logical checkout retried" from "a
new checkout of the same cart". A client key is the standard, explicit contract.

**Consequences:** Clients must generate a key per logical checkout (documented).
Keys are kept forever in this in-memory implementation; production would
expire them.

### Decision 3: Integer cents for all money

**Context:** Floating-point money produces rounding errors (0.1 + 0.2 != 0.3).

**Options considered:**
- `number` of dollars with `toFixed` at the edges.
- Decimal library (decimal.js, big.js).
- Integer cents everywhere, with a single pure function for discount math.

**Choice:** Integer cents. The only non-trivial math is the discount, isolated
in `discountCents` (`src/money.ts`): `floor(subtotal * percent / 100)`, clamped
to the subtotal.

**Why:** Integers are exact, dependency-free, and the operations here are only
multiply/divide by 100 - a decimal library is overkill. Floor is deterministic
and, combined with the clamp, guarantees non-negative totals.

**Consequences:** API clients must interpret `*Cents` fields. Currency is
implicitly a single minor-unit currency (e.g., USD); multi-currency would need a
currency field and per-currency minor-unit rules.

### Decision 4: Coupon generation is idempotent per milestone

**Context:** "A coupon is generated only if the milestone has been reached and a
coupon has not already been generated for that milestone." The spec doesn't say
what a repeated admin request should do.

**Options considered:**
- Error (`409`) when the milestone is already rewarded.
- Return the already-generated coupon (idempotent success).
- Generate for the highest reached milestone instead of the oldest.

**Choice:** Generate for the **oldest unrewarded** milestone; if every reached
milestone is already rewarded, return the most recently generated coupon
(idempotent). Before `n` orders exist, return `MILESTONE_NOT_REACHED`.

**Why:** Oldest-first means no milestone is ever silently skipped when the admin
is behind. Idempotent success makes retries of the admin request safe and
matches the "only if not already generated" wording - a second call must not
produce a second coupon for the same milestone.

**Consequences:** The admin cannot distinguish "just generated" from "already
existed" without comparing codes; acceptable, and documented.

### Decision 5: No payment abstraction; success = payment success

**Context:** The spec permits treating successful checkout as payment success or
introducing a fake payment step.

**Options considered:**
- A `PaymentGateway` interface with a fake implementation.
- No abstraction; checkout success is payment success.

**Choice:** No payment abstraction. Checkout success is payment success.

**Why:** A payment step would only add an artificial failure point and a
"payment succeeded but order failed" compensation path that has no bearing on
the evaluated invariants (inventory, coupons, idempotency). The interesting
failure modes are all upstream of payment.

**Consequences:** If real payments were added, the commit order would become
"authorize payment -> reserve inventory -> capture", and the coupon/inventory
commit would need a compensating action on capture failure - a known deferred
area.

### Decision 6: Structured, code-carrying errors

**Context:** "Return errors that are distinguishable and useful to an API
client."

**Options considered:**
- HTTP status only.
- Status plus free-text message.
- Status plus a stable machine-readable `code` plus a human message.

**Choice:** Every error is `{ "error": { "code": "INSUFFICIENT_INVENTORY",
"message": "..." } }` with a semantically appropriate status (400/404/409). A
single `AppError` class carries status and code (`src/errors.ts`).

**Why:** Clients branch on `code`, not on parsing messages. 409 (conflict) is
used for state conflicts (oversell, double-checkout, double-redeem) rather than
400, so retries and races are distinguishable from bad input.

**Consequences:** The code list is a de facto API surface that must stay stable.

## Transaction, concurrency, and idempotency strategy

- **Atomicity:** `checkoutSync` and `generateCouponSync` are synchronous
  critical sections: validate everything -> mutate everything. No `await` inside,
  so no interleaving is possible in the single-threaded runtime.
- **Serialization:** both are wrapped in one `Mutex`, so even if a future
  refactor introduces an `await`, the critical section stays serialized.
- **Idempotency:** `Idempotency-Key` -> stored order mapping, checked first.
- **Coupon safety:** a coupon is only marked `redeemed` in the same commit
  block that decrements inventory and creates the order - after every
  validation - so a failed checkout can never consume it, and the mutex
  guarantees two concurrent checkouts can't both redeem it.

## Money and rounding rules

- All amounts are integer cents (`subtotalCents`, `discountCents`,
  `totalCents`, `priceCents`).
- Discount: `floor(subtotal * percent / 100)`, then `min(discount, subtotal)`.
- No floating point is used anywhere in money math.

## Implemented vs. intentionally deferred

Implemented:
- Products, carts (add/update/remove/view), checkout, orders, coupons,
  admin generation, admin report.
- Idempotency keys, concurrency safety, integer-cents money, structured errors.
- Tests for the business rules plus competing/repeated operations.

Intentionally deferred (and why):
- **Authentication/authorization** - explicitly out of scope; admin routes are
  identified by path.
- **Persistence** - in-memory by design; see production evolution.
- **Coupon expiry / per-customer limits / minimum spend** - not specified, so
  not invented.
- **Payment integration** - see Decision 5.
- **Product administration** (create/update/delete products) - not required;
  products are seeded.
- **Rate limiting, pagination, request logging** - orthogonal to the evaluated
  invariants.

## Production evolution (multiple instances / real database)

The current design is single-instance. With multiple instances:

- **Inventory and coupons move to a database** with transactions. The
  check-then-decrement in `checkoutSync` becomes a single `UPDATE products SET
  inventory = inventory - ? WHERE id = ? AND inventory >= ?` (or
  `SELECT ... FOR UPDATE`); the coupon redemption becomes a conditional update
  `UPDATE coupons SET status='redeemed' WHERE code=? AND status='available'`
  that returns 0 rows on contention. The mutex is replaced by the database's
  locking; the *shape* of the code (validate -> commit in one transaction) is
  unchanged.
- **Idempotency keys** become a table with a unique constraint on the key;
  replay reads the stored order.
- **Order count for milestones** becomes a monotonic counter or a count over
  committed orders inside the same transaction as order creation, so the
  milestone and the coupon are consistent.
- **The report** becomes aggregate SQL queries (or a read replica) rather than
  an in-memory scan.
- **Mutex** would be dropped in favor of DB locks; per-cart/per-product locks
  would replace the single global lock to reduce contention.

## How I used AI tools

I used AI to draft the initial code and tests, then verified and corrected it
against the actual behavior. One concrete correction: my first `generateCoupon`
implementation threw `MILESTONE_NOT_REACHED` when every reached milestone was
already rewarded, which made the admin endpoint non-idempotent and broke the
concurrency test (10 parallel generate calls produced 1 success and 9 errors).
I rejected that behavior, changed the function to return the existing coupon
for the latest milestone, and updated the test to assert idempotency instead.
I also rejected an AI-suggested test style that asserted on error *messages*;
I switched the tests to assert on stable error *codes*, which is what clients
actually branch on and what the assignment asks for ("distinguishable errors").

## What I would examine first with two more hours

1. **Fuzz the concurrency boundaries** - property-style tests that run hundreds
   of interleaved checkouts/coupon-generations and assert the invariants
   (inventory >= 0, one coupon per milestone, one redemption per coupon) hold
   every run.
2. **Idempotency-key lifecycle** - expiry and collision handling, and what
   happens when a key arrives *after* its order was somehow deleted.
3. **Coupon semantics under partial failure** - if a future payment step fails
   after inventory reservation, define and test the compensation path.
4. **Report consistency under concurrent writes** - a test that runs the report
   *while* checkouts are in flight to prove it always sees a consistent
   snapshot (currently guaranteed by the synchronous critical sections, but
   worth pinning with a test).
