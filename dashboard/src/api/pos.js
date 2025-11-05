import { api } from './client';
export async function triggerMenuSync(restaurantId) {
    const { data } = await api.post(`/pos/${restaurantId}/sync-menu`);
    return data;
}
export async function getPosSyncLogs(restaurantId, limit = 10) {
    const { data } = await api.get(`/pos/${restaurantId}/sync-logs`, {
        params: { limit }
    });
    return data;
}
export async function getRestaurantPosConfig(restaurantId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/pos-config`);
    return data;
}
