import { supabase } from '../lib/supabase.js';
import { resolveDateRange } from '../utils/date-range.js';
export async function getPlatformOverview(range) {
    const { start, end } = resolveDateRange(range);
    const [usageResult, restaurantsResult] = await Promise.all([
        supabase
            .from('platform_usage_daily')
            .select('restaurant_id,total_calls,total_minutes,total_orders,total_order_value,vapi_call_cost')
            .gte('date', start.toISOString().slice(0, 10))
            .lt('date', end.toISOString().slice(0, 10)),
        supabase.from('restaurants').select('id,subscription_status')
    ]);
    if (usageResult.error) {
        throw Object.assign(new Error('Failed to load platform usage metrics'), {
            status: 500,
            details: usageResult.error
        });
    }
    if (restaurantsResult.error) {
        throw Object.assign(new Error('Failed to load restaurants'), {
            status: 500,
            details: restaurantsResult.error
        });
    }
    const usageRows = (usageResult.data ?? []);
    const restaurantRows = (restaurantsResult.data ?? []);
    const totals = usageRows.reduce((acc, row) => {
        acc.totalCalls += row.total_calls;
        acc.totalMinutes += row.total_minutes;
        acc.totalOrders += row.total_orders;
        acc.totalRevenue += row.total_order_value;
        acc.vapiCosts += row.vapi_call_cost;
        return acc;
    }, {
        totalCalls: 0,
        totalMinutes: 0,
        totalOrders: 0,
        totalRevenue: 0,
        vapiCosts: 0
    });
    const totalRestaurants = restaurantRows.length;
    const activeRestaurants = restaurantRows.filter((r) => r.subscription_status === 'active').length;
    return {
        activeRestaurants,
        totalRestaurants,
        totalCalls: totals.totalCalls,
        totalCallMinutes: totals.totalMinutes,
        totalOrders: totals.totalOrders,
        totalRevenue: totals.totalRevenue,
        vapiCosts: totals.vapiCosts,
        netProfit: totals.totalRevenue - totals.vapiCosts
    };
}
export async function listRestaurantSummaries(range) {
    const { start, end } = resolveDateRange(range);
    // First get all restaurants
    const { data: restaurants, error: restaurantsError } = await supabase
        .from('restaurants')
        .select('id,name,subscription_status');
    if (restaurantsError) {
        throw Object.assign(new Error('Failed to fetch restaurants'), {
            status: 500,
            details: restaurantsError
        });
    }
    // Get usage data from view (might be empty if no activity)
    const { data: usageData } = await supabase
        .from('restaurant_usage_summary')
        .select('restaurant_id,restaurant_name,subscription_status,total_calls,total_minutes,total_orders,total_order_value')
        .gte('date', start.toISOString().slice(0, 10))
        .lt('date', end.toISOString().slice(0, 10));
    // Aggregate usage by restaurant
    const usageMap = new Map();
    for (const row of (usageData ?? [])) {
        const existing = usageMap.get(row.restaurant_id);
        if (existing) {
            existing.calls += row.total_calls;
            existing.minutes += row.total_minutes;
            existing.orders += row.total_orders;
            existing.revenue += row.total_order_value;
        }
        else {
            usageMap.set(row.restaurant_id, {
                restaurantName: row.restaurant_name,
                status: row.subscription_status,
                calls: row.total_calls,
                minutes: row.total_minutes,
                orders: row.total_orders,
                revenue: row.total_order_value
            });
        }
    }
    // Combine restaurants with usage data (default to zeros if no usage)
    return (restaurants ?? []).map((restaurant) => {
        const usage = usageMap.get(restaurant.id);
        return {
            restaurantId: restaurant.id,
            restaurantName: restaurant.name,
            status: (usage?.status ?? restaurant.subscription_status),
            calls: usage?.calls ?? 0,
            callMinutes: usage?.minutes ?? 0,
            orders: usage?.orders ?? 0,
            revenue: usage?.revenue ?? 0
        };
    });
}
export async function getUsageTimeline(range) {
    const { start, end } = resolveDateRange(range);
    const { data, error } = await supabase
        .from('platform_usage_daily')
        .select('date,total_calls,total_minutes,total_orders,total_order_value')
        .gte('date', start.toISOString().slice(0, 10))
        .lt('date', end.toISOString().slice(0, 10));
    if (error) {
        throw Object.assign(new Error('Failed to fetch usage timeline'), {
            status: 500,
            details: error
        });
    }
    const timeline = new Map();
    for (const row of (data ?? [])) {
        const existing = timeline.get(row.date);
        if (existing) {
            existing.totalCalls += row.total_calls;
            existing.totalMinutes += row.total_minutes;
            existing.totalOrders += row.total_orders;
            existing.revenue += row.total_order_value;
        }
        else {
            timeline.set(row.date, {
                totalCalls: row.total_calls,
                totalMinutes: row.total_minutes,
                totalOrders: row.total_orders,
                revenue: row.total_order_value
            });
        }
    }
    return Array.from(timeline.entries())
        .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
        .map(([date, value]) => ({
        date,
        ...value
    }));
}
export async function getCallCenterMetrics(range) {
    const { start, end } = resolveDateRange(range);
    const { data, error } = await supabase
        .from('call_logs')
        .select('duration_seconds,status,created_at')
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());
    if (error) {
        throw Object.assign(new Error('Failed to fetch call metrics'), {
            status: 500,
            details: error
        });
    }
    const calls = data ?? [];
    const totalCalls = calls.length;
    const completed = calls.filter((call) => call.status === 'completed');
    const failed = calls.filter((call) => call.status === 'failed');
    const totalDuration = completed.reduce((sum, call) => sum + (call.duration_seconds ?? 0), 0);
    return {
        totalCalls,
        averageHandleTime: totalCalls ? Math.round((totalDuration / totalCalls) * 10) / 10 : 0,
        firstCallResolution: totalCalls ? Math.round((completed.length / totalCalls) * 1000) / 10 : 0,
        callAbandonmentRate: totalCalls ? Math.round((failed.length / totalCalls) * 1000) / 10 : 0,
        repeatCallRate: 0, // requires advanced session tracking
        serviceLevel: 100 // voice AI answers instantly
    };
}
