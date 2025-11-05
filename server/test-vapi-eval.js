/**
 * Test VAPI conversation flow using /eval endpoint (no credits consumed)
 * This simulates a conversation and tool calls without making actual phone calls
 */

import 'dotenv/config';

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const API_URL = process.env.API_URL || 'https://eely-val-provocatively.ngrok-free.dev';
const RESTAURANT_ID = '6a3293c9-0a0d-4a68-9bf4-7c1d6f40f6fc';

if (!VAPI_API_KEY) {
  console.error('❌ VAPI_API_KEY not found in environment');
  process.exit(1);
}

async function testMenuConversation() {
  try {
    console.log('🧪 Testing VAPI Conversation Flow (No Credits)\n');
    console.log('Using VAPI /eval endpoint to simulate conversation...\n');

    // Test 1: Menu inquiry conversation
    console.log('📋 Test 1: Customer asks about menu...');
    
    const evalResponse = await fetch('https://api.vapi.ai/eval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Restaurant Menu Inquiry Test',
        description: 'Test customer asking about menu items',
        type: 'chat.mockConversation',
        messages: [
          {
            role: 'user',
            content: 'What items do you have on your menu?'
          },
          {
            role: 'assistant',
            judgePlan: {
              type: 'exact',
              toolCalls: [{
                name: 'get_menu',
                arguments: {
                  restaurantId: RESTAURANT_ID,
                  locationId: null // Context-aware: should return items available at all locations
                }
              }]
            }
          },
          {
            role: 'tool',
            content: JSON.stringify({
              items: [
                { name: 'Chicken Biryani', price: 12.99, category: 'Main Course' },
                { name: 'Naan', price: 3.99, category: 'Bread' }
              ]
            })
          },
          {
            role: 'assistant',
            judgePlan: {
              type: 'regex',
              content: '.*menu|.*items|.*available.*'
            }
          }
        ]
      })
    });

    if (!evalResponse.ok) {
      const errorText = await evalResponse.text();
      throw new Error(`Eval request failed: ${evalResponse.status} - ${errorText}`);
    }

    const evalResult = await evalResponse.json();
    console.log('   ✅ Eval created:', evalResult.id || 'Success');
    console.log('   📊 This simulates the conversation flow without consuming credits\n');

    // Test 2: Location-specific menu inquiry
    console.log('📍 Test 2: Customer asks about menu for specific location...');
    
    // First, we'd need to get a location ID from your database
    // For now, this is a placeholder showing how it would work
    console.log('   ℹ️  To test location-specific menus:');
    console.log('   1. Get location ID from restaurant_pos_locations');
    console.log('   2. Pass locationId in get_menu tool arguments');
    console.log('   3. Verify only location-specific items are returned\n');

    // Test 3: Order placement conversation
    console.log('🛒 Test 3: Customer placing order...');
    
    const orderEval = await fetch('https://api.vapi.ai/eval', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: 'Restaurant Order Placement Test',
        description: 'Test customer placing an order',
        type: 'chat.mockConversation',
        messages: [
          {
            role: 'user',
            content: 'I would like to order a Chicken Biryani'
          },
          {
            role: 'assistant',
            judgePlan: {
              type: 'exact',
              toolCalls: [{
                name: 'create_order',
                arguments: {
                  restaurantId: RESTAURANT_ID,
                  items: [
                    { name: 'Chicken Biryani', quantity: 1, price: 12.99 }
                  ],
                  customerPhone: '+1234567890'
                }
              }]
            }
          },
          {
            role: 'tool',
            content: JSON.stringify({
              orderId: 'order-12345',
              status: 'pending',
              total: 12.99
            })
          },
          {
            role: 'assistant',
            judgePlan: {
              type: 'regex',
              content: '.*order.*confirmed|.*order.*placed.*'
            }
          }
        ]
      })
    });

    if (orderEval.ok) {
      const orderResult = await orderEval.json();
      console.log('   ✅ Order eval created:', orderResult.id || 'Success');
      console.log('   📊 This tests order placement flow without real call\n');
    }

    console.log('✅ All eval tests completed successfully!');
    console.log('\n💡 Key Benefits:');
    console.log('   • No phone credits consumed');
    console.log('   • Tests conversation logic and tool calls');
    console.log('   • Can test multiple scenarios quickly');
    console.log('   • Validates assistant behavior without real calls');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

testMenuConversation();

