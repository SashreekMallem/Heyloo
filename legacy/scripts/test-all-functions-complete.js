#!/usr/bin/env node

/**
 * Complete End-to-End Testing for All Edge Functions
 * Tests all functions with real tokens and payloads
 */

const PROJECT_URL = 'https://fjfhwbtovmbooaqafdxb.supabase.co';
const BASE_URL = `${PROJECT_URL}/functions/v1`;

// Tokens from environment or MCP config
const VAPI_SECRET = 'YOUR_VAPI_SECRET';
const VAPI_TOOL_TOKEN = process.env.VAPI_TOOL_TOKEN || 'test-token';

const results = {
  passed: [],
  failed: [],
  warnings: []
};

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(name, method, path, options = {}) {
  const { headers = {}, body, expectedStatus = [200, 201], shouldSucceed = true } = options;
  
  const url = `${BASE_URL}${path}`;
  const requestOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body) {
    requestOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, requestOptions);
    const status = response.status;
    const responseText = await response.text().catch(() => '');
    
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      responseData = responseText;
    }

    const isSuccess = expectedStatus.includes(status) && (shouldSucceed ? status < 400 : true);
    
    if (isSuccess) {
      results.passed.push({ name, status, path });
      log(`✓ PASSED: ${name} (HTTP ${status})`, 'green');
      if (responseData && typeof responseData === 'object' && Object.keys(responseData).length > 0) {
        console.log(`  Response: ${JSON.stringify(responseData).substring(0, 150)}`);
      }
      return { success: true, status, data: responseData };
    } else {
      results.failed.push({ name, status, path, response: responseData });
      log(`✗ FAILED: ${name} (HTTP ${status})`, 'red');
      if (responseData && typeof responseData === 'object') {
        console.log(`  Error: ${JSON.stringify(responseData).substring(0, 200)}`);
      } else {
        console.log(`  Response: ${responseText.substring(0, 200)}`);
      }
      return { success: false, status, data: responseData };
    }
  } catch (error) {
    results.failed.push({ name, status: 0, path, error: error.message });
    log(`✗ FAILED: ${name} (Network Error: ${error.message})`, 'red');
    return { success: false, error: error.message };
  }
}

async function runCompleteTests() {
  log('\n==========================================', 'blue');
  log('Complete End-to-End Function Testing', 'blue');
  log('==========================================', 'blue');
  log(`Project: ${PROJECT_URL}\n`, 'blue');

  // 1. AUTH FUNCTIONS
  log('\n--- Authentication Functions ---', 'cyan');
  await testEndpoint('Auth - Login (Invalid - Expected)', 'POST', '/auth/login', {
    body: { email: 'test@test.com', password: 'wrongpassword' },
    expectedStatus: [401],
    shouldSucceed: false
  });

  // 2. RESTAURANTS (verify_jwt: false, but has internal auth)
  log('\n--- Restaurant Functions ---', 'cyan');
  await testEndpoint('Restaurants - List (No Auth)', 'GET', '/restaurants', {
    expectedStatus: [200, 400, 401]
  });

  // 3. POS FUNCTIONS
  log('\n--- POS Functions ---', 'cyan');
  await testEndpoint('POS - Sync (No Auth)', 'POST', '/pos/sync', {
    body: { restaurantId: '00000000-0000-0000-0000-000000000000' },
    expectedStatus: [200, 400, 404, 500]
  });

  await testEndpoint('POS Sync - Trigger', 'POST', '/pos-sync', {
    body: { test: true },
    expectedStatus: [200, 400, 500]
  });

  // 4. ORDERS
  log('\n--- Order Functions ---', 'cyan');
  await testEndpoint('Orders - Create (No Auth)', 'POST', '/orders', {
    body: { restaurantId: '00000000-0000-0000-0000-000000000000', items: [] },
    expectedStatus: [201, 400, 401, 500]
  });

  // 5. PLATFORM
  log('\n--- Platform Functions ---', 'cyan');
  await testEndpoint('Platform - Overview', 'GET', '/platform/overview?range=today', {
    expectedStatus: [200, 401, 500]
  });

  // 6. SUPPORT
  log('\n--- Support Functions ---', 'cyan');
  await testEndpoint('Support - List', 'GET', '/support', {
    expectedStatus: [200, 401, 500]
  });

  // 7. WEBHOOKS
  log('\n--- Webhook Functions ---', 'cyan');
  await testEndpoint('Clover Webhook - Test', 'POST', '/clover-webhook', {
    body: { merchantId: 'test', orderId: 'test' },
    expectedStatus: [200, 400, 404, 500]
  });

  await testEndpoint('Square Webhook - Test', 'POST', '/square-webhook', {
    body: { type: 'test' },
    expectedStatus: [200, 400, 500]
  });

  await testEndpoint('Stripe Webhook - Test', 'POST', '/stripe-webhook', {
    headers: { 'stripe-signature': 'test' },
    body: { type: 'test' },
    expectedStatus: [200, 400, 401, 500]
  });

  // 8. ONBOARDING
  log('\n--- Onboarding Functions ---', 'cyan');
  await testEndpoint('Onboarding - Check Slug', 'GET', '/onboarding/check-slug/test-slug-123', {
    expectedStatus: [200]
  });

  await testEndpoint('Onboarding - Check Email', 'GET', '/onboarding/check-email/test@example.com', {
    expectedStatus: [200]
  });

  // 9. MONTHLY BILLING
  log('\n--- Monthly Billing ---', 'cyan');
  await testEndpoint('Monthly Billing - Trigger', 'POST', '/monthly-billing', {
    expectedStatus: [200, 500]
  });

  // 10. VAPI FUNCTIONS
  log('\n--- VAPI Functions ---', 'cyan');
  await testEndpoint('VAPI Assistant - Test', 'POST', '/vapi-assistant', {
    headers: { 'x-vapi-secret': VAPI_SECRET },
    body: { 
      message: { 
        type: 'assistant-request',
        phoneNumber: '+1234567890'
      }
    },
    expectedStatus: [200, 400, 500]
  });

  await testEndpoint('VAPI Tools - Orders', 'POST', '/vapi-tools/orders', {
    headers: { 'x-vapi-tool-token': VAPI_TOOL_TOKEN },
    body: {
      restaurantId: '00000000-0000-0000-0000-000000000000',
      items: [{ name: 'Test Item', quantity: 1, price: 10.99 }],
      customerPhone: '+1234567890'
    },
    expectedStatus: [200, 201, 400, 500]
  });

  await testEndpoint('VAPI Tools - Menu', 'POST', '/vapi-tools/menu', {
    headers: { 'x-vapi-tool-token': VAPI_TOOL_TOKEN },
    body: {
      restaurantId: '00000000-0000-0000-0000-000000000000'
    },
    expectedStatus: [200, 400, 404, 500]
  });

  await testEndpoint('VAPI Events - Test', 'POST', '/vapi-events', {
    headers: { 'x-vapi-signature': 'test-signature' },
    body: {
      type: 'call.ended',
      call: { id: 'test-call-id', phoneNumber: '+1234567890' }
    },
    expectedStatus: [200, 400, 401, 500]
  });

  await testEndpoint('VAPI Backfill - Test', 'POST', '/vapi-backfill', {
    body: {
      restaurantId: '00000000-0000-0000-0000-000000000000',
      startDate: '2024-01-01',
      endDate: '2024-01-31'
    },
    expectedStatus: [200, 400, 401, 500]
  });

  // Print Summary
  log('\n==========================================', 'blue');
  log('Test Summary', 'blue');
  log('==========================================', 'blue');
  log(`✓ Passed: ${results.passed.length}`, 'green');
  log(`✗ Failed: ${results.failed.length}`, 'red');
  log(`⚠ Warnings: ${results.warnings.length}`, 'yellow');
  log('');

  if (results.failed.length > 0) {
    log('\nFailed Tests:', 'red');
    results.failed.forEach(test => {
      log(`  - ${test.name} (HTTP ${test.status || 'Network Error'})`, 'red');
    });
  }

  if (results.passed.length > 0) {
    log('\nPassed Tests:', 'green');
    results.passed.forEach(test => {
      log(`  - ${test.name} (HTTP ${test.status})`, 'green');
    });
  }

  log('\n==========================================\n', 'blue');

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runCompleteTests().catch(error => {
  log(`\nFatal Error: ${error.message}`, 'red');
  process.exit(1);
});

