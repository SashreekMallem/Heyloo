import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@^3.23.8";
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
// Helper functions
function roundCurrency(amount) {
  return Math.round(amount * 100) / 100;
}
// Validate restaurantId is a valid UUID
function validateRestaurantId(restaurantId) {
  if (!restaurantId) {
    throw new Error("restaurantId is required");
  }
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(restaurantId)) {
    throw new Error(`Invalid restaurantId format. Expected UUID, got: ${restaurantId}`);
  }
  return restaurantId;
}
function verifyVapiToken(request) {
  // Check multiple possible header names that Vapi might use
  const token = request.headers.get("x-vapi-tool-token") || 
                request.headers.get("x-vapi-secret") ||
                request.headers.get("authorization")?.replace("Bearer ", "") ||
                request.headers.get("authorization")?.replace("bearer ", "");
  const expectedToken = Deno.env.get("VAPI_TOOL_TOKEN") || Deno.env.get("VAPI_TOOL_AUTH_TOKEN");
  
  // If no token is configured, allow requests (for development)
  if (!expectedToken) {
    console.warn("VAPI_TOOL_TOKEN not configured, allowing request");
    return true;
  }
  
  // If we have an expected token but no token in request, check if this is a Vapi tool call
  // Vapi might not send auth headers when using server URLs without credentialId
  if (!token) {
    console.warn("No authentication token found in headers");
    console.warn("This might be a Vapi tool call without credentialId configured");
    console.warn("Allowing request for now - configure credentialId in Vapi for production");
    // TEMPORARY: Allow requests without token to debug
    // TODO: Configure credentialId in Vapi tool definitions
    return true;
  }
  
  if (token !== expectedToken) {
    console.error(`Token mismatch. Received: ${token?.substring(0, 10)}..., Expected: ${expectedToken.substring(0, 10)}...`);
    return false;
  }
  return true;
}
// Format menu items into natural language for voice reading, including IDs for order creation
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
      // Include ID in parentheses so Vapi can extract it for order creation
      formatted += ` (ID: ${item.id})`;
      if (i < items.length - 1) {
        formatted += ". ";
      }
    }
    formatted += ". ";
  }
  return formatted.trim();
}
async function listMenuItems(restaurantId, locationId = null) {
  validateRestaurantId(restaurantId);
  let query = supabase.from("menu_items").select("id,name,description,price,category,is_available").eq("restaurant_id", restaurantId).eq("is_available", true);
  // If locationId is provided, filter by that location OR items available at all locations (location_id IS NULL)
  // If locationId is null, return ALL items for the restaurant (both location-specific and general items)
  if (locationId) {
    query = query.or(`location_id.eq.${locationId},location_id.is.null`);
  }
  // When locationId is null, don't filter by location_id - return all items
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
  validateRestaurantId(restaurantId);
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
  validateRestaurantId(restaurantId);
  const { data, error } = await supabase.from("customer_addresses").select("id,label,street,city,state,postal_code,is_default").eq("customer_id", customerId).eq("restaurant_id", restaurantId).order("is_default", {
    ascending: false
  });
  if (error) throw new Error(`Failed to load customer addresses: ${error.message}`);
  return data ?? [];
}
async function checkOrderStatus(orderId, restaurantId, customerPhone = null) {
  validateRestaurantId(restaurantId);
  let order;
  // If orderId is provided, look up by ID
  if (orderId) {
    const { data, error } = await supabase.from("orders").select("id,status,payment_status,total,placed_at,customer_name,customer_phone").eq("id", orderId).eq("restaurant_id", restaurantId).maybeSingle();
    if (error) throw new Error(`Failed to fetch order: ${error.message}`);
    if (!data) throw new Error("Order not found");
    order = data;
  } 
  // If customerPhone is provided but no orderId, find most recent order by phone
  else if (customerPhone) {
    // Normalize phone: try multiple formats
    let phone = String(customerPhone).trim();
    // Remove all non-digit characters except +
    let digitsOnly = phone.replace(/[^\d+]/g, "");
    
    // Try multiple phone formats
    const phoneFormats = [];
    
    // Format 1: With + prefix (E.164 format)
    if (digitsOnly.startsWith("+")) {
      phoneFormats.push(digitsOnly);
      phoneFormats.push(digitsOnly.substring(1)); // Without +
    } else {
      // Format 2: Add + prefix
      phoneFormats.push(`+${digitsOnly}`);
      phoneFormats.push(digitsOnly); // Without +
    }
    
    // Format 3: If it looks like US number (10 digits), try with +1
    if (digitsOnly.replace("+", "").length === 10) {
      const usNumber = digitsOnly.replace("+", "");
      phoneFormats.push(`+1${usNumber}`);
      phoneFormats.push(`1${usNumber}`);
    }
    
    // Remove duplicates
    const uniqueFormats = [...new Set(phoneFormats)];
    
    console.log(`Searching for orders with phone formats: ${uniqueFormats.join(", ")}`);
    
    let data = null;
    let error = null;
    
    // Try each format until we find a match
    for (const phoneFormat of uniqueFormats) {
      const result = await supabase
        .from("orders")
        .select("id,status,payment_status,total,placed_at,customer_name,customer_phone")
        .eq("restaurant_id", restaurantId)
        .eq("customer_phone", phoneFormat)
        .order("placed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (result.data) {
        data = result.data;
        console.log(`Found order with phone format: ${phoneFormat}`);
        break;
      }
      if (result.error) {
        error = result.error;
      }
    }
    
    if (error) throw new Error(`Failed to fetch order: ${error.message}`);
    if (!data) {
      // Provide helpful error message
      throw new Error(`No recent orders found for phone number ${customerPhone}. Please check your phone number or provide an order ID.`);
    }
    order = data;
  } else {
    throw new Error("Either orderId or customerPhone must be provided");
  }
  const statusMessages = {
    payment_pending: "Your order is pending payment",
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
async function createOrFindAddress(restaurantId, customerId, addressData) {
  if (!addressData || !addressData.street || !addressData.city || !addressData.state || !addressData.postalCode) {
    return null;
  }
  // Check if address already exists for this customer
  const { data: existingAddress } = await supabase
    .from("customer_addresses")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("customer_id", customerId)
    .eq("street", addressData.street.trim())
    .eq("city", addressData.city.trim())
    .eq("state", addressData.state.trim())
    .eq("postal_code", addressData.postalCode.trim())
    .maybeSingle();
  
  if (existingAddress) {
    return existingAddress.id;
  }
  
  // Check if customer has any addresses (to determine if this should be default)
  const { data: existingAddresses } = await supabase
    .from("customer_addresses")
    .select("id")
    .eq("restaurant_id", restaurantId)
    .eq("customer_id", customerId)
    .limit(1);
  
  const isDefault = !existingAddresses || existingAddresses.length === 0;
  
  // Create new address
  const { data: newAddress, error: addressError } = await supabase
    .from("customer_addresses")
    .insert({
      restaurant_id: restaurantId,
      customer_id: customerId,
      street: addressData.street.trim(),
      city: addressData.city.trim(),
      state: addressData.state.trim(),
      postal_code: addressData.postalCode.trim(),
      label: addressData.label || null,
      delivery_instructions: addressData.deliveryInstructions || null,
      is_default: isDefault
    })
    .select("id")
    .maybeSingle();
  
  if (addressError || !newAddress) {
    console.error("Failed to create address:", addressError);
    throw new Error(`Failed to create delivery address: ${addressError?.message || "Unknown error"}`);
  }
  
  return newAddress.id;
}

async function createOrder(payload, options) {
  const createOrderSchema = z.object({
    restaurantId: z.string().uuid(),
    customerPhone: z.string(),
    customerId: z.string().uuid().optional(),
    customerName: z.string().optional(),
    orderType: z.enum([
      "delivery",
      "pickup"
    ]),
    items: z.array(z.object({
      menuItemId: z.string().uuid(),
      quantity: z.number().int().positive(),
      specialInstructions: z.string().optional(),
      modifiers: z.array(z.object({
        name: z.string(),
        priceDelta: z.number()
      })).optional()
    })),
    deliveryAddressId: z.string().uuid().optional(),
    // New: Accept raw address data for delivery orders
    deliveryAddress: z.object({
      street: z.string(),
      city: z.string(),
      state: z.string(),
      postalCode: z.string(),
      label: z.string().optional(),
      deliveryInstructions: z.string().optional()
    }).optional(),
    paymentMethod: z.enum([
      "cash",
      "card_on_delivery"
    ])
  });
  const parsed = createOrderSchema.parse(payload);
  validateRestaurantId(parsed.restaurantId);
  // Get restaurant
  const { data: restaurant, error: restaurantError } = await supabase.from("restaurants").select("id,name,tax_rate,delivery_fee,pos_type,pos_location_id,manager_phone").eq("id", parsed.restaurantId).maybeSingle();
  if (restaurantError || !restaurant) {
    throw new Error("Restaurant not found");
  }
  // Get or create customer (use customerId if provided, otherwise find/create by phone)
  let customer;
  if (payload.customerId) {
    const { data: existingCustomer, error: customerError } = await supabase.from("customers").select("id,first_name,last_name,email,total_orders,total_spent").eq("id", payload.customerId).eq("restaurant_id", parsed.restaurantId).maybeSingle();
    if (customerError || !existingCustomer) {
      throw new Error("Customer not found");
    }
    customer = existingCustomer;
  } else {
    customer = await findOrCreateCustomer(parsed.restaurantId, parsed.customerPhone, parsed.customerName);
  }
  
  // Handle delivery address: create/find address if delivery order and address data provided
  let deliveryAddressId = parsed.deliveryAddressId || null;
  if (parsed.orderType === "delivery" && !deliveryAddressId && parsed.deliveryAddress) {
    try {
      deliveryAddressId = await createOrFindAddress(parsed.restaurantId, customer.id, parsed.deliveryAddress);
      console.log(`Created/found delivery address: ${deliveryAddressId}`);
    } catch (error) {
      console.error("Failed to create address:", error);
      throw new Error(`Delivery address is required for delivery orders: ${error.message}`);
    }
  }
  
  // Validate: delivery orders must have an address
  if (parsed.orderType === "delivery" && !deliveryAddressId) {
    throw new Error("Delivery address is required for delivery orders. Please provide deliveryAddressId or deliveryAddress.");
  }
  // Get menu items
  const menuItemIds = parsed.items.map((item)=>item.menuItemId);
  console.log(`Looking up menu items for order:`, {
    restaurantId: parsed.restaurantId,
    requestedMenuItemIds: menuItemIds,
    itemCount: parsed.items.length
  });
  const { data: menuItems, error: menuError } = await supabase.from("menu_items").select("id,name,price,is_available").eq("restaurant_id", parsed.restaurantId).in("id", menuItemIds);
  
  if (menuError) {
    console.error("Menu items query error:", menuError);
    throw new Error(`Failed to fetch menu items: ${menuError.message}`);
  }
  
  if (!menuItems || menuItems.length === 0) {
    console.error(`No menu items found for IDs: ${menuItemIds.join(", ")}`);
    throw new Error(`No menu items found for the provided IDs: ${menuItemIds.join(", ")}`);
  }
  
  // Check if all requested items were found
  const foundIds = new Set(menuItems.map(m => m.id));
  const missingIds = menuItemIds.filter(id => !foundIds.has(id));
  if (missingIds.length > 0) {
    console.error(`Menu items not found: ${missingIds.join(", ")}`);
    throw new Error(`Menu items not found: ${missingIds.join(", ")}`);
  }
  
  // Check if all items are available
  const unavailableItems = menuItems.filter(m => !m.is_available);
  if (unavailableItems.length > 0) {
    const unavailableNames = unavailableItems.map(m => m.name).join(", ");
    console.error(`Unavailable items: ${unavailableNames}`);
    throw new Error(`The following items are currently unavailable: ${unavailableNames}`);
  }
  
  console.log(`Successfully found ${menuItems.length} menu items`);
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
      modifiers,
      specialInstructions: item.specialInstructions || null
    };
  });
  const subtotal = roundCurrency(items.reduce((sum, item)=>sum + item.lineTotal, 0));
  const tax = roundCurrency(subtotal * restaurant.tax_rate);
  const deliveryFee = parsed.orderType === "delivery" ? roundCurrency(restaurant.delivery_fee) : 0;
  const total = roundCurrency(subtotal + tax + deliveryFee);
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
    delivery_address_id: deliveryAddressId,
    status: "pending",
    payment_status: "paid",
    payment_method: parsed.paymentMethod,
    pos_sync_status: "pending",
    pos_sync_attempts: 0,
    subtotal,
    tax,
    delivery_fee: deliveryFee,
    total,
    items,
    call_id: options.callId ?? null,
    source: options.source ?? "vapi"
  }).select("id,restaurant_id,customer_id,status,payment_status,subtotal,tax,delivery_fee,total,payment_method,items,placed_at,updated_at").maybeSingle();
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
  // Check if restaurant has POS configured (check restaurant_pos_locations table)
  const { data: posLocation } = await supabase
    .from("restaurant_pos_locations")
    .select("id,pos_type")
    .eq("restaurant_id", parsed.restaurantId)
    .eq("is_primary", true)
    .maybeSingle();
  
  // Push to POS or send SMS notification (async)
  if (posLocation && posLocation.pos_type && posLocation.pos_type !== "none") {
    // Call POS push function async
    console.log(`Pushing order ${insertedOrder.id} to POS (${posLocation.pos_type})`);
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
    }).catch((error) => {
      console.error(`Failed to push order to POS:`, error);
    });
  } else if (restaurant.manager_phone) {
    const itemsList = items.map((item)=>`${item.quantity}x ${item.name} ($${item.lineTotal})`).join("\n");
    const message = `🔔 NEW ORDER #${insertedOrder.id.slice(0, 8)}\n\n${restaurant.name}\n\nCustomer: ${parsed.customerName || parsed.customerPhone}\nPhone: ${parsed.customerPhone}\nType: ${parsed.orderType.toUpperCase()}\nPayment: ${parsed.paymentMethod}\n\nItems:\n${itemsList}\n\nSubtotal: $${subtotal}\nTax: $${tax}\n${deliveryFee > 0 ? `Delivery: $${deliveryFee}\n` : ""}Total: $${total}`;
    await sendSMS(restaurant.manager_phone, message).catch(()=>{});
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
  // Log all headers for debugging
  console.log("=== VAPI TOOLS REQUEST ===");
  console.log("URL:", req.url);
  console.log("Method:", req.method);
  const allHeaders = Object.fromEntries(req.headers.entries());
  console.log("All Headers:", JSON.stringify(allHeaders, null, 2));
  const token = req.headers.get("x-vapi-tool-token");
  const expectedToken = Deno.env.get("VAPI_TOOL_TOKEN") || Deno.env.get("VAPI_TOOL_AUTH_TOKEN");
  console.log("Token received:", token ? `${token.substring(0, 10)}...` : "NONE");
  console.log("Token expected:", expectedToken ? `${expectedToken.substring(0, 10)}...` : "NONE");
  
  if (!verifyVapiToken(req)) {
    console.error("Authentication failed!");
    return new Response(JSON.stringify({
      error: "Unauthorized VAPI tool request",
      code: "UNAUTHORIZED",
      debug: {
        hasToken: !!token,
        hasExpectedToken: !!expectedToken,
        tokenMatch: token === expectedToken
      }
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
    // Check if this is a VAPI tool call format (has message.toolCallList or toolWithToolCallList)
    // According to VAPI docs: https://docs.vapi.ai/tools-calling
    // VAPI sends: { message: { type: "tool-calls", toolCallList: [...] } }
    // We should return: { results: [{ toolCallId: "...", result: "..." }] }
    const isVapiToolCall = body?.message?.type === "tool-calls" && (body?.message?.toolCallList || body?.message?.toolWithToolCallList);
    if (isVapiToolCall) {
      console.log("Handling VAPI tool call format");
      // Handle VAPI tool call format (from Server URL)
      // Prefer toolCallList, fallback to toolWithToolCallList
      let toolCalls = body.message.toolCallList || [];
      if (toolCalls.length === 0 && body.message.toolWithToolCallList) {
        // Extract tool calls from toolWithToolCallList format
        toolCalls = body.message.toolWithToolCallList.map((toolWithCall) => {
          const toolCall = toolWithCall.toolCall || toolWithCall;
          return {
            id: toolCall.id,
            name: toolWithCall.name || toolCall.function?.name,
            arguments: toolCall.function?.parameters || toolCall.parameters || toolWithCall.parameters || {}
          };
        }).filter(tc => tc.id && tc.name);
      }
      const results = [];
      for (const toolCall of toolCalls){
        // Extract toolCallId - must be present and match exactly
        const toolCallId = toolCall.id || toolCall.toolCallId;
        if (!toolCallId) {
          console.error("Tool call missing ID:", toolCall);
          results.push({
            toolCallId: "unknown",
            error: "Tool call missing ID"
          });
          continue;
        }
        const toolName = toolCall.name || toolCall.function?.name;
        if (!toolName) {
          console.error("Tool call missing name:", toolCall);
          results.push({
            toolCallId,
            error: "Tool call missing name"
          });
          continue;
        }
        // Handle arguments as both object and JSON string (per Vapi docs)
        // Also check toolCall.function.arguments as alternative format
        let args = toolCall.arguments || toolCall.function?.arguments || {};
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch (e) {
            console.error(`Failed to parse arguments as JSON: ${args}`, e);
            args = {};
          }
        }
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
            result = `Order created successfully! Your order ID is ${order.id}. Total: $${order.total.toFixed(2)}.`;
          } else if (toolName === "check_order_status") {
            // Support both orderId and customerPhone (for phone number lookup)
            const orderId = args.orderId || null;
            const customerPhone = args.customerPhone || args.phoneNumber || null;
            console.log(`Checking order status - orderId: ${orderId}, customerPhone: ${customerPhone}, restaurantId: ${args.restaurantId}`);
            const status = await checkOrderStatus(orderId, args.restaurantId, customerPhone);
            result = `${status.message} Your order total is $${status.total.toFixed(2)}.`;
          } else {
            console.error(`Unknown tool name: ${toolName}`);
            result = `Tool ${toolName} is not implemented`;
          }
          // Ensure result is a single-line string (no line breaks per Vapi docs)
          const resultString = String(result).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
          results.push({
            toolCallId,
            result: resultString
          });
        } catch (error) {
          console.error(`Tool execution error for ${toolName}:`, error);
          // Ensure error is a single-line string (no line breaks per Vapi docs)
          const errorString = (error.message || "Tool execution failed").replace(/\n/g, " ").replace(/\s+/g, " ").trim();
          results.push({
            toolCallId,
            error: errorString
          });
        }
      }
      // Ensure we have results for all tool calls
      if (results.length === 0 && toolCalls.length > 0) {
        console.error("No results generated for tool calls:", toolCalls);
        // Return error for all tool calls
        for (const toolCall of toolCalls) {
          const toolCallId = toolCall.id || toolCall.toolCallId || "unknown";
          results.push({
            toolCallId,
            error: "Tool execution failed - no result generated"
          });
        }
      }
      console.log(`Returning results:`, results);
      // Return VAPI format: { results: [{ toolCallId, result }] }
      // Always return HTTP 200 even for errors (per Vapi docs)
      return new Response(JSON.stringify({
        results
      }), {
        status: 200,
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
      const menu = await listMenuItems(restaurantId, locationId || null);
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
      const result = `Order created successfully! Your order ID is ${order.id}. Total: $${order.total.toFixed(2)}.`;
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
        orderId: z.string().uuid().optional(),
        customerPhone: z.string().optional(),
        phoneNumber: z.string().optional()
      });
      const parsed = checkOrderStatusSchema.parse(body);
      const orderId = parsed.orderId || null;
      const customerPhone = parsed.customerPhone || parsed.phoneNumber || null;
      const status = await checkOrderStatus(orderId, parsed.restaurantId, customerPhone);
      const toolCallId = body.toolCallId || body.id || nanoid(10);
      return new Response(JSON.stringify({
        results: [
          {
            toolCallId,
            result: `${status.message} Your order total is $${status.total.toFixed(2)}.`
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
