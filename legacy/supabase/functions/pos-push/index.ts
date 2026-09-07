import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import axios from "npm:axios@^1.7.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") ?? "2025-01-23";
const SQUARE_ENVIRONMENT = Deno.env.get("SQUARE_ENVIRONMENT") ?? Deno.env.get("NODE_ENV") ?? "development";
const SQUARE_DEFAULT_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? undefined;
const CLOVER_CLIENT_ID = Deno.env.get("CLOVER_CLIENT_ID") ?? "";
const CLOVER_BASE_URL = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";

const squareBaseUrl = SQUARE_ENVIRONMENT === "production" ? "https://connect.squareup.com/v2" : "https://connect.squareupsandbox.com/v2";
const squareDefaultClient = SQUARE_DEFAULT_ACCESS_TOKEN ? axios.create({
  baseURL: squareBaseUrl,
  headers: {
    Authorization: `Bearer ${SQUARE_DEFAULT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_VERSION
  }
}) : null;

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function getTokenExpiration(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp || null;
  } catch {
    return null;
  }
}

function extractMerchantIdFromToken(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    // Clover JWT tokens contain merchant_uuid in the payload
    return payload.merchant_uuid || payload.merchantId || null;
  } catch (error) {
    console.error(`[pos-push] Failed to parse token for merchant_id:`, error);
    return null;
  }
}

function isTokenExpiredOrExpiringSoon(token: string, storedExpiration?: string, tokenCreatedAt?: string): boolean {
  // First, try to use stored expiration from API response (most accurate)
  if (storedExpiration) {
    const expirationTime = new Date(storedExpiration).getTime();
    const now = Date.now();
    const timeUntilExpiration = expirationTime - now;
    
    // Calculate token lifetime dynamically
    let tokenLifetime: number | null = null;
    if (tokenCreatedAt) {
      // Calculate lifetime from when token was created to expiration
      const createdAt = new Date(tokenCreatedAt).getTime();
      tokenLifetime = expirationTime - createdAt;
    }
    
    // Dynamic threshold: refresh when less than 10% of lifetime remaining
    // OR less than 1 hour remaining (whichever is smaller)
    // This ensures we refresh proactively but not too early
    const minBuffer = 3600 * 1000; // 1 hour in milliseconds (minimum)
    let threshold = minBuffer;
    
    if (tokenLifetime && tokenLifetime > 0) {
      // Use 10% of lifetime as threshold, but cap at 1 hour minimum
      // For short tokens (30 min), use 10% (3 min). For long tokens, use 1 hour.
      const dynamicThreshold = tokenLifetime * 0.10; // 10% of lifetime
      threshold = Math.min(dynamicThreshold, minBuffer); // Use whichever is smaller
    }
    
    const shouldRefresh = timeUntilExpiration < threshold;
    
    if (shouldRefresh) {
      const hoursRemaining = timeUntilExpiration / (1000 * 60 * 60);
      const percentRemaining = tokenLifetime ? (timeUntilExpiration / tokenLifetime) * 100 : null;
      console.log(`[pos-push] Access token expiring soon: ${hoursRemaining.toFixed(2)} hours remaining${percentRemaining ? ` (${percentRemaining.toFixed(1)}% of lifetime)` : ''}`);
    }
    
    return shouldRefresh;
  }
  
  // Fallback: parse JWT token expiration
  const exp = getTokenExpiration(token);
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  const timeUntilExpiration = exp - now;
  
  // If we can't determine lifetime, refresh if less than 1 hour remaining
  const buffer = 3600; // 1 hour
  return timeUntilExpiration <= buffer;
}

async function refreshCloverToken(locationId: string, refreshToken: string, clientId: string) {
  const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
  const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
  
  console.log(`[pos-push] Refreshing Clover token for location: ${locationId}`);
  
  try {
    const response = await axios.post(`${cloverBase}/oauth/v2/refresh`, {
      client_id: clientId,
      refresh_token: refreshToken
    }, {
      headers: {
        "Content-Type": "application/json"
      }
    });
    
    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;
    const accessTokenExpiration = response.data.access_token_expiration;
    const refreshTokenExpiration = response.data.refresh_token_expiration;
    
    if (!newAccessToken) {
      throw new Error("No access token in refresh response");
    }
    
    if (!newRefreshToken) {
      throw new Error("No refresh token in refresh response - Clover should always return a new refresh token");
    }
    
    console.log(`[pos-push] Received new tokens from Clover:`, {
      hasNewAccessToken: !!newAccessToken,
      hasNewRefreshToken: !!newRefreshToken,
      newRefreshTokenPreview: newRefreshToken ? `${newRefreshToken.substring(0, 20)}...` : 'missing',
      oldRefreshTokenPreview: refreshToken ? `${refreshToken.substring(0, 20)}...` : 'missing',
      tokensAreDifferent: newRefreshToken !== refreshToken
    });
    
    // Calculate expiration times for logging
    const accessTokenExpiresAt = accessTokenExpiration ? new Date(accessTokenExpiration * 1000) : null;
    const refreshTokenExpiresAt = refreshTokenExpiration ? new Date(refreshTokenExpiration * 1000) : null;
    const refreshTokenDaysRemaining = refreshTokenExpiresAt ? (refreshTokenExpiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24) : null;
    
    console.log(`[pos-push] Token refresh successful:`, {
      hasNewAccessToken: !!newAccessToken,
      hasNewRefreshToken: !!newRefreshToken,
      accessTokenExpiresAt: accessTokenExpiresAt?.toISOString() || 'unknown',
      refreshTokenExpiresAt: refreshTokenExpiresAt?.toISOString() || 'unknown',
      refreshTokenDaysRemaining: refreshTokenDaysRemaining ? `${refreshTokenDaysRemaining.toFixed(1)} days` : 'unknown',
      note: 'Clover refresh tokens expire after 14 days. Each refresh gives a new 14-day refresh token.',
      savingBothTokens: 'Both new access_token and new refresh_token will be saved to database'
    });
    
    // Store tokens and expiration info in address JSONB field (temporary until we add proper columns)
    const updateData: any = {
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      updated_at: new Date().toISOString()
    };
    
    // Store expiration info in address field if it exists, or create it
    const { data: currentLocation } = await supabase
      .from("restaurant_pos_locations")
      .select("address")
      .eq("id", locationId)
      .maybeSingle();
    
    const addressData = currentLocation?.address || {};
    addressData.token_expirations = {
      access_token_expires_at: accessTokenExpiration ? new Date(accessTokenExpiration * 1000).toISOString() : null,
      refresh_token_expires_at: refreshTokenExpiration ? new Date(refreshTokenExpiration * 1000).toISOString() : null,
      last_refreshed_at: new Date().toISOString()
    };
    updateData.address = addressData;
    
    const { error: updateError } = await supabase.from("restaurant_pos_locations").update(updateData).eq("id", locationId);
    
    if (updateError) {
      console.error("[Clover Token Refresh] Failed to update database:", updateError);
      throw updateError;
    }
    
    console.log(`[pos-push] ✅ Tokens updated in database successfully:`, {
      accessTokenUpdated: !!newAccessToken,
      refreshTokenUpdated: !!newRefreshToken,
      newRefreshTokenSaved: newRefreshToken !== refreshToken ? 'YES - New refresh token saved' : 'NO - Same token (unexpected)',
      accessTokenExpirationSaved: !!accessTokenExpiration,
      refreshTokenExpirationSaved: !!refreshTokenExpiration
    });
    
    return newAccessToken;
  } catch (error: any) {
    const errorMessage = error.response?.data?.message || error.message;
    const errorStatus = error.response?.status || 500;
    
    const errorDetails = {
      message: errorMessage,
      status: errorStatus,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      requestData: {
        client_id: clientId ? `${clientId.substring(0, 10)}...` : 'missing',
        hasRefreshToken: !!refreshToken,
        refreshTokenPreview: refreshToken ? `${refreshToken.substring(0, 20)}...` : 'missing'
      },
      responseData: error.response?.data ? JSON.stringify(error.response.data, null, 2) : null,
      responseHeaders: error.response?.headers ? JSON.stringify(error.response.headers, null, 2) : null,
      fullError: error.toString()
    };
    
    console.error("[Clover Token Refresh] ===== Token Refresh Error =====");
    console.error("[Clover Token Refresh] Error Details:", JSON.stringify(errorDetails, null, 2));
    console.error("[Clover Token Refresh] ===== End Error Details =====");
    
    // Check if refresh token is expired/invalid - this requires re-authorization
    if (errorStatus === 400 || errorStatus === 401 || errorMessage?.toLowerCase().includes('invalid') || errorMessage?.toLowerCase().includes('expired')) {
      throw Object.assign(new Error(`Clover refresh token has expired or is invalid. Please re-authorize your Clover connection in the dashboard. Original error: ${errorMessage}`), {
        status: 401,
        code: "REFRESH_TOKEN_EXPIRED",
        requiresReauth: true
      });
    }
    
    throw Object.assign(new Error(`Failed to refresh Clover token: ${errorMessage}`), {
      status: errorStatus,
      code: "TOKEN_REFRESH_FAILED"
    });
  }
}

function isRefreshTokenExpiringSoon(location: any): boolean {
  // Check if refresh token expiration is stored in address.token_expirations
  const tokenExpirations = location.address?.token_expirations;
  if (!tokenExpirations?.refresh_token_expires_at) {
    // If we don't have expiration info, assume it's valid but refresh proactively
    return false;
  }
  
  const refreshTokenExpiresAt = new Date(tokenExpirations.refresh_token_expires_at).getTime();
  const now = Date.now();
  const timeUntilExpiration = refreshTokenExpiresAt - now;
  const daysUntilExpiration = timeUntilExpiration / (1000 * 60 * 60 * 24);
  
  // Calculate token lifetime dynamically from last refresh time
  let tokenLifetime: number | null = null;
  if (tokenExpirations.last_refreshed_at) {
    const lastRefreshedAt = new Date(tokenExpirations.last_refreshed_at).getTime();
    tokenLifetime = refreshTokenExpiresAt - lastRefreshedAt;
  }
  
  // Dynamic threshold: refresh when less than 20% of actual lifetime remaining
  // This adapts to the actual token lifetime returned by Clover
  let threshold: number;
  
  if (tokenLifetime && tokenLifetime > 0) {
    // Use 20% of actual lifetime as threshold
    const dynamicThreshold = tokenLifetime * 0.20; // 20% of lifetime
    // Also set a minimum threshold of 2 days (safety net for 14-day tokens)
    const minThreshold = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds
    threshold = Math.max(dynamicThreshold, minThreshold);
  } else {
    // Fallback: assume 14 days if we can't calculate
    const assumedLifetime = 14 * 24 * 60 * 60 * 1000; // 14 days
    threshold = assumedLifetime * 0.20; // 20% = ~2.8 days
  }
  
  const shouldRefresh = timeUntilExpiration < threshold;
  
  if (shouldRefresh) {
    const percentRemaining = tokenLifetime ? (timeUntilExpiration / tokenLifetime) * 100 : null;
    const tokenLifetimeDays = tokenLifetime ? tokenLifetime / (1000 * 60 * 60 * 24) : null;
    console.log(`[pos-push] Refresh token expiring soon: ${daysUntilExpiration.toFixed(1)} days remaining${percentRemaining ? ` (${percentRemaining.toFixed(1)}% of ${tokenLifetimeDays?.toFixed(1)}-day lifetime)` : ' (Clover refresh tokens expire after 14 days)'}`);
  }
  
  return shouldRefresh;
}

async function ensureCloverAccessToken(location: any) {
  if (!location.refresh_token) {
    if (!location.access_token) {
      throw Object.assign(new Error("Clover access token not available"), {
        status: 400,
        code: "ACCESS_TOKEN_REQUIRED"
      });
    }
    console.log(`[pos-push] No refresh token available, using existing access token`);
    return location.access_token;
  }
  
  // Get stored expiration times for dynamic checking
  const tokenExpirations = location.address?.token_expirations;
  
  // Check if refresh token itself is expired (requires re-auth)
  if (tokenExpirations?.refresh_token_expires_at) {
    const refreshTokenExpiresAt = new Date(tokenExpirations.refresh_token_expires_at).getTime();
    const now = Date.now();
    if (now >= refreshTokenExpiresAt) {
      throw Object.assign(new Error("Clover refresh token has expired. Please re-authorize your Clover connection in the dashboard."), {
        status: 401,
        code: "REFRESH_TOKEN_EXPIRED",
        requiresReauth: true
      });
    }
  }
  
  const accessTokenStoredExpiration = tokenExpirations?.access_token_expires_at;
  
  // Proactively refresh if access token is expiring soon OR refresh token is expiring soon
  // Use stored expiration if available for more accurate checking
  const accessTokenCreatedAt = tokenExpirations?.last_refreshed_at;
  const accessTokenExpiring = isTokenExpiredOrExpiringSoon(location.access_token, accessTokenStoredExpiration, accessTokenCreatedAt);
  const refreshTokenExpiring = isRefreshTokenExpiringSoon(location);
  
  if (accessTokenExpiring || refreshTokenExpiring) {
    console.log(`[pos-push] Token refresh needed:`, {
      accessTokenExpiring,
      refreshTokenExpiring,
      accessTokenExpiration: accessTokenStoredExpiration || 'unknown',
      refreshTokenExpiration: tokenExpirations?.refresh_token_expires_at || 'unknown'
    });
    return await refreshCloverToken(location.id, location.refresh_token, CLOVER_CLIENT_ID);
  }
  
  // Log remaining time for debugging
  if (accessTokenStoredExpiration) {
    const accessTokenExpiresAt = new Date(accessTokenStoredExpiration).getTime();
    const hoursRemaining = (accessTokenExpiresAt - Date.now()) / (1000 * 60 * 60);
    console.log(`[pos-push] Access token still valid: ${hoursRemaining.toFixed(2)} hours remaining`);
  } else {
    console.log(`[pos-push] Access token still valid, no refresh needed`);
  }
  
  return location.access_token;
}

async function recordPosSyncLog(entry: any) {
  await supabase.from("pos_sync_log").insert({
    restaurant_id: entry.restaurantId,
    location_id: entry.locationId,
    sync_type: entry.syncType,
    status: entry.status,
    error_message: entry.errorMessage ?? null,
    items_processed: entry.itemsProcessed ?? null,
    external_reference: entry.externalId ?? null
  });
}

async function getOrder(orderId: string) {
  console.log(`[pos-push] Fetching order: ${orderId}`);
  const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) {
    console.error(`[pos-push] Failed to load order:`, error);
    throw Object.assign(new Error("Failed to load order"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  if (!data) {
    console.error(`[pos-push] Order not found: ${orderId}`);
    throw Object.assign(new Error("Order not found"), {
      status: 404,
      code: "ORDER_NOT_FOUND"
    });
  }
  
  console.log(`[pos-push] Order loaded:`, {
    id: data.id,
    restaurant_id: data.restaurant_id,
    order_type: data.order_type,
    delivery_address_id: data.delivery_address_id,
    items_count: Array.isArray(data.items) ? data.items.length : 0,
    total: data.total
  });
  
  // If delivery order, fetch the address from customer_addresses
  if (data.order_type === "delivery" && data.delivery_address_id) {
    console.log(`[pos-push] Fetching delivery address: ${data.delivery_address_id}`);
    const { data: address, error: addressError } = await supabase
      .from("customer_addresses")
      .select("street, city, state, postal_code, delivery_instructions")
      .eq("id", data.delivery_address_id)
      .maybeSingle();
    
    if (addressError) {
      console.error(`[pos-push] Failed to fetch address:`, addressError);
    } else if (address) {
      // Format address as a single string for POS systems
      const addressParts = [
        address.street,
        address.city,
        address.state,
        address.postal_code
      ].filter(Boolean);
      data.delivery_address = addressParts.join(", ");
      if (address.delivery_instructions) {
        data.delivery_address += ` (${address.delivery_instructions})`;
      }
      console.log(`[pos-push] Address formatted: ${data.delivery_address}`);
    } else {
      console.warn(`[pos-push] Address not found for ID: ${data.delivery_address_id}`);
    }
  } else if (data.order_type === "delivery" && !data.delivery_address_id) {
    console.warn(`[pos-push] Delivery order has no delivery_address_id`);
  }
  
  return data;
}

async function getLocation(restaurantId: string, locationId?: string) {
  console.log(`[pos-push] Getting location for restaurant: ${restaurantId}, locationId: ${locationId || 'primary'}`);
  const query = supabase.from("restaurant_pos_locations").select("id,pos_type,pos_location_id,pos_merchant_id,access_token,refresh_token,address").eq("restaurant_id", restaurantId);
  if (locationId) {
    query.eq("id", locationId);
  } else {
    query.order("is_primary", { ascending: false }).order("created_at", { ascending: true });
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error(`[pos-push] Failed to load POS location:`, error);
    throw Object.assign(new Error("Failed to load POS location"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  if (!data) {
    console.error(`[pos-push] POS location not found for restaurant: ${restaurantId}`);
    throw Object.assign(new Error("POS location not found"), {
      status: 404,
      code: "LOCATION_NOT_FOUND"
    });
  }
  
  console.log(`[pos-push] Found location:`, {
    id: data.id,
    pos_type: data.pos_type,
    pos_location_id: data.pos_location_id,
    pos_merchant_id: data.pos_merchant_id,
    has_access_token: !!data.access_token,
    has_refresh_token: !!data.refresh_token
  });
  
  // If Clover and merchant_id is missing, try to extract it from the JWT token
  if (data.pos_type === "clover" && !data.pos_merchant_id && data.access_token) {
    console.log(`[pos-push] Clover merchant_id missing, attempting to extract from JWT token...`);
    try {
      const accessToken = await ensureCloverAccessToken(data);
      const merchantId = extractMerchantIdFromToken(accessToken);
      
      if (merchantId) {
        console.log(`[pos-push] Extracted merchant_id from JWT token: ${merchantId}`);
        await supabase.from("restaurant_pos_locations").update({
          pos_merchant_id: merchantId
        }).eq("id", data.id);
        data.pos_merchant_id = merchantId;
      } else {
        console.warn(`[pos-push] Could not extract merchant_id from JWT token`);
        // Fallback: Try API call (though this endpoint may not exist)
        try {
          const cloverClient = axios.create({
            baseURL: CLOVER_BASE_URL,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            }
          });
          
          // Try getting merchant info - some endpoints might work without merchant_id in path
          const merchantResponse = await cloverClient.get("/v3/merchants/current");
          const apiMerchantId = merchantResponse.data?.id;
          
          if (apiMerchantId) {
            console.log(`[pos-push] Fetched merchant_id from Clover API: ${apiMerchantId}`);
            await supabase.from("restaurant_pos_locations").update({
              pos_merchant_id: apiMerchantId
            }).eq("id", data.id);
            data.pos_merchant_id = apiMerchantId;
          }
        } catch (apiError: any) {
          console.error(`[pos-push] API fallback also failed:`, {
            message: apiError.message,
            status: apiError.response?.status
          });
        }
      }
    } catch (merchantError: any) {
      console.error(`[pos-push] Failed to extract/fetch Clover merchant_id:`, {
        message: merchantError.message,
        status: merchantError.response?.status,
        data: merchantError.response?.data
      });
      // Don't throw - we'll let it fail later with a clearer error
    }
  }
  
  return data;
}

function getSquareClient(accessToken?: string) {
  if (accessToken) {
    return axios.create({
      baseURL: squareBaseUrl,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Square-Version": SQUARE_VERSION
      }
    });
  }
  if (squareDefaultClient) {
    return squareDefaultClient;
  }
  throw Object.assign(new Error("Square access token required"), {
    status: 400,
    code: "ACCESS_TOKEN_REQUIRED"
  });
}

async function pushOrderToSquare(args: any) {
  const client = getSquareClient(args.accessToken);
  const lineItems = args.items.map((item: any) => {
    if (item.externalItemId) {
      return {
        catalog_object_id: item.externalItemId,
        quantity: item.quantity.toString(),
        modifiers: item.modifiers?.map((mod: any) => ({
          catalog_object_id: mod.externalId || mod.id,
          catalog_object_version: undefined
        })) || []
      };
    }
    return {
      name: item.name,
      quantity: item.quantity.toString(),
      base_price_money: {
        amount: Math.round(item.unitPrice * 100),
        currency: "USD"
      },
      modifiers: item.modifiers?.map((mod: any) => ({
        name: mod.name,
        base_price_money: {
          amount: Math.round(mod.priceDelta * 100),
          currency: "USD"
        }
      })) || []
    };
  });
  
  const fulfillments: any[] = [];
  if (args.orderType === "delivery" && args.deliveryAddress) {
    fulfillments.push({
      type: "SHIPMENT",
      shipment_details: {
        recipient: args.customerName ? { display_name: args.customerName } : undefined,
        shipping_note: args.customerPhone ? `Caller: ${args.customerPhone}` : undefined,
        address: {
          address_line_1: args.deliveryAddress,
          locality: "",
          administrative_district_level_1: "",
          postal_code: ""
        }
      }
    });
  } else {
    fulfillments.push({
      type: "PICKUP",
      pickup_details: {
        recipient: args.customerName ? { display_name: args.customerName } : undefined,
        customer_note: args.customerPhone ? `Caller: ${args.customerPhone}` : undefined,
        scheduled_type: "ASAP"
      }
    });
  }
  
  const response = await client.post("/orders", {
    idempotency_key: args.orderId,
    order: {
      location_id: args.locationExternalId,
      reference_id: args.orderId.slice(0, 40),
      line_items: lineItems,
      fulfillments
    }
  });
  
  return response.data.order?.id ?? args.orderId;
}

async function pushOrderToClover(args: any) {
  console.log(`[pos-push] ===== pushOrderToClover called =====`);
  console.log(`[pos-push] Arguments:`, JSON.stringify({
    merchantId: args.merchantId,
    orderId: args.orderId,
    itemsCount: args.items?.length || 0,
    orderType: args.orderType,
    customerPhone: args.customerPhone,
    customerName: args.customerName,
    deliveryAddress: args.deliveryAddress,
    items: args.items?.map((i: any) => ({
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      priceInCents: Math.round(i.unitPrice * 100),
      externalItemId: i.externalItemId
    }))
  }, null, 2));
  console.log(`[pos-push] ===== End Arguments =====`);
  
  // Ensure token is refreshed before making API calls
  const location = await getLocation(args.restaurantId, args.locationId);
  const accessToken = await ensureCloverAccessToken(location);
  
  const client = axios.create({
    baseURL: `${CLOVER_BASE_URL}/v3/merchants/${args.merchantId}`,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    }
  });
  
  const noteParts = [
    args.customerPhone ? `Caller: ${args.customerPhone}` : null,
    args.customerName ? `Customer: ${args.customerName}` : null,
    args.orderType === "delivery" && args.deliveryAddress ? `Delivery: ${args.deliveryAddress}` : null
  ].filter(Boolean);
  
  // Clover custom order format (for non-Clover inventory items)
  // According to Clover API docs: orderType, currency, state are key fields
  // Note: Do NOT include 'id' - Clover generates it
  const orderPayload = {
    currency: "USD",
    title: args.customerName || `Voice Order ${args.orderId.slice(-6)}`,
    note: noteParts.join(" | ") || undefined,
    state: "open", // Order state: "open", "locked", "closed"
    taxRemoved: false,
    // orderType is optional but recommended - we'll try to get default if available
    // If we have orderType ID, include it, otherwise Clover will use default
  };
  
  console.log(`[pos-push] Creating Clover order:`, JSON.stringify(orderPayload, null, 2));
  let orderResponse;
  try {
    orderResponse = await client.post("/orders", orderPayload);
    console.log(`[pos-push] Clover order created:`, {
      status: orderResponse.status,
      orderId: orderResponse.data?.id,
      responseData: JSON.stringify(orderResponse.data, null, 2)
    });
  } catch (error: any) {
    const errorDetails = {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url,
      method: error.config?.method,
      requestData: JSON.stringify(orderPayload, null, 2),
      responseData: error.response?.data ? JSON.stringify(error.response.data, null, 2) : null,
      responseHeaders: error.response?.headers ? JSON.stringify(error.response.headers, null, 2) : null,
      fullError: error.toString()
    };
    console.error(`[pos-push] ===== Clover Order Creation Error =====`);
    console.error(`[pos-push] Error Details:`, JSON.stringify(errorDetails, null, 2));
    console.error(`[pos-push] ===== End Error Details =====`);
    throw error;
  }
  
  const cloverOrderId = orderResponse.data.id ?? args.orderId;
  console.log(`[pos-push] Clover order ID: ${cloverOrderId}, adding ${args.items.length} line items...`);
  
  for (let i = 0; i < args.items.length; i++) {
    const item = args.items[i];
    console.log(`[pos-push] Adding line item ${i + 1}/${args.items.length}: ${item.name}`);
    
    // Clover line item format: price in cents, unitQty for quantity
    // If externalItemId exists, use it; otherwise create custom line item
    const lineItemPayload: any = {
      name: item.name,
      price: Math.round(item.unitPrice * 100), // Price in cents
      unitQty: item.quantity, // Use unitQty instead of quantity
      unitName: "item" // Unit name (e.g., "item", "each", "lb")
    };
    
    // Only include item reference if we have externalItemId (Clover inventory item)
    if (item.externalItemId) {
      lineItemPayload.item = { id: item.externalItemId };
    }
    
    // Optional fields
    if (item.note || item.specialInstructions) {
      lineItemPayload.note = item.note || item.specialInstructions;
    }
    
    try {
      console.log(`[pos-push] Line item payload:`, JSON.stringify(lineItemPayload, null, 2));
      await client.post(`/orders/${cloverOrderId}/line_items`, lineItemPayload);
      console.log(`[pos-push] Line item added successfully`);
    } catch (error: any) {
      const errorDetails = {
        item: item.name,
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
        requestData: JSON.stringify(lineItemPayload, null, 2),
        responseData: error.response?.data ? JSON.stringify(error.response.data, null, 2) : null,
        responseHeaders: error.response?.headers ? JSON.stringify(error.response.headers, null, 2) : null,
        fullError: error.toString()
      };
      console.error(`[pos-push] ===== Clover Line Item Error =====`);
      console.error(`[pos-push] Error Details:`, JSON.stringify(errorDetails, null, 2));
      console.error(`[pos-push] ===== End Error Details =====`);
      throw error;
    }
    
    if (item.modifiers && item.modifiers.length > 0) {
      console.log(`[pos-push] Adding ${item.modifiers.length} modifiers for ${item.name}`);
      for (const mod of item.modifiers) {
        try {
          // Modifiers are added as separate line items
          await client.post(`/orders/${cloverOrderId}/line_items`, {
            name: mod.name,
            price: Math.round((mod.priceDelta ?? 0) * 100), // Price delta in cents
            unitQty: item.quantity, // Use unitQty instead of quantity
            unitName: "item"
          });
        } catch (error: any) {
          console.error(`[pos-push] Failed to add modifier:`, {
            modifier: mod.name,
            message: error.message
          });
          // Don't throw - modifiers are optional
        }
      }
    }
  }
  
  console.log(`[pos-push] Clover order push completed: ${cloverOrderId}`);
  return cloverOrderId;
}

async function pushOrderToPos(order: any, location: any) {
  console.log(`[pos-push] Pushing order to POS:`, {
    order_id: order.id,
    pos_type: location.pos_type,
    location_id: location.id
  });
  
  // Fetch pos_item_id from menu_items table for items that have menu_item_id
  const menuItemIds = (order.items ?? [])
    .map((item: any) => item.menu_item_id || item.menuItemId)
    .filter(Boolean);
  
  let menuItemsMap: Record<string, string> = {};
  if (menuItemIds.length > 0) {
    console.log(`[pos-push] Fetching pos_item_id for ${menuItemIds.length} menu items...`);
    const { data: menuItems, error: menuError } = await supabase
      .from("menu_items")
      .select("id, pos_item_id")
      .in("id", menuItemIds);
    
    if (menuError) {
      console.error(`[pos-push] Failed to fetch menu items:`, menuError);
    } else if (menuItems) {
      menuItemsMap = menuItems.reduce((acc: Record<string, string>, item: any) => {
        if (item.pos_item_id) {
          acc[item.id] = item.pos_item_id;
        }
        return acc;
      }, {});
      console.log(`[pos-push] Found ${Object.keys(menuItemsMap).length} menu items with pos_item_id`);
    }
  }
  
  const items = (order.items ?? []).map((item: any) => {
    // Get pos_item_id from menu_items table if we have menu_item_id
    const menuItemId = item.menu_item_id || item.menuItemId;
    const posItemId = menuItemId ? menuItemsMap[menuItemId] : undefined;
    
    return {
      externalItemId: posItemId || item.pos_item_id || undefined, // Use pos_item_id from menu_items, fallback to item.pos_item_id
      name: item.name,
      quantity: item.quantity ?? 1,
      // Support both camelCase (from vapi-tools) and snake_case (from database)
      unitPrice: item.unitPrice ?? item.unit_price ?? item.price ?? 0,
      modifiers: item.modifiers ?? [],
      note: item.specialInstructions ?? item.note ?? undefined
    };
  });
  
  console.log(`[pos-push] Processed ${items.length} items:`, JSON.stringify(items.map(i => ({
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    priceInCents: Math.round(i.unitPrice * 100),
    hasExternalId: !!i.externalItemId,
    modifiers: i.modifiers
  })), null, 2));
  
  if (!items.length) {
    console.error(`[pos-push] Order has no items`);
    throw Object.assign(new Error("Order has no items"), {
      status: 400,
      code: "NO_ITEMS"
    });
  }
  
  if (location.pos_type === "square") {
    console.log(`[pos-push] Pushing to Square...`);
    if (!location.pos_location_id) {
      throw Object.assign(new Error("Square location ID missing"), {
        status: 400,
        code: "LOCATION_REQUIRED"
      });
    }
    const externalOrderId = await pushOrderToSquare({
      locationExternalId: location.pos_location_id,
      orderId: order.id,
      items,
      total: order.total,
      customerPhone: order.customer_phone,
      customerName: order.customer_name,
      orderType: order.order_type,
      deliveryAddress: order.delivery_address,
      accessToken: location.access_token
    });
    return {
      provider: "square",
      externalOrderId
    };
  }
  
  if (location.pos_type === "clover") {
    console.log(`[pos-push] Pushing to Clover...`);
    if (!location.pos_merchant_id) {
      console.error(`[pos-push] Clover merchant ID missing for location: ${location.id}`);
      throw Object.assign(new Error("Clover merchant ID missing"), {
        status: 400,
        code: "MERCHANT_ID_REQUIRED"
      });
    }
    
    console.log(`[pos-push] Ensuring Clover access token is valid...`);
    // Refresh token before pushing
    const accessToken = await ensureCloverAccessToken(location);
    console.log(`[pos-push] Clover access token ready`);
    
    console.log(`[pos-push] Calling pushOrderToClover with merchant_id: ${location.pos_merchant_id}`);
    const externalOrderId = await pushOrderToClover({
      merchantId: location.pos_merchant_id,
      accessToken,
      restaurantId: order.restaurant_id,
      locationId: location.id,
      orderId: order.id,
      items,
      customerPhone: order.customer_phone,
      customerName: order.customer_name,
      orderType: order.order_type,
      deliveryAddress: order.delivery_address
    });
    return {
      provider: "clover",
      externalOrderId
    };
  }
  
  throw Object.assign(new Error("POS provider not supported"), {
    status: 400,
    code: "UNSUPPORTED_PROVIDER"
  });
}

Deno.serve(async (req) => {
  console.log(`[pos-push] ===== NEW REQUEST =====`);
  console.log(`[pos-push] Method: ${req.method}`);
  console.log(`[pos-push] URL: ${req.url}`);
  
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  
  try {
    if (req.method !== "POST") {
      console.error(`[pos-push] Invalid method: ${req.method}`);
      return jsonResponse({ error: "Method not allowed" }, 405);
  }
    
    const body = await req.json();
    console.log(`[pos-push] Request body:`, JSON.stringify(body, null, 2));
    const orderId = body.orderId;
    
    if (!orderId) {
      console.error(`[pos-push] Missing orderId in request`);
      return jsonResponse({ error: "orderId required" }, 400);
    }
    
    console.log(`[pos-push] Processing order: ${orderId}`);
    const order = await getOrder(orderId);
    if (!order.restaurant_id) {
      console.error(`[pos-push] Order missing restaurant_id`);
      return jsonResponse({ error: "Order missing restaurant" }, 400);
    }
    
    console.log(`[pos-push] Getting POS location for restaurant: ${order.restaurant_id}`);
    const location = await getLocation(order.restaurant_id, order.location_id);
    
    // Check if order is already synced to POS
    if (order.pos_sync_status === "synced" && order.pos_order_id) {
      console.log(`[pos-push] Order already synced to POS:`, {
        pos_order_id: order.pos_order_id,
        pos_sync_status: order.pos_sync_status
      });
      return jsonResponse({
        message: "Order already synced",
        externalOrderId: order.pos_order_id,
        provider: location?.pos_type || "unknown"
      }, 200);
    }
    
    await recordPosSyncLog({
      restaurantId: order.restaurant_id,
      locationId: location.id,
      syncType: "order_push",
      status: "pending"
    });
    
    try {
      console.log(`[pos-push] Starting push to POS...`);
      const result = await pushOrderToPos(order, location);
      console.log(`[pos-push] Push successful:`, result);
      
      await recordPosSyncLog({
        restaurantId: order.restaurant_id,
        locationId: location.id,
        syncType: "order_push",
        status: "synced",
        externalId: result.externalOrderId ?? null,
        itemsProcessed: order.items?.length ?? 0
      });
      
      await supabase.from("orders").update({
        pos_order_id: result.externalOrderId ?? null,
        pos_sync_status: "synced",
        pos_synced_at: new Date().toISOString()
      }).eq("id", order.id);
      
      console.log(`[pos-push] Order updated in database`);
      return jsonResponse(result);
    } catch (pushError: any) {
      console.error(`[pos-push] Push failed:`, {
        message: pushError.message,
        code: pushError.code,
        status: pushError.status,
        stack: pushError.stack,
        requiresReauth: pushError.requiresReauth
      });
      
      await recordPosSyncLog({
        restaurantId: order.restaurant_id,
        locationId: location.id,
        syncType: "order_push",
        status: "failed",
        errorMessage: pushError?.message || "Push failed"
      });
      
      await supabase.from("orders").update({
        pos_sync_status: "failed",
        pos_sync_error: pushError?.message ?? null,
        pos_sync_attempts: (order.pos_sync_attempts ?? 0) + 1
      }).eq("id", order.id);
      
      throw pushError;
    }
  } catch (error: any) {
    console.error(`[pos-push] ===== ERROR =====`);
    console.error(`[pos-push] Error:`, {
      message: error.message,
      code: error.code,
      status: error.status,
      stack: error.stack,
      requiresReauth: error.requiresReauth
    });
    const status = error?.status || 500;
    return jsonResponse({
      message: error?.message || "Internal server error",
      code: error?.code,
      requiresReauth: error?.requiresReauth || false
    }, status);
  }
});
