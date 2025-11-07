import { Router } from 'express';
import { z } from 'zod';
import { onboardRestaurant, handlePosOAuthCallback, updateRestaurantPosConfig } from '../../services/onboarding-service.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { env } from '../../config/env.js';
export const onboardingRouter = Router();
const onboardingSchema = z.object({
    restaurantName: z.string().min(2).max(100),
    restaurantSlug: z.string().optional(),
    ownerEmail: z.string().email(),
    phoneNumber: z.string().optional(),
    taxRate: z.number().min(0).max(1).optional(),
    deliveryFee: z.number().min(0).optional(),
    adminPassword: z.string().min(8),
    posType: z.enum(['square', 'toast', 'clover', 'none']).optional(),
    posAccessToken: z.string().optional(),
    posRefreshToken: z.string().optional(),
    posLocationId: z.string().optional(),
    posMerchantId: z.string().optional(),
    stripeAccountId: z.string().optional()
});
/**
 * POST /onboard
 * Complete restaurant onboarding
 */
onboardingRouter.post('/onboard', async (req, res) => {
    try {
        const payload = onboardingSchema.parse(req.body);
        const result = await onboardRestaurant(payload);
        res.status(201).json({
            success: true,
            restaurant: result.restaurant,
            admin: result.admin,
            auth: result.auth,
            configuration: {
                posConfigured: result.posConfigured,
                stripeConfigured: result.stripeConfigured,
                vapiPhoneProvisioned: result.vapiPhoneProvisioned
            }
        });
    }
    catch (err) {
        logger.error({ err, body: req.body }, 'Onboarding failed');
        if (err.code === 'SLUG_EXISTS' || err.code === 'EMAIL_EXISTS') {
            return res.status(400).json({
                success: false,
                message: err.message,
                code: err.code
            });
        }
        res.status(err.status ?? 500).json({
            success: false,
            message: err.message || 'Onboarding failed',
            code: err.code
        });
    }
});
/**
 * GET /pos/square/auth
 * Initiates Square OAuth flow
 */
onboardingRouter.get('/pos/square/auth', async (req, res, next) => {
    try {
        const { restaurantId } = req.query;
        if (!restaurantId || typeof restaurantId !== 'string') {
            return res.status(400).json({ error: 'restaurantId required' });
        }
        if (!env.SQUARE_CLIENT_ID) {
            logger.error('Square OAuth: SQUARE_CLIENT_ID not configured');
            return res.status(500).json({ error: 'Square client ID not configured' });
        }
        const apiUrl = env.API_URL ?? process.env.API_URL;
        if (!apiUrl) {
            logger.error('Square OAuth: API_URL not configured');
            return res.status(500).json({ error: 'API_URL not configured. Please set API_URL in .env to your ngrok URL.' });
        }
        // Generate state for CSRF protection
        const state = Buffer.from(JSON.stringify({ restaurantId, timestamp: Date.now() })).toString('base64');
        // Build Square OAuth authorization URL
        // According to Square docs: https://developer.squareup.com/docs/oauth-api/what-it-does
        // - redirect_uri must match exactly what's registered in Square Developer Dashboard
        // - Must use HTTPS unless testing with Sandbox on localhost
        // Request all necessary permissions for full POS integration:
        // - Menu/Inventory: ITEMS_READ, ITEMS_WRITE, INVENTORY_READ, INVENTORY_WRITE
        // - Orders: ORDERS_READ, ORDERS_WRITE
        // - Customers: CUSTOMERS_READ, CUSTOMERS_WRITE
        // - Payments: PAYMENTS_READ, PAYMENTS_WRITE (for order payment tracking)
        // - Merchant: MERCHANT_PROFILE_READ (for location/merchant info)
        const redirectUri = `${apiUrl}/v1/onboarding/pos/square/callback`;
        // Build Square OAuth authorization URL per Square documentation
        // According to Square docs: https://developer.squareup.com/docs/oauth-api/what-it-does
        // The authorize endpoint requires: client_id, scope, redirect_uri, state
        // No 'session' parameter in the official docs - removed
        const squareBaseUrl = env.SQUARE_ENVIRONMENT === 'production' || env.NODE_ENV === 'production'
            ? 'https://connect.squareup.com'
            : 'https://connect.squareupsandbox.com';
        const squareAuthUrl = new URL('/oauth2/authorize', squareBaseUrl);
        squareAuthUrl.searchParams.set('client_id', env.SQUARE_CLIENT_ID);
        squareAuthUrl.searchParams.set('scope', 'MERCHANT_PROFILE_READ ITEMS_READ ITEMS_WRITE INVENTORY_READ INVENTORY_WRITE ORDERS_READ ORDERS_WRITE CUSTOMERS_READ CUSTOMERS_WRITE PAYMENTS_READ PAYMENTS_WRITE');
        squareAuthUrl.searchParams.set('redirect_uri', redirectUri);
        squareAuthUrl.searchParams.set('state', state);
        res.json({ authUrl: squareAuthUrl.toString() });
    }
    catch (err) {
        logger.error({ err: err.message, stack: err.stack }, 'Square OAuth initiation failed');
        next(err);
    }
});
/**
 * GET /pos/toast/auth
 * Initiates Toast OAuth flow
 */
onboardingRouter.get('/pos/toast/auth', (req, res) => {
    const { restaurantId } = req.query;
    if (!restaurantId || typeof restaurantId !== 'string') {
        return res.status(400).json({ error: 'restaurantId required' });
    }
    const state = Buffer.from(JSON.stringify({ restaurantId, timestamp: Date.now() })).toString('base64');
    const apiUrl = env.API_URL ?? process.env.API_URL;
    if (!apiUrl) {
        logger.error('Toast OAuth: API_URL not configured');
        return res.status(500).json({ error: 'API_URL not configured' });
    }
    const toastAuthUrl = new URL('https://oauth.toasttab.com/oauth2/authorize');
    toastAuthUrl.searchParams.set('client_id', env.TOAST_CLIENT_ID ?? '');
    toastAuthUrl.searchParams.set('response_type', 'code');
    toastAuthUrl.searchParams.set('redirect_uri', `${apiUrl}/v1/onboarding/pos/toast/callback`);
    toastAuthUrl.searchParams.set('scope', 'menus:read orders:write');
    toastAuthUrl.searchParams.set('state', state);
    res.json({ authUrl: toastAuthUrl.toString() });
});
/**
 * GET /pos/clover/auth
 * Initiates Clover OAuth flow
 */
onboardingRouter.get('/pos/clover/auth', (req, res) => {
    const { restaurantId } = req.query;
    if (!restaurantId || typeof restaurantId !== 'string') {
        return res.status(400).json({ error: 'restaurantId required' });
    }
    if (!env.CLOVER_APP_ID) {
        return res.status(500).json({ error: 'Clover App ID not configured' });
    }
    const apiUrl = env.API_URL ?? process.env.API_URL;
    if (!apiUrl) {
        return res.status(500).json({ error: 'API_URL not configured' });
    }
    // Generate state for CSRF protection
    const state = Buffer.from(JSON.stringify({ restaurantId, timestamp: Date.now() })).toString('base64');
    // Build Clover OAuth authorization URL
    // Clover OAuth v2 endpoints (recommended):
    // - Production: https://www.clover.com/oauth/v2/authorize
    // - Sandbox: https://apisandbox.dev.clover.com/oauth/v2/authorize
    // NOTE: If app is in sandbox, use sandbox endpoints. Check Clover Dashboard to confirm.
    // IMPORTANT: The redirect_uri MUST be registered in Clover Developer Dashboard as a subpath of your Site URL
    // The redirect_uri parameter value must match EXACTLY what's registered (including https/http, domain, path)
    const redirectUri = `${apiUrl}/v1/onboarding/pos/clover/callback`;
    // Determine if we should use sandbox or production
    // You can set CLOVER_ENVIRONMENT=sandbox in .env to force sandbox, otherwise defaults to production
    const useSandbox = process.env.CLOVER_ENVIRONMENT === 'sandbox' || env.NODE_ENV !== 'production';
    const cloverAuthBase = useSandbox
        ? 'https://apisandbox.dev.clover.com'
        : 'https://www.clover.com';
    logger.info({
        redirectUri,
        apiUrl,
        appId: env.CLOVER_APP_ID?.substring(0, 8) + '...',
        environment: useSandbox ? 'sandbox' : 'production',
        authBase: cloverAuthBase
    }, '[Clover OAuth] Building authorization URL');
    // Use OAuth v2 endpoint (recommended over legacy /oauth/authorize)
    const cloverAuthUrl = new URL(`${cloverAuthBase}/oauth/v2/authorize`);
    cloverAuthUrl.searchParams.set('client_id', env.CLOVER_APP_ID);
    cloverAuthUrl.searchParams.set('redirect_uri', redirectUri);
    cloverAuthUrl.searchParams.set('state', state);
    // Request all necessary permissions for full POS integration:
    // - Inventory: Read/Write for menu sync
    // - Orders: Read/Write for order management
    // - Customers: Read/Write for customer management
    // - Payments: Read/Write for payment tracking
    // - Merchant: Read for merchant information
    // Note: These must also be enabled in Clover Developer Dashboard app settings
    res.json({ authUrl: cloverAuthUrl.toString() });
});
/**
 * GET /pos/:provider/callback
 * Handles OAuth callback from POS providers
 */
onboardingRouter.get('/pos/:provider/callback', async (req, res) => {
    const { provider } = req.params;
    logger.info({
        provider,
        query: req.query,
        hasCode: !!req.query.code,
        hasState: !!req.query.state
    }, '[OAuth Callback] Received callback');
    // Clover includes merchant_id in callback, others use state
    const { code, state, merchant_id, client_id } = req.query;
    // Handle Clover verification request (before OAuth flow)
    if (provider === 'clover' && !code && !state) {
        logger.info('[OAuth Callback] Clover verification request');
        // Clover may send verification request to verify the Site URL
        // Just return 200 to confirm the endpoint is reachable
        return res.status(200).send('OK');
    }
    if (!code || typeof code !== 'string') {
        logger.error({ query: req.query }, '[OAuth Callback] Missing authorization code');
        return res.status(400).send('Missing authorization code');
    }
    try {
        let restaurantId;
        if (provider === 'clover') {
            // Clover callback format: ?code=XXX&merchant_id=YYY&client_id=ZZZ
            // We need to extract restaurantId from state parameter
            if (state && typeof state === 'string') {
                const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
                restaurantId = stateData.restaurantId;
            }
            else {
                // If no state, we'll need to look up restaurant by merchant_id after OAuth
                // For now, return error - state should always be present
                return res.status(400).send('Missing state parameter for Clover OAuth');
            }
        }
        else {
            // Square and Toast use state parameter
            if (!state || typeof state !== 'string') {
                return res.status(400).send('Missing state parameter');
            }
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
            restaurantId = stateData.restaurantId;
        }
        if (provider !== 'square' && provider !== 'toast' && provider !== 'clover') {
            return res.status(400).send('Invalid POS provider');
        }
        logger.info({ restaurantId, provider }, '[OAuth Callback] Exchanging code for tokens');
        // Exchange code for tokens
        const tokens = await handlePosOAuthCallback(restaurantId, provider, code, state);
        logger.info({
            restaurantId,
            provider,
            hasAccessToken: !!tokens.accessToken,
            hasRefreshToken: !!tokens.refreshToken,
            hasLocations: !!(tokens.locations && tokens.locations.length > 0),
            hasMerchants: !!(tokens.merchants && tokens.merchants.length > 0),
            locationCount: tokens.locations?.length || 0,
            merchantCount: tokens.merchants?.length || 0
        }, '[OAuth Callback] Token exchange successful');
        // Store tokens temporarily in database for location/merchant selection
        // Use service role key to bypass RLS during OAuth callback (no tenant context yet)
        const { supabase: serviceSupabase } = await import('../../lib/supabase.js');
        logger.info({ restaurantId, provider }, '[OAuth Callback] Storing OAuth session in database');
        const { data: session, error: sessionError } = await serviceSupabase
            .from('pos_oauth_sessions')
            .insert({
            restaurant_id: restaurantId,
            pos_type: provider,
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken || null,
            merchant_id: tokens.merchantId || null,
            locations: tokens.locations && tokens.locations.length > 0 ? tokens.locations : null,
            merchants: tokens.merchants && tokens.merchants.length > 0 ? tokens.merchants : null,
            expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes
        })
            .select('id')
            .single();
        if (sessionError || !session) {
            logger.error({
                error: sessionError,
                errorCode: sessionError?.code,
                errorMessage: sessionError?.message,
                errorDetails: sessionError?.details,
                hasTokens: !!tokens.accessToken,
                tokenLength: tokens.accessToken?.length,
                restaurantId,
                provider
            }, '[OAuth Callback] Failed to store OAuth session');
            throw new Error(`Failed to store OAuth session: ${sessionError?.message || 'Unknown error'}`);
        }
        logger.info({
            sessionId: session.id,
            restaurantId,
            provider,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        }, '[OAuth Callback] Session stored successfully');
        // Redirect to frontend location selection page
        const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173';
        const hasLocations = (tokens.locations && tokens.locations.length > 0) || (tokens.merchants && tokens.merchants.length > 0);
        logger.info({
            frontendUrl,
            hasLocations,
            locationCount: tokens.locations?.length || 0,
            merchantCount: tokens.merchants?.length || 0,
            sessionId: session.id,
            provider
        }, '[OAuth Callback] Preparing redirect');
        if (hasLocations) {
            const locationCount = tokens.locations?.length || tokens.merchants?.length || 0;
            // If only 1 location, auto-connect it - no selection needed
            if (locationCount === 1) {
                logger.info({
                    restaurantId,
                    provider,
                    sessionId: session.id,
                    autoConnecting: true
                }, '[OAuth Callback] Single location detected, auto-connecting');
                const { connectMultipleLocations } = await import('../../services/onboarding-service.js');
                // Auto-connect the single location
                const selectedId = tokens.locations?.[0]?.id || tokens.merchants?.[0]?.id;
                if (selectedId) {
                    await connectMultipleLocations(restaurantId, provider, {
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        locations: tokens.locations,
                        merchants: tokens.merchants,
                        merchantId: tokens.merchantId
                    }, [selectedId]);
                    // Clean up temp session
                    await serviceSupabase.from('pos_oauth_sessions').delete().eq('id', session.id);
                    logger.info({ restaurantId, provider, selectedId }, '[OAuth Callback] Auto-connected single location');
                    // Redirect to success
                    const redirectUrl = `${frontendUrl}/restaurant/settings?pos_connected=${provider}`;
                    res.redirect(redirectUrl);
                    return;
                }
            }
            // Multiple locations - show selection
            logger.info({
                redirectUrl: `${frontendUrl}/restaurant/settings?pos_auth=${provider}&session=${session.id}`,
                provider,
                sessionId: session.id,
                locationCount
            }, '[OAuth Callback] Multiple locations, showing selector');
            // Just redirect - frontend will handle popup detection and location selection
            const redirectUrl = `${frontendUrl}/restaurant/settings?pos_auth=${provider}&session=${session.id}`;
            res.redirect(redirectUrl);
            return;
        }
        else {
            // Toast or error case - auto-complete with single location
            const selectedLocationId = tokens.locationId || tokens.merchantId;
            await updateRestaurantPosConfig(restaurantId, provider, {
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                locationId: selectedLocationId,
                merchantId: tokens.merchantId
            });
            // Clean up session using service role
            await serviceSupabase.from('pos_oauth_sessions').delete().eq('id', session.id);
            const redirectUrl = `${frontendUrl}/restaurant/settings?pos_connected=${provider}`;
            // Send HTML page that will postMessage to parent if in popup
            res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Connected</title>
        </head>
        <body>
          <script>
            // If we're in a popup (opener exists), notify parent window
            if (window.opener) {
              window.opener.postMessage({
                type: 'pos_oauth_complete',
                provider: '${provider}',
                connected: true
              }, window.location.origin);
              window.close();
            } else {
              // Not in popup, redirect directly
              window.location.href = '${redirectUrl}';
            }
          </script>
          <p>Successfully connected ${provider}!</p>
        </body>
        </html>
      `);
            return;
        }
    }
    catch (err) {
        logger.error({ err, provider, query: req.query }, 'POS OAuth callback failed');
        const frontendUrl = env.FRONTEND_URL || 'http://localhost:5173';
        const redirectUrl = `${frontendUrl}/restaurant/settings?pos_error=${encodeURIComponent(err.message)}`;
        // Send HTML page that will postMessage to parent if in popup
        res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Connection Failed</title>
      </head>
      <body>
        <script>
          // If we're in a popup (opener exists), notify parent window
          if (window.opener) {
            window.opener.postMessage({
              type: 'pos_oauth_error',
              provider: '${provider}',
              error: ${JSON.stringify(err.message)}
            }, window.location.origin);
            setTimeout(() => window.close(), 2000);
          } else {
            // Not in popup, redirect directly
            window.location.href = '${redirectUrl}';
          }
        </script>
        <p>Connection failed: ${err.message}</p>
      </body>
      </html>
    `);
    }
});
/**
 * GET /pos/:provider/locations
 * Get available locations/merchants from OAuth session
 */
onboardingRouter.get('/pos/:provider/locations', async (req, res, next) => {
    try {
        const { provider } = req.params;
        const { session } = req.query;
        if (!session || typeof session !== 'string') {
            return res.status(400).json({ error: 'session parameter required' });
        }
        if (provider !== 'square' && provider !== 'clover') {
            return res.status(400).json({ error: 'Invalid provider for location selection' });
        }
        const { supabase } = await import('../../lib/supabase.js');
        // Get session from database
        const { data: oauthSession, error } = await supabase
            .from('pos_oauth_sessions')
            .select('*')
            .eq('id', session)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();
        if (error || !oauthSession) {
            logger.warn({ session, error }, 'OAuth session not found or expired');
            return res.status(404).json({ error: 'Session not found or expired' });
        }
        if (provider === 'square' && oauthSession.locations) {
            // Parse locations if stored as JSON string, otherwise return as-is
            const locations = typeof oauthSession.locations === 'string'
                ? JSON.parse(oauthSession.locations)
                : oauthSession.locations;
            return res.json({ locations });
        }
        else if (provider === 'clover' && oauthSession.merchants) {
            // Parse merchants if stored as JSON string, otherwise return as-is
            const merchants = typeof oauthSession.merchants === 'string'
                ? JSON.parse(oauthSession.merchants)
                : oauthSession.merchants;
            return res.json({ merchants });
        }
        return res.status(404).json({ error: 'No locations/merchants found for this session' });
    }
    catch (err) {
        logger.error({ err }, 'Failed to get locations');
        next(err);
    }
});
/**
 * POST /pos/:provider/finalize
 * Finalize POS connection with selected location(s)/merchant(s)
 * Supports connecting multiple locations at once
 */
onboardingRouter.post('/pos/:provider/finalize', async (req, res, next) => {
    try {
        const { provider } = req.params;
        const { session, locationIds = [], merchantIds = [] } = req.body;
        if (!session || typeof session !== 'string') {
            return res.status(400).json({ error: 'session parameter required' });
        }
        if (provider === 'square' && (!locationIds || locationIds.length === 0)) {
            return res.status(400).json({ error: 'locationIds array required for Square' });
        }
        if (provider === 'clover' && (!merchantIds || merchantIds.length === 0)) {
            return res.status(400).json({ error: 'merchantIds array required for Clover' });
        }
        const { supabase } = await import('../../lib/supabase.js');
        const { connectMultipleLocations } = await import('../../services/onboarding-service.js');
        // Get session from database
        const { data: oauthSession, error } = await supabase
            .from('pos_oauth_sessions')
            .select('*')
            .eq('id', session)
            .gt('expires_at', new Date().toISOString())
            .maybeSingle();
        if (error || !oauthSession) {
            logger.warn({ session, error }, 'OAuth session not found or expired');
            return res.status(404).json({ error: 'Session not found or expired' });
        }
        // Connect multiple locations
        const selectedIds = provider === 'square' ? locationIds : merchantIds;
        // Parse locations/merchants if stored as JSON strings
        const locations = oauthSession.locations
            ? (typeof oauthSession.locations === 'string' ? JSON.parse(oauthSession.locations) : oauthSession.locations)
            : [];
        const merchants = oauthSession.merchants
            ? (typeof oauthSession.merchants === 'string' ? JSON.parse(oauthSession.merchants) : oauthSession.merchants)
            : [];
        const connectedCount = await connectMultipleLocations(oauthSession.restaurant_id, provider, {
            accessToken: oauthSession.access_token,
            refreshToken: oauthSession.refresh_token || undefined,
            locations,
            merchants,
            merchantId: oauthSession.merchant_id
        }, selectedIds);
        // Clean up session
        await supabase.from('pos_oauth_sessions').delete().eq('id', session);
        res.json({
            success: true,
            message: `Successfully connected ${connectedCount} location(s)`,
            connectedCount
        });
    }
    catch (err) {
        logger.error({ err }, 'Failed to finalize POS connection');
        next(err);
    }
});
/**
 * DELETE /pos/disconnect
 * Disconnect POS integration for a restaurant
 * Deletes all connected POS locations for the restaurant
 */
onboardingRouter.delete('/pos/disconnect', requireAuth, async (req, res, next) => {
    try {
        const restaurantId = req.user?.restaurantId;
        logger.info({ restaurantId, userId: req.user?.sub }, '[POS Disconnect] Received disconnect request');
        if (!restaurantId) {
            logger.warn({ userId: req.user?.sub }, '[POS Disconnect] Missing restaurantId');
            return res.status(401).json({ error: 'Unauthorized', message: 'Missing restaurant ID' });
        }
        const { supabase } = await import('../../lib/supabase.js');
        // Check if there are any locations to delete
        const { data: existingLocations, error: checkError } = await supabase
            .from('restaurant_pos_locations')
            .select('id, pos_type, pos_location_id')
            .eq('restaurant_id', restaurantId);
        if (checkError) {
            logger.error({ error: checkError, restaurantId }, '[POS Disconnect] Failed to check existing locations');
            return res.status(500).json({ error: 'Failed to check POS connection status' });
        }
        logger.info({ restaurantId, locationCount: existingLocations?.length || 0 }, '[POS Disconnect] Found locations to delete');
        // Delete all POS locations for this restaurant
        const { error: deleteError, data: deletedData } = await supabase
            .from('restaurant_pos_locations')
            .delete()
            .eq('restaurant_id', restaurantId)
            .select();
        if (deleteError) {
            logger.error({ error: deleteError, restaurantId }, '[POS Disconnect] Failed to delete locations');
            return res.status(500).json({ error: 'Failed to disconnect POS', message: deleteError.message });
        }
        const deletedCount = deletedData?.length || 0;
        logger.info({ restaurantId, deletedCount }, '[POS Disconnect] Deleted locations');
        // Also clear pos_type and pos_location_id in restaurants table for backward compatibility
        const { error: updateError } = await supabase
            .from('restaurants')
            .update({
            pos_type: 'none',
            pos_location_id: null,
            updated_at: new Date().toISOString()
        })
            .eq('id', restaurantId);
        if (updateError) {
            logger.warn({ error: updateError, restaurantId }, '[POS Disconnect] Failed to update restaurants table');
        }
        else {
            logger.info({ restaurantId }, '[POS Disconnect] Updated restaurants table');
        }
        logger.info({ restaurantId }, '[POS Disconnect] POS disconnected successfully');
        res.json({ success: true, message: 'POS disconnected successfully', deletedCount });
    }
    catch (err) {
        logger.error({ err, restaurantId: req.user?.restaurantId }, '[POS Disconnect] Exception during disconnect');
        next(err);
    }
});
/**
 * GET /check-slug/:slug
 * Check if restaurant slug is available
 */
onboardingRouter.get('/check-slug/:slug', async (req, res) => {
    const { slug } = req.params;
    // Import supabase here to avoid circular dependencies
    const { supabase } = await import('../../lib/supabase.js');
    const { data } = await supabase
        .from('restaurants')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
    res.json({ available: !data });
});
/**
 * GET /check-email/:email
 * Check if email is available
 */
onboardingRouter.get('/check-email/:email', async (req, res) => {
    const { email } = req.params;
    const { supabase } = await import('../../lib/supabase.js');
    const { data } = await supabase
        .from('app_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();
    res.json({ available: !data });
});
