import { dashboardTimeRangeSchema } from '@heyloo/shared';
import type { DashboardTimeRange } from '@heyloo/shared';

export function resolveDateRange(range: DashboardTimeRange) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (range) {
    case 'today':
      return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
    case 'yesterday': {
      const start = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      return { start, end: today };
    }
    case 'last7': {
      const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
      return { start, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
    }
    case 'last30': {
      const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
      return { start, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
    }
    case 'month_to_date': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
    }
    case 'year_to_date': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { start, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
    }
    default: {
      const _exhaustiveCheck: never = range;
      return { start: today, end: today };
    }
  }
}

export function parseDashboardRange(range: unknown): DashboardTimeRange {
  if (!range) {
    return 'today';
  }

  return dashboardTimeRangeSchema.parse(range);
}
