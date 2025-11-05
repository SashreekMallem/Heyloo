import { api } from './client';
export async function fetchRestaurantOverview(restaurantId, range) {
    const { data } = await api.get(`/restaurants/${restaurantId}/overview`, {
        params: { range }
    });
    return data;
}
export async function fetchRestaurantOrders(restaurantId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/orders`);
    return data;
}
export async function fetchRestaurantCalls(restaurantId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/calls`);
    return data;
}
export async function fetchRestaurantMenu(restaurantId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/menu`);
    return data;
}
