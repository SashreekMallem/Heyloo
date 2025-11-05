// Test script to sync menu from Square
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try multiple env file locations
const envPaths = [
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '.env.local'),
  join(process.cwd(), '.env'),
  join(process.cwd(), '.env.local')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) {
    console.log(`✅ Loaded env from: ${envPath}`);
    break;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔧 Config check:', {
  hasUrl: !!supabaseUrl,
  hasKey: !!supabaseKey,
  urlPrefix: supabaseUrl?.substring(0, 30),
  keyPrefix: supabaseKey?.substring(0, 20)
});

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    }
  }
});

const restaurantId = '6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc';

async function testMenuSync() {
  try {
    console.log('🔍 Step 1: Loading restaurant...');
    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id,pos_type,pos_location_id')
      .eq('id', restaurantId)
      .maybeSingle();

    if (restaurantError) {
      throw new Error(`Restaurant query error: ${restaurantError.message}`);
    }

    if (!restaurant) {
      throw new Error('Restaurant not found');
    }

    console.log('✅ Restaurant found:', {
      pos_type: restaurant.pos_type,
      pos_location_id: restaurant.pos_location_id
    });

    console.log('🔍 Step 2: Loading location credentials...');
    
    // First, check all locations
    const { data: allLocations, error: listError } = await supabase
      .from('restaurant_pos_locations')
      .select('*')
      .eq('restaurant_id', restaurantId);
    
    console.log('📋 All locations found:', allLocations?.length || 0);
    if (allLocations && allLocations.length > 0) {
      console.log('   Locations:', allLocations.map(l => ({
        id: l.id,
        pos_type: l.pos_type,
        pos_location_id: l.pos_location_id,
        is_active: l.is_active,
        has_token: !!l.access_token
      })));
    }
    
    const { data: location, error: locationError } = await supabase
      .from('restaurant_pos_locations')
      .select('id,access_token,is_active,pos_type,pos_location_id')
      .eq('restaurant_id', restaurantId)
      .eq('pos_type', restaurant.pos_type)
      .eq('pos_location_id', restaurant.pos_location_id)
      .eq('is_active', true)
      .maybeSingle();

    if (locationError) {
      console.error('Location query error:', locationError);
      throw new Error(`Location query error: ${locationError.message}`);
    }

    if (!location) {
      console.error('Query parameters:', {
        restaurant_id: restaurantId,
        pos_type: restaurant.pos_type,
        pos_location_id: restaurant.pos_location_id,
        is_active: true
      });
      throw new Error('Location not found');
    }

    if (!location.access_token) {
      throw new Error('Access token missing');
    }

    console.log('✅ Location credentials found:', {
      location_id: location.id,
      token_length: location.access_token.length,
      token_preview: location.access_token.substring(0, 20)
    });

    console.log('🔍 Step 3: Fetching menu from Square...');
    const squareApiUrl = 'https://connect.squareup.com/v2';
    const response = await fetch(`${squareApiUrl}/catalog/list`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${location.access_token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2024-01-18'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Square API error (${response.status}): ${errorText}`);
    }

    const catalogData = await response.json();
    const items = catalogData.objects?.filter(obj => obj.type === 'ITEM') || [];

    console.log(`✅ Found ${items.length} items from Square`);
    
    if (items.length > 0) {
      console.log('📋 Sample items:');
      items.slice(0, 3).forEach((item, i) => {
        console.log(`  ${i + 1}. ${item.item_data?.name || 'Untitled'} - $${((item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount ?? 0) / 100).toFixed(2)}`);
      });
    }

    console.log('🔍 Step 4: Upserting menu items...');
    const menuItems = items.map((item) => ({
      restaurant_id: restaurantId,
      location_id: location.id,
      pos_item_id: item.id,
      name: item.item_data?.name ?? 'Untitled Item',
      description: item.item_data?.description ?? null,
      category: item.item_data?.category_id ?? null,
      price: (item.item_data?.variations?.[0]?.item_variation_data?.price_money?.amount ?? 0) / 100,
      is_available: item.item_data?.available_online ?? true,
      sync_source: 'pos'
    }));

    // The unique constraint is on (restaurant_id, pos_item_id)
    // But we need to include location_id in the data for multi-location support
    const { error: upsertError } = await supabase
      .from('menu_items')
      .upsert(menuItems, {
        onConflict: 'restaurant_id,pos_item_id'
      });

    if (upsertError) {
      throw new Error(`Upsert error: ${upsertError.message}`);
    }

    console.log(`✅ Successfully synced ${menuItems.length} menu items!`);

    // Log sync
    await supabase.from('pos_sync_log').insert({
      restaurant_id: restaurantId,
      location_id: location.id,
      sync_type: 'menu_sync',
      sync_source: 'manual',
      status: 'success',
      items_processed: menuItems.length
    });

    console.log('✅ Sync complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testMenuSync();

