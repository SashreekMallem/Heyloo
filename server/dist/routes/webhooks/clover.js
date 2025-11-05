import { Router } from 'express';
import { logger } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';
export const cloverWebhookRouter = Router();
/**
 * GET /webhooks/clover
 * Handle Clover webhook verification (they may send GET request to verify endpoint)
 */
cloverWebhookRouter.get('/', async (req, res) => {
    const verificationCode = req.query.code || req.query.verification || req.query.challenge;
    logger.info({
        verificationCode: verificationCode || 'NOT FOUND',
        query: req.query,
        headers: Object.keys(req.headers),
        method: req.method,
        url: req.url,
        fullQuery: JSON.stringify(req.query)
    }, 'Clover webhook verification request received');
    // If Clover sends a challenge, echo it back
    if (verificationCode) {
        res.status(200).send(verificationCode);
    }
    else {
        res.status(200).send('OK');
    }
});
/**
 * POST /webhooks/clover
 * Handle Clover webhook events
 */
cloverWebhookRouter.post('/', async (req, res) => {
    try {
        const event = req.body;
        // Verification payloads may arrive via POST with a code/challenge field
        if (event && (event.verificationCode || event.code || event.challenge)) {
            const verificationCode = event.verificationCode || event.code || event.challenge;
            logger.info({ verificationCode, raw: event }, 'Clover webhook verification (POST) received');
            return res.status(200).send(String(verificationCode));
        }
        logger.info({ eventId: event.id, eventType: event.type }, 'Clover webhook received');
        switch (event.type) {
            case 'ORDER_CREATE':
            case 'ORDER_UPDATE': {
                const order = event.object;
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
                            status: mapCloverOrderState(order.state),
                            updated_at: new Date().toISOString()
                        })
                            .eq('id', existingOrder.id);
                        logger.info({ orderId: existingOrder.id, cloverOrderId: order.id }, 'Order updated from Clover webhook');
                    }
                }
                break;
            }
            case 'MERCHANT_UPDATE': {
                const merchantId = event.object?.id;
                if (merchantId) {
                    // Find restaurant by Clover merchant ID
                    const { data: restaurants } = await supabase
                        .from('restaurants')
                        .select('id,name')
                        .eq('pos_type', 'clover')
                        .eq('pos_location_id', merchantId);
                    logger.info({ merchantId, restaurantCount: restaurants?.length }, 'Clover merchant update received');
                }
                break;
            }
            case 'INVENTORY_UPDATE': {
                // Menu items may have changed, trigger menu sync
                const merchantId = event.merchantId;
                if (merchantId) {
                    logger.info({ merchantId }, 'Inventory update received, menu sync recommended');
                    // TODO: Trigger menu sync for this restaurant
                }
                break;
            }
            default:
                logger.debug({ eventType: event.type }, 'Unhandled Clover webhook event');
        }
        res.status(200).json({ received: true });
    }
    catch (err) {
        logger.error({ err, body: req.body }, 'Failed to process Clover webhook');
        res.status(500).json({ message: 'Webhook processing failed', code: 'PROCESSING_ERROR' });
    }
});
/**
 * Map Clover order state to our order status
 */
function mapCloverOrderState(cloverState) {
    const stateMap = {
        open: 'confirmed',
        locked: 'confirmed',
        closed: 'delivered'
    };
    return stateMap[cloverState.toLowerCase()] || 'pending';
}
