import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@^3.23.8";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vapi-secret, x-call-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const assistantRequestSchema = z.object({
  message: z.object({
    type: z.string(),
    phoneNumber: z.union([
      z.string(),
      z.object({}).passthrough()
    ]).optional(),
    call: z.object({
      phoneNumberId: z.string().optional(),
      phoneNumber: z.union([
        z.object({}).passthrough(),
        z.null()
      ]).optional()
    }).optional()
  })
});
function normalizePhoneNumber(phone) {
  return phone.replace(/[\s\-+()]/g, "").replace(/^\+?1?/, "");
}
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  const startTime = Date.now();
  const callId = req.headers.get("x-call-id") || null;
  try {
    const body = await req.json();
    const messageType = body?.message?.type;
    // Only process assistant-request messages
    if (!messageType || messageType !== "assistant-request") {
      return new Response(JSON.stringify({
        ok: true
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Validate schema
    const validated = assistantRequestSchema.parse(body);
    // Get phone number ID
    const directPhoneNumberId = validated.message.call?.phoneNumberId;
    const nestedPhoneNumberId = validated.message.call?.phoneNumber?.id;
    const phoneNumberId = directPhoneNumberId || nestedPhoneNumberId;
    if (!phoneNumberId) {
      return new Response(JSON.stringify({
        error: "Phone number ID is required"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Look up by location-specific VAPI phone number first
    let location = null;
    let locationError = null;
    let result = await supabase.from("restaurant_pos_locations").select("id,restaurant_id,vapi_phone_number,pos_location_name,restaurants!restaurant_pos_locations_restaurant_id_fkey(id,name,assistant_name)").eq("vapi_phone_number", phoneNumberId).eq("is_active", true).maybeSingle();
    if (result.error) {
      locationError = result.error;
    } else if (result.data) {
      location = result.data;
    }
    if (locationError) {
      return new Response(JSON.stringify({
        error: "Failed to lookup location"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    let restaurantId;
    let restaurantName;
    let assistantName = null;
    let locationId = null;
    let locationName = null;
    if (location) {
      restaurantId = location.restaurant_id;
      const restaurant = location.restaurants;
      restaurantName = restaurant?.name || "Restaurant";
      assistantName = restaurant?.assistant_name || null;
      locationId = location.id;
      locationName = location.pos_location_name;
    } else {
      // Fallback to restaurant-level phone number
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(phoneNumberId);
      let lookupValue = phoneNumberId;
      if (!isUUID) {
        lookupValue = normalizePhoneNumber(phoneNumberId);
      }
      result = await supabase.from("restaurants").select("id,name,phone_number,assistant_name").eq("phone_number", lookupValue).maybeSingle();
      if (result.error) {
        return new Response(JSON.stringify({
          error: "Failed to lookup restaurant"
        }), {
          status: 500,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (!result.data) {
        return new Response(JSON.stringify({
          error: "No restaurant found for this phone number"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      restaurantId = result.data.id;
      restaurantName = result.data.name;
      assistantName = result.data.assistant_name || null;
    }
    // Build variable values
    const variableValues = {
      restaurant_id: restaurantId,
      restaurant_name: restaurantName
    };
    if (assistantName) {
      variableValues.assistant_name = assistantName;
    }
    if (locationId) {
      variableValues.location_id = locationId;
      if (locationName) {
        variableValues.location_name = locationName;
      }
    }
    // Build greeting
    let greeting = `Thank you for calling {{restaurant_name}}`;
    if (assistantName) {
      greeting += `! This is {{assistant_name}}`;
    }
    greeting += "! How can I help you today?";
    // Build response
    const vapiAssistantId = Deno.env.get("VAPI_ASSISTANT_ID");
    if (!vapiAssistantId) {
      return new Response(JSON.stringify({
        error: "VAPI_ASSISTANT_ID not configured"
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    const response = {
      assistantId: vapiAssistantId,
      assistantOverrides: {
        variableValues: variableValues,
        firstMessage: greeting
      }
    };
    return new Response(JSON.stringify(response), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in vapi-assistant:", error);
    return new Response(JSON.stringify({
      error: "Internal server error",
      message: error?.message || "Unknown error"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
