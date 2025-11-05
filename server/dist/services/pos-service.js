import { getPosIntegration, getRestaurantExternalId } from '../integrations/factory.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
export async function syncMenuFromPos(restaurantId) {
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
    const integration = getPosIntegration(restaurant.pos_type);
    const externalId = getRestaurantExternalId(restaurant.pos_type, {
        squareLocationId: restaurant.pos_location_id ?? undefined
    });
    if (!externalId) {
        throw Object.assign(new Error('Missing POS external identifier for restaurant'), {
            status: 400,
            code: 'POS_LOCATION_REQUIRED'
        });
    }
    let accessToken;
    let locationId = null;
    const { error: tenantError } = await supabase.rpc('set_tenant_id', {
        p_tenant_id: restaurantId
    });
    if (tenantError) {
        logger.error({ tenantError, restaurantId }, '[POS Sync] Failed to set tenant context');
        throw Object.assign(new Error('Failed to establish tenant context'), {
            status: 500,
            code: 'TENANT_CONTEXT_FAILED'
        });
    }
    try {
        if (restaurant.pos_type && restaurant.pos_location_id) {
            const { data: location, error: locationError } = await supabase
                .from('restaurant_pos_locations')
                .select('id,access_token,is_active')
                .eq('restaurant_id', restaurantId)
                .eq('pos_type', restaurant.pos_type)
                .eq('pos_location_id', restaurant.pos_location_id)
                .eq('is_active', true)
                .maybeSingle();
            if (locationError) {
                logger.error({ restaurantId, posType: restaurant.pos_type, posLocationId: restaurant.pos_location_id, locationError }, '[POS Sync] Error querying restaurant_pos_locations');
            }
            if (location?.access_token) {
                const resolvedAccessToken = location.access_token;
                accessToken = resolvedAccessToken;
                locationId = location.id;
                logger.info({
                    restaurantId,
                    locationId,
                    accessTokenLength: resolvedAccessToken.length,
                    accessTokenPrefix: resolvedAccessToken.substring(0, 12)
                }, '[POS Sync] Loaded location credentials');
            }
            else {
                logger.warn({
                    restaurantId,
                    posType: restaurant.pos_type,
                    posLocationId: restaurant.pos_location_id,
                    locationFound: !!location
                }, '[POS Sync] No active location credentials found');
            }
        }
        if (!accessToken) {
            logger.warn({
                restaurantId,
                posType: restaurant.pos_type,
                posLocationId: restaurant.pos_location_id,
                externalId
            }, '[POS Sync] No access token found, using default credentials if configured');
        }
        const items = await integration.pullMenu(externalId, accessToken);
        if (!items.length) {
            await supabase.from('pos_sync_log').insert({
                restaurant_id: restaurantId,
                location_id: locationId,
                sync_type: 'menu_sync',
                sync_source: 'manual',
                status: 'success',
                items_processed: 0
            });
            return { provider: integration.provider, count: 0 };
        }
        const { error: upsertError } = await supabase.from('menu_items').upsert(items.map((item) => ({
            restaurant_id: restaurantId,
            location_id: locationId,
            pos_item_id: item.externalId,
            name: item.name,
            description: item.description ?? null,
            category: item.category ?? null,
            price: item.price,
            is_available: item.isAvailable,
            sync_source: 'pos'
        })), { onConflict: 'restaurant_id,pos_item_id' });
        if (upsertError) {
            logger.error({ err: upsertError, restaurantId }, '[POS Sync] Failed to upsert menu items');
            await supabase.from('pos_sync_log').insert({
                restaurant_id: restaurantId,
                location_id: locationId,
                sync_type: 'menu_sync',
                sync_source: 'manual',
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
            location_id: locationId,
            sync_type: 'menu_sync',
            sync_source: 'manual',
            status: 'success',
            items_processed: items.length
        });
        return { provider: integration.provider, count: items.length };
    }
    finally {
        const { error: clearError } = await supabase.rpc('clear_tenant_id');
        if (clearError) {
            logger.warn({ clearError, restaurantId }, '[POS Sync] Failed to clear tenant context');
        }
    }
}
export async function getPosSyncLogs(restaurantId, limit = 10) {
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
