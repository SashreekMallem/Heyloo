import { Router } from 'express';

import { requireAuth } from '../../middleware/auth.js';
import { setTenantContext } from '../../middleware/tenant-context.js';
import {
  assertRestaurantAccess,
  getRestaurantOverview,
  listMenuItems,
  listRecentCalls,
  listRestaurantOrders,
  listRestaurantCustomers,
  listCustomerAddresses
} from '../../services/restaurant-service.js';
import { parseDashboardRange } from '../../utils/date-range.js';
import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export const restaurantRouter = Router();

restaurantRouter.use(requireAuth);
restaurantRouter.use(setTenantContext);

// Get restaurant details
restaurantRouter.get('/:restaurantId', async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    await assertRestaurantAccess(restaurantId, req.user?.restaurantId);

    const result = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', restaurantId)
      .maybeSingle();

    logger.info({ 
      restaurantId, 
      hasData: !!result.data, 
      hasError: !!result.error,
      dataType: typeof result.data,
      isArray: Array.isArray(result.data),
      errorCode: result.error?.code,
      errorMessage: result.error?.message,
      resultKeys: result.data ? Object.keys(result.data) : null,
      fullResult: JSON.stringify(result, null, 2).substring(0, 500)
    }, 'Restaurant query result');

    if (result.error) {
      logger.error({ error: result.error, restaurantId }, 'Failed to query restaurant');
      return res.status(500).json({ 
        message: 'Failed to load restaurant',
        code: 'QUERY_ERROR',
        details: result.error
      });
    }

    if (!result.data) {
      logger.warn({ restaurantId }, 'Restaurant not found in database (query succeeded but no data)');
      return res.status(404).json({ message: 'Restaurant not found' });
    }

    res.json(result.data);
  } catch (err) {
    next(err);
  }
});

// Update restaurant settings
restaurantRouter.patch('/:restaurantId', async (req, res) => {
  const { restaurantId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);

  // POS integration is handled separately via OAuth flow - do not update pos_type/pos_location_id here
  // These are managed by restaurant_pos_locations table
  const updateData: any = {
    name: req.body.name,
    phone_number: req.body.phoneNumber,
    tax_rate: req.body.taxRate,
    delivery_fee: req.body.deliveryFee,
    // pos_type and pos_location_id removed - handled by OAuth connections
    updated_at: new Date().toISOString()
  };

  // Only update assistant_name if provided (allows null/empty to clear it)
  if (req.body.assistantName !== undefined) {
    updateData.assistant_name = req.body.assistantName || null;
  }

  const { error } = await supabase
    .from('restaurants')
    .update(updateData)
    .eq('id', restaurantId);

  if (error) {
    return res.status(500).json({ message: 'Failed to update restaurant' });
  }

  res.json({ message: 'Restaurant updated successfully' });
});

restaurantRouter.get('/:restaurantId/overview', async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
    const range = parseDashboardRange(req.query.range);
    const metrics = await getRestaurantOverview(restaurantId, range);
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

restaurantRouter.get('/:restaurantId/orders', async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
    const orders = await listRestaurantOrders(restaurantId);
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

restaurantRouter.get('/:restaurantId/calls', async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
    const calls = await listRecentCalls(restaurantId);
    res.json(calls);
  } catch (err) {
    next(err);
  }
});

restaurantRouter.get('/:restaurantId/menu', async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
    // For dashboard view, show ALL menu items regardless of location_id
    const menu = await listMenuItems(restaurantId, undefined, true);
    res.json(menu);
  } catch (err) {
    next(err);
  }
});

// POS Configuration
restaurantRouter.get('/:restaurantId/pos-config', async (req, res, next) => {
  try {
    const { restaurantId } = req.params;
    await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
    
    const result = await supabase
      .from('restaurants')
      .select('pos_type,pos_location_id')
      .eq('id', restaurantId)
      .maybeSingle();
    
    if (result.error) {
      logger.error({ error: result.error, restaurantId }, 'Failed to query restaurant for pos-config');
      return res.status(500).json({ 
        message: 'Failed to load POS configuration',
        code: 'QUERY_ERROR',
        details: result.error
      });
    }
    
    if (!result.data) {
      logger.warn({ restaurantId }, 'Restaurant not found while fetching pos-config');
      return res.status(404).json({ message: 'Restaurant not found' });
    }
    
    // Check restaurant_pos_locations for multi-location connections
    const { data: posLocations } = await supabase
      .from('restaurant_pos_locations')
      .select('pos_type, pos_location_id, is_primary')
      .eq('restaurant_id', restaurantId)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    
    // Determine actual POS type and location from restaurant_pos_locations if available
    // Otherwise fall back to restaurants table (backward compatibility)
    let actualPosType = result.data.pos_type || 'none';
    let actualLocationId = result.data.pos_location_id || null;
    
    if (posLocations && posLocations.length > 0) {
      // Use the first active location (primary if exists, otherwise first)
      const primaryLocation = posLocations.find(loc => loc.is_primary) || posLocations[0];
      actualPosType = primaryLocation.pos_type;
      actualLocationId = primaryLocation.pos_location_id;
    }
    
    // Get last sync time from pos_sync_log
    const syncResult = await supabase
      .from('pos_sync_log')
      .select('created_at')
      .eq('restaurant_id', restaurantId)
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (syncResult.error) {
      logger.warn({ error: syncResult.error, restaurantId }, 'Failed to query pos_sync_log');
    }

    res.json({
      posType: actualPosType,
      posLocationId: actualLocationId,
      locationCount: posLocations?.length || 0,
      lastSyncAt: syncResult.data?.created_at || null
    });
  } catch (err) {
    next(err);
  }
});

// API Token Management
restaurantRouter.post('/:restaurantId/tokens', async (req, res) => {
  const { restaurantId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
  
  const { generateApiToken } = await import('../../services/token-service.js');
  const result = await generateApiToken(restaurantId, req.body.expiresInDays);
  res.json(result);
});

restaurantRouter.get('/:restaurantId/tokens', async (req, res) => {
  const { restaurantId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);
  
  const { listApiTokens } = await import('../../services/token-service.js');
  const tokens = await listApiTokens(restaurantId);
  res.json(tokens);
});

restaurantRouter.delete('/:restaurantId/tokens/:tokenId', async (req, res) => {
  const { restaurantId, tokenId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);

  const { revokeApiToken } = await import('../../services/token-service.js');
  await revokeApiToken(restaurantId, tokenId);
  res.status(204).send();
});

// Customer management
restaurantRouter.get('/:restaurantId/customers', async (req, res) => {
  const { restaurantId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);

  const customers = await listRestaurantCustomers(restaurantId);
  res.json(customers);
});

restaurantRouter.get('/:restaurantId/customers/:customerId/addresses', async (req, res) => {
  const { restaurantId, customerId } = req.params;
  await assertRestaurantAccess(restaurantId, req.user?.restaurantId);

  const addresses = await listCustomerAddresses(restaurantId, customerId);
  res.json(addresses);
});
