import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { resolveDateRange } from '../utils/date-range.js';
export async function assertRestaurantAccess(restaurantId, actorRestaurantId) {
    // Validate restaurantId is a valid UUID
    if (!restaurantId || restaurantId.trim() === '' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
        throw Object.assign(new Error('Invalid restaurant ID'), {
            status: 400,
            code: 'INVALID_RESTAURANT_ID'
        });
    }
    // Platform admins (actorRestaurantId === null) have access to all restaurants
    if (!actorRestaurantId || actorRestaurantId === null) {
        return;
    }
    // Restaurant admins can only access their own restaurant
    if (actorRestaurantId !== restaurantId) {
        throw Object.assign(new Error('Forbidden'), {
            status: 403,
            code: 'FORBIDDEN'
        });
    }
}
export async function getRestaurantOverview(restaurantId, range) {
    // Validate restaurantId
    if (!restaurantId || restaurantId.trim() === '' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
        throw Object.assign(new Error('Invalid restaurant ID'), {
            status: 400,
            code: 'INVALID_RESTAURANT_ID'
        });
    }
    const { start, end } = resolveDateRange(range);
    const { data, error } = await supabase
        .from('platform_usage_daily')
        .select('total_calls,total_minutes,total_orders,total_order_value,delivery_orders,pickup_orders')
        .eq('restaurant_id', restaurantId)
        .gte('date', start.toISOString().slice(0, 10))
        .lt('date', end.toISOString().slice(0, 10));
    if (error) {
        logger.error({ error, restaurantId, query: 'platform_usage_daily', range }, 'Failed to query platform usage');
        throw Object.assign(new Error('Failed to load restaurant overview metrics'), {
            status: 500,
            code: 'QUERY_ERROR',
            details: error
        });
    }
    const totals = (data ?? []).reduce((acc, row) => {
        acc.calls += row.total_calls;
        acc.minutes += row.total_minutes;
        acc.orders += row.total_orders;
        acc.revenue += row.total_order_value;
        acc.deliveryOrders += row.delivery_orders;
        acc.pickupOrders += row.pickup_orders;
        return acc;
    }, {
        calls: 0,
        minutes: 0,
        orders: 0,
        revenue: 0,
        deliveryOrders: 0,
        pickupOrders: 0
    });
    return totals;
}
export async function listRestaurantOrders(restaurantId, limit = 50) {
    // Validate restaurantId
    if (!restaurantId || restaurantId.trim() === '' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
        throw Object.assign(new Error('Invalid restaurant ID'), {
            status: 400,
            code: 'INVALID_RESTAURANT_ID'
        });
    }
    const { data, error } = await supabase
        .from('orders')
        .select('id,status,payment_status,total,subtotal,tax,delivery_fee,payment_method,placed_at,customer_name,customer_phone,order_type')
        .eq('restaurant_id', restaurantId)
        .order('placed_at', { ascending: false })
        .limit(limit);
    if (error) {
        logger.error({ error, restaurantId, query: 'orders' }, 'Failed to query orders');
        throw Object.assign(new Error('Failed to load orders'), {
            status: 500,
            code: 'QUERY_ERROR',
            details: error
        });
    }
    return data ?? [];
}
export async function listRecentCalls(restaurantId, limit = 20) {
    // Validate restaurantId
    if (!restaurantId || restaurantId.trim() === '' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
        throw Object.assign(new Error('Invalid restaurant ID'), {
            status: 400,
            code: 'INVALID_RESTAURANT_ID'
        });
    }
    const { data, error } = await supabase
        .from('call_logs')
        .select('id,call_id,duration_seconds,outcome,created_at,customer_phone')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        logger.error({ error, restaurantId, query: 'call_logs' }, 'Failed to query call logs');
        throw Object.assign(new Error('Failed to load call logs'), {
            status: 500,
            code: 'QUERY_ERROR',
            details: error
        });
    }
    return data ?? [];
}
export async function listMenuItems(restaurantId, locationId) {
    // For multi-location support:
    // - Items with location_id = NULL are available at all locations
    // - Items with location_id = specific_id are only at that location
    // - If locationId provided, show: location_id = locationId OR location_id = NULL
    const { error: tenantError } = await supabase.rpc('set_tenant_id', {
        p_tenant_id: restaurantId
    });
    if (tenantError) {
        logger.error({ tenantError, restaurantId }, '[Menu] Failed to set tenant context');
        throw Object.assign(new Error('Failed to load menu items'), {
            status: 500,
            code: 'TENANT_CONTEXT_FAILED',
            details: tenantError
        });
    }
    try {
        let query = supabase
            .from('menu_items')
            .select('id,name,description,price,category,is_available')
            .eq('restaurant_id', restaurantId)
            .eq('is_available', true);
        if (locationId) {
            // Filter: items for this location OR items available at all locations (NULL)
            query = query.or(`location_id.eq.${locationId},location_id.is.null`);
        }
        query = query.order('category', { ascending: true })
            .order('name', { ascending: true });
        const { data, error } = await query;
        if (error) {
            throw Object.assign(new Error('Failed to load menu items'), {
                status: 500,
                details: error
            });
        }
        return data ?? [];
    }
    finally {
        const { error: clearError } = await supabase.rpc('clear_tenant_id');
        if (clearError) {
            logger.warn({ clearError, restaurantId }, '[Menu] Failed to clear tenant context');
        }
    }
}
export async function listRestaurantCustomers(restaurantId) {
    const { data, error } = await supabase
        .from('customers')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('total_spent', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) {
        throw Object.assign(new Error('Failed to load customers'), {
            status: 500,
            details: error
        });
    }
    return data ?? [];
}
export async function listCustomerAddresses(restaurantId, customerId) {
    const { data, error } = await supabase
        .from('customer_addresses')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('customer_id', customerId)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) {
        throw Object.assign(new Error('Failed to load customer addresses'), {
            status: 500,
            details: error
        });
    }
    return data ?? [];
}
