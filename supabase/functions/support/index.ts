import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@^9.0.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
};
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
function assertRestaurantAccess(restaurantId, actorRestaurantId) {
  if (actorRestaurantId && actorRestaurantId !== restaurantId) {
    throw Object.assign(new Error("Forbidden"), {
      status: 403
    });
  }
}
async function createSupportRequest(payload) {
  const { data, error } = await supabase.from("support_requests").insert({
      restaurant_id: payload.restaurantId,
      customer_phone: payload.customerPhone,
      customer_name: payload.customerName || null,
      call_id: payload.callId || null,
      order_id: payload.orderId || null,
      request_type: payload.requestType,
      priority: payload.priority || "medium",
      subject: payload.subject,
      description: payload.description,
      ai_transcript: payload.aiTranscript || null,
    status: "open"
  }).select().single();
  if (error) throw Object.assign(new Error("Failed to create support request"), {
    status: 500,
    details: error
  });
  return data;
}
async function listSupportRequests(restaurantId, status) {
  let query = supabase.from("support_requests").select("*").eq("restaurant_id", restaurantId);
  if (status) query = query.eq("status", status);
  query = query.order("created_at", {
    ascending: false
  });
  const { data, error } = await query;
  if (error) throw Object.assign(new Error("Failed to load support requests"), {
    status: 500,
    details: error
  });
  return data ?? [];
}
async function getSupportRequestWithNotes(id, restaurantId) {
  const { data: request, error } = await supabase.from("support_requests").select("*").eq("id", id).eq("restaurant_id", restaurantId).maybeSingle();
  if (error || !request) throw Object.assign(new Error("Support request not found"), {
    status: 404
  });
  const { data: notes } = await supabase.from("support_request_notes").select("*").eq("support_request_id", id).order("created_at", {
    ascending: true
  });
  return {
    ...request,
    notes: notes ?? []
  };
}
async function updateSupportRequest(id, restaurantId, updates) {
  const { data, error } = await supabase.from("support_requests").update({
      status: updates.status,
      priority: updates.priority,
      assigned_to: updates.assignedTo || null,
      resolved_at: updates.resolvedAt ? new Date(updates.resolvedAt).toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq("id", id).eq("restaurant_id", restaurantId).select().single();
  if (error) throw Object.assign(new Error("Failed to update support request"), {
    status: 500,
    details: error
  });
  return data;
}
async function addSupportRequestNote(id, email, note, isInternal) {
  const { data, error } = await supabase.from("support_request_notes").insert({
      support_request_id: id,
      author_email: email,
      note,
    is_internal: isInternal
  }).select().single();
  if (error) throw Object.assign(new Error("Failed to add note"), {
    status: 500,
    details: error
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
    const path = url.pathname.replace("/functions/v1/support", "");
    const method = req.method;
    // POST /requests
    if (method === "POST" && path === "/requests") {
      const body = await req.json();
      const restaurantId = user.role === "platform_admin" ? body.restaurantId : user?.restaurantId;
      if (!restaurantId) return new Response(JSON.stringify({
        message: "Restaurant ID is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      const request = await createSupportRequest({
        ...body,
        restaurantId
      });
      return new Response(JSON.stringify(request), {
        status: 201,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // GET /requests
    if (method === "GET" && path === "/requests") {
      const status = url.searchParams.get("status");
      const restaurantId = user.role === "platform_admin" ? url.searchParams.get("restaurantId") : user?.restaurantId;
      if (!restaurantId) return new Response(JSON.stringify({
        message: "Restaurant ID is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      const requests = await listSupportRequests(restaurantId, status || undefined);
      return new Response(JSON.stringify(requests), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // GET /requests/:id
    if (method === "GET" && path.startsWith("/requests/")) {
      const id = path.split("/")[2];
      const restaurantId = user.role === "platform_admin" ? url.searchParams.get("restaurantId") : user?.restaurantId;
      if (!restaurantId) return new Response(JSON.stringify({
        message: "Restaurant ID is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      const data = await getSupportRequestWithNotes(id, restaurantId);
      return new Response(JSON.stringify(data), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // PATCH /requests/:id
    if (method === "PATCH" && path.startsWith("/requests/")) {
      const id = path.split("/")[2];
      const body = await req.json();
      const restaurantId = user.role === "platform_admin" ? body.restaurantId : user?.restaurantId;
      if (!restaurantId) return new Response(JSON.stringify({
        message: "Restaurant ID is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
      const updated = await updateSupportRequest(id, restaurantId, body);
      return new Response(JSON.stringify(updated), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // POST /requests/:id/notes
    if (method === "POST" && path.includes("/notes")) {
      const id = path.split("/")[2];
      const body = await req.json();
      const note = await addSupportRequestNote(id, user?.email || "unknown", body.note, body.isInternal ?? true);
      return new Response(JSON.stringify(note), {
        status: 201,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      error: "Not found"
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in support:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error",
      code: error.code
    }), {
      status: error.status || 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
