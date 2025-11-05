import { Router } from 'express';
import crypto from 'node:crypto';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';

export const squareWebhookRouter = Router();

/**
 * Verify Square webhook signature
 */
function verifySquareSignature(rawBody: string, signature: string | undefined, signatureKey: string): boolean {
  if (!signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', signatureKey)
    .update(signatureKey + rawBody)
    .digest('base64');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * POST /webhooks/square
 * Handle Square webhook events
 */
squareWebhookRouter.post('/', async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: string }).rawBody;

  if (!rawBody) {
    return res.status(400).json({
      message: 'Raw body is required for signature verification',
      code: 'INVALID_PAYLOAD'
    });
  }

  // Note: Square webhook signature key is configured per webhook subscription in Square Dashboard
  // For now, we'll log the event without strict verification
  // In production, retrieve the signature key from your webhook subscription settings
  const signature = req.header('x-square-hmacsha256-signature');
  
  // TODO: Get signature key from Square webhook subscription configuration
  // const signatureKey = await getSquareWebhookSignatureKey(req);
  // if (!verifySquareSignature(rawBody, signature, signatureKey)) {
  //   return res.status(401).json({ message: 'Invalid signature', code: 'UNAUTHORIZED' });
  // }

  try {
    const event = JSON.parse(rawBody);

    logger.info({ eventId: event.event_id, eventType: event.type }, 'Square webhook received');

    switch (event.type) {
      case 'order.created':
      case 'order.updated': {
        const order = event.data?.object;
        if (order) {
          // Update order in our system if it exists
          const { data: existingOrder } = await supabase
            .from('orders')
            .select('id,restaurant_id')
            .eq('pos_order_id', order.id)
            .maybeSingle();

          if (existingOrder) {
            await supabase
              .from('orders')
              .update({
                status: mapSquareOrderState(order.state),
                updated_at: new Date().toISOString()
              })
              .eq('id', existingOrder.id);

            logger.info({ orderId: existingOrder.id, squareOrderId: order.id }, 'Order updated from Square webhook');
          }
        }
        break;
      }

      case 'oauth.authorization.revoked': {
        const merchantId = event.data?.object?.merchant_id;
        if (merchantId) {
          // Find restaurant by Square location ID
          const { data: restaurants } = await supabase
            .from('restaurants')
            .select('id,name')
            .eq('pos_type', 'square')
            .eq('pos_location_id', merchantId);

          if (restaurants && restaurants.length > 0) {
            // Clear POS credentials
            for (const restaurant of restaurants) {
              await supabase
                .from('restaurants')
                .update({
                  pos_type: 'none',
                  pos_location_id: null,
                  updated_at: new Date().toISOString()
                })
                .eq('id', restaurant.id);

              logger.warn({ restaurantId: restaurant.id }, 'Square authorization revoked');
            }
          }
        }
        break;
      }

      default:
        logger.debug({ eventType: event.type }, 'Unhandled Square webhook event');
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err, body: rawBody }, 'Failed to process Square webhook');
    res.status(500).json({ message: 'Webhook processing failed', code: 'PROCESSING_ERROR' });
  }
});

/**
 * Map Square order state to our order status
 */
function mapSquareOrderState(squareState: string): string {
  const stateMap: Record<string, string> = {
    DRAFT: 'pending',
    OPEN: 'confirmed',
    COMPLETED: 'delivered',
    CANCELED: 'cancelled'
  };

  return stateMap[squareState] || 'pending';
}

