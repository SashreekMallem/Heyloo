import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@^9.0.2";
import axios from "npm:axios@^1.7.7";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") ?? "2025-01-23";
const SQUARE_ENVIRONMENT = Deno.env.get("SQUARE_ENVIRONMENT") ?? Deno.env.get("NODE_ENV") ?? "development";
const SQUARE_DEFAULT_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? undefined;
const CLOVER_CLIENT_ID = Deno.env.get("CLOVER_CLIENT_ID") ?? "";
const squareBaseUrl = SQUARE_ENVIRONMENT === "production" ? "https://connect.squareup.com/v2" : "https://connect.squareupsandbox.com/v2";
const squareDefaultClient = SQUARE_DEFAULT_ACCESS_TOKEN ? axios.create({
  baseURL: squareBaseUrl,
  headers: {
    Authorization: `Bearer ${SQUARE_DEFAULT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
    "Square-Version": SQUARE_VERSION
  }
}) : null;
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
function verifyAuth(request, required = false) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    if (required) {
      throw Object.assign(new Error("Unauthorized"), {
        status: 401,
        code: "UNAUTHORIZED"
      });
    }
    return null;
  }
  const token = authHeader.slice(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch  {
    if (required) {
      throw Object.assign(new Error("Invalid token"), {
        status: 401,
        code: "UNAUTHORIZED"
      });
    }
    return null;
  }
}
function assertRestaurantAccess(restaurantId, actorRestaurantId) {
  if (!restaurantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(restaurantId)) {
    throw Object.assign(new Error("Invalid restaurant ID"), {
      status: 400,
      code: "INVALID_RESTAURANT_ID"
    });
  }
  if (actorRestaurantId && actorRestaurantId !== restaurantId) {
    throw Object.assign(new Error("Forbidden"), {
      status: 403,
      code: "FORBIDDEN"
    });
  }
}
function getTokenExpiration(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload.exp || null;
  } catch  {
    return null;
  }
}
function isTokenExpiredOrExpiringSoon(token) {
  if (!token) return true;
  const exp = getTokenExpiration(token);
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  const buffer = 300; // 5 minutes
  return exp <= now + buffer;
}
async function refreshCloverToken(locationId, refreshToken, clientId) {
  const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
  const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
  const response = await axios.post(`${cloverBase}/oauth/v2/refresh`, {
    client_id: clientId,
    refresh_token: refreshToken
  }, {
    headers: {
      "Content-Type": "application/json"
    }
  });
  const newAccessToken = response.data.access_token;
  const newRefreshToken = response.data.refresh_token || refreshToken;
  if (!newAccessToken) {
    throw new Error("Failed to refresh Clover access token");
  }
  const { error } = await supabase.from("restaurant_pos_locations").update({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
    updated_at: new Date().toISOString()
  }).eq("id", locationId);
  if (error) {
    console.error("[Clover Refresh] Failed to update tokens", error);
  }
  return newAccessToken;
}
async function ensureCloverAccessToken(location) {
  if (!location.refresh_token) {
    if (!location.access_token) {
      throw Object.assign(new Error("Clover access token not available"), {
        status: 400,
        code: "ACCESS_TOKEN_REQUIRED"
      });
    }
    return location.access_token;
  }
  if (!isTokenExpiredOrExpiringSoon(location.access_token)) {
    return location.access_token;
  }
  const refreshed = await refreshCloverToken(location.id, location.refresh_token, CLOVER_CLIENT_ID);
  location.access_token = refreshed;
  return refreshed;
}
function getSquareClient(accessToken) {
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
  throw Object.assign(new Error("Square access token is required"), {
    status: 400,
    code: "ACCESS_TOKEN_REQUIRED"
  });
}
async function pullSquareMenu(locationExternalId, accessToken) {
  if (!locationExternalId && !accessToken && !SQUARE_DEFAULT_ACCESS_TOKEN) {
    throw Object.assign(new Error("Square location or access token required"), {
      status: 400,
      code: "ACCESS_TOKEN_REQUIRED"
    });
  }
  const client = getSquareClient(accessToken);
  
  // Use POST /v2/catalog/search as per Square API documentation
  const catalog = await client.post("/catalog/search", {
    object_types: ["ITEM"],
    include_related_objects: false
  });
  
  const objects = catalog.data.objects ?? [];
  const items = objects.map((item)=>({
      externalId: item.id,
      name: item.item_data?.name ?? "Untitled Item",
      description: item.item_data?.description ?? undefined,
      category: item.item_data?.category_id ?? undefined,
      price: (item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount ?? 0) / 100,
      isAvailable: item.item_data?.available_online ?? true
    }));
  return items;
}
async function pullCloverMenu(location, accessToken) {
  let merchantId = location.pos_merchant_id;
  // If merchant_id is missing, try to get it from the API
  if (!merchantId) {
    try {
      const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
      const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
      // Get merchant info from token (Clover tokens contain merchant_id in the response)
      // Try to get it from /v3/merchants/current or decode from token
      const merchantResponse = await axios.get(`${cloverBase}/v3/merchants/current`, {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      merchantId = merchantResponse.data.id;
      // Update location with merchant_id if we got it
      if (merchantId) {
        await supabase.from("restaurant_pos_locations").update({
          pos_merchant_id: merchantId
        }).eq("id", location.id);
        location.pos_merchant_id = merchantId;
      }
    } catch (error) {
      console.error("[Clover] Failed to get merchant ID:", error);
    }
  }
  if (!merchantId) {
    throw Object.assign(new Error("Clover merchant ID required"), {
      status: 400,
      code: "MERCHANT_ID_REQUIRED"
    });
  }
  const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
  const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
  const { data } = await axios.get(`${cloverBase}/v3/merchants/${merchantId}/items`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    params: {
      expand: "categories"
    }
  });
  const elements = data.elements ?? [];
  const items = elements.map((item)=>({
      externalId: item.id,
      name: item.name ?? "Untitled Item",
      description: item.description ?? undefined,
      category: item.categories?.elements?.[0]?.name ?? undefined,
      price: (item.price ?? 0) / 100,
      isAvailable: item.available ?? true
    }));
  return items;
}
async function upsertMenuItems(restaurantId, locationId, items) {
  if (!items.length) return;
  const { error } = await supabase.from("menu_items").upsert(items.map((item)=>({
      restaurant_id: restaurantId,
      location_id: locationId,
      pos_item_id: item.externalId,
      name: item.name,
      description: item.description ?? null,
      category: item.category ?? null,
      price: item.price,
      is_available: item.isAvailable,
      sync_source: "pos"
    })), {
    onConflict: "restaurant_id,pos_item_id"
  });
  if (error) {
    throw Object.assign(new Error("Failed to store menu items"), {
      status: 500,
      code: "UPSERT_FAILED",
      details: error
    });
  }
}
async function recordSyncLog(args) {
  const { error } = await supabase.from("pos_sync_log").insert({
    restaurant_id: args.restaurantId,
    location_id: args.locationId,
    sync_type: "menu_sync",
    sync_source: args.syncSource,
    status: args.status,
    items_processed: args.itemsProcessed,
    error_message: args.errorMessage ?? null
  });
  if (error) {
    console.error("[POS Sync] Failed to record log", error);
  }
}
async function fetchRestaurant(restaurantId) {
  const { data, error } = await supabase.from("restaurants").select("id,pos_type,pos_location_id").eq("id", restaurantId).maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to load restaurant"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  if (!data) {
    throw Object.assign(new Error("Restaurant not found"), {
      status: 404,
      code: "NOT_FOUND"
    });
  }
  return data;
}
async function fetchLocation(restaurantId, requestedLocationId, fallbackPosType, fallbackPosLocationId) {
  if (requestedLocationId) {
    const { data, error } = await supabase.from("restaurant_pos_locations").select("id,pos_type,pos_location_id,pos_merchant_id,access_token,refresh_token").eq("id", requestedLocationId).eq("restaurant_id", restaurantId).eq("is_active", true).maybeSingle();
    if (error) {
      throw Object.assign(new Error("Failed to load location"), {
        status: 500,
        code: "QUERY_ERROR",
        details: error
      });
    }
    if (!data) {
      throw Object.assign(new Error("Location not found"), {
        status: 404,
        code: "LOCATION_NOT_FOUND"
      });
    }
    return data;
  }
  const { data, error } = await supabase.from("restaurant_pos_locations").select("id,pos_type,pos_location_id,pos_merchant_id,access_token,refresh_token").eq("restaurant_id", restaurantId).eq("is_active", true).order("is_primary", {
    ascending: false
  }).order("created_at", {
    ascending: true
  }).maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to load POS locations"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  if (data) {
    return data;
  }
  if (fallbackPosType && fallbackPosType !== "none" && fallbackPosLocationId) {
    const { data: fallback, error: fallbackError } = await supabase.from("restaurant_pos_locations").select("id,pos_type,pos_location_id,pos_merchant_id,access_token,refresh_token").eq("restaurant_id", restaurantId).eq("pos_type", fallbackPosType).eq("pos_location_id", fallbackPosLocationId).maybeSingle();
    if (fallbackError) {
      throw Object.assign(new Error("Failed to load fallback location"), {
        status: 500,
        code: "QUERY_ERROR",
        details: fallbackError
      });
    }
    if (fallback) {
      return fallback;
    }
  }
  throw Object.assign(new Error("No active POS locations configured"), {
    status: 400,
    code: "LOCATION_REQUIRED"
  });
}
async function handleMenuSync(restaurantId, locationIdParam) {
  const restaurant = await fetchRestaurant(restaurantId);
  // Try to fetch location even if restaurant.pos_type is "none" - locations table might have POS config
  let location;
  try {
    location = await fetchLocation(restaurantId, locationIdParam, restaurant.pos_type, restaurant.pos_location_id);
  } catch (error) {
    // If no locations found and restaurant has no POS type, return none
    if (!restaurant.pos_type || restaurant.pos_type === "none") {
      return {
        provider: "none",
        count: 0
      };
    }
    throw error;
  }
  const provider = location.pos_type || restaurant.pos_type;
  let items = [];
  let accessToken = location.access_token;
  try {
    if (provider === "square") {
      if (!accessToken && !SQUARE_DEFAULT_ACCESS_TOKEN) {
        throw Object.assign(new Error("Square access token required"), {
          status: 400,
          code: "ACCESS_TOKEN_REQUIRED"
        });
      }
      items = await pullSquareMenu(location.pos_location_id, accessToken);
    } else if (provider === "clover") {
      // Refresh token first before any API calls
      accessToken = await ensureCloverAccessToken(location);
      items = await pullCloverMenu(location, accessToken);
    } else {
      return {
        provider,
        count: 0
      };
    }
    await upsertMenuItems(restaurantId, location.id, items);
    await recordSyncLog({
      restaurantId,
      locationId: location.id,
      syncSource: locationIdParam ? "auto" : "manual",
      status: "success",
      itemsProcessed: items.length
    });
    return {
      provider,
      count: items.length
    };
  } catch (error) {
    console.error("[POS Sync] error", error);
    await recordSyncLog({
      restaurantId,
      locationId: location.id,
      syncSource: locationIdParam ? "auto" : "manual",
      status: "failed",
      itemsProcessed: 0,
      errorMessage: error?.message ?? "Sync failed"
    });
    throw error;
  }
}
async function getSyncLogs(restaurantId, limit) {
  const { data, error } = await supabase.from("pos_sync_log").select("*").eq("restaurant_id", restaurantId).order("created_at", {
    ascending: false
  }).limit(limit);
  if (error) {
    throw Object.assign(new Error("Failed to fetch sync logs"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return (data ?? []).map((log)=>({
      id: log.id,
      restaurantId: log.restaurant_id,
      syncType: log.sync_type,
      syncSource: log.sync_source,
      status: log.status,
      itemsSynced: log.items_processed ?? 0,
      errorMessage: log.error_message,
      createdAt: log.created_at
    }));
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const user = verifyAuth(req, false);
    const url = new URL(req.url);
    let path = url.pathname;
    if (path.startsWith("/pos")) {
      path = path.slice("/pos".length);
    }
    const segments = path.split("/").filter(Boolean);
    if (segments.length < 2) {
      return jsonResponse({
        error: "Not found"
      }, 404);
    }
    const restaurantId = segments[0];
    const resource = segments[1];
    assertRestaurantAccess(restaurantId, user?.restaurantId);
    if (req.method === "POST" && resource === "sync-menu") {
      const locationId = url.searchParams.get("locationId");
      const result = await handleMenuSync(restaurantId, locationId);
      return jsonResponse(result);
    }
    if (req.method === "GET" && resource === "sync-logs") {
      const limit = Number(url.searchParams.get("limit")) || 10;
      const logs = await getSyncLogs(restaurantId, limit);
      return jsonResponse(logs);
    }
    return jsonResponse({
      error: "Not found"
    }, 404);
  } catch (error) {
    console.error("Error in pos function", error);
    const status = error?.status || 500;
    return jsonResponse({
      message: error?.message || "Internal server error",
      code: error?.code
    }, status);
  }
});
