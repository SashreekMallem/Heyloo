import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { z } from "npm:zod@^3.23.8";
import bcrypt from "npm:bcryptjs@^2.4.3";
import jwt from "npm:jsonwebtoken@^9.0.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const JWT_SECRET = Deno.env.get("JWT_SECRET");
const JWT_REFRESH_SECRET = Deno.env.get("JWT_REFRESH_SECRET");
const ACCESS_TOKEN_TTL = 60 * 15; // 15 minutes
const REFRESH_TOKEN_TTL = 60 * 60 * 24 * 30; // 30 days
function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL
  });
}
function signRefreshToken(payload) {
  return jwt.sign(payload, JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL
  });
}
function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET);
  } catch (err) {
    if (err.name === "JsonWebTokenError") {
      throw Object.assign(new Error("Invalid refresh token"), {
        status: 401,
        code: "INVALID_REFRESH_TOKEN"
      });
    }
    if (err.name === "TokenExpiredError") {
      throw Object.assign(new Error("Refresh token expired"), {
        status: 401,
        code: "REFRESH_TOKEN_EXPIRED"
      });
    }
    throw Object.assign(new Error("Failed to verify refresh token"), {
      status: 401,
      code: "TOKEN_VERIFICATION_FAILED"
    });
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const url = new URL(req.url);
    // Supabase strips /functions/v1, so pathname is like "/auth/login"
    let path = url.pathname;
    if (path.startsWith("/auth")) {
      path = path.replace("/auth", "");
    }
    if (path === "") path = "/";
    const method = req.method;
    if (method === "POST" && path === "/login") {
      const body = await req.json();
      const loginSchema = z.object({
        email: z.string().email(),
        password: z.string().min(1)
      });
      const { email, password } = loginSchema.parse(body);
      // Get user for login
      const { data: userData, error: rpcError } = await supabase.rpc("get_user_for_login", {
        p_email: email
      });
      if (rpcError || !userData || userData.length === 0) {
        return new Response(JSON.stringify({
          message: "Invalid credentials",
          code: "INVALID_CREDENTIALS"
        }), {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const user = userData[0];
      const passwordMatches = await bcrypt.compare(password, user.password_hash);
      if (!passwordMatches) {
        return new Response(JSON.stringify({
          message: "Invalid credentials",
          code: "INVALID_CREDENTIALS"
        }), {
          status: 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurant_id
      };
      const accessToken = signAccessToken(payload);
      const refreshToken = signRefreshToken(payload);
      return new Response(JSON.stringify({
        accessToken,
        refreshToken,
        expiresIn: 900,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          restaurantId: user.restaurant_id
        }
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path === "/refresh") {
      const body = await req.json();
      const refreshSchema = z.object({
        refreshToken: z.string().min(10)
      });
      const { refreshToken } = refreshSchema.parse(body);
      let payload;
      try {
        payload = verifyRefreshToken(refreshToken);
      } catch (err) {
        return new Response(JSON.stringify({
          message: err.message,
          code: err.code
        }), {
          status: err.status || 401,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      // Get user for refresh
      const { data: userData, error: rpcError } = await supabase.rpc("get_user_for_refresh", {
        p_user_id: payload.sub
      });
      if (rpcError || !userData || userData.length === 0) {
        return new Response(JSON.stringify({
          message: "User not found",
          code: "USER_NOT_FOUND"
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        });
      }
      const user = userData[0];
      const newPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurant_id
      };
      return new Response(JSON.stringify({
        accessToken: signAccessToken(newPayload),
        refreshToken: signRefreshToken(newPayload),
        expiresIn: 900,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          restaurantId: user.restaurant_id
        }
      }), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (method === "POST" && path === "/logout") {
      return new Response(JSON.stringify({
        message: "Logged out successfully"
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
    console.error("Error in auth:", error);
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
