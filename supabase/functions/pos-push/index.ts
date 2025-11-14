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

function isTokenExpiredOrExpiringSoon(token: string) {
  const exp = getTokenExpiration(token);
  if (!exp) return true;
  const now = Math.floor(Date.now() / 1000);
  const buffer = 300; // 5 minutes
  return exp <= now + buffer;
}

async function refreshCloverToken(locationId: string, refreshToken: string, clientId: string) {
  const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
  const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
  
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
    const newRefreshToken = response.data.refresh_token || refreshToken;
    
    if (!newAccessToken) {
      throw new Error("No access token in refresh response");
    }
    
    const { error: updateError } = await supabase.from("restaurant_pos_locations").update({
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
      updated_at: new Date().toISOString()
    }).eq("id", locationId);
    
    if (updateError) {
      console.error("[Clover Token Refresh] Failed to update database:", updateError);
    }
    
    return newAccessToken;
  } catch (error: any) {
    console.error("[Clover Token Refresh] Failed:", {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status
    });
    throw Object.assign(new Error(`Failed to refresh Clover token: ${error.response?.data?.message || error.message}`), {
      status: error.response?.status || 500,
      code: "TOKEN_REFRESH_FAILED"
    });
  }
}

async function ensureCloverAccessToken(location: any) {
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
  
  return await refreshCloverToken(location.id, location.refresh_token, CLOVER_CLIENT_ID);
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
  const { data, error } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to load order"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  if (!data) {
    throw Object.assign(new Error("Order not found"), {
      status: 404,
      code: "ORDER_NOT_FOUND"
    });
  }
  return data;
}

async function getLocation(restaurantId: string, locationId?: string) {
  const query = supabase.from("restaurant_pos_locations").select("id,pos_type,pos_location_id,pos_merchant_id,access_token,refresh_token").eq("restaurant_id", restaurantId);
  if (locationId) {
    query.eq("id", locationId);
  } else {
    query.order("is_primary", { ascending: false }).order("created_at", { ascending: true });
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to load POS location"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  if (!data) {
    throw Object.assign(new Error("POS location not found"), {
      status: 404,
      code: "LOCATION_NOT_FOUND"
    });
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
  
  const orderPayload = {
    id: args.orderId,
    currency: "USD",
    title: args.customerName || `Voice Order ${args.orderId.slice(-6)}`,
    note: noteParts.join(" | ") || undefined
  };
  
  const orderResponse = await client.post("/orders", orderPayload);
  const cloverOrderId = orderResponse.data.id ?? args.orderId;
  
  for (const item of args.items) {
    await client.post(`/orders/${cloverOrderId}/line_items`, {
      item: item.externalItemId ? { id: item.externalItemId } : undefined,
      name: item.name,
      price: Math.round(item.unitPrice * 100),
      unitPrice: Math.round(item.unitPrice * 100),
      quantity: item.quantity
    });
    
    if (item.modifiers) {
      for (const mod of item.modifiers) {
        await client.post(`/orders/${cloverOrderId}/line_items`, {
          name: mod.name,
          price: Math.round((mod.priceDelta ?? 0) * 100),
          quantity: item.quantity
        });
      }
    }
  }
  
  return cloverOrderId;
}

async function pushOrderToPos(order: any, location: any) {
  const items = (order.items ?? []).map((item: any) => ({
    externalItemId: item.menu_item_id ?? item.pos_item_id ?? undefined,
    name: item.name,
    quantity: item.quantity ?? 1,
    unitPrice: item.unit_price ?? item.price ?? 0,
    modifiers: item.modifiers ?? []
  }));
  
  if (!items.length) {
    throw Object.assign(new Error("Order has no items"), {
      status: 400,
      code: "NO_ITEMS"
    });
  }
  
  if (location.pos_type === "square") {
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
    if (!location.pos_merchant_id) {
      throw Object.assign(new Error("Clover merchant ID missing"), {
        status: 400,
        code: "MERCHANT_ID_REQUIRED"
      });
    }
    
    // Refresh token before pushing
    const accessToken = await ensureCloverAccessToken(location);
    
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
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  
  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
  }
    
    const body = await req.json();
    const orderId = body.orderId;
    
    if (!orderId) {
      return jsonResponse({ error: "orderId required" }, 400);
    }
    
    const order = await getOrder(orderId);
    if (!order.restaurant_id) {
      return jsonResponse({ error: "Order missing restaurant" }, 400);
    }
    
    const location = await getLocation(order.restaurant_id, order.location_id);
    
    await recordPosSyncLog({
      restaurantId: order.restaurant_id,
      locationId: location.id,
      syncType: "order_push",
      status: "pending"
    });
    
    try {
      const result = await pushOrderToPos(order, location);
      
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
      
      return jsonResponse(result);
    } catch (pushError: any) {
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
    console.error("Error in pos-push", error);
    const status = error?.status || 500;
    return jsonResponse({
      message: error?.message || "Internal server error",
      code: error?.code
    }, status);
  }
});
