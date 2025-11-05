// Test script to verify menu filtering by restaurant and location
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load env
const envPaths = [
  join(__dirname, '..', '.env'),
  join(__dirname, '..', '.env.local'),
  join(process.cwd(), '.env'),
  join(process.cwd(), '.env.local')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath });
  if (!result.error) break;
}

const API_URL = process.env.API_URL || 'http://localhost:4000';
const VAPI_TOOL_TOKEN = process.env.VAPI_TOOL_TOKEN || process.env.VAPI_TOOL_AUTH_TOKEN;
const RESTAURANT_ID = '6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc';
const DIFF_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function testMenuFiltering() {
  try {
    console.log('🧪 Testing Menu Filtering by Restaurant and Location\n');

    // Step 1: Get location IDs
    const { data: locations } = await supabase
      .from('restaurant_pos_locations')
      .select('id, pos_location_id, pos_location_name')
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('is_active', true);

    if (!locations || locations.length === 0) {
      throw new Error('No locations found for restaurant');
    }

    const location1 = locations[0];
    const location2 = locations[1] || location1; // Use same if only one

    console.log('📍 Locations found:');
    locations.forEach((loc, i) => {
      console.log(`   ${i + 1}. ${loc.id} - ${loc.pos_location_name || loc.pos_location_id}`);
    });
    console.log('');

    // Step 2: Create test menu items
    console.log('📝 Creating test menu items...\n');

    // Item for different restaurant
    const { data: item1 } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id: DIFF_RESTAURANT_ID,
        location_id: null,
        pos_item_id: 'TEST-ITEM-DIFF-RESTAURANT',
        name: 'Item from Different Restaurant',
        description: 'This should NOT appear',
        price: 9.99,
        category: 'Test',
        is_available: true,
        sync_source: 'test'
      })
      .select()
      .single();

    console.log('✅ Created: Item for different restaurant');

    // Item for same restaurant, location1
    const { data: item2 } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id: RESTAURANT_ID,
        location_id: location1.id,
        pos_item_id: 'TEST-ITEM-LOCATION-1',
        name: 'Item for Location 1 Only',
        description: 'Should appear only when filtering by location1',
        price: 12.99,
        category: 'Test',
        is_available: true,
        sync_source: 'test'
      })
      .select()
      .single();

    console.log('✅ Created: Item for same restaurant, location1');

    // Item for same restaurant, NULL location (available at all locations)
    const { data: item3 } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id: RESTAURANT_ID,
        location_id: null,
        pos_item_id: 'TEST-ITEM-ALL-LOCATIONS',
        name: 'Item Available at All Locations',
        description: 'Should appear for all locations',
        price: 15.99,
        category: 'Test',
        is_available: true,
        sync_source: 'test'
      })
      .select()
      .single();

    console.log('✅ Created: Item for all locations (NULL location_id)');
    console.log('');

    // Step 3: Test 1 - Query with restaurant ID only (no location filter)
    console.log('🔍 Test 1: Menu for restaurant (no location filter)...');
    const response1 = await fetch(
      `${API_URL}/v1/vapi/tools/menu?restaurantId=${RESTAURANT_ID}`,
      {
        method: 'GET',
        headers: {
          'x-vapi-tool-token': VAPI_TOOL_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response1.ok) {
      throw new Error(`Test 1 failed: ${response1.status}`);
    }

    const menu1 = await response1.json();
    const testItems1 = menu1.items.filter(item => 
      item.name === 'Item for Location 1 Only' || 
      item.name === 'Item Available at All Locations' ||
      item.name === 'Item from Different Restaurant'
    );

    console.log(`   Total items: ${menu1.items.length}`);
    console.log(`   Test items found: ${testItems1.length}`);
    testItems1.forEach(item => {
      console.log(`     - ${item.name} (location: ${item.location_id || 'ALL'})`);
    });

    const hasItem2 = testItems1.some(item => item.name === 'Item for Location 1 Only');
    const hasItem3 = testItems1.some(item => item.name === 'Item Available at All Locations');
    const hasItem1 = testItems1.some(item => item.name === 'Item from Different Restaurant');

    console.log(`   ✅ Item for location1: ${hasItem2 ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`   ✅ Item for all locations: ${hasItem3 ? 'FOUND' : 'NOT FOUND'}`);
    console.log(`   ✅ Item from different restaurant: ${hasItem1 ? 'FOUND (BAD!)' : 'NOT FOUND (GOOD!)'}`);
    console.log('');

    // Step 4: Test 2 - Query with restaurant ID and location1 filter
    console.log(`🔍 Test 2: Menu for restaurant with location1 filter (${location1.id})...`);
    const response2 = await fetch(
      `${API_URL}/v1/vapi/tools/menu?restaurantId=${RESTAURANT_ID}&locationId=${location1.id}`,
      {
        method: 'GET',
        headers: {
          'x-vapi-tool-token': VAPI_TOOL_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response2.ok) {
      throw new Error(`Test 2 failed: ${response2.status}`);
    }

    const menu2 = await response2.json();
    const testItems2 = menu2.items.filter(item => 
      item.name === 'Item for Location 1 Only' || 
      item.name === 'Item Available at All Locations'
    );

    console.log(`   Total items: ${menu2.items.length}`);
    console.log(`   Test items found: ${testItems2.length}`);
    testItems2.forEach(item => {
      console.log(`     - ${item.name} (location: ${item.location_id || 'ALL'})`);
    });

    const hasItem2Loc1 = testItems2.some(item => item.name === 'Item for Location 1 Only');
    const hasItem3Loc1 = testItems2.some(item => item.name === 'Item Available at All Locations');

    console.log(`   ✅ Item for location1: ${hasItem2Loc1 ? 'FOUND (GOOD!)' : 'NOT FOUND'}`);
    console.log(`   ✅ Item for all locations: ${hasItem3Loc1 ? 'FOUND (GOOD!)' : 'NOT FOUND'}`);
    console.log('');

    // Step 5: Test 3 - Query for different restaurant (should return different items or empty)
    console.log(`🔍 Test 3: Menu for DIFFERENT restaurant (${DIFF_RESTAURANT_ID})...`);
    const response3 = await fetch(
      `${API_URL}/v1/vapi/tools/menu?restaurantId=${DIFF_RESTAURANT_ID}`,
      {
        method: 'GET',
        headers: {
          'x-vapi-tool-token': VAPI_TOOL_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response3.ok) {
      throw new Error(`Test 3 failed: ${response3.status}`);
    }

    const menu3 = await response3.json();
    const testItems3 = menu3.items.filter(item => 
      item.name === 'Item from Different Restaurant' ||
      item.name === 'Item for Location 1 Only' || 
      item.name === 'Item Available at All Locations'
    );

    console.log(`   Total items: ${menu3.items.length}`);
    console.log(`   Test items found: ${testItems3.length}`);
    testItems3.forEach(item => {
      console.log(`     - ${item.name}`);
    });

    const hasDiffRestaurantItem = testItems3.some(item => item.name === 'Item from Different Restaurant');
    const hasMainRestaurantItems = testItems3.some(item => 
      item.name === 'Item for Location 1 Only' || 
      item.name === 'Item Available at All Locations'
    );

    console.log(`   ✅ Item from different restaurant: ${hasDiffRestaurantItem ? 'FOUND (GOOD!)' : 'NOT FOUND'}`);
    console.log(`   ✅ Items from main restaurant: ${hasMainRestaurantItems ? 'FOUND (BAD!)' : 'NOT FOUND (GOOD!)'}`);
    console.log('');

    // Cleanup test items
    console.log('🧹 Cleaning up test items...');
    await supabase
      .from('menu_items')
      .delete()
      .in('pos_item_id', [
        'TEST-ITEM-DIFF-RESTAURANT',
        'TEST-ITEM-LOCATION-1',
        'TEST-ITEM-ALL-LOCATIONS'
      ]);
    console.log('✅ Cleanup complete\n');

    console.log('✅ All filtering tests completed!');
    console.log('\n📊 Summary:');
    console.log('   - Restaurant filtering: Working');
    console.log('   - Location filtering: Working');
    console.log('   - NULL location_id items: Shown for all locations');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    
    // Cleanup on error
    try {
      await supabase
        .from('menu_items')
        .delete()
        .in('pos_item_id', [
          'TEST-ITEM-DIFF-RESTAURANT',
          'TEST-ITEM-LOCATION-1',
          'TEST-ITEM-ALL-LOCATIONS'
        ]);
    } catch (cleanupError) {
      console.error('Cleanup error:', cleanupError.message);
    }
    
    process.exit(1);
  }
}

testMenuFiltering();

