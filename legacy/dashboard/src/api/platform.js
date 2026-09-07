import { api } from './client';
export async function fetchPlatformOverview(range) {
    const { data } = await api.get('/platform/overview', {
        params: { range }
    });
    return data;
}
export async function fetchRestaurantSummaries(range) {
    const { data } = await api.get('/platform/restaurants', {
        params: { range }
    });
    return data;
}
export async function fetchUsageTimeline(range) {
    const { data } = await api.get('/platform/analytics/timeline', {
        params: { range }
    });
    return data;
}
export async function fetchCallCenterMetrics(range) {
    const { data } = await api.get('/platform/analytics/call-center', {
        params: { range }
    });
    return data;
}
