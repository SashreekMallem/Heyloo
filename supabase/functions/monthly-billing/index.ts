import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
Deno.serve(async (req)=>{
  try {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const year = lastMonth.getFullYear();
    const month = lastMonth.getMonth() + 1;
    const { data: restaurants } = await supabase.from("restaurants").select("id,name,owner_email,subscription_status").eq("subscription_status", "active");
    if (!restaurants || restaurants.length === 0) {
      return new Response(JSON.stringify({
        message: "No active restaurants found for billing"
      }), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    for (const restaurant of restaurants){
      try {
        const { data: usageData } = await supabase.from("platform_usage_daily").select("total_minutes,vapi_call_cost").eq("restaurant_id", restaurant.id).gte("date", `${year}-${month.toString().padStart(2, "0")}-01`).lt("date", `${year}-${(month + 1).toString().padStart(2, "0")}-01`);
        if (!usageData) continue;
        const totalMinutes = usageData.reduce((sum, d)=>sum + Number(d.total_minutes), 0);
        const baseFee = 9900; // $99 in cents
        const includedMinutes = 500;
        const overageMinutes = Math.max(0, totalMinutes - includedMinutes);
        const overageRate = 10; // 10 cents per minute
        const overageCost = Math.round(overageMinutes * overageRate);
        const totalAmount = baseFee + overageCost;
        await supabase.from("subscription_invoices").insert({
          restaurant_id: restaurant.id,
          billing_period_start: `${year}-${month.toString().padStart(2, "0")}-01`,
          billing_period_end: `${year}-${(month + 1).toString().padStart(2, "0")}-01`,
          base_fee_cents: baseFee,
          included_minutes: includedMinutes,
          overage_minutes: Math.round(overageMinutes),
          overage_rate_cents: overageRate,
          total_amount_cents: totalAmount,
          status: "pending"
        });
      } catch (err) {
        console.error(`Failed to process billing for restaurant ${restaurant.id}:`, err);
      }
    }
    return new Response(JSON.stringify({
      message: "Monthly billing completed"
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    console.error("Error in monthly-billing:", error);
    return new Response(JSON.stringify({
      error: error.message || "Internal server error"
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
