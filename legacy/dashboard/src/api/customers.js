import { api } from './client';
export async function fetchRestaurantCustomers(restaurantId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/customers`);
    return data;
}
export async function fetchCustomerAddresses(restaurantId, customerId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/customers/${customerId}/addresses`);
    return data;
}
