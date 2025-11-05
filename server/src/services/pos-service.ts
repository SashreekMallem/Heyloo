import type { PosMenuItem } from '@heyloo/shared';

import { getPosIntegration, getRestaurantExternalId } from '../integrations/factory.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';

/**
 * Sync menu from POS for a restaurant and optionally a specific location
 * @param restaurantId - The restaurant ID
 * @param locationId - Optional specific location ID to sync. If not provided, syncs primary location.
 * @param syncSource - 'auto' for automatic syncs (after connection), 'manual' for user-triggered syncs
 */
export async function syncMenuFromPos(restaurantId: string, locationId?: string | null, syncSource: 'auto' | 'manual' = 'manual') {
  const { data: restaurant, error } = await supabase
    .from('restaurants')
    .select('id,pos_type,pos_location_id')
    .eq('id', restaurantId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error('Failed to load restaurant'), {
      status: 500,
      details: error
    });
  }

  if (!restaurant) {
    throw Object.assign(new Error('Restaurant not found'), {
      status: 404,
      code: 'RESTAURANT_NOT_FOUND'
    });
  }

  if (!restaurant.pos_type || restaurant.pos_type === 'none') {
    return { provider: 'none', count: 0 };
  }

  let accessToken: string | undefined;
  let resolvedLocationId: string | null = null;
  let externalId: string | undefined;

  // Service role key bypasses RLS - no need for tenant context
  try {
    // If locationId is provided, fetch that specific location
    if (locationId) {
      const { data: location, error: locationError } = await supabase
        .from('restaurant_pos_locations')
        .select('id,access_token,pos_location_id,pos_type,is_active')
        .eq('id', locationId)
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true)
        .maybeSingle();

      if (locationError || !location) {
        logger.error(
          { restaurantId, locationId, locationError },
          '[POS Sync] Failed to find specified location'
        );
        throw Object.assign(new Error('Location not found'), {
          status: 404,
          code: 'LOCATION_NOT_FOUND'
        });
      }

      if (!location.access_token || typeof location.access_token !== 'string') {
        throw Object.assign(new Error('Access token not available for this location'), {
          status: 400,
          code: 'ACCESS_TOKEN_REQUIRED'
        });
      }

      accessToken = location.access_token;
      resolvedLocationId = location.id;
      externalId = location.pos_location_id;
      
      logger.info(
        { restaurantId, locationId: resolvedLocationId, externalId },
        '[POS Sync] Syncing specific location'
      );
    } else if (restaurant.pos_type && restaurant.pos_location_id) {
      // Use single() instead of maybeSingle() and handle not found separately
      // This might help with connection pooling issues
      const { data: location, error: locationError } = await supabase
        .from('restaurant_pos_locations')
        .select('id,access_token,pos_location_id,is_active')
        .eq('restaurant_id', restaurantId)
        .eq('pos_type', restaurant.pos_type)
        .eq('pos_location_id', restaurant.pos_location_id)
        .eq('is_active', true)
        .maybeSingle();

      if (locationError) {
        logger.error(
          { restaurantId, posType: restaurant.pos_type, posLocationId: restaurant.pos_location_id, locationError },
          '[POS Sync] Error querying restaurant_pos_locations'
        );
      }

      if (location) {
        logger.info(
          {
            restaurantId,
            locationId: location.id,
            hasAccessToken: !!(location.access_token),
            accessTokenLength: location.access_token?.length || 0,
            locationKeys: Object.keys(location)
          },
          '[POS Sync] Location query result'
        );

        if (location.access_token && typeof location.access_token === 'string') {
          accessToken = location.access_token;
          resolvedLocationId = location.id;
          externalId = location.pos_location_id;
          logger.info(
            {
              restaurantId,
              locationId: resolvedLocationId,
              accessTokenLength: accessToken.length,
              accessTokenPrefix: accessToken.substring(0, 12)
            },
            '[POS Sync] Successfully loaded location credentials'
          );
        } else {
          logger.error(
            {
              restaurantId,
              locationId: location.id,
              locationData: location
            },
            '[POS Sync] Location found but access_token is missing or invalid'
          );
        }
      } else {
        logger.warn(
          {
            restaurantId,
            posType: restaurant.pos_type,
            posLocationId: restaurant.pos_location_id,
            locationFound: false,
            locationError
          },
          '[POS Sync] No location found in restaurant_pos_locations'
        );
      }
    }

    if (!accessToken || !externalId) {
      logger.error(
        {
          restaurantId,
          posType: restaurant.pos_type,
          posLocationId: restaurant.pos_location_id,
          externalId,
          providedLocationId: locationId
        },
        '[POS Sync] No access token found - cannot sync menu'
      );
      throw Object.assign(new Error('Square access token is required'), {
        status: 400,
        code: 'ACCESS_TOKEN_REQUIRED'
      });
    }

    const integration = getPosIntegration(restaurant.pos_type);
    logger.info({ restaurantId, externalId, locationId: resolvedLocationId, hasAccessToken: !!accessToken }, '[POS Sync] Fetching menu from Square');
    const items: PosMenuItem[] = await integration.pullMenu(externalId, accessToken);

    if (!items.length) {
      await supabase.from('pos_sync_log').insert({
        restaurant_id: restaurantId,
        location_id: resolvedLocationId,
        sync_type: 'menu_sync',
        sync_source: syncSource,
        status: 'success',
        items_processed: 0
      });
      return { provider: integration.provider, count: 0 };
    }

    const { error: upsertError } = await supabase.from('menu_items').upsert(
      items.map((item) => ({
        restaurant_id: restaurantId,
        location_id: resolvedLocationId,
        pos_item_id: item.externalId,
        name: item.name,
        description: item.description ?? null,
        category: item.category ?? null,
        price: item.price,
        is_available: item.isAvailable,
        sync_source: 'pos'
      })),
      { onConflict: 'restaurant_id,pos_item_id' }
    );

    if (upsertError) {
      logger.error({ err: upsertError, restaurantId, locationId: resolvedLocationId }, '[POS Sync] Failed to upsert menu items');
      await supabase.from('pos_sync_log').insert({
        restaurant_id: restaurantId,
        location_id: resolvedLocationId,
        sync_type: 'menu_sync',
        sync_source: syncSource,
        status: 'failed',
        error_message: upsertError.message,
        items_processed: 0
      });
      throw Object.assign(new Error('Failed to store menu items'), {
        status: 500,
        details: upsertError
      });
    }

    await supabase.from('pos_sync_log').insert({
      restaurant_id: restaurantId,
      location_id: resolvedLocationId,
      sync_type: 'menu_sync',
      sync_source: locationId ? 'auto' : 'manual',
      status: 'success',
      items_processed: items.length
    });

    return { provider: integration.provider, count: items.length };
  } catch (syncError: any) {
    logger.error({ err: syncError, restaurantId, locationId: resolvedLocationId, externalId }, '[POS Sync] Exception during menu sync');
    throw syncError;
  }
}

/**
 * Async wrapper for menu sync that runs in background without blocking
 * Errors are logged but don't throw - this is fire-and-forget
 * @param restaurantId - The restaurant ID
 * @param locationId - Optional specific location ID to sync
 * @param syncSource - 'auto' for automatic syncs (after connection), 'manual' for user-triggered syncs
 */
export async function syncMenuFromPosAsync(restaurantId: string, locationId?: string | null, syncSource: 'auto' | 'manual' = 'auto'): Promise<void> {
  // Run sync in background - don't await, just fire and forget
  syncMenuFromPos(restaurantId, locationId, syncSource)
    .then((result) => {
      logger.info(
        { restaurantId, locationId, count: result.count, provider: result.provider, syncSource },
        '[POS Sync Async] Menu sync completed successfully'
      );
    })
    .catch((err) => {
      // Log error but don't throw - connection should succeed even if sync fails
      logger.error(
        { err, restaurantId, locationId, syncSource },
        '[POS Sync Async] Menu sync failed (non-blocking)'
      );
    });
}

export async function getPosSyncLogs(restaurantId: string, limit = 10) {
  const { data, error } = await supabase
    .from('pos_sync_log')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ err: error, restaurantId }, 'Failed to fetch POS sync logs');
    throw Object.assign(new Error('Failed to fetch sync logs'), {
      status: 500,
      details: error
    });
  }

  return data.map((log) => ({
    id: log.id,
    restaurantId: log.restaurant_id,
    syncType: log.sync_type,
    status: log.status,
    itemsSynced: log.items_processed || 0,
    errorMessage: log.error_message,
    syncedAt: log.created_at
  }));
}
