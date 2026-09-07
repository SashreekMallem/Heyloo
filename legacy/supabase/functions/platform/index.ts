import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import jwt from "npm:jsonwebtoken@^9.0.2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
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
function resolveDateRange(range) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  switch(range){
    case "today":
      return {
        start: today,
        end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
      };
    case "yesterday":
      {
        const start = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        return {
          start,
          end: today
        };
      }
    case "last7":
      {
        const start = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
        return {
          start,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        };
      }
    case "last30":
      {
        const start = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);
        return {
          start,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        };
      }
    case "month_to_date":
      {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        return {
          start,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        };
      }
    case "year_to_date":
      {
        const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        return {
          start,
          end: new Date(today.getTime() + 24 * 60 * 60 * 1000)
        };
      }
    default:
      return {
        start: today,
        end: today
      };
  }
}
async function getPlatformOverview(range) {
  const { start, end } = resolveDateRange(range);
  const [usageResult, restaurantsResult] = await Promise.all([
    supabase.from("platform_usage_daily").select("restaurant_id,total_calls,total_minutes,total_orders,total_order_value,vapi_call_cost").gte("date", start.toISOString().slice(0, 10)).lt("date", end.toISOString().slice(0, 10)),
    supabase.from("restaurants").select("id,subscription_status")
  ]);
  if (usageResult.error || restaurantsResult.error) {
    throw new Error("Failed to load platform metrics");
  }
  const totals = (usageResult.data ?? []).reduce((acc, row)=>{
    acc.totalCalls += row.total_calls;
    acc.totalMinutes += row.total_minutes;
    acc.totalOrders += row.total_orders;
    acc.totalRevenue += row.total_order_value;
    acc.vapiCosts += row.vapi_call_cost;
    return acc;
  }, {
    totalCalls: 0,
    totalMinutes: 0,
    totalOrders: 0,
    totalRevenue: 0,
    vapiCosts: 0
  });
  const restaurantRows = restaurantsResult.data ?? [];
  return {
    activeRestaurants: restaurantRows.filter((r)=>r.subscription_status === "active").length,
    totalRestaurants: restaurantRows.length,
    totalCalls: totals.totalCalls,
    totalCallMinutes: totals.totalMinutes,
    totalOrders: totals.totalOrders,
    totalRevenue: totals.totalRevenue,
    vapiCosts: totals.vapiCosts,
    netProfit: totals.totalRevenue - totals.vapiCosts
  };
}
async function listRestaurantSummaries(range) {
  const { start, end } = resolveDateRange(range);
  const { data: restaurants } = await supabase.from("restaurants").select("id,name,subscription_status");
  const { data: usageData } = await supabase.from("restaurant_usage_summary").select("restaurant_id,restaurant_name,subscription_status,total_calls,total_minutes,total_orders,total_order_value").gte("date", start.toISOString().slice(0, 10)).lt("date", end.toISOString().slice(0, 10));
  const usageMap = new Map();
  for (const row of usageData ?? []){
    const existing = usageMap.get(row.restaurant_id);
    if (existing) {
      existing.calls += row.total_calls;
      existing.minutes += row.total_minutes;
      existing.orders += row.total_orders;
      existing.revenue += row.total_order_value;
    } else {
      usageMap.set(row.restaurant_id, {
        restaurantName: row.restaurant_name,
        status: row.subscription_status,
        calls: row.total_calls,
        minutes: row.total_minutes,
        orders: row.total_orders,
        revenue: row.total_order_value
      });
    }
  }
  return (restaurants ?? []).map((restaurant)=>{
    const usage = usageMap.get(restaurant.id);
    return {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      status: usage?.status ?? restaurant.subscription_status,
      calls: usage?.calls ?? 0,
      callMinutes: usage?.minutes ?? 0,
      orders: usage?.orders ?? 0,
      revenue: usage?.revenue ?? 0
    };
  });
}
async function getUsageTimeline(range) {
  const { start, end } = resolveDateRange(range);
  const { data } = await supabase.from("platform_usage_daily").select("date,total_calls,total_minutes,total_orders,total_order_value").gte("date", start.toISOString().slice(0, 10)).lt("date", end.toISOString().slice(0, 10));
  const timeline = new Map();
  for (const row of data ?? []){
    const existing = timeline.get(row.date);
    if (existing) {
      existing.totalCalls += row.total_calls;
      existing.totalMinutes += row.total_minutes;
      existing.totalOrders += row.total_orders;
      existing.revenue += row.total_order_value;
    } else {
      timeline.set(row.date, {
        totalCalls: row.total_calls,
        totalMinutes: row.total_minutes,
        totalOrders: row.total_orders,
        revenue: row.total_order_value
      });
    }
  }
  return Array.from(timeline.entries()).sort(([dateA], [dateB])=>dateA.localeCompare(dateB)).map(([date, value])=>({
      date,
      ...value
    }));
}
async function getCallCenterMetrics(range) {
  const { start, end } = resolveDateRange(range);
  const { data } = await supabase.from("call_logs").select("duration_seconds,status,created_at").gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  const calls = data ?? [];
  const totalCalls = calls.length;
  const completed = calls.filter((call)=>call.status === "completed");
  const failed = calls.filter((call)=>call.status === "failed");
  const totalDuration = completed.reduce((sum, call)=>sum + (call.duration_seconds ?? 0), 0);
  return {
    totalCalls,
    averageHandleTime: totalCalls ? Math.round(totalDuration / totalCalls * 10) / 10 : 0,
    firstCallResolution: totalCalls ? Math.round(completed.length / totalCalls * 1000) / 10 : 0,
    callAbandonmentRate: totalCalls ? Math.round(failed.length / totalCalls * 1000) / 10 : 0,
    repeatCallRate: 0,
    serviceLevel: 100
  };
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
    const path = url.pathname.replace("/functions/v1/platform", "");
    const range = url.searchParams.get("range") || "today";
    if (path === "/overview") {
      const metrics = await getPlatformOverview(range);
      return new Response(JSON.stringify(metrics), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (path === "/restaurants") {
      const summaries = await listRestaurantSummaries(range);
      return new Response(JSON.stringify(summaries), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (path === "/analytics/timeline") {
      const timeline = await getUsageTimeline(range);
      return new Response(JSON.stringify(timeline), {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json"
        }
      });
    }
    if (path === "/analytics/call-center") {
      const metrics = await getCallCenterMetrics(range);
      return new Response(JSON.stringify(metrics), {
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
    console.error("Error in platform:", error);
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
