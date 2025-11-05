import { api } from './client';
export async function generateToken(restaurantId, expiresInDays) {
    const { data } = await api.post(`/restaurants/${restaurantId}/tokens`, {
        expiresInDays
    });
    return data;
}
export async function listTokens(restaurantId) {
    const { data } = await api.get(`/restaurants/${restaurantId}/tokens`);
    return data;
}
export async function revokeToken(restaurantId, tokenId) {
    await api.delete(`/restaurants/${restaurantId}/tokens/${tokenId}`);
}
