export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  invalidRequest: (message: string) => new AppError(400, 'INVALID_REQUEST', message),
  invalidJson: () => new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON'),
  invalidQuantity: (message = 'Quantity must be a positive integer') =>
    new AppError(400, 'INVALID_QUANTITY', message),
  productNotFound: (id: string) =>
    new AppError(404, 'PRODUCT_NOT_FOUND', `Product ${id} does not exist`),
  cartNotFound: (id: string) => new AppError(404, 'CART_NOT_FOUND', `Cart ${id} does not exist`),
  orderNotFound: (id: string) => new AppError(404, 'ORDER_NOT_FOUND', `Order ${id} does not exist`),
  itemNotInCart: (productId: string) =>
    new AppError(404, 'ITEM_NOT_IN_CART', `Product ${productId} is not in the cart`),
  insufficientInventory: (productId: string) =>
    new AppError(
      409,
      'INSUFFICIENT_INVENTORY',
      `Not enough inventory available for product ${productId}`,
    ),
  cartAlreadyCheckedOut: (id: string) =>
    new AppError(409, 'CART_ALREADY_CHECKED_OUT', `Cart ${id} has already been checked out`),
  cartEmpty: () => new AppError(400, 'CART_EMPTY', 'Cannot check out an empty cart'),
  couponNotFound: (code: string) =>
    new AppError(404, 'COUPON_NOT_FOUND', `Coupon ${code} does not exist`),
  couponAlreadyRedeemed: (code: string) =>
    new AppError(409, 'COUPON_ALREADY_REDEEMED', `Coupon ${code} has already been redeemed`),
  milestoneNotReached: () =>
    new AppError(409, 'MILESTONE_NOT_REACHED', 'No eligible order milestone has been reached yet'),
  idempotencyKeyReused: () =>
    new AppError(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency key was already used for a different checkout',
    ),
};
