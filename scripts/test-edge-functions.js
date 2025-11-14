#!/usr/bin/env node

/**
 * Comprehensive Edge Functions Testing Script
 * Tests all Supabase Edge Functions with proper error handling
 */

const PROJECT_URL = 'https://fjfhwbtovmbooaqafdxb.supabase.co';
const BASE_URL = `${PROJECT_URL}/functions/v1`;

// Test results
const results = {
  passed: [],
  failed: [],
  skipped: []
};

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testEndpoint(name, method, path, options = {}) {
  const { headers = {}, body, expectedStatus = [200, 201, 400, 401, 403] } = options;
  
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

    if (expectedStatus.includes(status)) {
      if (status >= 200 && status < 300) {
        results.passed.push({ name, status, path });
        log(`✓ PASSED: ${name} (HTTP ${status})`, 'green');
        return { success: true, status, data: responseData };
      } else if (status === 401 || status === 403) {
        results.skipped.push({ name, status, path, reason: 'Auth required' });
        log(`⊘ SKIPPED: ${name} (HTTP ${status} - Auth required)`, 'yellow');
        return { success: true, status, skipped: true, data: responseData };
      } else if (status === 400) {
        results.passed.push({ name, status, path });
        log(`✓ PASSED: ${name} (HTTP ${status} - Expected validation error)`, 'green');
        return { success: true, status, data: responseData };
      }
    }

    results.failed.push({ name, status, path, response: responseData });
    log(`✗ FAILED: ${name} (HTTP ${status})`, 'red');
    if (responseData && typeof responseData === 'object') {
      console.log('  Error:', JSON.stringify(responseData).substring(0, 200));
    }
    return { success: false, status, data: responseData };
  } catch (error) {
    results.failed.push({ name, status: 0, path, error: error.message });
    log(`✗ FAILED: ${name} (Network Error: ${error.message})`, 'red');
    return { success: false, error: error.message };
  }
}

async function runTests() {
  log('\n==========================================', 'blue');
  log('Edge Functions Testing Suite', 'blue');
  log('==========================================', 'blue');
  log(`Project: ${PROJECT_URL}\n`, 'blue');

  // 1. CORS Preflight Tests
  log('\n--- CORS Preflight Tests ---', 'yellow');
  await testEndpoint('Auth - CORS', 'OPTIONS', '/auth/login');
  await testEndpoint('Restaurants - CORS', 'OPTIONS', '/restaurants');
  await testEndpoint('POS - CORS', 'OPTIONS', '/pos/sync');
  await testEndpoint('Orders - CORS', 'OPTIONS', '/orders');

  // 2. Public Endpoints (No Auth Required)
  log('\n--- Public Endpoints ---', 'yellow');
  await testEndpoint('Onboarding - Check Slug', 'GET', '/onboarding/check-slug/test-slug', {
    expectedStatus: [200, 400]
  });
  
  await testEndpoint('POS Sync - Trigger', 'POST', '/pos-sync', {
    body: { restaurantId: 'test-restaurant-id' },
    expectedStatus: [200, 400, 404, 500]
  });

  // 3. Auth Endpoints
  log('\n--- Authentication Tests ---', 'yellow');
  await testEndpoint('Auth - Login (Invalid Credentials)', 'POST', '/auth/login', {
    body: { email: 'test@test.com', password: 'wrongpassword' },
    expectedStatus: [401, 400]
  });

  await testEndpoint('Auth - Refresh (Invalid Token)', 'POST', '/auth/refresh', {
    body: { refreshToken: 'invalid-token' },
    expectedStatus: [401, 400]
  });

  // 4. Webhook Endpoints (May fail without proper signatures)
  log('\n--- Webhook Endpoints ---', 'yellow');
  await testEndpoint('Clover Webhook - Health', 'POST', '/clover-webhook', {
    body: { type: 'test' },
    expectedStatus: [200, 400, 401, 500]
  });

  await testEndpoint('Square Webhook - Health', 'POST', '/square-webhook', {
    body: { type: 'test' },
    expectedStatus: [200, 400, 401, 500]
  });

  await testEndpoint('Stripe Webhook - Health', 'POST', '/stripe-webhook', {
    headers: { 'stripe-signature': 'test-signature' },
    body: { type: 'test' },
    expectedStatus: [200, 400, 401, 500]
  });

  await testEndpoint('VAPI Events - Health', 'POST', '/vapi-events', {
    headers: { 'x-vapi-signature': 'test-signature' },
    body: { type: 'test' },
    expectedStatus: [200, 400, 401, 500]
  });

  // 5. Protected Endpoints (Will skip without auth)
  log('\n--- Protected Endpoints (Require Auth) ---', 'yellow');
  await testEndpoint('Restaurants - List', 'GET', '/restaurants', {
    expectedStatus: [200, 401, 403]
  });

  await testEndpoint('Restaurants - Get by ID', 'GET', '/restaurants/test-id', {
    expectedStatus: [200, 401, 403, 404]
  });

  await testEndpoint('Orders - Create', 'POST', '/orders', {
    body: { restaurantId: 'test' },
    expectedStatus: [201, 400, 401, 403]
  });

  await testEndpoint('Platform - Overview', 'GET', '/platform/overview?range=today', {
    expectedStatus: [200, 401, 403]
  });

  await testEndpoint('Support - List', 'GET', '/support', {
    expectedStatus: [200, 401, 403]
  });

  await testEndpoint('POS - Sync', 'POST', '/pos/sync', {
    body: { restaurantId: 'test' },
    expectedStatus: [200, 400, 401, 403]
  });

  // 6. VAPI Endpoints
  log('\n--- VAPI Endpoints ---', 'yellow');
  await testEndpoint('VAPI Assistant - Health', 'POST', '/vapi-assistant', {
    headers: { 'x-vapi-secret': 'test-secret' },
    body: { message: { type: 'assistant-request' } },
    expectedStatus: [200, 400, 401, 500]
  });

  await testEndpoint('VAPI Tools - Health', 'POST', '/vapi-tools', {
    headers: { 'x-vapi-tool-token': 'test-token' },
    body: { message: { type: 'tool-calls' } },
    expectedStatus: [200, 400, 401, 500]
  });

  // Print Summary
  log('\n==========================================', 'blue');
  log('Test Summary', 'blue');
  log('==========================================', 'blue');
  log(`✓ Passed: ${results.passed.length}`, 'green');
  log(`✗ Failed: ${results.failed.length}`, 'red');
  log(`⊘ Skipped: ${results.skipped.length}`, 'yellow');
  log('');

  if (results.failed.length > 0) {
    log('\nFailed Tests:', 'red');
    results.failed.forEach(test => {
      log(`  - ${test.name} (HTTP ${test.status})`, 'red');
    });
  }

  if (results.skipped.length > 0) {
    log('\nSkipped Tests (Auth Required):', 'yellow');
    results.skipped.forEach(test => {
      log(`  - ${test.name}`, 'yellow');
    });
  }

  log('\n==========================================\n', 'blue');

  // Exit with appropriate code
  process.exit(results.failed.length > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  log(`\nFatal Error: ${error.message}`, 'red');
  process.exit(1);
});

