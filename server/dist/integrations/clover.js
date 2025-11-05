import axios from 'axios';
import { env } from '../config/env.js';
export class CloverIntegration {
    provider = 'clover';
    client;
    constructor() {
        if (!env.CLOVER_API_KEY || !env.CLOVER_MERCHANT_ID) {
            throw new Error('Clover credentials are required for Clover integration');
        }
        this.client = axios.create({
            baseURL: `https://api.clover.com/v3/merchants/${env.CLOVER_MERCHANT_ID}`,
            headers: {
                Authorization: `Bearer ${env.CLOVER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
    }
    async pullMenu() {
        const { data } = await this.client.get('/items', {
            params: {
                expand: 'categories'
            }
        });
        return (data.elements ?? []).map((item) => ({
            externalId: item.id,
            name: item.name,
            description: item.description,
            category: item.categories?.elements?.[0]?.name ?? undefined,
            price: (item.price ?? 0) / 100,
            isAvailable: item.available ?? true
        }));
    }
    async pushOrder({ restaurantExternalId, orderId, items, total, customerPhone, customerName, orderType, deliveryAddress }) {
        // Create order
        const orderNote = [
            customerPhone ? `Caller: ${customerPhone}` : null,
            customerName ? `Customer: ${customerName}` : null,
            orderType === 'delivery' && deliveryAddress ? `Delivery: ${deliveryAddress}` : null
        ]
            .filter(Boolean)
            .join(' | ');
        const { data: order } = await this.client.post('/orders', {
            id: orderId,
            currency: 'USD',
            title: customerName || `Voice Order ${orderId.slice(-6)}`,
            note: orderNote || undefined
        });
        const orderIdFromResponse = order.id;
        // Add line items
        for (const item of items) {
            await this.client.post(`/orders/${orderIdFromResponse}/line_items`, {
                item: item.externalItemId ? { id: item.externalItemId } : undefined,
                name: item.name,
                price: Math.round(item.unitPrice * 100),
                unitPrice: Math.round(item.unitPrice * 100),
                quantity: item.quantity
            });
            // Add modifiers if any
            if (item.modifiers && item.modifiers.length > 0) {
                for (const modifier of item.modifiers) {
                    await this.client.post(`/orders/${orderIdFromResponse}/line_items`, {
                        name: modifier.name,
                        price: Math.round((modifier.priceDelta || 0) * 100),
                        quantity: item.quantity // Modifier quantity matches item quantity
                    });
                }
            }
        }
        // Note: We don't call /pay endpoint here because payment is handled via Stripe
        // The order will remain in 'open' state until manually closed or paid in POS
        // Restaurant staff can complete payment in their POS system
        return { externalOrderId: orderIdFromResponse ?? orderId };
    }
}
