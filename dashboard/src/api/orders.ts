import { api } from './client';

export type OrderStatus =
  | 'pending'
  | 'payment_pending'
  | 'paid'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'picked_up'
  | 'cancelled';

export async function updateOrderStatus(
  orderId: string,
  restaurantId: string,
  status: OrderStatus
) {
  const { data } = await api.patch(`/orders/${orderId}/status`, {
    status,
    restaurantId
  });
  return data;
}

export async function createOrder(payload: {
  restaurantId: string;
  customerId: string;
  customerPhone: string;
  customerName?: string;
  orderType: 'delivery' | 'pickup';
  items: Array<{
    menuItemId: string;
    quantity: number;
    specialInstructions?: string;
  }>;
  deliveryAddress?: string;
  paymentMethod: 'cash' | 'card' | 'stripe_link';
}) {
  const { data } = await api.post('/orders', payload);
  return data;
}

