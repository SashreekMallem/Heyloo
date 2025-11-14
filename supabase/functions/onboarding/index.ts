import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@^2.39.3";
import bcrypt from "npm:bcryptjs@^2.4.3";
import jwt from "npm:jsonwebtoken@^9.0.2";
import { nanoid } from "npm:nanoid@^5.0.7";
import axios from "npm:axios@^1.7.7";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS"
};
const htmlHeaders = {
  ...corsHeaders,
  "Content-Type": "text/html; charset=utf-8"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const edgeFunctionsBase = supabaseUrl.replace("/rest/v1", "");
function getFrontendUrl(fallbackUrl) {
  if (fallbackUrl) return fallbackUrl;
  const envUrl = Deno.env.get("FRONTEND_URL");
  if (envUrl) return envUrl;
  if (supabaseUrl.includes(".supabase.co")) {
    return "https://your-frontend-domain.com";
  }
  return "http://localhost:5173";
}
function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").substring(0, 50);
}
async function onboardRestaurant(payload) {
  const slug = payload.restaurantSlug ?? generateSlug(payload.restaurantName);
  const { data: existingRestaurant } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
  if (existingRestaurant) throw Object.assign(new Error("Restaurant slug already exists"), {
    status: 400,
    code: "SLUG_EXISTS"
  });
  const { data: existingUser } = await supabase.from("app_users").select("id").eq("email", payload.ownerEmail).maybeSingle();
  if (existingUser) throw Object.assign(new Error("Email already exists"), {
    status: 400,
    code: "EMAIL_EXISTS"
  });
  const { data: restaurant, error: restaurantError } = await supabase.from("restaurants").insert({
    name: payload.restaurantName,
    slug,
    phone_number: payload.phoneNumber ?? null,
    owner_email: payload.ownerEmail,
    subscription_status: "trial",
    pos_type: payload.posType ?? "none",
    pos_location_id: payload.posLocationId ?? null,
    tax_rate: payload.taxRate ?? 0.0825,
    delivery_fee: payload.deliveryFee ?? 5.0,
    stripe_account_id: payload.stripeAccountId ?? null
  }).select("id,name,slug,phone_number").single();
  if (restaurantError || !restaurant) throw Object.assign(new Error("Failed to create restaurant"), {
    status: 500,
    details: restaurantError
  });
  const passwordHash = await bcrypt.hash(payload.adminPassword, 12);
  const { data: admin, error: adminError } = await supabase.from("app_users").insert({
    email: payload.ownerEmail,
    password_hash: passwordHash,
    role: "restaurant_admin",
    restaurant_id: restaurant.id
  }).select("id,email").single();
  if (adminError || !admin) {
    await supabase.from("restaurants").delete().eq("id", restaurant.id);
    throw Object.assign(new Error("Failed to create admin user"), {
      status: 500,
      details: adminError
    });
  }
  const accessToken = jwt.sign({
    sub: admin.id,
    email: admin.email,
    role: "restaurant_admin",
    restaurantId: restaurant.id
  }, JWT_SECRET, {
    expiresIn: "30d"
  });
  const refreshToken = nanoid(64);
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const refreshExpiresAt = new Date();
  refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 90);
  await supabase.from("refresh_tokens").insert({
    user_id: admin.id,
    token_hash: tokenHash,
    expires_at: refreshExpiresAt.toISOString()
  });
  return {
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      slug: restaurant.slug,
      phone_number: restaurant.phone_number
    },
    admin: {
      id: admin.id,
      email: admin.email
    },
    auth: {
      accessToken,
      refreshToken,
      expiresIn: 2592000
    },
    posConfigured: !!(payload.posType && payload.posType !== "none"),
    stripeConfigured: !!payload.stripeAccountId,
    vapiPhoneProvisioned: false
  };
}
async function handlePosOAuthCallback(restaurantId, provider, code, state, callbackMerchantId) {
  const redirectUri = `${edgeFunctionsBase}/functions/v1/onboarding/pos/${provider}/callback`;
  if (provider === "square") {
    const squareClientId = Deno.env.get("SQUARE_CLIENT_ID");
    const squareClientSecret = Deno.env.get("SQUARE_CLIENT_SECRET");
    const isProduction = Deno.env.get("SQUARE_ENVIRONMENT") === "production" || Deno.env.get("NODE_ENV") === "production";
    const squareBase = isProduction ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
    const tokenResponse = await axios.post(`${squareBase}/oauth2/token`, {
      client_id: squareClientId,
      client_secret: squareClientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri
    }, {
      headers: {
        "Content-Type": "application/json"
      }
    });
    const accessToken = tokenResponse.data.access_token;
    const locationsResponse = await axios.get(`${squareBase}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
    return {
      accessToken,
      refreshToken: tokenResponse.data.refresh_token,
      locations: locationsResponse.data.locations || [],
      merchantId: locationsResponse.data.locations?.[0]?.id
    };
  }
  if (provider === "clover") {
    const cloverAppId = Deno.env.get("CLOVER_APP_ID");
    const cloverAppSecret = Deno.env.get("CLOVER_APP_SECRET");
    const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
    const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
    console.log("🔵 [Clover OAuth] Exchanging code:", {
      cloverAppId: cloverAppId ? "SET" : "MISSING",
      cloverAppSecret: cloverAppSecret ? "SET" : "MISSING",
      useSandbox,
      cloverBase,
      redirectUri,
      callbackMerchantId
    });
    try {
      const tokenResponse = await axios.post(`${cloverBase}/oauth/v2/token`, {
        client_id: cloverAppId,
        client_secret: cloverAppSecret,
        code: code
      }, {
        headers: {
          "Content-Type": "application/json"
        }
      });
      const accessToken = tokenResponse.data.access_token;
      // Use merchant_id from callback URL if provided, otherwise from token response
      const merchantId = callbackMerchantId || tokenResponse.data.merchant_id || tokenResponse.data.merchant_uuid;
      console.log("✅ [Clover OAuth] Token exchange successful:", {
        hasAccessToken: !!accessToken,
        hasMerchantId: !!merchantId,
        merchantIdSource: callbackMerchantId ? "callback_url" : "token_response",
        responseKeys: Object.keys(tokenResponse.data)
      });
      return {
        accessToken,
        refreshToken: tokenResponse.data.refresh_token,
        merchantId,
        merchants: [
          {
            id: merchantId,
            name: "Clover Merchant"
          }
        ]
      };
    } catch (error) {
      console.error("🔴 [Clover OAuth] Token exchange failed:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        headers: error.response?.headers
      });
      throw Object.assign(new Error(`Clover token exchange failed: ${error.response?.data?.error || error.message}`), {
        status: 500,
        code: "CLOVER_TOKEN_EXCHANGE_FAILED",
        details: error.response?.data
      });
    }
  }
  throw new Error(`Unsupported provider: ${provider}`);
}
async function connectMultipleLocations(restaurantId, provider, tokens, selectedIds) {
  const connectedLocationIds = [];
  for (const selectedId of selectedIds){
    const locationData = provider === "square" ? tokens.locations?.find((l)=>l.id === selectedId) : tokens.merchants?.find((m)=>m.id === selectedId);
    if (!locationData) continue;
    const { data: location } = await supabase.from("restaurant_pos_locations").insert({
      restaurant_id: restaurantId,
      pos_type: provider,
      pos_location_id: selectedId,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken || null,
      is_active: true,
      is_primary: selectedIds.indexOf(selectedId) === 0
    }).select("id").single();
    if (location) connectedLocationIds.push(location.id);
  }
  return {
    count: selectedIds.length,
    locationIds: connectedLocationIds
  };
}
// Auto-sync menu after POS connection - creates JWT token to call pos function
async function syncMenuAfterConnection(restaurantId, locationId) {
  try {
    console.log("🔄 [Auto Sync] Starting menu sync after POS connection", {
      restaurantId,
      locationId
    });
    // Get a user for this restaurant to create a valid JWT
    const { data: user } = await supabase.from("app_users").select("id,restaurant_id").eq("restaurant_id", restaurantId).limit(1).maybeSingle();
    if (!user) {
      console.warn("⚠️ [Auto Sync] No user found for restaurant, skipping sync", {
        restaurantId
      });
      return;
    }
    // Create a JWT token signed with JWT_SECRET (same as pos function expects)
    const syncToken = jwt.sign({
      sub: user.id,
      restaurantId: restaurantId
    }, JWT_SECRET, {
      expiresIn: "5m"
    });
    // Call the pos Edge Function to sync menu
    const syncUrl = `${edgeFunctionsBase}/functions/v1/pos/${restaurantId}/sync-menu`;
    const response = await axios.post(syncUrl, {}, {
      headers: {
        "Authorization": `Bearer ${syncToken}`,
        "apikey": supabaseServiceKey
      }
    });
    console.log("✅ [Auto Sync] Menu sync completed", {
      restaurantId,
      result: response.data
    });
  } catch (error) {
    // Don't fail the connection if sync fails - just log it
    console.error("⚠️ [Auto Sync] Menu sync failed (non-blocking):", {
      restaurantId,
      locationId,
      error: error.message,
      response: error.response?.data
    });
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: corsHeaders
  });
  try {
    const url1 = new URL(req.url);
    let path = url1.pathname;
    if (path.startsWith("/onboarding")) {
      path = path.replace("/onboarding", "");
    }
    if (path === "") path = "/";
    const method = req.method;
    if (method === "POST" && path === "/onboard") {
      const body = await req.json();
      const result = await onboardRestaurant(body);
      return new Response(JSON.stringify({
        success: true,
        ...result
      }), {
        status: 201,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "GET" && path.includes("/pos/") && path.endsWith("/auth")) {
      const provider = path.split("/")[2];
      const restaurantId = url1.searchParams.get("restaurantId");
      const frontendUrl = url1.searchParams.get("frontendUrl");
      if (!restaurantId) {
        return new Response(JSON.stringify({
          error: "restaurantId required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const state = btoa(JSON.stringify({
        restaurantId,
        frontendUrl: frontendUrl || getFrontendUrl(),
        timestamp: Date.now()
      }));
      if (provider === "square") {
        const squareClientId = Deno.env.get("SQUARE_CLIENT_ID");
        if (!squareClientId) {
          return new Response(JSON.stringify({
            error: "Square client ID not configured"
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        const isProduction = Deno.env.get("SQUARE_ENVIRONMENT") === "production" || Deno.env.get("NODE_ENV") === "production";
        const squareBase = isProduction ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
        const redirectUri = `${edgeFunctionsBase}/functions/v1/onboarding/pos/square/callback`;
        const authUrl = `${squareBase}/oauth2/authorize?client_id=${squareClientId}&scope=MERCHANT_PROFILE_READ ITEMS_READ ITEMS_WRITE INVENTORY_READ INVENTORY_WRITE ORDERS_READ ORDERS_WRITE CUSTOMERS_READ CUSTOMERS_WRITE PAYMENTS_READ PAYMENTS_WRITE&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        return new Response(JSON.stringify({
          authUrl
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (provider === "clover") {
        const cloverAppId = Deno.env.get("CLOVER_APP_ID");
        if (!cloverAppId) {
          return new Response(JSON.stringify({
            error: "Clover App ID not configured"
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          });
        }
        const useSandbox = Deno.env.get("CLOVER_ENVIRONMENT") === "sandbox" || Deno.env.get("NODE_ENV") !== "production";
        const cloverBase = useSandbox ? "https://apisandbox.dev.clover.com" : "https://api.clover.com";
        const redirectUri = `${edgeFunctionsBase}/functions/v1/onboarding/pos/clover/callback`;
        const authUrl = `${cloverBase}/oauth/v2/authorize?client_id=${cloverAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
        return new Response(JSON.stringify({
          authUrl
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
    }
    // GET /pos/:provider/callback
    if (method === "GET" && path.includes("/pos/") && path.includes("/callback")) {
      const provider = path.split("/")[2];
      const code = url1.searchParams.get("code");
      const state = url1.searchParams.get("state");
      // Clover sends merchant_id in callback URL
      const callbackMerchantId = provider === "clover" ? url1.searchParams.get("merchant_id") : null;
      if (!code) {
        return new Response("Missing authorization code", {
          status: 400,
          headers: corsHeaders
        });
      }
      let stateData;
      try {
        stateData = JSON.parse(atob(state || ""));
      } catch (e) {
        return new Response("Invalid state parameter", {
          status: 400,
          headers: corsHeaders
        });
      }
      const restaurantId = stateData.restaurantId;
      const frontendUrl = getFrontendUrl(stateData.frontendUrl);
      if (!restaurantId) {
        return new Response("Missing restaurant ID in state", {
          status: 400,
          headers: corsHeaders
        });
      }
      console.log("🔵 [OAuth Callback] Processing:", {
        provider,
        restaurantId,
        hasCode: !!code,
        hasState: !!state,
        callbackMerchantId
      });
      const tokens = await handlePosOAuthCallback(restaurantId, provider, code, state || "", callbackMerchantId);
      console.log("✅ [OAuth Callback] Tokens received:", {
        provider,
        hasAccessToken: !!tokens.accessToken,
        hasMerchantId: !!tokens.merchantId,
        merchantsCount: tokens.merchants?.length || 0,
        locationsCount: tokens.locations?.length || 0
      });
      const sessionId = nanoid();
      await supabase.from("pos_oauth_sessions").insert({
        id: sessionId,
        restaurant_id: restaurantId,
        pos_type: provider,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken || null,
        merchant_id: tokens.merchantId || null,
        locations: tokens.locations || null,
        merchants: tokens.merchants || null,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      const hasLocations = tokens.locations && tokens.locations.length > 0 || tokens.merchants && tokens.merchants.length > 0;
      console.log("🔍 [OAuth Callback] Checking auto-connect:", {
        hasLocations,
        locationsCount: tokens.locations?.length || 0,
        merchantsCount: tokens.merchants?.length || 0,
        totalCount: (tokens.locations?.length || 0) + (tokens.merchants?.length || 0)
      });
      // If single location/merchant, auto-connect
      if (hasLocations && (tokens.locations?.length || 0) + (tokens.merchants?.length || 0) === 1) {
        const selectedId = tokens.locations?.[0]?.id || tokens.merchants?.[0]?.id;
        console.log("🔗 [OAuth Callback] Auto-connecting single location:", {
          selectedId,
          provider
        });
        if (selectedId) {
          const { locationIds } = await connectMultipleLocations(restaurantId, provider, tokens, [
            selectedId
          ]);
          console.log("✅ [OAuth Callback] Connection saved:", {
            locationIds,
            count: locationIds.length
          });
          await supabase.from("pos_oauth_sessions").delete().eq("id", sessionId);
          // Trigger menu sync asynchronously (fire and forget)
          if (locationIds.length > 0) {
            syncMenuAfterConnection(restaurantId, locationIds[0]).catch((err)=>console.error("Sync error:", err));
          }
          const redirectUrl = `${frontendUrl}/restaurant/settings?pos_connected=${provider}`;
          // Use meta refresh + link - works in sandboxed iframes
          return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=${redirectUrl}"><title>Connection Successful</title><style>body{font-family:Arial,sans-serif;max-width:500px;margin:50px auto;padding:20px;text-align:center;background:#f5f5f5}h1{color:#22c55e;font-size:24px;margin-bottom:20px}p{color:#333;font-size:16px;line-height:1.6;margin:15px 0}.box{background:#d1fae5;border:2px solid #22c55e;border-radius:8px;padding:30px;margin:30px 0}.btn{display:inline-block;background:#22c55e;color:white;padding:15px 30px;text-decoration:none;border-radius:6px;font-size:18px;font-weight:bold;margin-top:20px;transition:background 0.3s}.btn:hover{background:#16a34a}</style></head><body><div class="box"><h1>✅ Connection Successful!</h1><p>Your ${provider.charAt(0).toUpperCase() + provider.slice(1)} account has been connected.</p><p>Menu sync in progress...</p><p>Redirecting to settings page in 2 seconds...</p><p><a href="${redirectUrl}" class="btn" target="_top">Continue to Settings →</a></p></div></body></html>`, {
            headers: htmlHeaders
          });
        }
      }
      // Multiple locations - show selection
      const redirectUrl = `${frontendUrl}/restaurant/settings?pos_auth=${provider}&session=${sessionId}`;
      // Use meta refresh + link - works in sandboxed iframes
      return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2;url=${redirectUrl}"><title>Select Location</title><style>body{font-family:Arial,sans-serif;max-width:500px;margin:50px auto;padding:20px;text-align:center;background:#f5f5f5}h1{color:#3b82f6;font-size:24px;margin-bottom:20px}p{color:#333;font-size:16px;line-height:1.6;margin:15px 0}.box{background:#dbeafe;border:2px solid #3b82f6;border-radius:8px;padding:30px;margin:30px 0}.btn{display:inline-block;background:#3b82f6;color:white;padding:15px 30px;text-decoration:none;border-radius:6px;font-size:18px;font-weight:bold;margin-top:20px;transition:background 0.3s}.btn:hover{background:#2563eb}</style></head><body><div class="box"><h1>📍 Select Location</h1><p>Please select which ${provider.charAt(0).toUpperCase() + provider.slice(1)} location to connect.</p><p>Redirecting to settings page in 2 seconds...</p><p><a href="${redirectUrl}" class="btn" target="_top">Select Location →</a></p></div></body></html>`, {
        headers: htmlHeaders
      });
    }
    if (method === "GET" && path.includes("/pos/") && path.includes("/locations")) {
      const provider = path.split("/")[2];
      const session = url1.searchParams.get("session");
      if (!session) {
        return new Response(JSON.stringify({
          error: "session parameter required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { data: oauthSession } = await supabase.from("pos_oauth_sessions").select("*").eq("id", session).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!oauthSession) {
        return new Response(JSON.stringify({
          error: "Session not found or expired"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (provider === "square" && oauthSession.locations) {
        const locations = typeof oauthSession.locations === "string" ? JSON.parse(oauthSession.locations) : oauthSession.locations;
        return new Response(JSON.stringify({
          locations
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      if (provider === "clover" && oauthSession.merchants) {
        const merchants = typeof oauthSession.merchants === "string" ? JSON.parse(oauthSession.merchants) : oauthSession.merchants;
        return new Response(JSON.stringify({
          merchants
        }), {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        error: "No locations/merchants found"
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path.includes("/pos/") && path.includes("/finalize")) {
      const provider = path.split("/")[2];
      const body = await req.json();
      const { session, locationIds = [], merchantIds = [] } = body;
      if (!session) {
        return new Response(JSON.stringify({
          error: "session parameter required"
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const { data: oauthSession } = await supabase.from("pos_oauth_sessions").select("*").eq("id", session).gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!oauthSession) {
        return new Response(JSON.stringify({
          error: "Session not found or expired"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const locations = oauthSession.locations ? typeof oauthSession.locations === "string" ? JSON.parse(oauthSession.locations) : oauthSession.locations : [];
      const merchants = oauthSession.merchants ? typeof oauthSession.merchants === "string" ? JSON.parse(oauthSession.merchants) : oauthSession.merchants : [];
      const selectedIds = provider === "square" ? locationIds : merchantIds;
      const { locationIds: connectedLocationIds } = await connectMultipleLocations(oauthSession.restaurant_id, provider, {
        accessToken: oauthSession.access_token,
        refreshToken: oauthSession.refresh_token || undefined,
        locations,
        merchants,
        merchantId: oauthSession.merchant_id
      }, selectedIds);
      await supabase.from("pos_oauth_sessions").delete().eq("id", session);
      // Trigger menu sync asynchronously for the first connected location (fire and forget)
      if (connectedLocationIds.length > 0) {
        syncMenuAfterConnection(oauthSession.restaurant_id, connectedLocationIds[0]).catch((err)=>console.error("Sync error:", err));
      }
      return new Response(JSON.stringify({
        success: true,
        message: `Successfully connected ${selectedIds.length} location(s)`,
        connectedCount: selectedIds.length
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "DELETE" && path === "/pos/disconnect") {
      const authHeader = req.headers.get("authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({
          error: "Unauthorized"
        }), {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const token = authHeader.slice(7);
      const user = jwt.verify(token, JWT_SECRET);
      const restaurantId = user.restaurantId;
      if (!restaurantId) {
        return new Response(JSON.stringify({
          error: "Missing restaurant ID"
        }), {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      await supabase.from("restaurant_pos_locations").delete().eq("restaurant_id", restaurantId);
      await supabase.from("restaurants").update({
        pos_type: "none",
        pos_location_id: null,
        updated_at: new Date().toISOString()
      }).eq("id", restaurantId);
      return new Response(JSON.stringify({
        success: true,
        message: "POS disconnected successfully"
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "GET" && path.startsWith("/check-slug/")) {
      const slug = path.split("/")[2];
      const { data } = await supabase.from("restaurants").select("id").eq("slug", slug).maybeSingle();
      return new Response(JSON.stringify({
        available: !data
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "GET" && path.startsWith("/check-email/")) {
      const email = path.split("/")[2];
      const { data } = await supabase.from("app_users").select("id").eq("email", email).maybeSingle();
      return new Response(JSON.stringify({
        available: !data
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    return new Response(JSON.stringify({
      error: "Not found",
      path
    }), {
      status: 404,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("🔴 [Onboarding Error]:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      status: error.status,
      code: error.code
    });
    let frontendUrl = "http://localhost:5173";
    let provider = "unknown";
    try {
      const url1 = new URL(req.url);
      const state = url1.searchParams.get("state");
      if (state) {
        const stateData = JSON.parse(atob(state));
        frontendUrl = getFrontendUrl(stateData.frontendUrl);
      } else {
        frontendUrl = getFrontendUrl();
      }
      const pathParts = url1.pathname.split("/");
      const posIndex = pathParts.indexOf("pos");
      if (posIndex >= 0 && posIndex < pathParts.length - 1) {
        provider = pathParts[posIndex + 1];
      }
    } catch (e) {
      frontendUrl = getFrontendUrl();
    }
    const redirectUrl = `${frontendUrl}/restaurant/settings?pos_error=${encodeURIComponent(error.message || "Internal server error")}`;
    return new Response(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="3;url=${redirectUrl}"><title>Connection Failed</title><style>body{font-family:Arial,sans-serif;max-width:500px;margin:50px auto;padding:20px;text-align:center;background:#f5f5f5}h1{color:#ef4444;font-size:24px;margin-bottom:20px}p{color:#333;font-size:16px;line-height:1.6;margin:15px 0}.box{background:#fee2e2;border:2px solid #ef4444;border-radius:8px;padding:30px;margin:30px 0}.btn{display:inline-block;background:#ef4444;color:white;padding:15px 30px;text-decoration:none;border-radius:6px;font-size:18px;font-weight:bold;margin-top:20px;transition:background 0.3s}.btn:hover{background:#dc2626}</style></head><body><div class="box"><h1>❌ Connection Failed</h1><p>${error.message || "Internal server error"}</p><p>Error code: ${error.code || "UNKNOWN"}</p><p>Redirecting to settings page in 3 seconds...</p><p><a href="${redirectUrl}" class="btn" target="_top">Return to Settings →</a></p></div></body></html>`, {
      status: error.status || 500,
      headers: htmlHeaders
    });
  }
});
