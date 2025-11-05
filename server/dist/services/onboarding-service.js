import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { supabase } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
const isSquareProduction = env.SQUARE_ENVIRONMENT === 'production' || env.NODE_ENV === 'production';
const squareBaseUrl = isSquareProduction
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
const squareOAuthBase = `${squareBaseUrl}/oauth2`;
const squareApiBase = `${squareBaseUrl}/v2`;
const squareVersion = '2025-01-23';
/**
 * Complete restaurant onboarding flow
 * Creates restaurant, admin user, sets up POS, Stripe, and VAPI phone
 */
export async function onboardRestaurant(payload) {
    // Generate slug if not provided
    const slug = payload.restaurantSlug ?? generateSlug(payload.restaurantName);
    // Check if slug or email already exists
    const { data: existingRestaurant } = await supabase
        .from('restaurants')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
    if (existingRestaurant) {
        throw Object.assign(new Error('Restaurant slug already exists'), {
            status: 400,
            code: 'SLUG_EXISTS'
        });
    }
    const { data: existingUser } = await supabase
        .from('app_users')
        .select('id')
        .eq('email', payload.ownerEmail)
        .maybeSingle();
    if (existingUser) {
        throw Object.assign(new Error('Email already exists'), {
            status: 400,
            code: 'EMAIL_EXISTS'
        });
    }
    // Step 1: Create restaurant
    const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
        name: payload.restaurantName,
        slug,
        phone_number: payload.phoneNumber ?? null,
        owner_email: payload.ownerEmail,
        subscription_status: 'trial',
        pos_type: payload.posType ?? 'none',
        pos_location_id: payload.posLocationId ?? null,
        tax_rate: payload.taxRate ?? 0.0825,
        delivery_fee: payload.deliveryFee ?? 5.0,
        stripe_account_id: payload.stripeAccountId ?? null,
        vapi_phone_number: null // Will be set if provisioned
    })
        .select('id,name,slug,phone_number')
        .single();
    if (restaurantError || !restaurant) {
        logger.error({ error: restaurantError }, 'Failed to create restaurant during onboarding');
        throw Object.assign(new Error('Failed to create restaurant'), {
            status: 500,
            details: restaurantError
        });
    }
    // Step 2: Create admin user
    const passwordHash = await bcrypt.hash(payload.adminPassword, 12);
    const { data: admin, error: adminError } = await supabase
        .from('app_users')
        .insert({
        email: payload.ownerEmail,
        password_hash: passwordHash,
        role: 'restaurant_admin',
        restaurant_id: restaurant.id
    })
        .select('id,email')
        .single();
    if (adminError || !admin) {
        // Rollback restaurant creation
        await supabase.from('restaurants').delete().eq('id', restaurant.id);
        logger.error({ error: adminError }, 'Failed to create admin user during onboarding');
        throw Object.assign(new Error('Failed to create admin user'), {
            status: 500,
            details: adminError
        });
    }
    // Step 3: Store POS credentials (encrypted in production)
    if (payload.posType && payload.posType !== 'none' && payload.posAccessToken) {
        // In production, encrypt these tokens before storing
        // For now, we'll just store them (this should be replaced with proper encryption)
        logger.warn({ restaurantId: restaurant.id, posType: payload.posType }, 'POS credentials provided - in production these should be encrypted');
        // You would store encrypted tokens in a separate secure table
    }
    // Step 4: Provision VAPI phone number (if requested)
    let vapiPhoneProvisioned = false;
    if (!payload.phoneNumber) {
        // This would integrate with VAPI's phone provisioning API
        // For now, we'll just log that it should be done
        logger.info({ restaurantId: restaurant.id }, 'VAPI phone provisioning required');
        // vapiPhoneProvisioned = await provisionVapiPhone(restaurant.id);
    }
    // Step 5: Generate JWT tokens for immediate login
    const accessToken = jwt.sign({
        userId: admin.id,
        email: admin.email,
        role: 'restaurant_admin',
        restaurantId: restaurant.id
    }, env.JWT_SECRET, { expiresIn: '30d' });
    const refreshToken = nanoid(64);
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    const refreshExpiresAt = new Date();
    refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 90);
    await supabase.from('refresh_tokens').insert({
        user_id: admin.id,
        token_hash: tokenHash,
        expires_at: refreshExpiresAt.toISOString()
    });
    // Step 6: Log onboarding event
    logger.info({
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        adminEmail: admin.email,
        posType: payload.posType ?? 'none',
        stripeConfigured: !!payload.stripeAccountId
    }, 'Restaurant onboarding completed');
    return {
        restaurant: {
            id: restaurant.id,
            name: restaurant.name,
            slug: restaurant.slug,
            phone_number: restaurant.phone_number
        },
        admin: {
            id: admin.id,
            email: admin.email
        },
        auth: {
            accessToken,
            refreshToken
        },
        posConfigured: !!(payload.posType && payload.posType !== 'none' && payload.posAccessToken),
        stripeConfigured: !!payload.stripeAccountId,
        vapiPhoneProvisioned
    };
}
/**
 * Generate URL-friendly slug from restaurant name
 */
function generateSlug(name) {
    return (name
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim() +
        '-' +
        nanoid(6).toLowerCase());
}
/**
 * Handle POS OAuth callback and exchange code for tokens
 */
export async function handlePosOAuthCallback(restaurantId, posType, code, state) {
    // Verify state to prevent CSRF
    // In production, validate the state parameter
    switch (posType) {
        case 'square':
            return exchangeSquareCode(code);
        case 'toast':
            return exchangeToastCode(code);
        case 'clover':
            return exchangeCloverCode(code);
        default:
            throw Object.assign(new Error('Unsupported POS type'), {
                status: 400,
                code: 'INVALID_POS_TYPE'
            });
    }
}
async function exchangeSquareCode(code) {
    if (!env.SQUARE_CLIENT_ID || !env.SQUARE_CLIENT_SECRET) {
        throw Object.assign(new Error('Square credentials not configured'), {
            status: 500,
            code: 'SQUARE_NOT_CONFIGURED'
        });
    }
    const apiUrl = env.API_URL ?? process.env.API_URL;
    if (!apiUrl) {
        throw Object.assign(new Error('API_URL not configured'), {
            status: 500,
            code: 'API_URL_NOT_CONFIGURED'
        });
    }
    // Square OAuth token exchange (Production)
    // POST https://connect.squareup.com/oauth2/token
    // IMPORTANT: redirect_uri MUST match exactly what was used in the authorization request
    const redirectUri = `${apiUrl}/v1/onboarding/pos/square/callback`;
    const response = await fetch(`${squareOAuthBase}/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Square-Version': squareVersion
        },
        body: JSON.stringify({
            client_id: env.SQUARE_CLIENT_ID,
            client_secret: env.SQUARE_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri
        })
    });
    if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Square OAuth exchange failed');
        throw Object.assign(new Error('Failed to exchange Square OAuth code'), {
            status: 500,
            code: 'SQUARE_OAUTH_FAILED',
            details: errorText
        });
    }
    const data = await response.json();
    // Fetch all locations for this merchant - user will select one
    let locations = [];
    try {
        const locationsResponse = await fetch(`${squareApiBase}/locations`, {
            headers: {
                'Square-Version': squareVersion,
                'Authorization': `Bearer ${data.access_token}`,
                'Content-Type': 'application/json'
            }
        });
        if (locationsResponse.ok) {
            const locationsData = await locationsResponse.json();
            locations = (locationsData.locations || []).map((loc) => ({
                id: loc.id,
                name: loc.name || 'Unnamed Location',
                address: loc.address
            }));
            logger.info({ merchantId: data.merchant_id, locationCount: locations.length }, 'Fetched Square locations');
        }
    }
    catch (err) {
        logger.warn({ err }, 'Failed to fetch Square locations');
    }
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        locations, // Return all locations for user selection
        merchantId: data.merchant_id
    };
}
async function exchangeToastCode(code) {
    // Toast OAuth token exchange
    // POST https://ws-api.toasttab.com/authentication/v1/authentication/login
    const response = await fetch('https://ws-api.toasttab.com/authentication/v1/authentication/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            clientId: env.TOAST_CLIENT_ID ?? '',
            clientSecret: env.TOAST_CLIENT_SECRET ?? '',
            userAccessType: 'TOAST_MACHINE_CLIENT',
            code
        })
    });
    if (!response.ok) {
        throw Object.assign(new Error('Failed to exchange Toast OAuth code'), {
            status: 500,
            code: 'TOAST_OAUTH_FAILED'
        });
    }
    const data = await response.json();
    return {
        accessToken: data.token.accessToken,
        locationId: data.restaurantGuid
    };
}
async function exchangeCloverCode(code) {
    if (!env.CLOVER_APP_ID || !env.CLOVER_APP_SECRET) {
        throw Object.assign(new Error('Clover credentials not configured'), {
            status: 500,
            code: 'CLOVER_NOT_CONFIGURED'
        });
    }
    // Clover OAuth token exchange
    // POST https://api.clover.com/oauth/token
    const response = await fetch('https://api.clover.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            client_id: env.CLOVER_APP_ID,
            client_secret: env.CLOVER_APP_SECRET,
            code,
            grant_type: 'authorization_code'
        })
    });
    if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Clover OAuth exchange failed');
        throw Object.assign(new Error('Failed to exchange Clover OAuth code'), {
            status: 500,
            code: 'CLOVER_OAUTH_FAILED',
            details: errorText
        });
    }
    const data = await response.json();
    logger.info({ merchantId: data.merchant_id }, 'Clover OAuth exchange successful');
    // Fetch merchants for this account - user will select one
    // Clover API: GET /v3/merchants
    let merchants = [];
    try {
        const merchantsResponse = await fetch(`https://api.clover.com/v3/merchants?access_token=${data.access_token}`, {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        if (merchantsResponse.ok) {
            const merchantsData = await merchantsResponse.json();
            merchants = (merchantsData.elements || []).map((merchant) => ({
                id: merchant.id,
                name: merchant.name || 'Unnamed Merchant'
            }));
            logger.info({ merchantCount: merchants.length }, 'Fetched Clover merchants');
        }
    }
    catch (err) {
        logger.warn({ err }, 'Failed to fetch Clover merchants');
        // If we can't fetch merchants, use the merchant_id from OAuth
        if (data.merchant_id) {
            merchants = [{ id: data.merchant_id, name: 'Default Merchant' }];
        }
    }
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        merchantId: data.merchant_id,
        merchants // Return merchants for user selection
    };
}
/**
 * Connect multiple POS locations for a restaurant (multi-location support)
 */
export async function connectMultipleLocations(restaurantId, posType, config, selectedIds) {
    const locations = posType === 'square' ? config.locations : config.merchants;
    if (!locations || locations.length === 0) {
        throw Object.assign(new Error('No locations/merchants available'), {
            status: 400,
            code: 'NO_LOCATIONS_AVAILABLE'
        });
    }
    const { data: existingLocations } = await supabase
        .from('restaurant_pos_locations')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('pos_type', posType)
        .limit(1);
    let shouldMarkPrimary = !existingLocations || existingLocations.length === 0;
    let connectedCount = 0;
    for (let i = 0; i < selectedIds.length; i++) {
        const selectedId = selectedIds[i];
        const locationData = locations.find((loc) => loc.id === selectedId);
        if (!locationData) {
            logger.warn({ selectedId, posType }, 'Selected location not found in available locations');
            continue;
        }
        const markPrimary = shouldMarkPrimary && connectedCount === 0;
        logger.info({
            restaurantId,
            posType,
            selectedId,
            locationName: locationData.name,
            hasAccessToken: !!config.accessToken,
            hasRefreshToken: !!config.refreshToken,
            accessTokenLength: config.accessToken?.length || 0,
            markPrimary
        }, 'Upserting POS location via RPC');
        const { data: upsertedId, error: upsertError } = await supabase.rpc('insert_restaurant_pos_location', {
            p_restaurant_id: restaurantId,
            p_pos_type: posType,
            p_pos_location_id: selectedId,
            p_pos_location_name: locationData.name,
            p_pos_merchant_id: config.merchantId || null,
            p_access_token: config.accessToken,
            p_refresh_token: config.refreshToken || null,
            p_address: 'address' in locationData && locationData.address
                ? locationData.address
                : null,
            p_is_primary: markPrimary
        });
        if (upsertError) {
            logger.error({ error: upsertError, restaurantId, selectedId }, 'Failed to upsert location');
            continue;
        }
        connectedCount++;
        shouldMarkPrimary = false;
        logger.info({
            restaurantId,
            posType,
            selectedId,
            upsertedId
        }, 'POS location upserted successfully');
    }
    logger.info({
        restaurantId,
        posType,
        connectedCount,
        requestedCount: selectedIds.length
    }, 'Multiple POS locations connected');
    return connectedCount;
}
/**
 * Update restaurant with POS credentials after OAuth (single location - backward compatibility)
 */
export async function updateRestaurantPosConfig(restaurantId, posType, config) {
    // Store encrypted tokens in secure storage (implement proper encryption in production)
    const { error } = await supabase
        .from('restaurants')
        .update({
        pos_type: posType,
        pos_location_id: config.locationId ?? config.merchantId ?? null,
        updated_at: new Date().toISOString()
    })
        .eq('id', restaurantId);
    if (error) {
        logger.error({ error, restaurantId }, 'Failed to update POS configuration');
        throw Object.assign(new Error('Failed to update POS configuration'), {
            status: 500,
            details: error
        });
    }
    // Trigger initial menu sync
    logger.info({ restaurantId, posType }, 'POS configured, initiating menu sync');
    // You would call the menu sync service here
}
