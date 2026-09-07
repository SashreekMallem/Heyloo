import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@^16.8.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
// Initialize Supabase client
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
// Initialize Stripe
const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, {
  apiVersion: "2024-06-20"
}) : null;
Deno.serve(async (req)=>{
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!stripe) {
    return new Response(JSON.stringify({
      message: "Stripe is not configured",
      code: "STRIPE_NOT_CONFIGURED"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response(JSON.stringify({
      message: "Stripe webhook secret is not configured",
      code: "STRIPE_NOT_CONFIGURED"
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    // Get raw body for signature verification
    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response(JSON.stringify({
        message: "Missing Stripe signature header",
        code: "UNAUTHORIZED"
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Verify signature and parse event
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      return new Response(JSON.stringify({
        message: "Invalid Stripe webhook signature",
        code: "INVALID_SIGNATURE"
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Handle different event types
    switch(event.type){
      case "payment_intent.succeeded":
        {
          const paymentIntent = event.data.object;
          const orderId = paymentIntent.metadata?.order_id;
          if (orderId) {
            // Update order payment status
            await supabase.from("orders").update({
              payment_status: "paid",
              status: "confirmed",
              updated_at: new Date().toISOString()
            }).eq("id", orderId);
            // Get order and restaurant details
            const { data: order } = await supabase.from("orders").select("id,restaurant_id,customer_phone,customer_name,order_type").eq("id", orderId).maybeSingle();
            if (order) {
              const { data: restaurant } = await supabase.from("restaurants").select("name,pos_type,manager_phone").eq("id", order.restaurant_id).maybeSingle();
              if (restaurant) {
                // Push to POS if configured
                if (restaurant.pos_type && restaurant.pos_type !== "none") {
                  // Call POS push function (async - don't wait)
                  fetch(`https://${Deno.env.get("SUPABASE_URL")?.replace("https://", "")}/functions/v1/pos-push`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      "Authorization": `Bearer ${supabaseServiceKey}`
                    },
                    body: JSON.stringify({
                      orderId: order.id,
                      restaurantId: order.restaurant_id
                    })
                  }).catch((err)=>console.error("Failed to push order to POS:", err));
                }
              }
            }
          }
          break;
        }
      case "payment_intent.payment_failed":
        {
          const paymentIntent = event.data.object;
          const orderId = paymentIntent.metadata?.order_id;
          if (orderId) {
            await supabase.from("orders").update({
              payment_status: "failed",
              status: "cancelled",
              updated_at: new Date().toISOString()
            }).eq("id", orderId);
          }
          break;
        }
      case "payment_intent.canceled":
        {
          const paymentIntent = event.data.object;
          const orderId = paymentIntent.metadata?.order_id;
          if (orderId) {
            await supabase.from("orders").update({
              payment_status: "canceled",
              status: "cancelled",
              updated_at: new Date().toISOString()
            }).eq("id", orderId);
          }
          break;
        }
      case "checkout.session.completed":
        {
          const session = event.data.object;
          const orderId = session.metadata?.order_id;
          if (orderId && session.payment_status === "paid") {
            await supabase.from("orders").update({
              payment_status: "paid",
              status: "confirmed",
              stripe_payment_intent_id: session.payment_intent,
              updated_at: new Date().toISOString()
            }).eq("id", orderId);
          }
          break;
        }
      case "charge.refunded":
        {
          const charge = event.data.object;
          const orderId = charge.metadata?.order_id;
          if (orderId) {
            await supabase.from("orders").update({
              payment_status: "refunded",
              status: "cancelled",
              updated_at: new Date().toISOString()
            }).eq("id", orderId);
          }
          break;
        }
      default:
        console.debug("Unhandled Stripe webhook event:", event.type);
    }
    return new Response(JSON.stringify({
      received: true
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in stripe-webhook:", error);
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
