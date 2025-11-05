import { Router } from 'express';

import { platformOverviewMetricsSchema, restaurantSummaryMetricsSchema } from '@heyloo/shared';

import { requireAuth } from '../../middleware/auth.js';
import {
  getPlatformOverview,
  getUsageTimeline,
  getCallCenterMetrics,
  listRestaurantSummaries
} from '../../services/platform-service.js';
import { parseDashboardRange } from '../../utils/date-range.js';

export const platformRouter = Router();

platformRouter.use(requireAuth);

platformRouter.get('/overview', async (req, res) => {
  const range = parseDashboardRange(req.query.range);
  const metrics = await getPlatformOverview(range);
  res.json(platformOverviewMetricsSchema.parse(metrics));
});

platformRouter.get('/restaurants', async (req, res) => {
  const range = parseDashboardRange(req.query.range);
  const summaries = await listRestaurantSummaries(range);
  res.json(summaries.map((summary) => restaurantSummaryMetricsSchema.parse(summary)));
});

platformRouter.get('/analytics/timeline', async (req, res) => {
  const range = parseDashboardRange(req.query.range);
  const timeline = await getUsageTimeline(range);
  res.json(timeline);
});

platformRouter.get('/analytics/call-center', async (req, res) => {
  const range = parseDashboardRange(req.query.range);
  const metrics = await getCallCenterMetrics(range);
  res.json(metrics);
});
