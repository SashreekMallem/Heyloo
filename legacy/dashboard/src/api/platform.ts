import type {
  DashboardTimeRange,
  PlatformOverviewMetrics,
  RestaurantSummaryMetrics
} from '@heyloo/shared';

import { api } from './client';

export async function fetchPlatformOverview(range: DashboardTimeRange) {
  const { data } = await api.get<PlatformOverviewMetrics>('/platform/overview', {
    params: { range }
  });

  return data;
}

export async function fetchRestaurantSummaries(range: DashboardTimeRange) {
  const { data } = await api.get<RestaurantSummaryMetrics[]>('/platform/restaurants', {
    params: { range }
  });

  return data;
}

export async function fetchUsageTimeline(range: DashboardTimeRange) {
  const { data } = await api.get<Array<{ date: string; totalCalls: number; totalMinutes: number; totalOrders: number; revenue: number }>>(
    '/platform/analytics/timeline',
    {
      params: { range }
    }
  );

  return data;
}

export async function fetchCallCenterMetrics(range: DashboardTimeRange) {
  const { data } = await api.get<{
    totalCalls: number;
    averageHandleTime: number;
    firstCallResolution: number;
    callAbandonmentRate: number;
    repeatCallRate: number;
    serviceLevel: number;
  }>('/platform/analytics/call-center', {
    params: { range }
  });

  return data;
}
