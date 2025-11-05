# Integration Verification - Supabase, Webhooks & Sync

## ✅ Supabase Integration Status

### Orders
- **✅ Orders saved to Supabase**: `server/src/services/order-service.ts`
  - Inserts into `orders` table (line 184-212)
  - Records usage via `record_order_usage` RPC (line 226-230)
  - Updates customer totals via `increment_customer_totals` RPC (line 221-224)

### Menu Items
- **✅ Menu sync saves to Supabase**: `server/src/services/pos-service.ts`
  - Upserts to `menu_items` table (line 50-62)
  - Logs sync to `pos_sync_log` table (line 73-79)
  - Handles Square, Clover, and Toast

### POS Sync Status
- **✅ Orders update POS sync status**: Updates `pos_sync_status` in orders table
- **✅ Sync logging**: All syncs logged to `pos_sync_log` table

---

## ✅ Webhook URLs & Routes

### Configured Webhook Endpoints:

| Provider | Endpoint | Method | Purpose |
|----------|----------|--------|---------|
| **Square** | `/v1/webhooks/square` | POST | Receive order updates, OAuth revocations |
| **Clover** | `/v1/webhooks/clover` | GET/POST | Verification & order/payment updates |
| **Stripe** | `/v1/webhooks/stripe` | POST | Payment confirmations |
| **VAPI** | `/v1/webhooks/vapi` | POST | Call events, order creation |

### Webhook URLs for External Services:

**Square Webhook URL:**
```
https://your-domain.com/v1/webhooks/square
```
Configure in: Square Developer Dashboard → Webhooks

**Clover Webhook URL:**
```
https://your-domain.com/v1/webhooks/clover
```
Configure in: Clover Developer Dashboard → App Settings → Webhooks

**Stripe Webhook URL:**
```
https://your-domain.com/v1/webhooks/stripe
```
Configure in: Stripe Dashboard → Developers → Webhooks

**VAPI Webhook URL:**
```
https://your-domain.com/v1/webhooks/vapi
```
Configure in: VAPI Dashboard → Assistant Settings → Webhooks

---

## ✅ Webhook Integration with Supabase

### Square Webhooks → Supabase
**File**: `server/src/routes/webhooks/square.ts`
- **Order Updates**: Updates `orders` table when Square order state changes (line 64-82)
- **OAuth Revocation**: Clears POS credentials from `restaurants` table (line 86-113)
- **✅ Saves to Supabase**: Yes - directly updates orders and restaurants tables

### Clover Webhooks → Supabase
**File**: `server/src/routes/webhooks/clover.ts`
- **Order Updates**: Updates `orders` table when Clover order changes (line 19-52)
- **Merchant Updates**: Logs merchant changes (line 45-67)
- **Inventory Updates**: Triggers menu sync (line 60-77)
- **✅ Saves to Supabase**: Yes - updates orders table

### Stripe Webhooks → Supabase
**File**: `server/src/routes/webhooks/stripe.ts`
- **Payment Confirmation**: Updates `orders` table payment status
- **✅ Saves to Supabase**: Yes - updates orders table

---

## ✅ Menu Sync Flow

### Automatic Sync (Cron Job)
**File**: `server/src/jobs/cron.ts`
- **Schedule**: Every 4 hours (`0 */4 * * *`)
- **Process**:
  1. Fetches all active restaurants with POS integration (line 18-22)
  2. Calls `syncMenuFromPos()` for each restaurant (line 42)
  3. Saves to Supabase `menu_items` table (via pos-service.ts)
  4. Logs sync to `pos_sync_log` table

### Manual Sync (API)
**Endpoint**: `POST /v1/pos/:restaurantId/sync-menu`
- **File**: `server/src/routes/v1/pos.ts`
- **Process**: Same as cron - saves directly to Supabase

---

## ✅ Order Push to POS Flow

### Order Created → POS Push
**File**: `server/src/services/order-service.ts`
1. Order created → Saved to Supabase `orders` table (line 184-212)
2. If POS configured → Calls `pushOrderToPOS()` (line 239)
3. **File**: `server/src/services/pos-push-service.ts`
   - Fetches order from Supabase (line 21-26)
   - Fetches restaurant config from Supabase (line 34-38)
   - Pushes to Square/Clover/Toast
   - Updates order in Supabase with `pos_order_id` and `pos_sync_status` (line 107-117)

### Retry Logic
- **Max Retries**: 3 attempts (line 8)
- **Delays**: 5s, 15s, 60s (line 9)
- **Failure Handling**: Marks as 'manual' in Supabase, alerts staff

---

## ✅ Seamless Flow Summary

### 1. Menu Sync Flow:
```
POS System → Integration.pullMenu() → Supabase.menu_items.upsert()
```

### 2. Order Creation Flow:
```
Voice/Dashboard → createOrder() → Supabase.orders.insert()
  → pushOrderToPOS() → POS System
  → Update Supabase with pos_order_id
```

### 3. Order Update Flow:
```
POS System → Webhook → Update Supabase.orders
```

### 4. Payment Flow:
```
Stripe Payment → Webhook → Update Supabase.orders.payment_status
  → pushOrderToPOS() (if not already pushed)
```

---

## 🔧 Configuration Required

### Environment Variables:
```env
API_URL=https://your-domain.com  # For OAuth callbacks and webhook base URL
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### Webhook Configuration:
1. **Square**: Configure webhook URL in Developer Dashboard
2. **Clover**: Configure webhook URL in App Settings
3. **Stripe**: Configure webhook URL in Dashboard
4. **VAPI**: Configure webhook URL in Assistant Settings

---

## ✅ Everything is Connected!

- ✅ All integrations call Supabase
- ✅ Menu sync saves to Supabase
- ✅ Orders save to Supabase
- ✅ Webhooks update Supabase
- ✅ POS push reads from Supabase
- ✅ Cron jobs sync from Supabase
- ✅ All flows are seamless and automated

**Status**: 🟢 **FULLY INTEGRATED**

