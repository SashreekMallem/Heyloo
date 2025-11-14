import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@^3.23.8";
import jwt from "npm:jsonwebtoken@^9.0.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
};

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const JWT_SECRET = Deno.env.get("JWT_SECRET");
function verifyAuth(request, required = true) {
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
async function createOrder(payload) {
  const response = await fetch(`${supabaseUrl}/functions/v1/vapi-tools/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vapi-tool-token": Deno.env.get("VAPI_TOOL_TOKEN") || ""
    },
    body: JSON.stringify({
      ...payload,
      source: "dashboard"
    })
  });
  if (!response.ok) throw new Error("Failed to create order");
  return await response.json();
}
async function listOrders(restaurantId: string, filters: any) {
  let query = supabase
    .from("orders")
    .select("*")
    .eq("restaurant_id", restaurantId);
  
  // Filter by status
  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }
  
  // Filter by payment status
  if (filters.paymentStatus) {
    query = query.eq("payment_status", filters.paymentStatus);
  }
  
  // Filter by date range
  if (filters.startDate) {
    query = query.gte("placed_at", filters.startDate);
  }
  if (filters.endDate) {
    query = query.lte("placed_at", filters.endDate);
  }
  
  // Filter by customer phone
  if (filters.customerPhone) {
    query = query.eq("customer_phone", filters.customerPhone);
  }
  
  // Order by placed_at descending (newest first)
  query = query.order("placed_at", { ascending: false });
  
  // Pagination
  const limit = filters.limit ? Math.min(Number(filters.limit), 100) : 50;
  const offset = filters.offset ? Number(filters.offset) : 0;
  query = query.range(offset, offset + limit - 1);
  
  const { data, error } = await query;
  
  if (error) {
    throw Object.assign(new Error("Failed to load orders"), {
      status: 500,
      code: "QUERY_ERROR",
      details: error
    });
  }
  
  return data ?? [];
}

async function getOrder(orderId: string, restaurantId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  
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

async function updateOrderStatus(orderId, restaurantId, status) {
  const { data, error } = await supabase.from("orders").update({
    status
  }).eq("id", orderId).eq("restaurant_id", restaurantId).select("id,status").maybeSingle();
  if (error) throw Object.assign(new Error("Failed to update order status"), {
    status: 500,
    details: error
  });
  if (!data) throw Object.assign(new Error("Order not found"), {
    status: 404,
    code: "ORDER_NOT_FOUND"
  });
  return data;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const user = verifyAuth(req, true);
    if (!user) {
      return new Response(JSON.stringify({
        error: "Unauthorized",
        code: "UNAUTHORIZED"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const url = new URL(req.url);
    const path = url.pathname.replace("/functions/v1/orders", "");
    const method = req.method;
    const pathParts = path.split("/").filter(Boolean);
    
    // GET / - List orders
    if (method === "GET" && (path === "" || path === "/")) {
      const restaurantId = user.role === "platform_admin" 
        ? url.searchParams.get("restaurantId") 
        : user?.restaurantId;
      
      if (!restaurantId) {
        return jsonResponse({
          message: "restaurantId is required",
          code: "RESTAURANT_ID_REQUIRED"
        }, 400);
      }
      
      const filters = {
        status: url.searchParams.get("status") || "all",
        paymentStatus: url.searchParams.get("paymentStatus"),
        startDate: url.searchParams.get("startDate"),
        endDate: url.searchParams.get("endDate"),
        customerPhone: url.searchParams.get("customerPhone"),
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset")
      };
      
      const orders = await listOrders(restaurantId, filters);
      return jsonResponse(orders);
    }
    
    // GET /:orderId - Get single order
    if (method === "GET" && pathParts.length === 1) {
      const orderId = pathParts[0];
      const restaurantId = user.role === "platform_admin"
        ? url.searchParams.get("restaurantId")
        : user?.restaurantId;
      
      if (!restaurantId) {
        return jsonResponse({
          message: "restaurantId is required",
          code: "RESTAURANT_ID_REQUIRED"
        }, 400);
      }
      
      const order = await getOrder(orderId, restaurantId);
      return jsonResponse(order);
    }
    
    // POST / - Create order
    if (method === "POST" && (path === "" || path === "/")) {
      const body = await req.json();
      const restaurantId = user.role === "platform_admin" ? body.restaurantId : user?.restaurantId;
      if (!restaurantId) {
        return new Response(JSON.stringify({
          message: "restaurantId is required",
          code: "RESTAURANT_ID_REQUIRED"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const order = await createOrder({
        ...body,
        restaurantId
      });
      return jsonResponse(order, 201);
    }
    // PATCH /:orderId/status - Update order status
    if (method === "PATCH" && pathParts.length === 2 && pathParts[1] === "status") {
      const orderId = pathParts[0];
      if (!orderId) {
        return new Response(JSON.stringify({
          error: "Order ID is required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const body = await req.json();
      const statusSchema = z.object({
        status: z.enum([
          "pending",
          "payment_pending",
          "paid",
          "confirmed",
          "preparing",
          "ready",
          "out_for_delivery",
          "delivered",
          "picked_up",
          "cancelled"
        ])
      });
      const { status } = statusSchema.parse(body);
      const restaurantId = user.role === "platform_admin" ? body.restaurantId : user?.restaurantId;
      if (!restaurantId) {
        return new Response(JSON.stringify({
          message: "restaurantId is required",
          code: "RESTAURANT_ID_REQUIRED"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const updated = await updateOrderStatus(orderId, restaurantId, status);
      return jsonResponse(updated);
    }
    return jsonResponse({
      error: "Not found",
      path
    }, 404);
  } catch (error: any) {
    console.error("Error in orders:", error);
    const status = error?.status || 500;
    return jsonResponse({
      error: error?.message || "Internal server error",
      code: error?.code
    }, status);
  }
});
