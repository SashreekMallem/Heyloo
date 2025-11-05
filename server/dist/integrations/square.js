import axios from 'axios';
import { env } from '../config/env.js';
export class SquareIntegration {
    provider = 'square';
    defaultClient;
    baseURL;
    squareVersion = '2025-01-23';
    constructor() {
        this.baseURL =
            env.SQUARE_ENVIRONMENT === 'production' || env.NODE_ENV === 'production'
                ? 'https://connect.squareup.com/v2'
                : 'https://connect.squareupsandbox.com/v2';
        // Create default client only if env token exists (backward compatibility)
        if (env.SQUARE_ACCESS_TOKEN) {
            this.defaultClient = axios.create({
                baseURL: this.baseURL,
                headers: {
                    Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                    'Square-Version': this.squareVersion
                }
            });
        }
        else {
            this.defaultClient = null;
        }
    }
    getClient(accessToken) {
        // Use provided token (multi-location) or fall back to default
        const token = accessToken || env.SQUARE_ACCESS_TOKEN;
        if (!token) {
            throw new Error('Square access token is required');
        }
        if (accessToken && accessToken !== env.SQUARE_ACCESS_TOKEN) {
            // Create new client with location-specific token
            return axios.create({
                baseURL: this.baseURL,
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                    'Square-Version': this.squareVersion
                }
            });
        }
        // Use default client
        if (!this.defaultClient) {
            throw new Error('Square access token is required');
        }
        return this.defaultClient;
    }
    async pullMenu(locationId, accessToken) {
        if (!locationId) {
            throw new Error('Square location ID is required to sync menu');
        }
        const client = this.getClient(accessToken);
        const catalog = await client.get('/catalog/list', {
            params: {
                types: 'ITEM'
            }
        });
        const items = catalog.data.objects ?? [];
        return items.map((item) => ({
            externalId: item.id,
            name: item.item_data?.name ?? 'Untitled Item',
            description: item.item_data?.description ?? undefined,
            category: item.item_data?.category_id ?? undefined,
            price: (item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount ?? 0) /
                100,
            isAvailable: item.item_data?.available_online ?? true
        }));
    }
    async pushOrder({ restaurantExternalId, orderId, items, total, customerPhone, customerName, orderType, deliveryAddress, accessToken }) {
        const client = this.getClient(accessToken);
        // Build line items with proper catalog object IDs or custom pricing
        const lineItems = items.map((item) => {
            // If we have a catalog object ID, use it
            if (item.externalItemId) {
                return {
                    catalog_object_id: item.externalItemId,
                    catalog_object_version: undefined, // Will use latest
                    quantity: item.quantity.toString(),
                    modifiers: item.modifiers?.map((mod) => ({
                        catalog_object_id: mod.externalId || mod.id,
                        catalog_object_version: undefined
                    })) || []
                };
            }
            // Otherwise, use custom pricing
            return {
                name: item.name,
                quantity: item.quantity.toString(),
                base_price_money: {
                    amount: Math.round(item.unitPrice * 100),
                    currency: 'USD'
                },
                modifiers: item.modifiers?.map((mod) => ({
                    name: mod.name,
                    base_price_money: {
                        amount: Math.round(mod.priceDelta * 100),
                        currency: 'USD'
                    }
                })) || []
            };
        });
        // Determine fulfillment type based on order type
        const fulfillments = [];
        if (orderType === 'delivery' && deliveryAddress) {
            fulfillments.push({
                type: 'SHIPMENT',
                shipment_details: {
                    recipient: customerName ? { display_name: customerName } : undefined,
                    shipping_note: customerPhone ? `Caller: ${customerPhone}` : undefined,
                    address: {
                        address_line_1: deliveryAddress.split(',')[0] || deliveryAddress,
                        locality: deliveryAddress.split(',')[1]?.trim() || '',
                        administrative_district_level_1: deliveryAddress.split(',')[2]?.trim() || '',
                        postal_code: deliveryAddress.split(',')[3]?.trim() || ''
                    }
                }
            });
        }
        else {
            // Default to pickup
            fulfillments.push({
                type: 'PICKUP',
                pickup_details: {
                    recipient: customerName ? { display_name: customerName } : undefined,
                    customer_note: customerPhone ? `Caller: ${customerPhone}` : undefined,
                    scheduled_type: 'ASAP'
                }
            });
        }
        const response = await client.post('/orders', {
            idempotency_key: orderId,
            order: {
                location_id: restaurantExternalId,
                reference_id: orderId.slice(0, 40), // Square limits to 40 chars
                line_items: lineItems,
                fulfillments: fulfillments,
                state: 'DRAFT' // Will be finalized when paid
            }
        });
        return { externalOrderId: response.data.order?.id ?? orderId };
    }
}
