import type { Order, OrderItem } from '@prisma/client';
import { formatMoney, toCents } from '../cart/cart.totals';

export type OrderListItemJson = {
  id: string;
  status: string;
  total: string;
  createdAt: string;
};

export type OrderDetailJson = OrderListItemJson & {
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
    price: string;
  }>;
};

export function toOrderListItem(
  order: Pick<Order, 'id' | 'status' | 'total' | 'createdAt'>,
): OrderListItemJson {
  return {
    id: order.id,
    status: order.status,
    total: formatMoney(toCents(order.total)),
    createdAt: order.createdAt.toISOString(),
  };
}

export function toOrderDetail(
  order: Pick<Order, 'id' | 'status' | 'total' | 'createdAt'> & {
    items: Pick<OrderItem, 'productId' | 'name' | 'quantity' | 'price'>[];
  },
): OrderDetailJson {
  return {
    ...toOrderListItem(order),
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      price: formatMoney(toCents(item.price)),
    })),
  };
}
