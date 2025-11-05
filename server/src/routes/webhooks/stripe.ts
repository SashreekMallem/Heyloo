import { Router } from 'express';
import Stripe from 'stripe';

import { env } from '../../config/env.js';
import { stripe, assertStripeConfigured } from '../../lib/stripe.js';
import { attachStripePaymentResult } from '../../services/order-service.js';
import { pushOrderToPOS } from '../../services/pos-push-service.js';
import { sendOrderConfirmationSMS } from '../../lib/sms.js';
import { logger } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post('/', async (req, res) => {
  assertStripeConfigured();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({
      message: 'Stripe webhook secret is not configured',
      code: 'STRIPE_NOT_CONFIGURED'
    });
  }

  const rawBody = (req as typeof req & { rawBody?: string }).rawBody;

  if (!rawBody) {
    return res.status(400).json({
      message: 'Raw body is required for signature verification',
      code: 'INVALID_PAYLOAD'
    });
  }

  const signature = req.header('stripe-signature');

  if (!signature) {
    return res.status(401).json({
      message: 'Missing Stripe signature header',
      code: 'UNAUTHORIZED'
    });
  }

  let event: Stripe.Event;

  try {
    event = stripe!.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({
      message: 'Invalid Stripe webhook signature',
      code: 'INVALID_SIGNATURE'
    });
  }

  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = paymentIntent.metadata?.order_id;
      if (orderId) {
        await attachStripePaymentResult(orderId, paymentIntent.id);

        // Get order details for notifications and POS push
        const { data: order } = await supabase
          .from('orders')
          .select('id,restaurant_id,customer_phone,customer_name,order_type')
          .eq('id', orderId)
          .maybeSingle();

        if (order) {
          // Get restaurant details for SMS and POS
          const { data: restaurant } = await supabase
            .from('restaurants')
            .select('name,pos_type,manager_phone')
            .eq('id', order.restaurant_id)
            .maybeSingle();

          if (restaurant) {
            // Send confirmation SMS to customer
            sendOrderConfirmationSMS(
              order.customer_phone,
              order.id,
              restaurant.name,
              order.order_type
            ).catch((err) => {
              logger.error({ err, orderId }, 'Failed to send confirmation SMS');
            });

            // Push to POS or notify manager based on restaurant setup
            if (restaurant.pos_type && restaurant.pos_type !== 'none') {
              // Push to POS asynchronously
              pushOrderToPOS(order.id, order.restaurant_id).catch((err) => {
                logger.error({ err, orderId }, 'Failed to push paid order to POS');
              });
            } else if (restaurant.manager_phone) {
              // No POS - send SMS notification to manager
              const { sendOrderNotificationSMS } = await import('../../lib/sms.js');
              sendOrderNotificationSMS(restaurant.manager_phone, order, restaurant.name).catch(
                (err) => {
                  logger.error({ err, orderId }, 'Failed to send order notification to manager');
                }
              );
            }
          }
        }
      }
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = paymentIntent.metadata?.order_id;
      if (orderId) {
        await supabase
          .from('orders')
          .update({
            payment_status: 'failed',
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);

        logger.warn(
          { orderId, paymentIntentId: paymentIntent.id },
          'Payment failed for order'
        );
      }
      break;
    }

    case 'payment_intent.canceled': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const orderId = paymentIntent.metadata?.order_id;
      if (orderId) {
        await supabase
          .from('orders')
          .update({
            payment_status: 'canceled',
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);

        logger.info(
          { orderId, paymentIntentId: paymentIntent.id },
          'Payment canceled for order'
        );
      }
      break;
    }

    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      if (orderId && session.payment_status === 'paid') {
        await attachStripePaymentResult(orderId, session.payment_intent as string);

        // Get order and restaurant details for notifications
        const { data: order } = await supabase
          .from('orders')
          .select('id,restaurant_id,customer_phone,customer_name,order_type')
          .eq('id', orderId)
          .maybeSingle();

        if (order) {
          const { data: restaurant } = await supabase
            .from('restaurants')
            .select('name,pos_type,manager_phone')
            .eq('id', order.restaurant_id)
            .maybeSingle();

          if (restaurant) {
            // Send confirmation SMS to customer
            sendOrderConfirmationSMS(
              order.customer_phone,
              order.id,
              restaurant.name,
              order.order_type
            ).catch((err) => {
              logger.error({ err, orderId }, 'Failed to send confirmation SMS after checkout');
            });

            // Push to POS or notify manager
            if (restaurant.pos_type && restaurant.pos_type !== 'none') {
              pushOrderToPOS(order.id, order.restaurant_id).catch((err) => {
                logger.error({ err, orderId }, 'Failed to push order to POS after checkout');
              });
            } else if (restaurant.manager_phone) {
              const { sendOrderNotificationSMS } = await import('../../lib/sms.js');
              sendOrderNotificationSMS(restaurant.manager_phone, order, restaurant.name).catch(
                (err) => {
                  logger.error(
                    { err, orderId },
                    'Failed to send order notification to manager after checkout'
                  );
                }
              );
            }
          }
        }
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object as Stripe.Charge;
      const orderId = charge.metadata?.order_id;
      if (orderId) {
        await supabase
          .from('orders')
          .update({
            payment_status: 'refunded',
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('id', orderId);

        logger.info({ orderId, chargeId: charge.id }, 'Order refunded');
      }
      break;
    }

    default:
      logger.debug({ eventType: event.type }, 'Unhandled Stripe webhook event');
      break;
  }

  res.status(200).json({ received: true });
});
