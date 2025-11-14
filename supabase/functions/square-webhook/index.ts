import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-square-hmacsha256-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Square webhook signature verification
// Get signature key from environment (should be set per webhook subscription)
const SQUARE_WEBHOOK_SIGNATURE_KEY = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || "";
const SQUARE_WEBHOOK_NOTIFICATION_URL = Deno.env.get("SQUARE_WEBHOOK_NOTIFICATION_URL") || 
  `${supabaseUrl}/functions/v1/square-webhook`;

/**
 * Verify Square webhook signature using HMAC-SHA256
 * Algorithm: HMAC-SHA256(notificationUrl + rawBody, signatureKey)
 */
async function verifySquareWebhookSignature(
  signatureHeader: string | null,
  rawBody: string,
  signatureKey: string,
  notificationUrl: string
): Promise<boolean> {
  if (!signatureHeader || !signatureKey) {
    console.warn("⚠️ Missing signature or signature key - skipping verification");
    return false;
  }

  try {
    // Create the message to sign: notificationUrl + rawBody
    const message = notificationUrl + rawBody;
    
    // Import the signature key
    const keyData = new TextEncoder().encode(signatureKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    // Compute HMAC-SHA256
    const messageData = new TextEncoder().encode(message);
    const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
    
    // Convert to base64
    const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    
    // Compare signatures (constant-time comparison)
    if (signatureHeader.length !== computedSignature.length) {
      return false;
    }
    
    let match = true;
    for (let i = 0; i < signatureHeader.length; i++) {
      if (signatureHeader[i] !== computedSignature[i]) {
        match = false;
      }
    }
    
    return match;
  } catch (error) {
    console.error("❌ Error verifying Square webhook signature:", error);
    return false;
  }
}
// Map Square order state to our order status
function mapSquareOrderState(squareState) {
  const stateMap = {
    DRAFT: "pending",
    OPEN: "confirmed",
    COMPLETED: "delivered",
    CANCELED: "cancelled"
  };
  return stateMap[squareState] || "pending";
}
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    // Get raw body
    const rawBody = await req.text();
    if (!rawBody) {
      return new Response(JSON.stringify({
        message: "Raw body is required",
        code: "INVALID_PAYLOAD"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Verify Square webhook signature
    const signature = req.headers.get("x-square-hmacsha256-signature");
    const isValid = await verifySquareWebhookSignature(
      signature,
      rawBody,
      SQUARE_WEBHOOK_SIGNATURE_KEY,
      SQUARE_WEBHOOK_NOTIFICATION_URL
    );

    if (!isValid && SQUARE_WEBHOOK_SIGNATURE_KEY) {
      // Only reject if signature key is configured (allows development without key)
      console.warn("⚠️ Invalid Square webhook signature");
      return new Response(JSON.stringify({
        message: "Invalid signature",
        code: "INVALID_SIGNATURE"
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }

    const event = JSON.parse(rawBody);
    const eventId = event.event_id;
    const eventType = event.type;
    console.log("📦 Square webhook received:", {
      eventId,
      eventType,
      timestamp: event.created_at
    });
    switch(eventType){
      // ========== ORDER EVENTS ==========
      case "order.created":
      case "order.updated":
        {
          const order = event.data?.object;
          if (order) {
            // Update order in our system if it exists
            const { data: existingOrder } = await supabase.from("orders").select("id, restaurant_id").eq("pos_order_id", order.id).maybeSingle();
            if (existingOrder) {
              await supabase.from("orders").update({
                status: mapSquareOrderState(order.state),
                updated_at: new Date().toISOString()
              }).eq("id", existingOrder.id);
              console.log("✅ Order updated from Square webhook:", {
                orderId: existingOrder.id,
                squareOrderId: order.id,
                newStatus: mapSquareOrderState(order.state)
              });
            } else {
              console.log("ℹ️ Order not found in our system:", order.id);
            }
          }
          break;
        }
      case "order.fulfillment.updated":
        {
          const order = event.data?.object;
          if (order) {
            const { data: existingOrder } = await supabase.from("orders").select("id, restaurant_id").eq("pos_order_id", order.id).maybeSingle();
            if (existingOrder) {
              // Update order status based on fulfillment state
              const fulfillmentState = order.fulfillments?.[0]?.state;
              if (fulfillmentState === "PREPARED") {
                await supabase.from("orders").update({
                  status: "ready",
                  updated_at: new Date().toISOString()
                }).eq("id", existingOrder.id);
              }
              console.log("✅ Order fulfillment updated:", {
                orderId: existingOrder.id,
                fulfillmentState
              });
            }
          }
          break;
        }
      // ========== PAYMENT EVENTS ==========
      case "payment.created":
      case "payment.updated":
        {
          const payment = event.data?.object;
          if (payment) {
            // Find order by payment reference
            const orderId = payment.order_id;
            if (orderId) {
              const { data: existingOrder } = await supabase.from("orders").select("id, restaurant_id").eq("pos_order_id", orderId).maybeSingle();
              if (existingOrder) {
                const paymentStatus = payment.status === "COMPLETED" ? "paid" : "pending";
                await supabase.from("orders").update({
                  payment_status: paymentStatus,
                  stripe_payment_intent_id: payment.id,
                  updated_at: new Date().toISOString()
                }).eq("id", existingOrder.id);
                console.log("✅ Payment updated from Square webhook:", {
                  orderId: existingOrder.id,
                  paymentId: payment.id,
                  paymentStatus
                });
              }
            }
          }
          break;
        }
      // ========== REFUND EVENTS ==========
      case "refund.created":
      case "refund.updated":
        {
          const refund = event.data?.object;
          if (refund) {
            const paymentId = refund.payment_id;
            // Find order by payment ID
            const { data: orders } = await supabase.from("orders").select("id, restaurant_id").eq("stripe_payment_intent_id", paymentId);
            if (orders && orders.length > 0) {
              for (const order of orders){
                await supabase.from("orders").update({
                  payment_status: "refunded",
                  updated_at: new Date().toISOString()
                }).eq("id", order.id);
              }
              console.log("✅ Refund processed from Square webhook:", {
                refundId: refund.id,
                paymentId,
                affectedOrders: orders.length
              });
            }
          }
          break;
        }
      // ========== CUSTOMER EVENTS ==========
      case "customer.created":
      case "customer.updated":
        {
          const customer = event.data?.object;
          if (customer) {
            // Extract phone number from customer data
            const phoneNumber = customer.phone_number?.replace(/\D/g, "");
            const email = customer.email_address?.email_address;
            const firstName = customer.given_name;
            const lastName = customer.family_name;
            if (phoneNumber) {
              // Find restaurant by Square location ID (from merchant_id in event)
              const merchantId = event.merchant_id;
              if (merchantId) {
                const { data: restaurants } = await supabase.from("restaurants").select("id").eq("pos_type", "square").eq("pos_location_id", merchantId);
                if (restaurants && restaurants.length > 0) {
                  for (const restaurant of restaurants){
                    // Upsert customer
                    const { data: existingCustomer } = await supabase.from("customers").select("id").eq("restaurant_id", restaurant.id).eq("phone_number", phoneNumber).maybeSingle();
                    if (existingCustomer) {
                      // Update existing customer
                      await supabase.from("customers").update({
                        first_name: firstName || null,
                        last_name: lastName || null,
                        email: email || null,
                        updated_at: new Date().toISOString()
                      }).eq("id", existingCustomer.id);
                    } else {
                      // Create new customer
                      await supabase.from("customers").insert({
                        restaurant_id: restaurant.id,
                        phone_number: phoneNumber,
                        first_name: firstName || null,
                        last_name: lastName || null,
                        email: email || null,
                        total_orders: 0,
                        total_spent: 0
                      });
                    }
                  }
                  console.log("✅ Customer synced from Square webhook:", {
                    customerId: customer.id,
                    phoneNumber,
                    merchantId
                  });
                }
              }
            }
          }
          break;
        }
      case "customer.deleted":
        {
          const customer = event.data?.object;
          if (customer) {
            const phoneNumber = customer.phone_number?.replace(/\D/g, "");
            if (phoneNumber) {
              const merchantId = event.merchant_id;
              if (merchantId) {
                const { data: restaurants } = await supabase.from("restaurants").select("id").eq("pos_type", "square").eq("pos_location_id", merchantId);
                if (restaurants && restaurants.length > 0) {
                  for (const restaurant of restaurants){
                    // Note: We might want to soft-delete or just log this
                    // For now, we'll just log the deletion
                    console.log("ℹ️ Customer deleted in Square (not removing from our DB):", {
                      restaurantId: restaurant.id,
                      phoneNumber
                    });
                  }
                }
              }
            }
          }
          break;
        }
      // ========== INVENTORY & CATALOG EVENTS ==========
      case "inventory.count.updated":
        {
          const inventoryCount = event.data?.object;
          if (inventoryCount) {
            console.log("📦 Inventory count updated in Square - menu sync may be needed:", {
              catalogObjectId: inventoryCount.catalog_object_id,
              state: inventoryCount.state,
              quantity: inventoryCount.quantity
            });
          // Could trigger a menu sync job here if needed
          }
          break;
        }
      case "catalog.version.updated":
        {
          console.log("📋 Catalog version updated in Square - menu sync may be needed:", {
            catalogVersion: event.data?.object?.version
          });
          break;
        }
      // ========== AUTH EVENTS ==========
      case "oauth.authorization.revoked":
        {
          const merchantId = event.data?.object?.merchant_id;
          if (merchantId) {
            // Find restaurant by Square location ID
            const { data: restaurants } = await supabase.from("restaurants").select("id, name").eq("pos_type", "square").eq("pos_location_id", merchantId);
            if (restaurants && restaurants.length > 0) {
              // Clear POS credentials
              for (const restaurant of restaurants){
                await supabase.from("restaurants").update({
                  pos_type: "none",
                  pos_location_id: null,
                  updated_at: new Date().toISOString()
                }).eq("id", restaurant.id);
                console.warn("⚠️ Square authorization revoked for restaurant:", {
                  restaurantId: restaurant.id,
                  restaurantName: restaurant.name
                });
              }
            }
          }
          break;
        }
      // ========== UNHANDLED EVENTS ==========
      default:
        console.log(`ℹ️ Unhandled Square webhook event: ${eventType}`);
        console.log("Event data:", JSON.stringify(event, null, 2));
    }
    return new Response(JSON.stringify({
      received: true,
      eventType
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("❌ Error in square-webhook:", error);
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
