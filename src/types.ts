export interface Product {
  id: string;
  name: string;
  priceCents: number;
  inventory: number;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface Cart {
  id: string;
  items: CartItem[];
  createdAt: string;
  checkedOutAt?: string;
  orderId?: string;
}

export interface CartLineView {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface CartView extends Cart {
  items: CartLineView[];
  subtotalCents: number;
}

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Order {
  id: string;
  cartId: string;
  lines: OrderLine[];
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponCode?: string;
  createdAt: string;
}

export type CouponStatus = 'available' | 'redeemed';

export interface Coupon {
  code: string;
  percent: number;
  milestone: number;
  status: CouponStatus;
  createdAt: string;
  redeemedAt?: string;
  orderId?: string;
}

export interface Config {
  n: number;
  x: number;
}

export interface Report {
  purchasedQuantityByProduct: Record<string, number>;
  grossRevenueCents: number;
  totalDiscountCents: number;
  netRevenueCents: number;
  couponsGenerated: number;
  couponsAvailable: number;
  couponsRedeemed: number;
  totalOrders: number;
}
