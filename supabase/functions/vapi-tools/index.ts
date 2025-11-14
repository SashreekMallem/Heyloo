import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@^3.23.8";
import Stripe from "npm:stripe@^16.8.0";
import { nanoid } from "npm:nanoid@^5.0.7";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-vapi-tool-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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
// Helper functions
function roundCurrency(amount) {
  return Math.round(amount * 100) / 100;
}
function verifyVapiToken(request) {
  const token = request.headers.get("x-vapi-tool-token");
  const expectedToken = Deno.env.get("VAPI_TOOL_TOKEN") || Deno.env.get("VAPI_TOOL_AUTH_TOKEN");
  if (!expectedToken) {
    console.error("VAPI_TOOL_TOKEN not configured");
    return false;
  }
  if (token !== expectedToken) {
    console.error(`Token mismatch. Received: ${token?.substring(0, 10)}..., Expected: ${expectedToken.substring(0, 10)}...`);
    return false;
  }
  return true;
}
// Format menu items into natural language for voice reading
function formatMenuForVoice(menuItems) {
  if (!menuItems || menuItems.length === 0) {
    return "We currently don't have any items available on our menu.";
  }
  // Group by category
  const byCategory = {};
  for (const item of menuItems){
    const category = item.category || "Other";
    if (!byCategory[category]) {
      byCategory[category] = [];
    }
    byCategory[category].push(item);
  }
  let formatted = "Here's our menu. ";
  for (const [category, items] of Object.entries(byCategory)){
    formatted += `In ${category}, we have: `;
    for(let i = 0; i < items.length; i++){
      const item = items[i];
      formatted += `${item.name}`;
      if (item.description) {
        formatted += `, which is ${item.description}`;
      }
      formatted += `, for $${parseFloat(item.price).toFixed(2)}`;
      if (i < items.length - 1) {
        formatted += ". ";
      }
    }
    formatted += ". ";
  }
  return formatted.trim();
}
async function listMenuItems(restaurantId, locationId = null) {
  let query = supabase.from("menu_items").select("id,name,description,price,category,is_available").eq("restaurant_id", restaurantId).eq("is_available", true);
  if (locationId) {
    query = query.or(`location_id.eq.${locationId},location_id.is.null`);
  } else {
    query = query.is("location_id", null);
  }
  query = query.order("category", {
    ascending: true
  }).order("name", {
    ascending: true
  });
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load menu items: ${error.message}`);
  return data ?? [];
}
async function findOrCreateCustomer(restaurantId, phoneNumber, fullName) {
  const phone = phoneNumber.replace(/\D/g, "");
  const { data, error } = await supabase.from("customers").select("id,first_name,last_name,email,total_orders,total_spent").eq("restaurant_id", restaurantId).eq("phone_number", phone).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to fetch customer: ${error.message}`);
  if (data) return data;
  const [firstName, ...rest] = (fullName ?? "").split(" ").filter(Boolean);
  const lastName = rest.join(" ") || null;
  const { data: inserted, error: insertError } = await supabase.from("customers").insert({
    restaurant_id: restaurantId,
    phone_number: phone,
    first_name: firstName ?? null,
    last_name: lastName,
    total_orders: 0,
    total_spent: 0
  }).select("id,first_name,last_name,email,total_orders,total_spent").maybeSingle();
  if (insertError || !inserted) {
    throw new Error(`Failed to create customer: ${insertError?.message || "Unknown error"}`);
  }
  return inserted;
}
async function getCustomerAddresses(customerId, restaurantId) {
  const { data, error } = await supabase.from("customer_addresses").select("id,label,street,city,state,postal_code,is_default").eq("customer_id", customerId).eq("restaurant_id", restaurantId).order("is_default", {
    ascending: false
  });
  if (error) throw new Error(`Failed to load customer addresses: ${error.message}`);
  return data ?? [];
}
async function checkOrderStatus(orderId, restaurantId) {
  const { data: order, error } = await supabase.from("orders").select("id,status,payment_status,total,placed_at,customer_name").eq("id", orderId).eq("restaurant_id", restaurantId).maybeSingle();
  if (error) throw new Error(`Failed to fetch order: ${error.message}`);
  if (!order) throw new Error("Order not found");
  const statusMessages = {
    payment_pending: "Waiting for payment. Please check your text message for the payment link.",
    pending: "Your order is being processed",
    confirmed: "Your order has been confirmed and is being prepared",
    preparing: "Your order is being prepared in the kitchen",
    ready: "Your order is ready for pickup!",
    out_for_delivery: "Your order is out for delivery",
    delivered: "Your order has been delivered",
    picked_up: "Your order has been picked up",
    cancelled: "Your order has been cancelled"
  };
  return {
    orderId: order.id,
    status: order.status,
    paymentStatus: order.payment_status,
    message: statusMessages[order.status] || "Your order is being processed",
    total: order.total,
    placedAt: order.placed_at
  };
}
async function sendSMS(to, message) {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!twilioSid || !twilioToken || !twilioPhone) {
    console.warn("Twilio not configured - SMS would be sent in production");
    return true;
  }
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`
      },
      body: new URLSearchParams({
        From: twilioPhone,
        To: to,
        Body: message
      })
    });
    return response.ok;
  } catch (error) {
    console.error("Failed to send SMS:", error);
    return false;
  }
}
async function createOrder(payload, options) {
  const createOrderSchema = z.object({
    restaurantId: z.string().uuid(),
    customerPhone: z.string(),
    customerName: z.string().optional(),
    orderType: z.enum([
      "delivery",
      "pickup"
    ]),
    items: z.array(z.object({
      menuItemId: z.string().uuid(),
      quantity: z.number().int().positive(),
      modifiers: z.array(z.object({
        name: z.string(),
        priceDelta: z.number()
      })).optional()
    })),
    deliveryAddressId: z.string().uuid().optional(),
    paymentMethod: z.enum([
      "stripe_link",
      "cash",
      "card"
    ])
  });
  const parsed = createOrderSchema.parse(payload);
  // Get restaurant
  const { data: restaurant, error: restaurantError } = await supabase.from("restaurants").select("id,name,tax_rate,delivery_fee,stripe_account_id,stripe_customer_id,pos_type,pos_location_id,manager_phone").eq("id", parsed.restaurantId).maybeSingle();
  if (restaurantError || !restaurant) {
    throw new Error("Restaurant not found");
  }
  // Get or create customer
  const customer = await findOrCreateCustomer(parsed.restaurantId, parsed.customerPhone, parsed.customerName);
  // Get menu items
  const menuItemIds = parsed.items.map((item)=>item.menuItemId);
  const { data: menuItems, error: menuError } = await supabase.from("menu_items").select("id,name,price,is_available").eq("restaurant_id", parsed.restaurantId).in("id", menuItemIds);
  if (menuError || !menuItems || menuItems.length !== parsed.items.length) {
    throw new Error("One or more menu items are unavailable");
  }
  // Calculate totals
  const items = parsed.items.map((item)=>{
    const menuItem = menuItems.find((m)=>m.id === item.menuItemId);
    if (!menuItem) throw new Error("Menu item missing");
    const modifiers = item.modifiers?.map((mod)=>({
        name: mod.name,
        priceDelta: mod.priceDelta
      })) ?? [];
    const modifiersTotal = modifiers.reduce((sum, mod)=>sum + mod.priceDelta, 0);
    const unitPrice = roundCurrency(menuItem.price + modifiersTotal);
    const lineTotal = roundCurrency(unitPrice * item.quantity);
    return {
      menuItemId: item.menuItemId,
      name: menuItem.name,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      modifiers
    };
  });
  const subtotal = roundCurrency(items.reduce((sum, item)=>sum + item.lineTotal, 0));
  const tax = roundCurrency(subtotal * restaurant.tax_rate);
  const deliveryFee = parsed.orderType === "delivery" ? roundCurrency(restaurant.delivery_fee) : 0;
  const total = roundCurrency(subtotal + tax + deliveryFee);
  // Handle Stripe payment if needed
  let stripePaymentLink = null;
  let stripePaymentIntentId = null;
  if (parsed.paymentMethod === "stripe_link" && stripe) {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "usd",
      customer: restaurant.stripe_customer_id ?? undefined,
      metadata: {
        restaurant_id: parsed.restaurantId,
        customer_phone: parsed.customerPhone,
        source: options.source ?? "vapi"
      },
      description: `${restaurant.name} voice order`
    }, restaurant.stripe_account_id ? {
      stripeAccount: restaurant.stripe_account_id
    } : undefined);
    stripePaymentIntentId = paymentIntent.id;
    const price = await stripe.prices.create({
      currency: "usd",
      unit_amount: Math.round(total * 100),
      product_data: {
        name: `Order from ${restaurant.name}`
      }
    }, restaurant.stripe_account_id ? {
      stripeAccount: restaurant.stripe_account_id
    } : undefined);
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price: price.id,
          quantity: 1
        }
      ],
      metadata: {
        restaurant_id: parsed.restaurantId,
        order_reference: nanoid(10)
      }
    }, restaurant.stripe_account_id ? {
      stripeAccount: restaurant.stripe_account_id
    } : undefined);
    stripePaymentLink = paymentLink.url;
    // Send payment link SMS
    if (stripePaymentLink) {
      const message = `Hi! Your order from ${restaurant.name} totaling $${total.toFixed(2)} is ready. Please complete payment here: ${stripePaymentLink}`;
      await sendSMS(parsed.customerPhone, message).catch(()=>{});
    }
  }
  // Determine location_id
  let locationId = options.locationId || null;
  if (!locationId && options.callId) {
    const { data: callLog } = await supabase.from("call_logs").select("location_id").eq("call_id", options.callId).maybeSingle();
    if (callLog?.location_id) locationId = callLog.location_id;
  }
  // Create order
  const { data: insertedOrder, error: insertError } = await supabase.from("orders").insert({
    restaurant_id: parsed.restaurantId,
    location_id: locationId,
    customer_id: customer.id,
    customer_phone: parsed.customerPhone,
    customer_name: parsed.customerName ?? null,
    order_type: parsed.orderType,
    delivery_address_id: parsed.deliveryAddressId ?? null,
    status: parsed.paymentMethod === "stripe_link" ? "payment_pending" : "pending",
    payment_status: parsed.paymentMethod === "stripe_link" ? "pending" : "paid",
    payment_method: parsed.paymentMethod,
    pos_sync_status: "pending",
    pos_sync_attempts: 0,
    subtotal,
    tax,
    delivery_fee: deliveryFee,
    total,
    items,
    stripe_payment_link: stripePaymentLink,
    stripe_payment_intent_id: stripePaymentIntentId,
    payment_link_sent_at: stripePaymentLink ? new Date().toISOString() : null,
    call_id: options.callId ?? null,
    source: options.source ?? "vapi"
  }).select("id,restaurant_id,customer_id,status,payment_status,subtotal,tax,delivery_fee,total,payment_method,stripe_payment_link,stripe_payment_intent_id,items,placed_at,updated_at").maybeSingle();
  if (insertError || !insertedOrder) {
    throw new Error("Failed to create order");
  }
  // Update customer totals and record usage
  await supabase.rpc("increment_customer_totals", {
    p_customer_id: customer.id,
    p_order_total: total
  });
  await supabase.rpc("record_order_usage", {
    p_restaurant_id: parsed.restaurantId,
    p_order_total: total,
    p_order_type: parsed.orderType
  });
  // Push to POS or send SMS notification (async)
  if (parsed.paymentMethod !== "stripe_link") {
    if (restaurant.pos_type && restaurant.pos_type !== "none") {
      // Call POS push function async
      fetch(`${supabaseUrl}/functions/v1/pos-push`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${supabaseServiceKey}`
        },
        body: JSON.stringify({
          orderId: insertedOrder.id,
          restaurantId: parsed.restaurantId
        })
      }).catch(()=>{});
    } else if (restaurant.manager_phone) {
      const itemsList = items.map((item)=>`${item.quantity}x ${item.name} ($${item.lineTotal})`).join("\n");
      const message = `🔔 NEW ORDER #${insertedOrder.id.slice(0, 8)}\n\n${restaurant.name}\n\nCustomer: ${parsed.customerName || parsed.customerPhone}\nPhone: ${parsed.customerPhone}\nType: ${parsed.orderType.toUpperCase()}\nPayment: ${parsed.paymentMethod}\n\nItems:\n${itemsList}\n\nSubtotal: $${subtotal}\nTax: $${tax}\n${deliveryFee > 0 ? `Delivery: $${deliveryFee}\n` : ""}Total: $${total}`;
      await sendSMS(restaurant.manager_phone, message).catch(()=>{});
    }
  }
  return insertedOrder;
}
// Main handler
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (!verifyVapiToken(req)) {
    return new Response(JSON.stringify({
      error: "Unauthorized VAPI tool request",
      code: "UNAUTHORIZED"
    }), {
      status: 401,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const url = new URL(req.url);
    let path = url.pathname;
    if (path.startsWith("/vapi-tools")) {
      path = path.replace("/vapi-tools", "");
    }
    if (path === "") path = "/";
    const method = req.method;
    const body = await req.json().catch(()=>({}));
    // Debug logging
    console.log("VAPI Tool Request:", {
      path,
      method,
      hasMessage: !!body?.message,
      messageType: body?.message?.type,
      hasToolCallList: !!body?.message?.toolCallList,
      toolCallListLength: body?.message?.toolCallList?.length,
      bodyKeys: Object.keys(body),
      firstToolCall: body?.message?.toolCallList?.[0]
    });
    // Check if this is a VAPI tool call format (has message.toolCallList)
    // According to VAPI docs: https://docs.vapi.ai/tools-calling
    // VAPI sends: { message: { type: "tool-calls", toolCallList: [...] } }
    // We should return: { results: [{ toolCallId: "...", result: "..." }] }
    const isVapiToolCall = body?.message?.type === "tool-calls" && body?.message?.toolCallList;
    if (isVapiToolCall) {
      console.log("Handling VAPI tool call format");
      // Handle VAPI tool call format (from Server URL)
      const toolCalls = body.message.toolCallList || [];
      const results = [];
      for (const toolCall of toolCalls){
        const toolCallId = toolCall.id;
        const toolName = toolCall.name;
        const args = toolCall.arguments || {};
        console.log(`Processing tool: ${toolName}, ID: ${toolCallId}, args:`, args);
        try {
          let result;
          if (toolName === "get_menu") {
            const restaurantId = args.restaurantId;
            const locationId = args.locationId || args.location_id || null;
            console.log(`Getting menu for restaurant: ${restaurantId}, location: ${locationId}`);
            const menu = await listMenuItems(restaurantId, locationId);
            const formattedMenu = formatMenuForVoice(menu);
            result = formattedMenu;
            console.log(`Menu retrieved: ${menu.length} items, formatted length: ${formattedMenu.length}`);
          } else if (toolName === "find_or_create_customer") {
            const customer = await findOrCreateCustomer(args.restaurantId, args.phoneNumber, args.name);
            const greeting = customer.first_name ? `Welcome back ${customer.first_name}!` : "Welcome! I've set up your account.";
            result = `${greeting} Your customer ID is ${customer.id}.`;
          } else if (toolName === "get_customer_addresses") {
            const addresses = await getCustomerAddresses(args.customerId, args.restaurantId);
            if (addresses.length === 0) {
              result = "You don't have any saved addresses. Please provide your delivery address.";
            } else {
              result = `You have ${addresses.length} saved address${addresses.length > 1 ? "es" : ""}: `;
              addresses.forEach((addr, idx)=>{
                result += `${idx + 1}. ${addr.label || "Address"} at ${addr.street}, ${addr.city}, ${addr.state} ${addr.postal_code}`;
                if (idx < addresses.length - 1) result += ". ";
              });
            }
          } else if (toolName === "create_order") {
            const locationId = args.locationId || args.location_id || null;
            const callId = body.message?.call?.id || null;
            const order = await createOrder(args, {
              source: "vapi",
              locationId,
              callId
            });
            result = `Order created successfully! Your order ID is ${order.id}. Total: $${order.total.toFixed(2)}. ${order.stripe_payment_link ? "A payment link has been sent to your phone." : ""}`;
          } else if (toolName === "check_order_status") {
            const status = await checkOrderStatus(args.orderId, args.restaurantId);
            result = status.message;
          } else {
            console.error(`Unknown tool name: ${toolName}`);
            result = `Tool ${toolName} is not implemented`;
          }
          results.push({
            toolCallId,
            result: String(result)
          });
        } catch (error) {
          console.error(`Tool execution error for ${toolName}:`, error);
          results.push({
            toolCallId,
            error: error.message || "Tool execution failed"
          });
        }
      }
      console.log(`Returning results:`, results);
      // Return VAPI format: { results: [{ toolCallId, result }] }
      return new Response(JSON.stringify({
        results
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    // Handle direct tool calls via server.url (when VAPI sends just arguments)
    // This is a fallback for when VAPI sends arguments directly without message wrapper
    // But we still return the VAPI format: { results: [{ toolCallId, result }] }
    console.log("Handling direct tool call (not message.toolCallList format)");
    if (method === "POST" && path === "/menu") {
      console.log("POST /menu - body:", body);
      const menuSchema = z.object({
        restaurantId: z.string().uuid(),
        locationId: z.string().uuid().optional().nullable(),
        location_id: z.string().uuid().optional().nullable()
      });
      try {
        const parsed = menuSchema.parse(body);
        const locationId = parsed.locationId || parsed.location_id || null;
        console.log(`Direct menu call - restaurant: ${parsed.restaurantId}, location: ${locationId}`);
        const menu = await listMenuItems(parsed.restaurantId, locationId);
        const formattedMenu = formatMenuForVoice(menu);
        // Return VAPI format even for direct calls
        // Generate a toolCallId if not provided (for backward compatibility)
        const toolCallId = body.toolCallId || body.id || nanoid(10);
        console.log(`Direct menu call - returning ${menu.length} items, toolCallId: ${toolCallId}`);
        return new Response(JSON.stringify({
          results: [
            {
              toolCallId,
              result: formattedMenu
            }
          ]
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      } catch (parseError) {
        console.error("Menu schema validation error:", parseError);
        throw parseError;
      }
    }
    if (method === "GET" && path === "/menu") {
      const restaurantId = url.searchParams.get("restaurantId");
      if (!restaurantId) {
        return new Response(JSON.stringify({
          error: "restaurantId is required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const locationId = url.searchParams.get("locationId") || url.searchParams.get("location_id") || null;
      const menu = await listMenuItems(restaurantId, locationId);
      const formattedMenu = formatMenuForVoice(menu);
      return new Response(JSON.stringify({
        items: menu,
        description: formattedMenu
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path === "/customer") {
      const findCustomerSchema = z.object({
        restaurantId: z.string().uuid(),
        phoneNumber: z.string(),
        name: z.string().optional()
      });
      const parsed = findCustomerSchema.parse(body);
      const customer = await findOrCreateCustomer(parsed.restaurantId, parsed.phoneNumber, parsed.name);
      const greeting = customer.first_name ? `Welcome back ${customer.first_name}!` : "Welcome! I've set up your account.";
      const result = `${greeting} Your customer ID is ${customer.id}.`;
      const toolCallId = body.toolCallId || body.id || nanoid(10);
      return new Response(JSON.stringify({
        results: [
          {
            toolCallId,
            result
          }
        ]
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path === "/customer-addresses") {
      const customerAddressesSchema = z.object({
        restaurantId: z.string().uuid(),
        customerId: z.string().uuid()
      });
      const parsed = customerAddressesSchema.parse(body);
      const addresses = await getCustomerAddresses(parsed.customerId, parsed.restaurantId);
      let result;
      if (addresses.length === 0) {
        result = "You don't have any saved addresses. Please provide your delivery address.";
      } else {
        result = `You have ${addresses.length} saved address${addresses.length > 1 ? "es" : ""}: `;
        addresses.forEach((addr, idx)=>{
          result += `${idx + 1}. ${addr.label || "Address"} at ${addr.street}, ${addr.city}, ${addr.state} ${addr.postal_code}`;
          if (idx < addresses.length - 1) result += ". ";
        });
      }
      const toolCallId = body.toolCallId || body.id || nanoid(10);
      return new Response(JSON.stringify({
        results: [
          {
            toolCallId,
            result
          }
        ]
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "GET" && path === "/customer-addresses") {
      const restaurantId = url.searchParams.get("restaurantId");
      const customerId = url.searchParams.get("customerId");
      if (!restaurantId || !customerId) {
        return new Response(JSON.stringify({
          error: "restaurantId and customerId are required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const addresses = await getCustomerAddresses(customerId, restaurantId);
      return new Response(JSON.stringify({
        addresses
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path === "/orders") {
      const locationId = body.locationId || body.location_id || null;
      const callId = body.callId || null;
      const order = await createOrder(body, {
        source: "vapi",
        locationId,
        callId
      });
      const result = `Order created successfully! Your order ID is ${order.id}. Total: $${order.total.toFixed(2)}. ${order.stripe_payment_link ? "A payment link has been sent to your phone." : ""}`;
      const toolCallId = body.toolCallId || body.id || nanoid(10);
      return new Response(JSON.stringify({
        results: [
          {
            toolCallId,
            result
          }
        ]
      }), {
        status: 201,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path === "/orders/status") {
      const checkOrderStatusSchema = z.object({
        restaurantId: z.string().uuid(),
        orderId: z.string().uuid()
      });
      const parsed = checkOrderStatusSchema.parse(body);
      const status = await checkOrderStatus(parsed.orderId, parsed.restaurantId);
      const toolCallId = body.toolCallId || body.id || nanoid(10);
      return new Response(JSON.stringify({
        results: [
          {
            toolCallId,
            result: status.message
          }
        ]
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "GET" && path.startsWith("/orders/") && path.endsWith("/status")) {
      const orderId = path.split("/")[2];
      const restaurantId = url.searchParams.get("restaurantId");
      if (!restaurantId) {
        return new Response(JSON.stringify({
          error: "restaurantId is required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const result = await checkOrderStatus(orderId, restaurantId);
      return new Response(JSON.stringify(result), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    console.error("No handler found for path:", path, "method:", method);
    return new Response(JSON.stringify({
      error: "Not found",
      path,
      method
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error"
    }), {
      status: error.status || 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
});
