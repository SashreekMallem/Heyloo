import type { CreateOrderPayload } from '@heyloo/shared';

import { getPosIntegration, getRestaurantExternalId } from '../integrations/factory.js';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { sendSMS } from '../lib/sms.js';

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [5000, 15000, 60000]; // 5s, 15s, 1min

/**
 * Push order to POS with automatic retry logic
 */
export async function pushOrderToPOS(
  orderId: string,
  restaurantId: string,
  retryAttempt: number = 0
): Promise<{ success: boolean; posOrderId?: string; error?: string }> {
  try {
    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, items')
      .eq('id', orderId)
      .eq('restaurant_id', restaurantId)
      .maybeSingle();

    if (orderError || !order) {
      logger.error({ orderError, orderId }, 'Order not found for POS push');
      return { success: false, error: 'Order not found' };
    }

    // Get restaurant info
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id,name,pos_type,owner_email')
      .eq('id', restaurantId)
      .maybeSingle();

    if (restaurantError || !restaurant) {
      logger.error({ restaurantError, restaurantId }, 'Restaurant not found');
      return { success: false, error: 'Restaurant not found' };
    }

    // Get location-specific POS config (multi-location support)
    let locationConfig = null;
    let posLocationId: string | null = null;
    let accessToken: string | null = null;

    if (order.location_id) {
      // Order is associated with a specific location
      const { data: location } = await supabase
        .from('restaurant_pos_locations')
        .select('id,pos_type,pos_location_id,access_token,is_active')
        .eq('id', order.location_id)
        .eq('is_active', true)
        .maybeSingle();

      if (location) {
        locationConfig = location;
        posLocationId = location.pos_location_id;
        accessToken = location.access_token;
      }
    }

    // Fallback to restaurant-level POS config if no location-specific config
    if (!locationConfig && restaurant.pos_type && restaurant.pos_type !== 'none') {
      const { data: primaryLocation } = await supabase
        .from('restaurant_pos_locations')
        .select('id,pos_location_id,access_token')
        .eq('restaurant_id', restaurantId)
        .eq('pos_type', restaurant.pos_type)
        .eq('is_primary', true)
        .eq('is_active', true)
        .maybeSingle();

      if (primaryLocation) {
        posLocationId = primaryLocation.pos_location_id;
        accessToken = primaryLocation.access_token;
      } else {
        // Legacy fallback to restaurants table
        const { data: legacyRestaurant } = await supabase
          .from('restaurants')
          .select('pos_location_id')
          .eq('id', restaurantId)
          .maybeSingle();
        
        posLocationId = legacyRestaurant?.pos_location_id || null;
      }
    }

    // If no POS configured, mark as manual
    if (!restaurant.pos_type || restaurant.pos_type === 'none' || !posLocationId) {
      await supabase
        .from('orders')
        .update({
          pos_sync_status: 'manual',
          pos_sync_error: 'No POS system configured for this location',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      await alertRestaurantStaff(restaurantId, orderId, 'No POS configured - manual entry required');
      return { success: false, error: 'No POS configured' };
    }

    // Get POS integration
    const integration = getPosIntegration(restaurant.pos_type);
    const externalId = getRestaurantExternalId(restaurant.pos_type, {
      squareLocationId: posLocationId ?? undefined
    });

    if (!externalId) {
      await supabase
        .from('orders')
        .update({
          pos_sync_status: 'manual',
          pos_sync_error: 'POS location ID not configured',
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId);

      await alertRestaurantStaff(
        restaurantId,
        orderId,
        'POS location ID missing - please configure in settings'
      );
      return { success: false, error: 'POS location ID missing' };
    }

    // Convert order items to POS format
    const posItems = order.items.map((item: any) => ({
      externalItemId: item.menuItemId, // Should map to POS item ID
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      modifiers: item.modifiers || []
    }));

    // Push to POS
    logger.info({ orderId, posType: restaurant.pos_type, attempt: retryAttempt + 1 }, 'Pushing order to POS');

    const deliveryAddress = order.order_type === 'delivery'
      ? await getDeliveryAddress(order.delivery_address_id)
      : undefined;

    const result = await integration.pushOrder({
      restaurantExternalId: externalId,
      orderId: orderId,
      items: posItems,
      total: order.total,
      customerName: order.customer_name || 'Voice Order',
      customerPhone: order.customer_phone,
      orderType: order.order_type as 'delivery' | 'pickup' | 'dine_in',
      deliveryAddress: deliveryAddress,
      accessToken: accessToken || undefined // Pass location-specific token for multi-location
    });

    const posOrderId = result.externalOrderId;

    // Update order with POS sync success
    await supabase
      .from('orders')
      .update({
        pos_order_id: posOrderId,
        pos_sync_status: 'synced',
        pos_synced_at: new Date().toISOString(),
        status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    // Log success
    await supabase.from('pos_sync_log').insert({
      restaurant_id: restaurantId,
      sync_type: 'order_push',
      sync_source: 'manual',
      status: 'success',
      items_processed: 1,
      created_at: new Date().toISOString()
    });

    logger.info({ orderId, posOrderId }, 'Order pushed to POS successfully');

    return { success: true, posOrderId };
  } catch (error: any) {
    logger.error({ error, orderId, attempt: retryAttempt + 1 }, 'Failed to push order to POS');

    // Update retry attempt counter
    await supabase
      .from('orders')
      .update({
        pos_sync_attempts: retryAttempt + 1,
        pos_sync_error: error.message || 'Unknown error',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    // Log failure
    await supabase.from('pos_sync_log').insert({
      restaurant_id: restaurantId,
      sync_type: 'order_push',
      sync_source: 'manual',
      status: 'failed',
      items_processed: 0,
      error_message: error.message || 'Unknown error',
      created_at: new Date().toISOString()
    });

    // Retry if attempts remaining
    if (retryAttempt < MAX_RETRY_ATTEMPTS - 1) {
      const delay = RETRY_DELAYS[retryAttempt];
      logger.info({ orderId, nextAttempt: retryAttempt + 2, delay }, 'Scheduling POS push retry');

      setTimeout(() => {
        pushOrderToPOS(orderId, restaurantId, retryAttempt + 1).catch((err) => {
          logger.error({ err, orderId }, 'Retry failed');
        });
      }, delay);

      return { success: false, error: 'Retry scheduled' };
    }

    // Max retries exceeded - mark as manual and alert staff
    await supabase
      .from('orders')
      .update({
        pos_sync_status: 'manual',
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    await alertRestaurantStaff(
      restaurantId,
      orderId,
      `Failed to sync order to POS after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`
    );

    return { success: false, error: error.message };
  }
}

/**
 * Get delivery address details for POS
 */
async function getDeliveryAddress(addressId: string | null): Promise<string | undefined> {
  if (!addressId) return undefined;

  const { data: address } = await supabase
    .from('customer_addresses')
    .select('street,city,state,postal_code,delivery_instructions')
    .eq('id', addressId)
    .maybeSingle();

  if (!address) return undefined;

  let fullAddress = `${address.street}, ${address.city}, ${address.state} ${address.postal_code}`;
  if (address.delivery_instructions) {
    fullAddress += ` (${address.delivery_instructions})`;
  }

  return fullAddress;
}

/**
 * Alert restaurant staff about POS sync issues
 */
export async function alertRestaurantStaff(
  restaurantId: string,
  orderId: string,
  errorMessage: string
): Promise<void> {
  try {
    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('name,owner_email,phone_number')
      .eq('id', restaurantId)
      .maybeSingle();

    if (!restaurant) return;

    // Send SMS alert to restaurant phone
    if (restaurant.phone_number) {
      const message = `⚠️ ${restaurant.name}: Order ${orderId.slice(
        -8
      )} requires manual entry in your POS. Reason: ${errorMessage}`;
      await sendSMS(restaurant.phone_number, message);
    }

    // TODO: Send email alert to owner_email when email service is configured
    logger.warn(
      {
        restaurantId,
        orderId,
        ownerEmail: restaurant.owner_email,
        error: errorMessage
      },
      'Restaurant staff alerted about POS sync failure'
    );
  } catch (error) {
    logger.error({ error, restaurantId, orderId }, 'Failed to alert restaurant staff');
  }
}

/**
 * Manually retry a failed order sync
 */
export async function retryOrderSync(orderId: string, restaurantId: string): Promise<void> {
  // Reset sync status
  await supabase
    .from('orders')
    .update({
      pos_sync_status: 'pending',
      pos_sync_attempts: 0,
      pos_sync_error: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', orderId);

  // Trigger push
  await pushOrderToPOS(orderId, restaurantId);
}

