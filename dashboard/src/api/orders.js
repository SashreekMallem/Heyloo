import { api } from './client';
export async function updateOrderStatus(orderId, restaurantId, status) {
    const { data } = await api.patch(`/orders/${orderId}/status`, {
        status,
        restaurantId
    });
    return data;
}
export async function createOrder(payload) {
    const { data } = await api.post('/orders', payload);
    return data;
}
