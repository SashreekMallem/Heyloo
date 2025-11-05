import axios from 'axios';
import { env } from '../config/env.js';
export class ToastIntegration {
    provider = 'toast';
    client;
    constructor() {
        if (!env.TOAST_API_KEY || !env.TOAST_PARTNER_CLIENT_ID) {
            throw new Error('Toast credentials are required for Toast integration');
        }
        this.client = axios.create({
            baseURL: 'https://toast-api-server.toasttab.com',
            headers: {
                'Toast-Restaurant-External-Id': env.TOAST_PARTNER_CLIENT_ID,
                'Toast-Api-Key': env.TOAST_API_KEY,
                'Content-Type': 'application/json'
            }
        });
    }
    async pullMenu(restaurantExternalId) {
        const { data } = await this.client.get(`/config/v1/menus?restaurantGuid=${restaurantExternalId}`);
        const menuItems = [];
        for (const menu of data.menus ?? []) {
            for (const group of menu.menuGroups ?? []) {
                for (const item of group.menuItems ?? []) {
                    menuItems.push({
                        externalId: item.guid,
                        name: item.name,
                        description: item.description,
                        category: group.name,
                        price: (item.basePrice ?? 0) / 100,
                        isAvailable: item.active ?? true
                    });
                }
            }
        }
        return menuItems;
    }
    async pushOrder({ restaurantExternalId, orderId, items, total, customerPhone, customerName, orderType, deliveryAddress }) {
        // Parse customer name or use defaults
        const nameParts = customerName?.split(' ') || ['Voice', 'Customer'];
        const firstName = nameParts[0] || 'Voice';
        const lastName = nameParts.slice(1).join(' ') || 'Customer';
        // Phone must be exactly 10 digits for Toast
        const phone = customerPhone?.replace(/\D/g, '').slice(-10) || '0000000000';
        // Email required by Toast - use phone-based email if not provided
        const email = `voice-${phone}@heyloo.temp`;
        // Determine dining option based on order type
        // Toast requires dining option GUID - for now we'll use a placeholder
        // In production, restaurants should configure this during onboarding
        const diningOptionGuid = orderType === 'delivery'
            ? undefined // Delivery orders may need special configuration
            : undefined; // Pickup/dine-in need restaurant-specific GUIDs
        // Build order items with menu item GUIDs
        const orderItems = items.map((item) => ({
            guid: `${orderId}-${item.externalItemId}-${Date.now()}`, // Generate unique GUID
            entityType: 'OrderItem',
            menuItem: {
                guid: item.externalItemId,
                entityType: 'MenuItem'
            },
            quantity: item.quantity,
            price: Math.round(item.unitPrice * 100),
            modifiers: item.modifiers?.map((mod) => ({
                guid: `${orderId}-mod-${mod.externalId || mod.id}`,
                entityType: 'MenuItemSelection',
                item: {
                    guid: mod.externalId || mod.id,
                    entityType: 'MenuItem'
                },
                quantity: 1,
                price: Math.round((mod.priceDelta || 0) * 100)
            })) || []
        }));
        // Build checks array (Toast orders can have multiple checks)
        const checks = [
            {
                entityType: 'Check',
                guid: `${orderId}-check-1`,
                customer: {
                    entityType: 'Customer',
                    firstName: firstName,
                    lastName: lastName,
                    phone: phone,
                    phoneCountryCode: '+1', // Default to US, should be configurable
                    email: email
                },
                orderItems: orderItems,
                payments: [] // Payments handled separately via Stripe
            }
        ];
        const requestBody = {
            entityType: 'Order',
            orderType: orderType === 'delivery' ? 'DELIVERY' : orderType === 'dine_in' ? 'DINE_IN' : 'TAKE_OUT',
            location: {
                guid: restaurantExternalId,
                entityType: 'Location'
            },
            order: {
                guid: orderId,
                entityType: 'Order',
                creationDate: new Date().toISOString(),
                lastUpdatedDate: new Date().toISOString(),
                orderStatus: 'OPEN',
                orderType: orderType === 'delivery' ? 'DELIVERY' : orderType === 'dine_in' ? 'DINE_IN' : 'TAKE_OUT',
                guestCount: 1,
                items: orderItems
            },
            checks: checks
        };
        // Add dining option if provided (required for dine-in)
        if (orderType === 'dine_in' && diningOptionGuid) {
            requestBody.diningOption = {
                guid: diningOptionGuid,
                entityType: 'DiningOption'
            };
        }
        // Add delivery address if it's a delivery order
        if (orderType === 'delivery' && deliveryAddress) {
            requestBody.order.deliveryAddress = deliveryAddress;
        }
        const { data } = await this.client.post('/orders/v2', requestBody);
        return { externalOrderId: data.order?.guid || data.orderGuid || orderId };
    }
}
