import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { assertRestaurantAccess } from '../../services/restaurant-service.js';
import { syncMenuFromPos } from '../../services/pos-service.js';

export const posRouter = Router();

posRouter.use(requireAuth);

posRouter.post('/:restaurantId/sync-menu', async (req, res) => {
  const { restaurantId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
  const result = await syncMenuFromPos(restaurantId);
  res.json({ synced: result.count, provider: result.provider });
});

posRouter.get('/:restaurantId/sync-logs', async (req, res) => {
  const { restaurantId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
  
  const { getPosSyncLogs } = await import('../../services/pos-service.js');
  const logs = await getPosSyncLogs(restaurantId, Number(req.query.limit) || 10);
  res.json(logs);
});
