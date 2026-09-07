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

async function updateOrderFromClover(cloverOrderId: string, payload: any) {
  // Clover order structure:
  // - state: "open", "locked", "closed"
  // - total: in cents (integer)
  // - customer: { id, firstName, lastName, phoneNumber, emailAddresses, addresses }
  // - payments: array of payment objects
  
  const customer = payload?.customers?.elements?.[0] || payload?.customer;
  const customerName = customer 
    ? `${customer.firstName || ""} ${customer.lastName || ""}`.trim() || customer.name
    : null;
  const customerPhone = customer?.phoneNumber || null;
  const totalAmount = payload?.total ?? null;
  const orderState = payload?.state?.toLowerCase() || null;
  
  // Map Clover order states to our status
  let status = "pending";
  if (orderState === "closed") {
    status = "completed";
  } else if (orderState === "locked") {
    status = "confirmed";
  } else if (orderState === "open") {
    status = "pending";
  }
  
  // Check payment status from payments array
  let paymentStatus = "pending";
  const payments = payload?.payments?.elements || payload?.payments || [];
  if (payments.length > 0) {
    const hasPaidPayment = payments.some((p: any) => 
      p.result === "SUCCESS" || p.result === "APPROVED" || p.state === "PAID"
    );
    paymentStatus = hasPaidPayment ? "paid" : "pending";
  }
  
  console.log(`[clover-webhook] Updating order ${cloverOrderId}:`, {
    status,
    paymentStatus,
    total: totalAmount ? totalAmount / 100 : null
  });
  
  const { error } = await supabase
    .from("orders")
    .update({
      customer_name: customerName,
      customer_phone: customerPhone,
      total: totalAmount ? totalAmount / 100 : null,
      status,
      payment_status: paymentStatus,
      pos_sync_status: "synced",
      pos_synced_at: new Date().toISOString()
    })
    .eq("pos_order_id", cloverOrderId);
    
  if (error) {
    console.error(`[clover-webhook] Failed to update order:`, error);
    throw error;
  }
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
    console.log(`[clover-webhook] Received webhook:`, JSON.stringify(body, null, 2));
    
    // Clover webhook format:
    // {
    //   "appId": "DRKVJT2ZRRRSC",
    //   "merchants": {
    //     "XYZVJT2ZRRRSC": [
    //       {
    //         "objectId": "O:GHIVJT2ABCRSC",  // "O:" prefix for orders
    //         "type": "CREATE" | "UPDATE" | "DELETE",
    //         "ts": 1537970958000
    //       }
    //     ]
    //   }
    // }
    
    const appId = body?.appId;
    const merchants = body?.merchants;
    
    if (!merchants || typeof merchants !== "object") {
      console.error(`[clover-webhook] Invalid webhook format: missing merchants`);
      return new Response(JSON.stringify({ error: "Invalid webhook format" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
    
    // Process updates for each merchant
    const results: Array<{
      merchantId: string;
      orderId: string;
      type: string;
      success: boolean;
      error?: string;
    }> = [];
    for (const [merchantId, updates] of Object.entries(merchants)) {
      if (!Array.isArray(updates)) continue;
      
      const location = await fetchLocationByMerchant(merchantId);
      if (!location || !location.access_token) {
        console.warn(`[clover-webhook] Location not found for merchant: ${merchantId}`);
        continue;
      }
      
      // Process each update
      for (const update of updates) {
        const { objectId, type, ts } = update;
        
        // Check if this is an order update (objectId starts with "O:")
        if (objectId && objectId.startsWith("O:")) {
          const cloverOrderId = objectId.substring(2); // Remove "O:" prefix
          
          console.log(`[clover-webhook] Processing order ${type}: ${cloverOrderId} for merchant ${merchantId}`);
          
          try {
            // Fetch the full order details from Clover
            const order = await fetchCloverOrder(merchantId, cloverOrderId, location.access_token);
            
            // Update our database
            await updateOrderFromClover(cloverOrderId, order);
            
            results.push({
              merchantId,
              orderId: cloverOrderId,
              type,
              success: true
            });
          } catch (error: any) {
            console.error(`[clover-webhook] Failed to process order ${cloverOrderId}:`, error.message);
            results.push({
              merchantId,
              orderId: cloverOrderId,
              type,
              success: false,
              error: error.message
    });
  }
}
      }
    }
    
    return new Response(JSON.stringify({ 
      success: true,
      processed: results.length,
      results
    }), { 
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error: any) {
    console.error(`[clover-webhook] Webhook processing error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
