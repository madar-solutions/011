import type { CartItem, Product } from '@prisma/client';
import { formatMoney, toCents } from './cart.totals';

export type CartItemJson = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: string;
  quantity: number;
};

export type CartJson = {
  items: CartItemJson[];
  coupon: string | null;
  discount: string;
};

export type CouponAppliedJson = {
  coupon: string | null;
  discount: string;
};

type LineWithProduct = CartItem & { product: Product };

export function toCartItemJson(line: LineWithProduct): CartItemJson {
  return {
    id: line.id,
    productId: line.productId,
    sku: line.product.sku,
    name: line.product.name,
    price: formatMoney(toCents(line.product.price)),
    quantity: line.quantity,
  };
}

export function emptyCart(): CartJson {
  return { items: [], coupon: null, discount: formatMoney(0) };
}
