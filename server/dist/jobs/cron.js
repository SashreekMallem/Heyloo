import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { syncMenuFromPos } from '../services/pos-service.js';
/**
 * Menu Sync Cron Job
 * Runs every 4 hours to sync menus from POS systems
 */
export function startMenuSyncCron() {
    // Run every 4 hours: 0 */4 * * *
    cron.schedule('0 */4 * * *', async () => {
        logger.info('Starting scheduled menu sync job');
        try {
            // Get all active restaurants with POS integration
            const { data: restaurants, error } = await supabase
                .from('restaurants')
                .select('id,name,pos_type,subscription_status')
                .in('pos_type', ['square', 'toast', 'clover'])
                .eq('subscription_status', 'active');
            if (error) {
                logger.error({ error }, 'Failed to fetch restaurants for menu sync');
                return;
            }
            if (!restaurants || restaurants.length === 0) {
                logger.info('No restaurants with POS integration found for sync');
                return;
            }
            logger.info({ count: restaurants.length }, 'Syncing menus for restaurants');
            let successCount = 0;
            let failCount = 0;
            // Sync each restaurant
            for (const restaurant of restaurants) {
                try {
                    const result = await syncMenuFromPos(restaurant.id);
                    if (result.count > 0) {
                        logger.info({
                            restaurantId: restaurant.id,
                            restaurantName: restaurant.name,
                            itemsSynced: result.count,
                            provider: result.provider
                        }, 'Menu sync successful');
                        successCount++;
                    }
                    else {
                        logger.warn({
                            restaurantId: restaurant.id,
                            restaurantName: restaurant.name
                        }, 'Menu sync returned 0 items');
                    }
                }
                catch (err) {
                    logger.error({
                        err,
                        restaurantId: restaurant.id,
                        restaurantName: restaurant.name
                    }, 'Menu sync failed for restaurant');
                    failCount++;
                }
                // Add small delay between syncs to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            logger.info({
                total: restaurants.length,
                successful: successCount,
                failed: failCount
            }, 'Menu sync cron job completed');
        }
        catch (err) {
            logger.error({ err }, 'Menu sync cron job encountered error');
        }
    });
    logger.info('Menu sync cron job scheduled (every 4 hours)');
}
/**
 * Daily Usage Aggregation Cron Job
 * Runs at midnight to aggregate platform usage data
 */
export function startDailyAggregationCron() {
    // Run at midnight every day: 0 0 * * *
    cron.schedule('0 0 * * *', async () => {
        logger.info('Starting daily usage aggregation job');
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const dateStr = yesterday.toISOString().slice(0, 10);
            // Aggregate call data for yesterday
            const { error: callAggError } = await supabase.rpc('aggregate_daily_calls', {
                target_date: dateStr
            });
            if (callAggError) {
                logger.error({ error: callAggError }, 'Failed to aggregate daily calls');
            }
            else {
                logger.info({ date: dateStr }, 'Daily call aggregation successful');
            }
            // Aggregate order data for yesterday
            const { error: orderAggError } = await supabase.rpc('aggregate_daily_orders', {
                target_date: dateStr
            });
            if (orderAggError) {
                logger.error({ error: orderAggError }, 'Failed to aggregate daily orders');
            }
            else {
                logger.info({ date: dateStr }, 'Daily order aggregation successful');
            }
            logger.info({ date: dateStr }, 'Daily aggregation cron job completed');
        }
        catch (err) {
            logger.error({ err }, 'Daily aggregation cron job encountered error');
        }
    });
    logger.info('Daily aggregation cron job scheduled (midnight daily)');
}
/**
 * Monthly Billing Cron Job
 * Runs on the 1st of each month to generate invoices
 */
export function startMonthlyBillingCron() {
    // Run at 2am on the 1st of each month: 0 2 1 * *
    cron.schedule('0 2 1 * *', async () => {
        logger.info('Starting monthly billing job');
        try {
            const lastMonth = new Date();
            lastMonth.setMonth(lastMonth.getMonth() - 1);
            const year = lastMonth.getFullYear();
            const month = lastMonth.getMonth() + 1;
            // Get all active restaurants
            const { data: restaurants, error } = await supabase
                .from('restaurants')
                .select('id,name,owner_email,subscription_status')
                .eq('subscription_status', 'active');
            if (error) {
                logger.error({ error }, 'Failed to fetch restaurants for billing');
                return;
            }
            if (!restaurants || restaurants.length === 0) {
                logger.info('No active restaurants found for billing');
                return;
            }
            logger.info({
                count: restaurants.length,
                billingPeriod: `${year}-${month.toString().padStart(2, '0')}`
            }, 'Generating invoices for restaurants');
            for (const restaurant of restaurants) {
                try {
                    // Get usage data for the month
                    const { data: usageData } = await supabase
                        .from('platform_usage_daily')
                        .select('total_minutes,vapi_call_cost')
                        .eq('restaurant_id', restaurant.id)
                        .gte('date', `${year}-${month.toString().padStart(2, '0')}-01`)
                        .lt('date', `${year}-${(month + 1).toString().padStart(2, '0')}-01`);
                    if (!usageData)
                        continue;
                    const totalMinutes = usageData.reduce((sum, d) => sum + Number(d.total_minutes), 0);
                    const totalCost = usageData.reduce((sum, d) => sum + Number(d.vapi_call_cost), 0);
                    // Base subscription fee: $99/month, includes 500 minutes
                    const baseFee = 9900; // cents
                    const includedMinutes = 500;
                    const overageMinutes = Math.max(0, totalMinutes - includedMinutes);
                    const overageRate = 10; // 10 cents per minute
                    const overageCost = Math.round(overageMinutes * overageRate);
                    const totalAmount = baseFee + overageCost;
                    // Create invoice
                    const { error: invoiceError } = await supabase
                        .from('subscription_invoices')
                        .insert({
                        restaurant_id: restaurant.id,
                        billing_period_start: `${year}-${month.toString().padStart(2, '0')}-01`,
                        billing_period_end: `${year}-${(month + 1).toString().padStart(2, '0')}-01`,
                        base_fee_cents: baseFee,
                        included_minutes: includedMinutes,
                        overage_minutes: Math.round(overageMinutes),
                        overage_rate_cents: overageRate,
                        total_amount_cents: totalAmount,
                        status: 'pending'
                    });
                    if (invoiceError) {
                        logger.error({
                            error: invoiceError,
                            restaurantId: restaurant.id
                        }, 'Failed to create invoice');
                    }
                    else {
                        logger.info({
                            restaurantId: restaurant.id,
                            restaurantName: restaurant.name,
                            totalMinutes: Math.round(totalMinutes),
                            overageMinutes: Math.round(overageMinutes),
                            totalAmount: totalAmount / 100
                        }, 'Invoice created');
                    }
                }
                catch (err) {
                    logger.error({
                        err,
                        restaurantId: restaurant.id
                    }, 'Failed to process billing for restaurant');
                }
            }
            logger.info('Monthly billing cron job completed');
        }
        catch (err) {
            logger.error({ err }, 'Monthly billing cron job encountered error');
        }
    });
    logger.info('Monthly billing cron job scheduled (1st of month at 2am)');
}
/**
 * Start all cron jobs
 */
export function startAllCronJobs() {
    startMenuSyncCron();
    startDailyAggregationCron();
    startMonthlyBillingCron();
    logger.info('All cron jobs started successfully');
}
