import { env } from '../config/env.js';
import { logger } from './logger.js';
/**
 * Send SMS using Twilio (or mock in development)
 */
export async function sendSMS(to, message) {
    // If no Twilio credentials, log and return success in dev mode
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_PHONE_NUMBER) {
        logger.warn({ to, messagePreview: message.substring(0, 50) }, 'Twilio not configured - SMS would be sent in production');
        return true; // Don't fail the order creation
    }
    try {
        // In production, use Twilio SDK
        // For now, log the SMS that would be sent
        logger.info({
            to,
            from: env.TWILIO_PHONE_NUMBER,
            message
        }, 'SMS sent successfully');
        // TODO: Implement actual Twilio API call when credentials are available
        // const twilio = require('twilio');
        // const client = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
        // await client.messages.create({
        //   body: message,
        //   from: env.TWILIO_PHONE_NUMBER,
        //   to: to
        // });
        return true;
    }
    catch (error) {
        logger.error({ error, to }, 'Failed to send SMS');
        return false; // Don't throw - SMS failure shouldn't break order flow
    }
}
/**
 * Send payment link SMS to customer
 */
export async function sendPaymentLinkSMS(phoneNumber, paymentLink, orderTotal, restaurantName) {
    const message = `Hi! Your order from ${restaurantName} totaling $${orderTotal.toFixed(2)} is ready. Please complete payment here: ${paymentLink}`;
    return sendSMS(phoneNumber, message);
}
/**
 * Send order confirmation SMS
 */
export async function sendOrderConfirmationSMS(phoneNumber, orderId, restaurantName, orderType, estimatedTime) {
    let message = `✅ Your ${orderType} order from ${restaurantName} has been confirmed! Order ID: ${orderId.slice(-8)}`;
    if (estimatedTime) {
        message += ` Estimated ${orderType === 'delivery' ? 'delivery' : 'pickup'} time: ${estimatedTime}`;
    }
    return sendSMS(phoneNumber, message);
}
/**
 * Send order notification to restaurant manager (for manual POS)
 */
export async function sendOrderNotificationSMS(managerPhone, order, restaurantName) {
    const itemsList = order.items
        .map((item) => `${item.quantity}x ${item.name} ($${item.lineTotal})`)
        .join('\n');
    const message = `🔔 NEW ORDER #${order.id.slice(0, 8)}

${restaurantName}

Customer: ${order.customer_name || order.customer_phone}
Phone: ${order.customer_phone}
Type: ${order.order_type.toUpperCase()}
Payment: ${order.payment_method}

Items:
${itemsList}

Subtotal: $${order.subtotal}
Tax: $${order.tax}
${order.delivery_fee > 0 ? `Delivery: $${order.delivery_fee}\n` : ''}Total: $${order.total}

View dashboard: https://heyloo.ai/restaurant/orders`;
    return sendSMS(managerPhone, message);
}
/**
 * Send order status update SMS
 */
export async function sendOrderStatusSMS(phoneNumber, orderId, status, restaurantName) {
    const statusMessages = {
        preparing: '👨‍🍳 Your order is being prepared!',
        ready: '✅ Your order is ready for pickup!',
        out_for_delivery: '🚗 Your order is out for delivery!',
        delivered: '📦 Your order has been delivered. Enjoy!'
    };
    const statusMessage = statusMessages[status] || `Order status: ${status}`;
    const message = `${restaurantName} - ${statusMessage} (Order: ${orderId.slice(-8)})`;
    return sendSMS(phoneNumber, message);
}
