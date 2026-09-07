# Edge Functions Testing Guide

## Overview

This guide documents all Supabase Edge Functions, their purposes, and how to test them.

**Project URL:** `https://fjfhwbtovmbooaqafdxb.supabase.co`

---

## Function Catalog

### 1. **auth** - Authentication Service
**Purpose:** User authentication (login, refresh tokens, password management)

**Endpoints:**
- `POST /auth/login` - User login
- `POST /auth/refresh` - Refresh access token
- `POST /auth/forgot-password` - Request password reset
- `POST /auth/reset-password` - Reset password with token

**Auth Required:** No (public endpoints)

**Test:**
```bash
# Login
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'

# Refresh token
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your_refresh_token"}'
```

---

### 2. **restaurants** - Restaurant Management
**Purpose:** CRUD operations for restaurants, POS integration, manual orders

**Endpoints:**
- `GET /restaurants` - List restaurants (with filters)
- `GET /restaurants/:id` - Get restaurant details
- `POST /restaurants` - Create restaurant
- `PATCH /restaurants/:id` - Update restaurant
- `DELETE /restaurants/:id` - Delete restaurant
- `POST /restaurants/:id/orders/manual` - Create manual order
- `GET /restaurants/:id/pos/locations` - Get POS locations
- `POST /restaurants/:id/pos/locations` - Add POS location
- `PATCH /restaurants/:id/pos/locations/:locationId` - Update POS location

**Auth Required:** Yes (JWT Bearer token)

**Test:**
```bash
# Get restaurants (requires auth token)
curl -X GET https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/restaurants \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

---

### 3. **pos** - POS Integration Management
**Purpose:** Main POS operations (sync, create orders, get items, sync logs)

**Endpoints:**
- `POST /pos/sync` - Trigger manual sync
- `POST /pos/orders` - Create order in POS
- `GET /pos/items` - Get POS items/menu
- `GET /pos/sync-logs` - Get sync history

**Auth Required:** Yes

**Test:**
```bash
# Sync POS data
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/pos/sync \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"restaurant-uuid"}'
```

---

### 4. **pos-sync** - Manual POS Sync
**Purpose:** Manual synchronization of POS data (items, orders, etc.)

**Endpoints:**
- `POST /` - Trigger sync for a restaurant

**Auth Required:** No (`verify_jwt: false`)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/pos-sync \
  -H "Content-Type: application/json" \
  -d '{"restaurantId":"restaurant-uuid"}'
```

---

### 5. **pos-push** - Push Orders to POS
**Purpose:** Push orders from Heyloo to POS systems (Clover, Square)

**Endpoints:**
- `POST /` - Push order to POS

**Auth Required:** No (`verify_jwt: false`)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/pos-push \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "order-uuid",
    "restaurantId": "restaurant-uuid"
  }'
```

---

### 6. **clover-webhook** - Clover POS Webhook Handler
**Purpose:** Receives webhooks from Clover POS (order updates, payment events)

**Endpoints:**
- `POST /` - Handle Clover webhook events

**Auth Required:** No (`verify_jwt: false` - webhooks don't use JWT)

**Test:**
```bash
# Simulate Clover webhook
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/clover-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ORDER_UPDATED",
    "merchantId": "merchant-id",
    "objectId": "order-id"
  }'
```

---

### 7. **square-webhook** - Square POS Webhook Handler
**Purpose:** Receives webhooks from Square POS

**Endpoints:**
- `POST /` - Handle Square webhook events

**Auth Required:** No

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/square-webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"order.updated","data":{"object":{"order":{"id":"order-id"}}}}'
```

---

### 8. **stripe-webhook** - Stripe Payment Webhook Handler
**Purpose:** Handles Stripe payment events (subscriptions, payments, invoices)

**Endpoints:**
- `POST /` - Handle Stripe webhook events

**Auth Required:** No (uses Stripe signature verification)

**Test:**
```bash
# Note: Stripe webhooks require proper signature
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/stripe-webhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: signature" \
  -d '{"type":"payment_intent.succeeded","data":{"object":{}}}'
```

---

### 9. **orders** - Order Management
**Purpose:** Create and manage orders

**Endpoints:**
- `POST /` - Create new order
- `PATCH /:orderId/status` - Update order status

**Auth Required:** Yes

**Test:**
```bash
# Create order
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/orders \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "restaurant-uuid",
    "items": [{"name":"Pizza","quantity":1,"price":15.99}],
    "customerName": "John Doe",
    "customerPhone": "+1234567890"
  }'

# Update order status
curl -X PATCH https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/orders/order-uuid/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'
```

---

### 10. **onboarding** - Restaurant Onboarding
**Purpose:** Complete restaurant onboarding flow (create restaurant, admin user, POS connection)

**Endpoints:**
- `POST /` - Complete onboarding
- `GET /status/:restaurantId` - Check onboarding status

**Auth Required:** No (public onboarding)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/onboarding \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantName": "Test Restaurant",
    "ownerEmail": "owner@test.com",
    "adminPassword": "secure123",
    "phoneNumber": "+1234567890",
    "posType": "clover"
  }'
```

---

### 11. **platform** - Platform Admin Dashboard
**Purpose:** Platform-wide metrics and analytics for admins

**Endpoints:**
- `GET /overview?range=today` - Platform overview metrics
- `GET /restaurants?range=today` - Restaurant summaries
- `GET /analytics/timeline?range=today` - Usage timeline
- `GET /analytics/call-center?range=today` - Call center metrics

**Auth Required:** Yes (platform_admin role)

**Test:**
```bash
curl -X GET "https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/platform/overview?range=today" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

### 12. **support** - Support Ticket Management
**Purpose:** Create and manage support tickets

**Endpoints:**
- `POST /` - Create support ticket
- `GET /` - List support tickets
- `GET /:id` - Get ticket details
- `POST /:id/notes` - Add note to ticket

**Auth Required:** Yes

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/support \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "Issue with POS sync",
    "description": "POS sync is not working",
    "priority": "high"
  }'
```

---

### 13. **monthly-billing** - Monthly Billing Processing
**Purpose:** Process monthly subscription billing for restaurants

**Endpoints:**
- `POST /` - Process monthly billing

**Auth Required:** No (internal/cron job)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/monthly-billing \
  -H "Content-Type: application/json"
```

---

### 14. **vapi-assistant** - VAPI Assistant Integration
**Purpose:** Handles VAPI assistant requests (call routing, phone number lookup)

**Endpoints:**
- `POST /` - Handle assistant-request messages from VAPI

**Auth Required:** No (uses VAPI secret header)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/vapi-assistant \
  -H "Content-Type: application/json" \
  -H "x-vapi-secret: YOUR_VAPI_SECRET" \
  -d '{
    "message": {
      "type": "assistant-request",
      "phoneNumber": "+1234567890"
    }
  }'
```

---

### 15. **vapi-tools** - VAPI Tool Calls
**Purpose:** Handles VAPI tool calls (create orders, get menu, etc.)

**Endpoints:**
- `POST /orders` - Create order via VAPI
- `POST /menu` - Get restaurant menu
- `POST /hours` - Get restaurant hours
- `POST /` - Generic tool call handler

**Auth Required:** No (uses VAPI tool token)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/vapi-tools/orders \
  -H "Content-Type: application/json" \
  -H "x-vapi-tool-token: YOUR_VAPI_TOOL_TOKEN" \
  -d '{
    "restaurantId": "restaurant-uuid",
    "items": [{"name":"Pizza","quantity":1}],
    "customerPhone": "+1234567890"
  }'
```

---

### 16. **vapi-events** - VAPI Webhook Events
**Purpose:** Handles VAPI webhook events (call logs, function calls, end-of-call reports)

**Endpoints:**
- `POST /` - Handle VAPI events

**Auth Required:** No (uses VAPI signature verification)

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/vapi-events \
  -H "Content-Type: application/json" \
  -H "x-vapi-signature: signature" \
  -d '{
    "type": "call.ended",
    "call": {
      "id": "call-id",
      "phoneNumber": "+1234567890"
    }
  }'
```

---

### 17. **vapi-backfill** - VAPI Call Log Backfill
**Purpose:** Backfill historical call logs from VAPI

**Endpoints:**
- `POST /` - Trigger backfill

**Auth Required:** Yes

**Test:**
```bash
curl -X POST https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/vapi-backfill \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "restaurant-uuid",
    "startDate": "2024-01-01",
    "endDate": "2024-01-31"
  }'
```

---

## Testing Strategy

### 1. **Health Checks**
Test each function responds to OPTIONS (CORS preflight):
```bash
curl -X OPTIONS https://fjfhwbtovmbooaqafdxb.supabase.co/functions/v1/FUNCTION_NAME
```

### 2. **Authentication Tests**
- Test login endpoint
- Verify JWT token generation
- Test token refresh
- Test invalid credentials

### 3. **Authorization Tests**
- Test with valid JWT
- Test with invalid/expired JWT
- Test role-based access (restaurant_admin vs platform_admin)

### 4. **Webhook Tests**
- Test webhook signature verification
- Test webhook event handling
- Test invalid webhook payloads

### 5. **Integration Tests**
- Test POS sync flow
- Test order creation → POS push flow
- Test VAPI call → order creation flow

### 6. **Error Handling**
- Test invalid input validation
- Test missing required fields
- Test database errors
- Test external API failures

---

## Monitoring & Logs

### View Function Logs
```bash
# Using Supabase CLI
supabase functions logs FUNCTION_NAME

# Or via Dashboard
# Go to: Edge Functions > FUNCTION_NAME > Logs
```

### Check Function Status
```bash
# List all functions
supabase functions list

# Get function details
supabase functions get FUNCTION_NAME
```

---

## Common Issues & Debugging

### 401 Unauthorized
- Check JWT token is valid and not expired
- Verify `Authorization: Bearer TOKEN` header format
- Check `verify_jwt` setting in `config.toml`

### 403 Forbidden
- Verify user has correct role/permissions
- Check restaurant access restrictions

### 500 Internal Server Error
- Check function logs for error details
- Verify environment variables are set
- Check database connection
- Verify external API credentials

### CORS Issues
- Verify CORS headers in function response
- Check OPTIONS request handling

---

## Automated Testing Script

See `scripts/test-edge-functions.sh` for automated testing script.

