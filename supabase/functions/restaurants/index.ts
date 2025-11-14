import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@^9.0.2";
import { nanoid } from "npm:nanoid@^5.0.7";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const DASHBOARD_RANGES = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "month_to_date",
  "year_to_date"
];
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
function parseDashboardRange(value) {
  if (!value) return "today";
  if (DASHBOARD_RANGES.includes(value)) return value;
  throw Object.assign(new Error("Invalid range"), {
    status: 400,
    code: "INVALID_RANGE"
  });
}
function resolveDateRange(range) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayMs = 24 * 60 * 60 * 1000;
  switch(range){
    case "today":
      return {
        start: today,
        end: new Date(today.getTime() + dayMs)
      };
    case "yesterday":
      {
        const start = new Date(today.getTime() - dayMs);
        return {
          start,
          end: today
        };
      }
    case "last7":
      {
        const start = new Date(today.getTime() - 6 * dayMs);
        return {
          start,
          end: new Date(today.getTime() + dayMs)
        };
      }
    case "last30":
      {
        const start = new Date(today.getTime() - 29 * dayMs);
        return {
          start,
          end: new Date(today.getTime() + dayMs)
        };
      }
    case "month_to_date":
      {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return {
          start,
          end: new Date(today.getTime() + dayMs)
        };
      }
    case "year_to_date":
      {
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        return {
          start,
          end: new Date(today.getTime() + dayMs)
        };
      }
    default:
      return {
        start: today,
        end: new Date(today.getTime() + dayMs)
      };
  }
}
async function getRestaurantOverview(restaurantId, range) {
  const { start, end } = resolveDateRange(range);
  const { data, error } = await supabase.from("platform_usage_daily").select("total_calls,total_minutes,total_orders,total_order_value,delivery_orders,pickup_orders").eq("restaurant_id", restaurantId).gte("date", start.toISOString().slice(0, 10)).lt("date", end.toISOString().slice(0, 10));
  if (error) {
    throw Object.assign(new Error("Failed to load metrics"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return (data ?? []).reduce((acc, row)=>{
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
}
async function listRestaurantOrders(restaurantId) {
  const { data, error } = await supabase.from("orders").select("id,status,payment_status,total,subtotal,tax,delivery_fee,payment_method,placed_at,customer_name,customer_phone,order_type").eq("restaurant_id", restaurantId).order("placed_at", {
    ascending: false
  }).limit(50);
  if (error) {
    throw Object.assign(new Error("Failed to load orders"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return data ?? [];
}
async function listRecentCalls(restaurantId) {
  const { data, error } = await supabase.from("call_logs").select("id,call_id,duration_seconds,outcome,created_at,customer_phone").eq("restaurant_id", restaurantId).order("created_at", {
    ascending: false
  }).limit(20);
  if (error) {
    throw Object.assign(new Error("Failed to load calls"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return data ?? [];
}
async function listMenuItems(restaurantId, showAll = false) {
  let query = supabase.from("menu_items").select("id,name,description,price,category,is_available").eq("restaurant_id", restaurantId).order("category", {
    ascending: true
  }).order("name", {
    ascending: true
  });
  if (!showAll) {
    query = query.eq("is_available", true).is("location_id", null);
  }
  const { data, error } = await query;
  if (error) {
    throw Object.assign(new Error("Failed to load menu"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return data ?? [];
}
async function listRestaurantCustomers(restaurantId) {
  const { data, error } = await supabase.from("customers").select("*").eq("restaurant_id", restaurantId).order("total_spent", {
    ascending: false
  }).order("created_at", {
    ascending: false
  });
  if (error) {
    throw Object.assign(new Error("Failed to load customers"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return data ?? [];
}
async function listCustomerAddresses(restaurantId, customerId) {
  const { data, error } = await supabase.from("customer_addresses").select("*").eq("restaurant_id", restaurantId).eq("customer_id", customerId).order("is_default", {
    ascending: false
  }).order("created_at", {
    ascending: false
  });
  if (error) {
    throw Object.assign(new Error("Failed to load addresses"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  return data ?? [];
}
async function generateApiToken(restaurantId, expiresInDays) {
  const token = `hey_${nanoid(40)}`;
  const tokenPrefix = token.slice(0, 12);
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString() : null;
  const { data, error } = await supabase.from("api_tokens").insert({
    restaurant_id: restaurantId,
    token_hash: token,
    token_prefix: tokenPrefix,
    expires_at: expiresAt
  }).select().single();
  if (error) {
    throw Object.assign(new Error("Failed to create token"), {
      status: 500,
      code: "TOKEN_CREATE_FAILED",
      details: error
    });
  }
  return {
    token,
    tokenData: {
      id: data.id,
      restaurantId: data.restaurant_id,
      tokenPrefix: data.token_prefix,
      lastUsedAt: data.last_used_at,
      expiresAt: data.expires_at,
      createdAt: data.created_at,
      revokedAt: data.revoked_at
    }
  };
}
async function listApiTokens(restaurantId) {
  const { data, error } = await supabase.from("api_tokens").select("*").eq("restaurant_id", restaurantId).order("created_at", {
    ascending: false
  });
  if (error) {
    throw Object.assign(new Error("Failed to list tokens"), {
      status: 500,
      code: "TOKEN_QUERY_FAILED",
      details: error
    });
  }
  return (data ?? []).map((token)=>({
      id: token.id,
      restaurantId: token.restaurant_id,
      tokenPrefix: token.token_prefix,
      lastUsedAt: token.last_used_at,
      expiresAt: token.expires_at,
      createdAt: token.created_at,
      revokedAt: token.revoked_at
    }));
}
async function revokeApiToken(restaurantId, tokenId) {
  const { error } = await supabase.from("api_tokens").update({
    revoked_at: new Date().toISOString()
  }).eq("id", tokenId).eq("restaurant_id", restaurantId);
  if (error) {
    throw Object.assign(new Error("Failed to revoke token"), {
      status: 500,
      code: "TOKEN_REVOKE_FAILED",
      details: error
    });
  }
}
async function getPosConfig(restaurantId) {
  const { data, error } = await supabase.from("restaurants").select("pos_type,pos_location_id").eq("id", restaurantId).maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to load POS config"), {
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
  const { data: locations } = await supabase.from("restaurant_pos_locations").select("pos_type,pos_location_id,is_primary").eq("restaurant_id", restaurantId).eq("is_active", true).order("is_primary", {
    ascending: false
  }).order("created_at", {
    ascending: true
  });
  let posType = data.pos_type || "none";
  let locationId = data.pos_location_id || null;
  if (locations && locations.length > 0) {
    const primary = locations.find((loc)=>loc.is_primary) || locations[0];
    posType = primary.pos_type;
    locationId = primary.pos_location_id;
  }
  const { data: syncLog } = await supabase.from("pos_sync_log").select("created_at").eq("restaurant_id", restaurantId).eq("status", "success").order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  return {
    posType,
    posLocationId: locationId,
    locationCount: locations?.length ?? 0,
    lastSyncAt: syncLog?.created_at ?? null
  };
}
async function updateRestaurantSettings(restaurantId, payload) {
  const updateData = {
    name: payload.name,
    phone_number: payload.phoneNumber,
    tax_rate: payload.taxRate,
    delivery_fee: payload.deliveryFee,
    updated_at: new Date().toISOString()
  };
  if (payload.assistantName !== undefined) {
    updateData.assistant_name = payload.assistantName || null;
  }
  if (payload.manualMode !== undefined) {
    updateData.manual_mode = Boolean(payload.manualMode);
    if (payload.manualMode === true) {
      updateData.pos_type = 'none';
      updateData.pos_location_id = null;
    }
  }
  const { error } = await supabase.from("restaurants").update(updateData).eq("id", restaurantId);
  if (error) {
    throw Object.assign(new Error("Failed to update restaurant"), {
      status: 500,
      code: "UPDATE_FAILED",
      details: error
    });
  }
}
async function ensureManualModeRestaurant(restaurantId) {
  const { data, error } = await supabase.from("restaurants").select("id,manual_mode,pos_type,tax_rate,delivery_fee").eq("id", restaurantId).maybeSingle();
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
  if (!data.manual_mode && data.pos_type && data.pos_type !== "none") {
    throw Object.assign(new Error("Manual mode is disabled"), {
      status: 400,
      code: "MANUAL_MODE_DISABLED"
    });
  }
  return data;
}
async function createManualMenuItem(restaurantId, body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const price = Number(body.price);
  if (!name) {
    throw Object.assign(new Error("Name is required"), {
      status: 400,
      code: "NAME_REQUIRED"
    });
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw Object.assign(new Error("Price must be positive"), {
      status: 400,
      code: "INVALID_PRICE"
    });
  }
  const { data, error } = await supabase.from("menu_items").insert({
    restaurant_id: restaurantId,
    name,
    description: typeof body.description === "string" ? body.description : null,
    category: typeof body.category === "string" ? body.category : null,
    price,
    is_available: body.isAvailable !== false,
    sync_source: "manual"
  }).select("*").single();
  if (error) {
    throw Object.assign(new Error("Failed to create menu item"), {
      status: 500,
      code: "MENU_CREATE_FAILED",
      details: error
    });
  }
  return data;
}
async function updateManualMenuItem(restaurantId, itemId, body) {
  const update = {};
  if (typeof body.name === "string") update.name = body.name.trim();
  if (typeof body.description === "string" || body.description === null) update.description = body.description;
  if (typeof body.category === "string" || body.category === null) update.category = body.category;
  if (body.price !== undefined) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw Object.assign(new Error("Invalid price"), {
        status: 400,
        code: "INVALID_PRICE"
      });
    }
    update.price = price;
  }
  if (body.isAvailable !== undefined) {
    update.is_available = Boolean(body.isAvailable);
  }
  const { data, error } = await supabase.from("menu_items").update(update).eq("id", itemId).eq("restaurant_id", restaurantId).select("*").maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to update menu item"), {
      status: 500,
      code: "MENU_UPDATE_FAILED",
      details: error
    });
  }
  if (!data) {
    throw Object.assign(new Error("Menu item not found"), {
      status: 404,
      code: "MENU_NOT_FOUND"
    });
  }
  return data;
}
async function deleteMenuItem(restaurantId, itemId) {
  const { error } = await supabase.from("menu_items").delete().eq("id", itemId).eq("restaurant_id", restaurantId);
  if (error) {
    throw Object.assign(new Error("Failed to delete menu item"), {
      status: 500,
      code: "MENU_DELETE_FAILED",
      details: error
    });
  }
}
async function createManualCustomer(restaurantId, body) {
  const phoneNumber = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!phoneNumber) {
    throw Object.assign(new Error("Phone number is required"), {
      status: 400,
      code: "PHONE_REQUIRED"
    });
  }
  const { data, error } = await supabase.from("customers").insert({
    restaurant_id: restaurantId,
    phone_number: phoneNumber,
    first_name: typeof body.firstName === "string" ? body.firstName : null,
    last_name: typeof body.lastName === "string" ? body.lastName : null,
    email: typeof body.email === "string" ? body.email : null,
    notes: typeof body.notes === "string" ? body.notes : null,
    total_orders: 0,
    total_spent: 0
  }).select("*").single();
  if (error) {
    throw Object.assign(new Error("Failed to create customer"), {
      status: 500,
      code: "CUSTOMER_CREATE_FAILED",
      details: error
    });
  }
  return data;
}
async function updateManualCustomer(restaurantId, customerId, body) {
  const update = {};
  if (body.phoneNumber !== undefined) {
    const phone = typeof body.phoneNumber === "string" ? body.phoneNumber.trim() : "";
    if (!phone) {
      throw Object.assign(new Error("Phone number required"), {
        status: 400,
        code: "PHONE_REQUIRED"
      });
    }
    update.phone_number = phone;
  }
  if (body.firstName !== undefined) update.first_name = body.firstName || null;
  if (body.lastName !== undefined) update.last_name = body.lastName || null;
  if (body.email !== undefined) update.email = body.email || null;
  if (body.notes !== undefined) update.notes = body.notes || null;
  const { data, error } = await supabase.from("customers").update(update).eq("id", customerId).eq("restaurant_id", restaurantId).select("*").maybeSingle();
  if (error) {
    throw Object.assign(new Error("Failed to update customer"), {
      status: 500,
      code: "CUSTOMER_UPDATE_FAILED",
      details: error
    });
  }
  if (!data) {
    throw Object.assign(new Error("Customer not found"), {
      status: 404,
      code: "CUSTOMER_NOT_FOUND"
    });
  }
  return data;
}
async function deleteCustomer(restaurantId, customerId) {
  const { error } = await supabase.from("customers").delete().eq("id", customerId).eq("restaurant_id", restaurantId);
  if (error) {
    throw Object.assign(new Error("Failed to delete customer"), {
      status: 500,
      code: "CUSTOMER_DELETE_FAILED",
      details: error
    });
  }
}
async function createManualOrder(restaurantId, body) {
  const restaurant = await ensureManualModeRestaurant(restaurantId);
  const items = Array.isArray(body.items) ? body.items : [];
  const normalizedItems = items.map((item)=>({
      name: typeof item.name === "string" ? item.name : null,
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unitPrice ?? item.price) || 0,
      modifiers: Array.isArray(item.modifiers) ? item.modifiers : []
    })).filter((item)=>item.name && item.unit_price > 0);
  if (!normalizedItems.length) {
    throw Object.assign(new Error("At least one item is required"), {
      status: 400,
      code: "NO_ITEMS"
    });
  }
  const subtotal = normalizedItems.reduce((sum, item)=>sum + item.unit_price * item.quantity, 0);
  const taxRate = Number(restaurant.tax_rate ?? 0);
  const tax = Number((subtotal * taxRate).toFixed(2));
  const deliveryFee = body.deliveryFee !== undefined ? Number(body.deliveryFee) : Number(restaurant.delivery_fee ?? 0);
  const total = subtotal + tax + (deliveryFee || 0);
  const orderType = body.orderType === "delivery" ? "delivery" : "pickup";
  const paymentMethod = [
    "stripe_link",
    "cash",
    "card_on_delivery"
  ].includes(body.paymentMethod) ? body.paymentMethod : "cash";
  const paymentStatus = [
    "pending",
    "paid",
    "failed",
    "refunded"
  ].includes(body.paymentStatus) ? body.paymentStatus : "paid";
  const { data, error } = await supabase.from("orders").insert({
    restaurant_id: restaurantId,
    customer_id: body.customerId ?? null,
    customer_phone: typeof body.customerPhone === "string" ? body.customerPhone : null,
    customer_name: typeof body.customerName === "string" ? body.customerName : null,
    order_type: orderType,
    status: body.status || "confirmed",
    payment_status: paymentStatus,
    payment_method: paymentMethod,
    subtotal,
    tax,
    delivery_fee: deliveryFee || 0,
    total,
    items: normalizedItems,
    source: "manual",
    pos_sync_status: "manual",
    placed_at: new Date().toISOString()
  }).select("*").single();
  if (error) {
    throw Object.assign(new Error("Failed to create order"), {
      status: 500,
      code: "ORDER_CREATE_FAILED",
      details: error
    });
  }
  return data;
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
    if (path.startsWith("/restaurants")) {
      path = path.slice("/restaurants".length);
    }
    if (path === "" || path === "/") {
      return jsonResponse({
        error: "Not found"
      }, 404);
    }
    const segments = path.split("/").filter(Boolean);
    if (segments.length === 0) {
      return jsonResponse({
        error: "Not found"
      }, 404);
    }
    const restaurantId = segments[0];
    assertRestaurantAccess(restaurantId, user?.restaurantId);
    if (req.method === "GET" && segments.length === 1) {
      const { data, error } = await supabase.from("restaurants").select("*").eq("id", restaurantId).maybeSingle();
      if (error) return jsonResponse({
        message: "Failed to load restaurant",
        code: "QUERY_ERROR",
        details: error
      }, 500);
      if (!data) return jsonResponse({
        message: "Restaurant not found"
      }, 404);
      return jsonResponse(data);
    }
    if (req.method === "PATCH" && segments.length === 1) {
      const body = await req.json();
      await updateRestaurantSettings(restaurantId, body);
      return jsonResponse({
        message: "Restaurant updated successfully"
      });
    }
    if (req.method === "GET" && segments[1] === "overview") {
      const range = parseDashboardRange(url.searchParams.get("range"));
      const metrics = await getRestaurantOverview(restaurantId, range);
      return jsonResponse(metrics);
    }
    if (req.method === "GET" && segments[1] === "orders") {
      const orders = await listRestaurantOrders(restaurantId);
      return jsonResponse(orders);
    }
    if (req.method === "GET" && segments[1] === "calls") {
      const calls = await listRecentCalls(restaurantId);
      return jsonResponse(calls);
    }
    if (segments[1] === "menu") {
      if (req.method === "GET" && segments.length === 2) {
        const menu = await listMenuItems(restaurantId, true);
        return jsonResponse(menu);
      }
      if (req.method === "POST" && segments.length === 2) {
        await ensureManualModeRestaurant(restaurantId);
        const body = await req.json();
        const item = await createManualMenuItem(restaurantId, body);
        return jsonResponse(item, 201);
      }
      if (req.method === "PATCH" && segments.length === 3) {
        await ensureManualModeRestaurant(restaurantId);
        const body = await req.json();
        const item = await updateManualMenuItem(restaurantId, segments[2], body);
        return jsonResponse(item);
      }
      if (req.method === "DELETE" && segments.length === 3) {
        await ensureManualModeRestaurant(restaurantId);
        await deleteMenuItem(restaurantId, segments[2]);
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }
    }
    if (req.method === "GET" && segments[1] === "pos-config") {
      const config = await getPosConfig(restaurantId);
      return jsonResponse(config);
    }
    if (segments[1] === "tokens") {
      if (req.method === "POST" && segments.length === 2) {
        const body = await req.json().catch(()=>({}));
        const expiresInDays = typeof body.expiresInDays === "number" ? body.expiresInDays : undefined;
        const token = await generateApiToken(restaurantId, expiresInDays);
        return jsonResponse(token);
      }
      if (req.method === "GET" && segments.length === 2) {
        const tokens = await listApiTokens(restaurantId);
        return jsonResponse(tokens);
      }
      if (req.method === "DELETE" && segments.length === 3) {
        await revokeApiToken(restaurantId, segments[2]);
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }
    }
    if (segments[1] === "customers") {
      if (req.method === "GET" && segments.length === 2) {
        const customers = await listRestaurantCustomers(restaurantId);
        return jsonResponse(customers);
      }
      if (req.method === "POST" && segments.length === 2) {
        await ensureManualModeRestaurant(restaurantId);
        const body = await req.json();
        const customer = await createManualCustomer(restaurantId, body);
        return jsonResponse(customer, 201);
      }
      if (req.method === "PATCH" && segments.length === 3) {
        await ensureManualModeRestaurant(restaurantId);
        const body = await req.json();
        const customer = await updateManualCustomer(restaurantId, segments[2], body);
        return jsonResponse(customer);
      }
      if (req.method === "DELETE" && segments.length === 3) {
        await ensureManualModeRestaurant(restaurantId);
        await deleteCustomer(restaurantId, segments[2]);
        return new Response(null, {
          status: 204,
          headers: corsHeaders
        });
      }
      if (req.method === "GET" && segments.length === 4 && segments[3] === "addresses") {
        const addresses = await listCustomerAddresses(restaurantId, segments[2]);
        return jsonResponse(addresses);
      }
    }
    if (segments[1] === "orders" && segments[2] === "manual" && req.method === "POST") {
      const body = await req.json();
      const order = await createManualOrder(restaurantId, body);
      return jsonResponse(order, 201);
    }
    return jsonResponse({
      error: "Not found"
    }, 404);
  } catch (error) {
    console.error("Error in restaurants function:", error);
    const status = error?.status || 500;
    return jsonResponse({
      message: error?.message || "Internal server error",
      code: error?.code
    }, status);
  }
});
