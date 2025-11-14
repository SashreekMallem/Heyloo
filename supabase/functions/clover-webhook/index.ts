import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import axios from "npm:axios@^1.7.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CLOVER_BASE_URL = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox"
  ? "https://apisandbox.dev.clover.com"
  : "https://api.clover.com";

async function fetchLocationByMerchant(merchantId: string) {
  const { data, error } = await supabase
    .from("restaurant_pos_locations")
    .select("*")
    .eq("pos_merchant_id", merchantId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load POS location: ${error.message}`);
  }

  return data;
}

async function updateOrderFromClover(orderId: string, payload: any) {
  const customerName = payload?.customer?.name ?? null;
  const customerPhone = payload?.customer?.phoneNumber ?? null;
  const totalAmount = payload?.total ?? null;

  await supabase
    .from("orders")
    .update({
      customer_name: customerName,
      customer_phone: customerPhone,
      total: totalAmount ? totalAmount / 100 : null,
      status: "confirmed",
      payment_status: payload?.state === "PAID" ? "paid" : "pending",
      pos_sync_status: "synced",
      pos_synced_at: new Date().toISOString()
    })
    .eq("pos_order_id", orderId);
}

async function fetchCloverOrder(merchantId: string, orderId: string, accessToken: string) {
  const url = `${CLOVER_BASE_URL}/v3/merchants/${merchantId}/orders/${orderId}`;
  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const merchantId = body?.merchantId;
    const cloverOrderId = body?.orderId;

    if (!merchantId || !cloverOrderId) {
      return new Response(JSON.stringify({ error: "Bad Request" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const location = await fetchLocationByMerchant(merchantId);
    if (!location || !location.access_token) {
      return new Response(JSON.stringify({ error: "Location Not Found" }), { 
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

    const order = await fetchCloverOrder(merchantId, cloverOrderId, location.access_token);
    await updateOrderFromClover(cloverOrderId, order);
    return new Response(JSON.stringify({ success: true }), { 
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
