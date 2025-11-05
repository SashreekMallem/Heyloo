import { Router } from 'express';
import { z } from 'zod';
import { requireVapiToolToken } from '../../middleware/vapi-tool-auth.js';
import { vapiToolLimiter } from '../../middleware/rate-limit.js';
import { listMenuItems } from '../../services/restaurant-service.js';
import { findOrCreateCustomer, getCustomerAddresses } from '../../services/customer-service.js';
import { createOrder, updateOrderStatus } from '../../services/order-service.js';
import { supabase } from '../../lib/supabase.js';
const router = Router();
const restaurantParamSchema = z.object({
    restaurantId: z.string().uuid()
});
// Apply rate limiting and authentication
router.use(vapiToolLimiter);
router.use(requireVapiToolToken);
router.get('/menu', async (req, res) => {
    const { restaurantId } = restaurantParamSchema.parse(req.query);
    // Extract locationId from VAPI variables if provided (multi-location support)
    const locationId = req.query.locationId || req.query.location_id || null;
    const menu = await listMenuItems(restaurantId, locationId);
    res.json({ items: menu });
});
const findCustomerSchema = z.object({
    restaurantId: z.string().uuid(),
    phoneNumber: z.string(),
    name: z.string().optional()
});
router.post('/customer', async (req, res) => {
    const body = findCustomerSchema.parse(req.body);
    const customer = await findOrCreateCustomer(body.restaurantId, body.phoneNumber, body.name);
    res.json(customer);
});
router.get('/customer-addresses', async (req, res) => {
    const schema = z.object({
        restaurantId: z.string().uuid(),
        customerId: z.string().uuid()
    });
    const { restaurantId, customerId } = schema.parse(req.query);
    const addresses = await getCustomerAddresses(customerId, restaurantId);
    res.json({ addresses });
});
router.post('/orders', async (req, res) => {
    // Extract locationId from VAPI variables if provided (multi-location support)
    const body = req.body;
    const locationId = body.locationId || body.location_id || null;
    const callId = body.callId || null;
    const order = await createOrder(req.body, {
        source: 'vapi',
        locationId: locationId,
        callId: callId
    });
    res.status(201).json(order);
});
router.post('/orders/:orderId/status', async (req, res) => {
    const schema = z.object({
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
        ]),
        restaurantId: z.string().uuid()
    });
    const { orderId } = req.params;
    const body = schema.parse(req.body);
    const result = await updateOrderStatus(orderId, body.restaurantId, body.status);
    res.json(result);
});
router.get('/orders/:orderId/status', async (req, res) => {
    const schema = z.object({
        restaurantId: z.string().uuid()
    });
    const { orderId } = req.params;
    const { restaurantId } = schema.parse(req.query);
    const { data: order, error } = await supabase
        .from('orders')
        .select('id,status,payment_status,total,placed_at,customer_name')
        .eq('id', orderId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();
    if (error) {
        return res.status(500).json({
            message: 'Failed to fetch order',
            code: 'ORDER_FETCH_ERROR'
        });
    }
    if (!order) {
        return res.status(404).json({
            message: 'Order not found',
            code: 'ORDER_NOT_FOUND'
        });
    }
    // Return friendly status message for VAPI
    let statusMessage = 'Your order is being processed';
    switch (order.status) {
        case 'payment_pending':
            statusMessage = 'Waiting for payment. Please check your text message for the payment link.';
            break;
        case 'pending':
            statusMessage = 'Your order is being processed';
            break;
        case 'confirmed':
            statusMessage = 'Your order has been confirmed and is being prepared';
            break;
        case 'preparing':
            statusMessage = 'Your order is being prepared in the kitchen';
            break;
        case 'ready':
            statusMessage = 'Your order is ready for pickup!';
            break;
        case 'out_for_delivery':
            statusMessage = 'Your order is out for delivery';
            break;
        case 'delivered':
            statusMessage = 'Your order has been delivered';
            break;
        case 'picked_up':
            statusMessage = 'Your order has been picked up';
            break;
        case 'cancelled':
            statusMessage = 'Your order has been cancelled';
            break;
    }
    res.json({
        orderId: order.id,
        status: order.status,
        paymentStatus: order.payment_status,
        message: statusMessage,
        total: order.total,
        placedAt: order.placed_at
    });
});
export const vapiToolsRouter = router;
