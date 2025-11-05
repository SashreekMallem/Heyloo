# VAPI → Supabase → POS Flow

## ✅ VAPI Calls Supabase (Yes!)

### VAPI Tool Endpoints → Supabase Queries:

| VAPI Tool | Endpoint | Supabase Table | Action |
|-----------|----------|----------------|--------|
| **get_menu** | `GET /vapi/tools/menu` | `menu_items` | ✅ Reads from Supabase |
| **find_or_create_customer** | `POST /vapi/tools/customer` | `customers` | ✅ Creates/reads Supabase |
| **get_customer_addresses** | `GET /vapi/tools/customer-addresses` | `customer_addresses` | ✅ Reads from Supabase |
| **create_order** | `POST /vapi/tools/orders` | `orders` | ✅ Inserts into Supabase |
| **check_order_status** | `GET /vapi/tools/orders/:id/status` | `orders` | ✅ Reads from Supabase |
| **update_order_status** | `POST /vapi/tools/orders/:id/status` | `orders` | ✅ Updates Supabase |

### Code References:

**Menu Query** (`server/src/services/restaurant-service.ts`):
```typescript
// listMenuItems() queries Supabase.menu_items
const { data } = await supabase
  .from('menu_items')
  .select('*')
  .eq('restaurant_id', restaurantId)
```

**Customer Creation** (`server/src/services/customer-service.ts`):
```typescript
// findOrCreateCustomer() queries/inserts Supabase.customers
const { data: existing } = await supabase
  .from('customers')
  .select('*')
  .eq('restaurant_id', restaurantId)
  .eq('phone', phoneNumber)
  .maybeSingle();

if (!existing) {
  await supabase.from('customers').insert({...});
}
```

**Order Creation** (`server/src/services/order-service.ts`):
```typescript
// createOrder() inserts into Supabase.orders
const { data: insertedOrder } = await supabase
  .from('orders')
  .insert({...})
  .select('*')
```

**Order Status** (`server/src/routes/v1/vapi-tools.ts` line 85):
```typescript
// Direct Supabase query for order status
const { data: order } = await supabase
  .from('orders')
  .select('id,status,payment_status,total,placed_at,customer_name')
  .eq('id', orderId)
```

---

## ✅ Supabase in Sync with POS (Yes!)

### 1. Menu Sync: POS → Supabase

**Flow**:
```
POS System (Square/Clover/Toast)
  ↓
integration.pullMenu()
  ↓
Supabase.menu_items.upsert()
  ↓
Menu available for VAPI calls
```

**Code**: `server/src/services/pos-service.ts`
- Pulls menu from POS
- Upserts to Supabase `menu_items` table
- VAPI `get_menu` tool reads from this table

### 2. Order Push: Supabase → POS

**Flow**:
```
VAPI creates order
  ↓
Supabase.orders.insert()
  ↓
pushOrderToPOS()
  ↓
POS System creates order
  ↓
Supabase.orders.update(pos_order_id, pos_sync_status)
```

**Code**: `server/src/services/pos-push-service.ts`
- Order saved to Supabase first
- Then pushed to POS
- POS order ID saved back to Supabase

### 3. Order Updates: POS → Supabase

**Flow**:
```
POS System updates order
  ↓
Webhook (Square/Clover)
  ↓
Update Supabase.orders
  ↓
VAPI can query updated status
```

**Code**: 
- `server/src/routes/webhooks/square.ts` - Updates Supabase
- `server/src/routes/webhooks/clover.ts` - Updates Supabase

---

## Complete Flow Diagram

### Customer Calls Restaurant → Order Created:

```
1. Customer calls → VAPI Assistant
   ↓
2. VAPI calls: GET /vapi/tools/menu
   → Reads from Supabase.menu_items (synced from POS)
   ↓
3. VAPI calls: POST /vapi/tools/customer
   → Creates/reads from Supabase.customers
   ↓
4. VAPI calls: POST /vapi/tools/orders
   → Inserts into Supabase.orders
   → Triggers pushOrderToPOS()
   ↓
5. pushOrderToPOS() 
   → Pushes order to POS System (Square/Clover)
   → Updates Supabase.orders with pos_order_id
   ↓
6. POS System processes order
   → Webhook fires
   → Updates Supabase.orders.status
   ↓
7. Customer asks for status
   → VAPI calls: GET /vapi/tools/orders/:id/status
   → Reads from Supabase.orders (latest status from POS)
```

---

## ✅ Synchronization Status

| Sync Direction | Status | Method |
|----------------|--------|--------|
| **POS → Supabase (Menu)** | ✅ Active | Automatic cron (every 4 hours) + Manual API |
| **Supabase → POS (Orders)** | ✅ Active | Automatic push when order created |
| **POS → Supabase (Order Updates)** | ✅ Active | Webhooks from Square/Clover |
| **VAPI → Supabase (Read/Write)** | ✅ Active | All VAPI tools query/update Supabase |

---

## ✅ Verification

**All VAPI tools make Supabase calls:**
- ✅ Menu: Reads from Supabase
- ✅ Customers: Reads/writes to Supabase
- ✅ Orders: Writes to Supabase
- ✅ Order Status: Reads from Supabase (which has POS updates via webhooks)

**Supabase is synchronized with POS:**
- ✅ Menu synced from POS to Supabase
- ✅ Orders pushed from Supabase to POS
- ✅ Order updates synced from POS to Supabase via webhooks
- ✅ Two-way sync is working

**Status**: 🟢 **FULLY SYNCED & SEAMLESS**

