import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import axios from "npm:axios@^1.7.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

const squareBaseUrl = (Deno.env.get("SQUARE_ENVIRONMENT") === "production" || Deno.env.get("NODE_ENV") === "production")
  ? "https://connect.squareup.com/v2"
  : "https://connect.squareupsandbox.com/v2";
const SQUARE_VERSION = Deno.env.get("SQUARE_VERSION") ?? "2025-01-23";
const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN");

async function fetchRestaurantsWithPos() {
  const { data, error } = await supabase
    .from("restaurants")
    .select("id,pos_type,pos_location_id")
    .neq("pos_type", "none");

  if (error) {
    throw new Error(`Failed to load restaurants: ${error.message}`);
  }

  return data ?? [];
  }

async function fetchLocations(restaurantId: string) {
  const { data, error } = await supabase
    .from("restaurant_pos_locations")
    .select("id,pos_type,pos_location_id,access_token")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load locations: ${error.message}`);
  }

  return data ?? [];
}

async function syncSquareMenu(location: any, restaurantId: string) {
  if (!location.access_token && !SQUARE_ACCESS_TOKEN) {
    throw new Error("Square access token required");
  }

  const client = axios.create({
    baseURL: squareBaseUrl,
    headers: {
      Authorization: `Bearer ${location.access_token || SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_VERSION
    }
  });

  // Use POST /v2/catalog/search as per Square API documentation
  const response = await client.post("/catalog/search", {
    object_types: ["ITEM"],
    include_related_objects: false
  });
  const objects = response.data.objects ?? [];

  const items = objects.map((item: any) => ({
    restaurant_id: restaurantId,
    location_id: location.id,
    pos_item_id: item.id,
    name: item.item_data?.name ?? "Untitled Item",
    description: item.item_data?.description ?? null,
    category: item.item_data?.category_id ?? null,
    price: (item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount ?? 0) / 100,
    is_available: item.item_data?.available_online ?? true,
    sync_source: "pos"
  }));

  if (!items.length) {
    return 0;
  }

  const { error } = await supabase
    .from("menu_items")
    .upsert(items, { onConflict: "restaurant_id,pos_item_id" });

  if (error) {
    throw new Error(`Failed to upsert menu: ${error.message}`);
  }

  return items.length;
}

async function runSync() {
  const restaurants = await fetchRestaurantsWithPos();

  for (const restaurant of restaurants) {
    const locations = await fetchLocations(restaurant.id);

    for (const location of locations) {
      if (location.pos_type === "square") {
        try {
          const count = await syncSquareMenu(location, restaurant.id);
          await supabase.from("pos_sync_log").insert({
            restaurant_id: restaurant.id,
            location_id: location.id,
            sync_type: "menu_sync",
            sync_source: "auto",
            status: "success",
            items_processed: count
          });
        } catch (error) {
          await supabase.from("pos_sync_log").insert({
            restaurant_id: restaurant.id,
            location_id: location.id,
            sync_type: "menu_sync",
            sync_source: "auto",
            status: "failed",
            error_message: error.message
          });
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      }
    });
  }

  try {
    await runSync();
    return new Response(JSON.stringify({ success: true, message: "Sync completed" }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Sync error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
    }
});
