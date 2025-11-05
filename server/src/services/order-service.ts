import { nanoid } from 'nanoid';

import type { CreateOrderPayload, Order } from '@heyloo/shared';
import { createOrderPayloadSchema, orderSchema } from '@heyloo/shared';

import { env } from '../config/env.js';
import { stripe, assertStripeConfigured } from '../lib/stripe.js';
import { supabase } from '../lib/supabase.js';
import { roundCurrency } from '../utils/currency.js';
import { getPosIntegration, getRestaurantExternalId } from '../integrations/factory.js';
import { logger } from '../lib/logger.js';
import { findOrCreateCustomer } from './customer-service.js';
import { sendPaymentLinkSMS, sendOrderNotificationSMS } from '../lib/sms.js';
import { pushOrderToPOS } from './pos-push-service.js';

type CreateOrderOptions = {
  source?: 'vapi' | 'dashboard';
  callId?: string | null;
  locationId?: string | null; // For multi-location support
};

export async function createOrder(
  payload: CreateOrderPayload,
  options: CreateOrderOptions = {}
): Promise<Order> {
  const parsed = createOrderPayloadSchema.parse(payload);

  const { data: restaurant, error: restaurantError } = await supabase
    .from('restaurants')
    .select(
      'id,name,tax_rate,delivery_fee,stripe_account_id,stripe_customer_id,pos_type,pos_location_id,manager_phone'
    )
    .eq('id', parsed.restaurantId)
    .maybeSingle();

  if (restaurantError) {
    throw Object.assign(new Error('Failed to fetch restaurant'), {
      status: 500,
      details: restaurantError
    });
  }

  if (!restaurant) {
    throw Object.assign(new Error('Restaurant not found'), {
      status: 404,
      code: 'RESTAURANT_NOT_FOUND'
    });
  }

  const customer = await findOrCreateCustomer(
    parsed.restaurantId,
    parsed.customerPhone,
    parsed.customerName
  );

  const menuItemIds = parsed.items.map((item) => item.menuItemId);

  const { data: menuItems, error: menuError } = await supabase
    .from('menu_items')
    .select('id,name,price,is_available')
    .eq('restaurant_id', parsed.restaurantId)
    .in('id', menuItemIds);

  if (menuError) {
    throw Object.assign(new Error('Failed to fetch menu items'), {
      status: 500,
      details: menuError
    });
  }

  if (!menuItems || menuItems.length !== parsed.items.length) {
    throw Object.assign(new Error('One or more menu items are unavailable'), {
      status: 400,
      code: 'MENU_ITEM_UNAVAILABLE'
    });
  }

  const items = parsed.items.map((item) => {
    const menuItem = menuItems.find((m) => m.id === item.menuItemId);
    if (!menuItem) {
      throw Object.assign(new Error('Menu item missing'), {
        status: 400,
        code: 'MENU_ITEM_UNAVAILABLE'
      });
    }

    const modifiers = item.modifiers?.map((modifier) => ({
      name: modifier.name,
      priceDelta: modifier.priceDelta
    })) ?? [];

    const modifiersTotal = modifiers.reduce((sum, modifier) => sum + modifier.priceDelta, 0);
    const unitPrice = roundCurrency(menuItem.price + modifiersTotal);
    const lineTotal = roundCurrency(unitPrice * item.quantity);

    return {
      menuItemId: item.menuItemId,
      name: menuItem.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      modifiers
    };
  });

  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.lineTotal, 0));
  const tax = roundCurrency(subtotal * restaurant.tax_rate);
  const deliveryFee =
    parsed.orderType === 'delivery' ? roundCurrency(restaurant.delivery_fee) : 0;
  const total = roundCurrency(subtotal + tax + deliveryFee);

  let stripePaymentLink: string | null = null;
  let stripePaymentIntentId: string | null = null;

  if (parsed.paymentMethod === 'stripe_link') {
    assertStripeConfigured();

    const paymentIntent = await stripe!.paymentIntents.create(
      {
        amount: Math.round(total * 100),
        currency: 'usd',
        customer: restaurant.stripe_customer_id ?? undefined,
        metadata: {
          restaurant_id: parsed.restaurantId,
          customer_phone: parsed.customerPhone,
          source: options.source ?? 'dashboard'
        },
        description: `${restaurant.name} voice order`
      },
      restaurant.stripe_account_id
        ? {
            stripeAccount: restaurant.stripe_account_id
          }
        : undefined
    );

    stripePaymentIntentId = paymentIntent.id;

    // Create a temporary price for the payment link
    const price = await stripe!.prices.create({
      currency: 'usd',
      unit_amount: Math.round(total * 100),
      product_data: {
        name: `Order from ${restaurant.name}`
      }
    });

    const paymentLink = await stripe!.paymentLinks.create(
      {
        line_items: [
          {
            price: price.id,
            quantity: 1
          }
        ],
        metadata: {
          restaurant_id: parsed.restaurantId,
          order_reference: nanoid(10)
        }
      },
      restaurant.stripe_account_id
        ? {
            stripeAccount: restaurant.stripe_account_id
          }
        : undefined
    );

    stripePaymentLink = paymentLink.url;

    // Send payment link SMS
    if (stripePaymentLink) {
      const smsSent = await sendPaymentLinkSMS(
        parsed.customerPhone,
        stripePaymentLink,
        total,
        restaurant.name
      );
      
      if (smsSent) {
        logger.info({ customerPhone: parsed.customerPhone }, 'Payment link SMS sent');
      }
    }
  }

  // Determine location_id for multi-location support
  let locationId: string | null = options.locationId || null;
  
  // If location_id not provided but callId exists, try to find from call_logs
  if (!locationId && options.callId) {
    const { data: callLog } = await supabase
      .from('call_logs')
      .select('location_id')
      .eq('call_id', options.callId)
      .maybeSingle();
    
    if (callLog?.location_id) {
      locationId = callLog.location_id;
    }
  }

  const { data: insertedOrder, error: insertError } = await supabase
    .from('orders')
    .insert({
      restaurant_id: parsed.restaurantId,
      location_id: locationId,
      customer_id: customer.id,
      customer_phone: parsed.customerPhone,
      customer_name: parsed.customerName ?? null,
      order_type: parsed.orderType,
      delivery_address_id: parsed.deliveryAddressId ?? null,
      status: parsed.paymentMethod === 'stripe_link' ? 'payment_pending' : 'pending',
      payment_status: parsed.paymentMethod === 'stripe_link' ? 'pending' : 'paid',
      payment_method: parsed.paymentMethod,
      pos_sync_status: 'pending',
      pos_sync_attempts: 0,
      subtotal,
      tax,
      delivery_fee: deliveryFee,
      total,
      items,
      stripe_payment_link: stripePaymentLink,
      stripe_payment_intent_id: stripePaymentIntentId,
      payment_link_sent_at: stripePaymentLink ? new Date().toISOString() : null,
      call_id: options.callId ?? null,
      source: options.source ?? 'dashboard'
    })
    .select(
      'id,restaurant_id,customer_id,status,payment_status,subtotal,tax,delivery_fee,total,payment_method,stripe_payment_link,stripe_payment_intent_id,items,placed_at,updated_at'
    )
    .maybeSingle();

  if (insertError || !insertedOrder) {
    throw Object.assign(new Error('Failed to create order'), {
      status: 500,
      details: insertError
    });
  }

  await supabase.rpc('increment_customer_totals', {
    p_customer_id: customer.id,
    p_order_total: total
  });

  await supabase.rpc('record_order_usage', {
    p_restaurant_id: parsed.restaurantId,
    p_order_total: total,
    p_order_type: parsed.orderType
  });

  const parsedOrder = orderSchema.parse(insertedOrder);

  // Push to POS if payment is not required OR if cash/card on delivery
  // For stripe_link, we'll push after payment confirmation via webhook
  if (parsed.paymentMethod !== 'stripe_link') {
    // Push to POS asynchronously (don't block response)
    if (restaurant.pos_type && restaurant.pos_type !== 'none') {
      pushOrderToPOS(parsedOrder.id, parsed.restaurantId).catch((error) => {
        logger.error(
          { error, orderId: parsedOrder.id },
          'Background POS push failed - will retry'
        );
      });
    } else {
      // No POS integration - send SMS to manager if configured
      if (restaurant.manager_phone) {
        sendOrderNotificationSMS(restaurant.manager_phone, parsedOrder, restaurant.name).catch(
          (error) => {
            logger.error(
              { error, orderId: parsedOrder.id },
              'Failed to send order notification SMS to manager'
            );
          }
        );
      }
    }
  }

  return parsedOrder;
}

export async function updateOrderStatus(
  orderId: string,
  restaurantId: string,
  status: string
) {
  const { data, error } = await supabase
    .from('orders')
    .update({ status })
    .eq('id', orderId)
    .eq('restaurant_id', restaurantId)
    .select('id,status')
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error('Failed to update order status'), {
      status: 500,
      details: error
    });
  }

  if (!data) {
    throw Object.assign(new Error('Order not found'), {
      status: 404,
      code: 'ORDER_NOT_FOUND'
    });
  }

  return data;
}

export async function attachStripePaymentResult(orderId: string, paymentIntentId: string) {
  const { error } = await supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      stripe_payment_intent_id: paymentIntentId,
      status: 'payment_pending'
    })
    .eq('id', orderId);

  if (error) {
    throw Object.assign(new Error('Failed to update payment status'), {
      status: 500,
      details: error
    });
  }
}
