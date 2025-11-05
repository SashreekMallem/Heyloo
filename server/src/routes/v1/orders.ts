import { Router } from 'express';
import { z } from 'zod';

import { createOrder, updateOrderStatus } from '../../services/order-service.js';
import { requireAuth } from '../../middleware/auth.js';
import { setTenantContext } from '../../middleware/tenant-context.js';

const updateStatusSchema = z.object({
  status: z.enum([
    'pending',
    'payment_pending',
    'paid',
    'confirmed',
    'preparing',
    'ready',
    'out_for_delivery',
    'delivered',
    'picked_up',
    'cancelled'
  ])
});

export const ordersRouter = Router();

ordersRouter.use(requireAuth);
ordersRouter.use(setTenantContext);

ordersRouter.post('/', async (req, res) => {
  const restaurantId =
    req.user?.role === 'platform_admin'
      ? req.body.restaurantId
      : req.user?.restaurantId;

  if (!restaurantId) {
    return res.status(400).json({
      message: 'restaurantId is required',
      code: 'RESTAURANT_ID_REQUIRED'
    });
  }

  const order = await createOrder(
    {
      ...req.body,
      restaurantId
    },
    { source: 'dashboard' }
  );

  res.status(201).json(order);
});

ordersRouter.patch('/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
  const { status } = updateStatusSchema.parse(req.body);
  const restaurantId =
    req.user?.role === 'platform_admin'
      ? req.body.restaurantId
      : req.user?.restaurantId;

  if (!restaurantId) {
    return res.status(400).json({
      message: 'restaurantId is required',
      code: 'RESTAURANT_ID_REQUIRED'
    });
  }

  const updated = await updateOrderStatus(orderId, restaurantId, status);
  res.json(updated);
});
