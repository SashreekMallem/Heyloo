// Test script to simulate VAPI calling the menu endpoint
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

const API_URL = process.env.API_URL || 'http://localhost:4000';
const VAPI_TOOL_TOKEN = process.env.VAPI_TOOL_TOKEN || process.env.VAPI_TOOL_AUTH_TOKEN || process.env.VAPI_API_KEY;
const RESTAURANT_ID = '6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc';

async function testVapiMenuCall() {
  try {
    console.log('🔍 Testing VAPI Menu Endpoint...\n');
    console.log('📋 Configuration:');
    console.log(`   API URL: ${API_URL}`);
    console.log(`   Restaurant ID: ${RESTAURANT_ID}`);
    console.log(`   Has VAPI Token: ${!!VAPI_TOOL_TOKEN}`);
    console.log('');

    if (!VAPI_TOOL_TOKEN) {
      console.error('❌ VAPI_TOOL_TOKEN or VAPI_API_KEY not found in environment');
      console.error('   Please set VAPI_TOOL_TOKEN in your .env file');
      process.exit(1);
    }

    // Test 1: Call menu endpoint as VAPI would
    console.log('🔍 Test 1: Calling /v1/vapi/tools/menu endpoint...');
    const menuUrl = `${API_URL}/v1/vapi/tools/menu?restaurantId=${RESTAURANT_ID}`;
    
    console.log(`   URL: ${menuUrl}`);
    console.log(`   Method: GET`);
    console.log(`   Headers: x-vapi-tool-token: ${VAPI_TOOL_TOKEN.substring(0, 20)}...`);

    const response = await fetch(menuUrl, {
      method: 'GET',
      headers: {
        'x-vapi-tool-token': VAPI_TOOL_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    console.log(`\n   Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`\n❌ Error: ${errorText}`);
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const menuData = await response.json();
    
    console.log(`\n✅ Success! Menu data received:`);
    console.log(`   Total items: ${menuData.items?.length || 0}`);
    
    if (menuData.items && menuData.items.length > 0) {
      console.log(`\n📋 Sample menu items (first 5):`);
      menuData.items.slice(0, 5).forEach((item, i) => {
        console.log(`   ${i + 1}. ${item.name} - $${item.price?.toFixed(2) || 'N/A'}`);
        if (item.description) {
          console.log(`      ${item.description}`);
        }
        if (item.category) {
          console.log(`      Category: ${item.category}`);
        }
      });
    }

    // Test 2: Test with location ID (if we have one)
    console.log('\n\n🔍 Test 2: Calling menu with location_id parameter...');
    
    // Get location ID from database first
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    const { data: location } = await supabase
      .from('restaurant_pos_locations')
      .select('id')
      .eq('restaurant_id', RESTAURANT_ID)
      .eq('is_active', true)
      .maybeSingle();

    if (location) {
      const menuUrlWithLocation = `${API_URL}/v1/vapi/tools/menu?restaurantId=${RESTAURANT_ID}&locationId=${location.id}`;
      console.log(`   URL: ${menuUrlWithLocation}`);
      
      const response2 = await fetch(menuUrlWithLocation, {
        method: 'GET',
        headers: {
          'x-vapi-tool-token': VAPI_TOOL_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      if (response2.ok) {
        const menuData2 = await response2.json();
        console.log(`   ✅ Success! Items with location filter: ${menuData2.items?.length || 0}`);
      } else {
        const errorText = await response2.text();
        console.log(`   ⚠️  Response: ${response2.status} - ${errorText}`);
      }
    } else {
      console.log('   ℹ️  No location found, skipping location filter test');
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('\n📝 Summary:');
    console.log('   - VAPI menu endpoint is accessible');
    console.log('   - Authentication works correctly');
    console.log('   - Menu items are being returned');
    console.log('   - Ready for VAPI to call during actual phone calls');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testVapiMenuCall();

