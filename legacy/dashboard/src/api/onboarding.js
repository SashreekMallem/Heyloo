import { api } from './client';
export async function onboardRestaurant(payload) {
    const { data } = await api.post('/onboarding/onboard', payload);
    return data;
}
export async function checkSlugAvailability(slug) {
    const { data } = await api.get(`/onboarding/check-slug/${slug}`);
    return data.available;
}
export async function checkEmailAvailability(email) {
    const { data } = await api.get(`/onboarding/check-email/${email}`);
    return data.available;
}
export async function initiatePosAuth(posType, restaurantId) {
    console.log('🔵 [initiatePosAuth] Calling API', { posType, restaurantId });
    if (!restaurantId || restaurantId.trim() === '') {
        throw new Error('Restaurant ID is required');
    }
    try {
        const { data } = await api.get(`/onboarding/pos/${posType}/auth`, {
            params: { restaurantId }
        });
        console.log('🟢 [initiatePosAuth] Success', { hasAuthUrl: !!data?.authUrl });
        return data;
    }
    catch (error) {
        console.error('🔴 [initiatePosAuth] Failed', {
            status: error.response?.status,
            message: error.response?.data?.error || error.message,
            posType,
            restaurantId
        });
        throw error;
    }
}
export async function getPosLocations(provider, sessionId) {
    const { data } = await api.get(`/onboarding/pos/${provider}/locations`, {
        params: { session: sessionId }
    });
    return data;
}
export async function finalizePosConnection(provider, sessionId, locationIds, merchantIds) {
    const { data } = await api.post(`/onboarding/pos/${provider}/finalize`, {
        session: sessionId,
        locationIds,
        merchantIds
    });
    return data;
}
