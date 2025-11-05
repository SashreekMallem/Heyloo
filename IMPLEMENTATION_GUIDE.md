# THE COMPLETE END-TO-END IMPLEMENTATION GUIDE (Revised with Best Practices)

---

## 🎯 COMPLETE SYSTEM ARCHITECTURE

**System Flow:**

```
Customer Calls
    ↓
VAPI (Voice Layer + Observability Hooks)
    ↓
Your Webhook Server (Routing + Business Logic)
    ↓
Supabase Database (Multi-Tenant with RLS)
    ↓
POS APIs (Async Integration with Failover)
    ↓
Stripe (Payment Links - PCI-Compliant)
```

***

## 🚀 Implementation Snapshot (February 2025)

The repository now ships a working productized stack that maps directly to the blueprint above. Key entry points:

- **Monorepo layout:** root `package.json` declares npm workspaces for `server/`, `dashboard/`, and `packages/shared/` to share types and schemas.
- **Server (`server/`):** Express + TypeScript voice/billing API. Notable modules:
  - `src/routes/v1/*` expose auth, platform analytics, restaurant data, order management, and VAPI webhook handlers.
  - `src/services/*` encapsulate Supabase + Stripe + Vapi logic (order creation, call logging, customer lifecycle).
  - `src/lib/supabase.ts` uses the MCP Supabase read/write server (service role) while still enforcing tenant isolation in code and SQL policies.
  - `src/lib/stripe.ts` centralizes Stripe instantiation and is reused by payment flows and webhook signature checks.
- **Supabase (`supabase/`):** migration `20250214_initial_schema.sql` provisions every table, RLS policy, and stored procedure referenced in the docs (`record_call_usage`, `record_order_usage`, `increment_customer_totals`, `restaurant_usage_summary` view). `seed/seed.sql` bootstraps demo restaurants, users, and menu items.
- **Shared package (`packages/shared/`):** houses `zod` schemas + TypeScript types used by both the API and dashboards (orders, metrics payloads, JWTs, Vapi events).
- **Dashboard (`dashboard/`):** Vite + React + Tailwind UI with dual personas. Platform routes under `/platform/*` mirror the analytics sections described later; restaurant routes under `/restaurant/*` surface KPI boards, live calls, and menu management.
- **Marketing site:** A premium landing experience now lives at `/`, with supporting legal pages (`/privacy`, `/terms`) and a concierge support hub (`/support`). Assets (logo mark, gradients) reside in `dashboard/src/assets` and reuse the Tailwind design tokens shipped with the app.
- **Tests:** Vitest harness for the API (`server/test/app.test.ts`) and front-end session store (`dashboard/src/hooks/useAuthStore.test.ts`) give smoke coverage for health checks and auth state.

Run `npm install` at the repo root to hydrate all workspaces, then:

```
npm run dev:api           # express voice API on http://localhost:4000
npm run dev:dashboard     # Vite dashboard on http://localhost:5173
```

Supabase migrations apply via MCP (`supabase db push`) or the provided SQL. Seeds give you a platform admin (`admin@heyloo.ai` / `password`) and a restaurant admin for Imperial Biryani.

***

## 📊 PART 1: DATABASE SCHEMA (Complete with Payment Support)

**Stack Decision:**[1][2][3][4]
- **Database:** Supabase (PostgreSQL with built-in RLS)
- **Why:** Free tier generous, RLS proven for multi-tenant, real-time subscriptions, webhook support

### **Complete Database Tables:**

**1. RESTAURANTS TABLE (Main Tenant Table)**
Stores information about each restaurant using the platform:
- Basic info: ID (UUID), name, slug (URL-friendly name), owner email
- VAPI integration: Unique phone number assigned to restaurant
- POS Integration settings:
  - POS type (Square, Toast, Clover, or none)
  - Access tokens and credentials for each POS system
  - Webhook signatures for security
- Payment Integration: Stripe account ID and publishable key
- Restaurant settings: Tax rate (default 8.25%), delivery fee (default $5.00)
- Subscription status: trial, active, cancelled, etc.
- Timestamps: created_at, updated_at

**2. MENU ITEMS TABLE**
Stores all menu items for each restaurant:
- Basic info: ID, restaurant_id (foreign key), name, description, price
- Category for organization
- Availability flag (true/false)
- POS Integration tracking:
  - POS item ID (unique identifier in POS system)
  - Sync source (webhook, cron, or manual)
  - Last synced timestamp
- Indexed for fast queries on available items
- Unique constraint on (restaurant_id, pos_item_id) to prevent duplicates

**3. CUSTOMERS TABLE**
Stores customer profiles per restaurant:
- Basic info: ID, restaurant_id, phone number, first/last name, email
- Notes field for special instructions or preferences
- Analytics: Total orders count, total spent amount
- Timestamps: created_at, updated_at
- Unique constraint on (restaurant_id, phone_number)

**4. CUSTOMER ADDRESSES TABLE**
Stores delivery addresses for customers:
- Links to customer and restaurant
- Full address: Street, city, state, ZIP code
- Delivery instructions (gate codes, special directions)
- Default address flag
- Timestamp: created_at

**5. ORDERS TABLE (Core Transaction Table)**
Stores all order information with comprehensive tracking:

**Order Basics:**
- ID, restaurant_id, customer_id, order type (delivery/pickup)
- Customer phone and name (denormalized for quick access)
- Delivery address link (if applicable)

**Order Items & Pricing:**
- Items stored as JSON (flexible for varying menu items)
- Subtotal, tax amount, delivery fee, total amount

**Order Status Tracking:**
- Status: pending, payment_pending, paid, confirmed, preparing, ready, out_for_delivery, delivered, picked_up, cancelled
- Each status represents a stage in the order lifecycle

**Payment Information (PCI-Compliant):**
- Payment method: stripe_link, cash, card_on_delivery
- Payment status: pending, paid, failed, refunded
- Stripe payment intent ID (for tracking)
- Stripe payment link URL (sent to customer)
- Timestamps: payment_link_sent_at, paid_at

**POS Integration with Failover:**
- POS order ID (ID in the POS system)
- Sync status: pending, synced, failed, manual
- Sync attempts counter (for retry logic)
- Sync error messages (for debugging)
- Synced timestamp

**Call Tracking:**
- VAPI call ID (links to call logs)
- Pickup time, estimated delivery time

**6. CALL LOGS TABLE**
Tracks all voice AI calls with real-time support:
- Basic: ID, restaurant_id, VAPI call ID, customer phone
- Call details: Duration in seconds, full transcript, call type, outcome
- Real-time streaming: Status (in_progress, completed, failed)
- Messages field (JSON array) for real-time transcript streaming
- Links to order if call resulted in an order

**7. POS SYNC LOG TABLE (Audit Trail)**
Tracks all synchronization activities:
- Restaurant ID
- Sync type: menu_sync, order_push, webhook
- Sync source: webhook, cron, manual
- Status: success or failed
- Number of items synced
- Error message if failed
- Timestamp for audit purposes

### **Row-Level Security (RLS) Policies:**

**What is RLS?**
Row-Level Security is a PostgreSQL feature that automatically filters database queries based on user context. Instead of filtering in application code, the database itself enforces data isolation.

**How It Works:**
1. Each table has RLS enabled
2. Policies are created that check `current_setting('app.tenant_id')`
3. Before each request, the server sets the tenant_id variable
4. All queries automatically filter to only show data for that restaurant
5. Even if application code has bugs, data cannot leak between restaurants

**Tables with RLS Enabled:**
- menu_items
- customers
- customer_addresses
- orders
- call_logs
- pos_sync_log

**Policy Rule:**
All tables use the same policy: `restaurant_id = current_setting('app.tenant_id', true)::UUID`

This means every query only returns/modifies rows where the restaurant_id matches the currently authenticated restaurant.

***

## 🎤 PART 2: VAPI SETUP WITH OBSERVABILITY HOOKS

### **Universal Assistant Configuration**

**What is the Universal Assistant?**
Instead of creating a separate VAPI assistant for each restaurant, you create ONE universal assistant that dynamically adapts to whichever restaurant receives the call. This is done through variable injection.

**Assistant Configuration Components:**

**1. Basic Settings:**
- Name: "Universal Restaurant Assistant"
- Provider: OpenAI GPT-4
- Voice: ElevenLabs (voice ID: 21m00Tcm4TlvDq8ikWAM)

**2. System Prompt:**
The AI's instructions, using variables:
- "You are a friendly voice assistant for {{restaurant_name}}"
- "Your restaurant_id is: {{restaurant_id}}"
- Capabilities: Share menu, take orders, check order status, answer questions
- Payment instructions: NEVER ask for credit card numbers, inform customers they'll receive a secure payment link via SMS
- Always pass restaurant_id to all function calls

**3. First Message:**
"Thank you for calling {{restaurant_name}}! How can I help you today?"
Variables are replaced with actual restaurant name when call starts.

**4. Observability Configuration:**
- Server URL: Your webhook endpoint for real-time events
- Server URL Secret: Shared secret for webhook signature verification
- This enables real-time transcript streaming and event tracking

**5. Function Tools:**
The AI has access to 5 functions to interact with your backend:

**Tool 1: get_menu**
- Description: Get the restaurant's current menu
- Parameters: restaurant_id (required)
- URL: Your API endpoint for menu retrieval
- Returns: Formatted menu text for voice reading

**Tool 2: find_or_create_customer**
- Description: Find existing customer or create new profile
- Parameters: restaurant_id, phone_number (required), name (optional)
- Returns: Customer profile with greeting

**Tool 3: get_customer_addresses**
- Description: Get customer's saved delivery addresses
- Parameters: restaurant_id, customer_id (required)
- Returns: List of saved addresses

**Tool 4: create_order**
- Description: Place a new order (payment link sent via SMS)
- Parameters: restaurant_id, customer_id, order_type (delivery/pickup), items array, delivery_address_id, pickup_time, payment_method (required)
- Returns: Order confirmation with total and payment instructions

**Tool 5: check_order_status**
- Description: Check status of an order
- Parameters: restaurant_id (required), order_id or phone_number (optional)
- Returns: Current order status in friendly language

***

## 🔧 PART 3: BACKEND API IMPLEMENTATION

### **Server Setup:**
- Framework: Express.js (Node.js)
- Database Client: Supabase JavaScript client
- Payment Processing: Stripe SDK
- SMS: Twilio (for sending payment links and confirmations)

### **Key Components:**

**1. Tenant Context Middleware (RLS Safety)**

**Purpose:** Ensures every database query is scoped to the correct restaurant.

**How it works:**
- Function receives the tenant_id (restaurant UUID)
- Executes PostgreSQL command: `SET LOCAL app.tenant_id = 'uuid'`
- SET LOCAL means this variable only exists for the current database transaction
- All subsequent queries in that request automatically filter by this restaurant

**RLS Isolation Test (Development Only):**
- Set context to a valid restaurant ID
- Attempt to query another restaurant's data
- Should return zero rows (RLS blocks unauthorized access)
- If any data is returned, throw error: "RLS BREACH"
- This test should run on server startup in development mode

**2. VAPI Dynamic Routing Webhook**

**Endpoint:** POST /vapi/assistant-request

**Purpose:** When a call comes in, lookup which restaurant owns that phone number and inject their data into the assistant.

**Process:**
1. Receive call event from VAPI with phone number that was called
2. Query restaurants table for matching vapi_phone_number
3. If no restaurant found, return 404 error
4. Return response to VAPI with:
   - Universal assistant ID
   - Variable values: restaurant_id and restaurant_name
   - First message with restaurant name already inserted
5. VAPI uses this restaurant's context for the entire call

**Why This Matters:**
- Critical to inject variables at call creation (not mid-call) to avoid race conditions
- Ensures the AI always has the correct restaurant context
- One assistant serves unlimited restaurants

**3. VAPI Server Events (Observability Hooks)**

**Endpoint:** POST /vapi/events

**Purpose:** Receive real-time events during calls for monitoring and analytics.

**Security:**
- Verify webhook signature using HMAC SHA256
- Compare received signature with expected signature calculated from body
- Reject requests with invalid signatures (prevents spoofing)

**Event Types Handled:**

**'transcript' events:**
- Receive real-time messages as the call progresses
- Update call_logs table with new message
- Append to messages JSON array (role, content, timestamp)
- Allows live transcript viewing in dashboard

**'function-call' events:**
- Log when tools are used (for analytics)
- Track which functions are most commonly called
- Helps optimize the AI's tool usage

**'status-update' events:**
- Update call status in real-time (in_progress, completed, failed)
- Helps track call lifecycle

**'end-of-call-report' events:**
- Receive final call summary when call ends
- Update with: duration, complete transcript, final status
- Mark call as completed

**4. Tool Implementation: Get Menu**

**Endpoint:** POST /tools/menu

**Purpose:** Retrieve restaurant's menu for the AI to read to customer.

**Process:**
1. Receive restaurant_id from VAPI
2. Set tenant context for RLS
3. Query menu_items table:
   - Filter by restaurant_id (automatic via RLS)
   - Only available items (available = true)
   - Ordered by category and name
4. Format for voice:
   - Group items by category
   - Create natural language text: "In [category]: [item1] for $X, [item2] for $Y"
   - Join all categories with periods
5. Return result text (what AI will say) and structured menu items

**Performance:** 50-100ms response time (querying local database, not external API)

**5. Tool Implementation: Find or Create Customer**

**Endpoint:** POST /tools/customer

**Process:**
1. Receive restaurant_id, phone_number, and optional name
2. Set tenant context
3. Query customers table for existing customer (restaurant_id + phone_number)
4. If found: Return existing customer with "Welcome back [name]!" message
5. If not found:
   - Split name into first/last name
   - Insert new customer record
   - Return new customer with greeting
6. Return customer object for use in subsequent calls

**6. Tool Implementation: Get Customer Addresses**

**Endpoint:** POST /tools/addresses

**Process:**
1. Receive restaurant_id and customer_id
2. Set tenant context
3. Query customer_addresses table
4. If no addresses: Return message asking for delivery address
5. If addresses found:
   - Format as numbered list: "1. [street], [city]"
   - Return text and structured addresses array
6. AI can read addresses to customer for selection

**7. Tool Implementation: Create Order**

**Endpoint:** POST /tools/order

**Purpose:** Process new orders with payment handling.

**Process:**

**Step 1: Calculate Totals**
- Sum item prices × quantities for subtotal
- Calculate tax (subtotal × restaurant's tax rate)
- Add delivery fee if order type is delivery
- Calculate total

**Step 2: Create Order in Database**
- Insert order with all details
- Status depends on payment method:
  - stripe_link: status = 'payment_pending', payment_status = 'pending'
  - cash/card_on_delivery: status = 'pending', payment_status = 'paid'
- Store VAPI call ID to link order to call

**Step 3: Handle Payment**

**If payment_method = 'stripe_link':**
- Call createStripePaymentLink() function
- This creates Stripe payment intent and payment link
- Updates order with payment link URL
- Sends SMS with payment link to customer
- Order waits for payment before going to POS

**If payment_method = 'cash' or 'card_on_delivery':**
- Push order to POS immediately (async)
- No payment processing needed upfront
- Restaurant collects payment on delivery/pickup

**Step 4: Return Response to AI**
Response message varies by payment method:
- Stripe: Inform customer about payment link coming via SMS, mention preparation starts after payment
- Cash/COD: Give estimated delivery/pickup time

**8. Stripe Payment Link Creation**

**Purpose:** Generate secure payment links (PCI-compliant, no credit card handling).

**Process:**

**Create Payment Intent:**
- Amount: total in cents (multiply by 100)
- Currency: USD
- Metadata: order_id, restaurant_id, customer_phone
- If using Stripe Connect: Add transfer_data to route funds to restaurant's Stripe account

**Create Payment Link:**
- Line items from order.items (each with name, price, quantity)
- Metadata: order_id, restaurant_id
- Stripe generates a hosted payment page URL

**Update Order:**
- Store payment_intent_id and payment_link URL
- Record payment_link_sent_at timestamp

**Send SMS:**
- Use Twilio to send text message
- Message: "Your order #[id] is ready! Pay securely here: [link]"
- Customer clicks link, pays on Stripe's secure page

**Error Handling:**
- If Stripe fails, update order status to 'payment_failed'
- Alert restaurant staff via dashboard
- Customer support can manually process payment

**9. Stripe Webhook Handler**

**Endpoint:** POST /webhooks/stripe

**Purpose:** Receive notification when customer completes payment.

**Security:**
- Verify webhook signature using Stripe's SDK
- Prevents fake payment notifications

**Process:**

**When 'payment_intent.succeeded' event received:**
1. Extract order_id from payment metadata
2. Update order in database:
   - payment_status = 'paid'
   - status = 'pending' (now ready for restaurant to confirm)
   - paid_at = current timestamp
3. NOW push order to POS (async)
4. Send order confirmation SMS to customer

**Why This Matters:**
- Only confirmed payments trigger POS integration
- Prevents restaurants from preparing unpaid orders
- Provides clear audit trail of payment timing

**10. Tool Implementation: Check Order Status**

**Endpoint:** POST /tools/order-status

**Process:**
1. Receive restaurant_id and either order_id OR phone_number
2. Set tenant context
3. Query orders table:
   - If order_id provided: Find that specific order
   - If phone_number provided: Find most recent order for that customer
4. If no order found: Return "No order found"
5. If found: Translate status code to customer-friendly message:
   - 'payment_pending' → "Waiting for payment. Please check your text message for the payment link."
   - 'pending' → "Your order is being processed"
   - 'confirmed' → "Your order has been confirmed and is being prepared"
   - 'preparing' → "Your order is being prepared in the kitchen"
   - 'ready' → "Your order is ready for pickup!" (or "...will be delivered soon" for delivery)
   - 'out_for_delivery' → "Your order is out for delivery"
   - 'delivered' → "Your order has been delivered"
   - 'picked_up' → "Your order has been picked up"

**11. POS Integration with Failover**

**Purpose:** Push orders to restaurant's POS system with robust error handling.

**Process:**

**Step 1: Check POS Type**
- Query restaurant settings
- If pos_type = 'none', skip integration
- Track sync attempts counter

**Step 2: Attempt Push**
- If Square: Call createSquareOrder()
- If Toast: Call createToastOrder()
- If Clover: Call createCloverOrder()

**Step 3: Success Handling**
- Update order: pos_order_id, pos_sync_status = 'synced', status = 'confirmed'
- Increment sync attempts
- Log success in pos_sync_log table

**Step 4: Failure Handling**
- Update order: pos_sync_status = 'failed', store error message
- Increment sync attempts
- Log failure in pos_sync_log

**Step 5: Retry Logic**
- If attempts < 3: Retry with exponential backoff (5s, 10s, 20s)
- If attempts >= 3: Give up on automatic sync
- Alert restaurant staff: "POS sync failed after 3 attempts. Please manually enter order in POS."
- Mark order as pos_sync_status = 'manual'

**12. Square Order Creation**

**Purpose:** Create order in Square POS system.

**Process:**
1. Initialize Square client with restaurant's access token
2. Map order items to Square's line item format:
   - Name, quantity, price (converted to cents), currency
3. Create fulfillment object based on order type:
   - Delivery: SHIPMENT type with customer info and scheduled time
   - Pickup: PICKUP type with customer info and pickup time
4. Call Square Orders API:
   - Location ID
   - Line items
   - Fulfillment details
   - State: 'OPEN'
   - Metadata: platform order ID, source = 'voice_ai'
5. Return Square's order ID
6. Square POS displays order on their system for restaurant staff

**13. Restaurant Staff Alerts**

**Purpose:** Notify restaurant when manual intervention needed.

**Methods:**
- Email to owner_email
- SMS to restaurant phone
- Dashboard alert (red banner)
- Optional: Slack/Discord webhook integration

**Common Alert Scenarios:**
- POS sync failed after 3 retries
- Payment link creation failed
- Menu sync errors
- Subscription payment failed

**14. Menu Sync: Webhook + Cron Hybrid**

**Strategy:** Use webhooks when available (real-time), fall back to cron jobs (polling).

**Toast Webhook (Preferred - Real-Time):**

**Endpoint:** POST /webhooks/toast/menu

**Process:**
1. Verify Toast webhook signature (HMAC SHA256)
2. Receive menu_updates array from Toast
3. Set tenant context
4. For each menu item in updates:
   - Upsert to menu_items table
   - Map Toast fields: GUID → pos_item_id, name, description, price
   - Set available = !item.isDeleted
   - Record sync_source = 'webhook', last_synced_at = now
5. Handle conflicts: If restaurant_id + pos_item_id already exists, update it
6. Log success in pos_sync_log

**Why Webhooks are Better:**
- Instant updates (no lag)
- Lower API usage
- More reliable than polling

**Cron Job Fallback (for Square/Clover - Every 4 Hours):**

**Purpose:** Periodically sync menus for POS systems without webhooks.

**Process:**
1. Query all restaurants with subscription_status = 'active'
2. Filter to pos_type IN ('square', 'clover') - NOT Toast
3. For each restaurant:
   - If Square: Call syncSquareMenu()
   - If Clover: Call syncCloverMenu()
4. Log any failures but don't stop processing other restaurants

**Square Menu Sync:**
1. Initialize Square client
2. Call catalogApi.listCatalog() with type = 'ITEM'
3. Receive all menu items
4. For each item:
   - Get first variation (usually only one per item)
   - Extract: item ID, name, description, price (convert from cents), category
   - Upsert to menu_items table
   - Set sync_source = 'cron', available = !isDeleted
5. Log sync completion with items_synced count

**Manual Resync Endpoint:**

**Endpoint:** POST /api/restaurants/:id/resync-menu

**Purpose:** Dashboard button for restaurant owners to force menu sync.

**Process:**
1. Receive restaurant ID from URL parameter
2. Query restaurant settings
3. Call appropriate sync function based on pos_type
4. Return success/failure message
5. Display result in dashboard

**15. Server Startup:**

When server starts:
1. Log "Server running on port 3000"
2. Log "VAPI webhooks configured"
3. Log "Stripe webhooks ready"
4. Log "POS webhook endpoints active"
5. Log "RLS policies enforced"
6. If NODE_ENV = 'development': Run testRLSIsolation()

***

## 🏗️ REFERENCE ARCHITECTURE COMPARISON

**Your Architecture vs AWS Voice Bot Blueprint:**

**AWS Components → Your Implementation:**
- Cognito (Auth) → Supabase Auth + RLS
- Lambda (Functions) → Express API (Node.js)
- DynamoDB (Data) → PostgreSQL/Supabase
- S3 (Storage) → Supabase Storage
- Architecture Pattern: Store local, serve fast, integrate async ✓

**Your Architecture Follows AWS Best Practices:**
- ✓ Fast local database queries (<100ms) - Menu from database, not POS API
- ✓ Async external API integration - POS push happens after response to AI
- ✓ Webhook-driven updates when possible - Toast menu sync, Stripe payments
- ✓ Retry logic with failover - 3 attempts with exponential backoff for POS
- ✓ Real-time event streaming - VAPI transcript updates, Supabase realtime subscriptions

**Key Architectural Decisions Explained:**

**1. Why Query Menu from Database (Not POS API)?**
- Speed: 50-100ms vs 500-2000ms for external API
- Reliability: No dependency on POS being online during calls
- Cost: No API rate limits or charges per query
- Consistency: Menu stays available even if POS temporarily down

**2. Why Push Orders to POS Asynchronously?**
- Don't make customer wait on AI call for POS API response
- POS APIs can be slow or fail - shouldn't block order confirmation
- Retry logic can work in background
- Customer gets immediate confirmation

**3. Why Use Stripe Payment Links (Not Direct Integration)?**
- PCI compliance: Never touch credit card data
- Stripe hosts secure payment page
- Works on any device (SMS link opens in browser)
- Lower development cost and risk

**4. Why Webhook + Cron Hybrid for Menu Sync?**
- Best of both worlds: Real-time when possible, polling as backup
- Toast supports webhooks → use them
- Square/Clover don't → use cron
- 4-hour interval balances freshness with API usage

**5. Why Row-Level Security (RLS)?**
- Security at database level, not application level
- Even if application has SQL injection bug, can't access other tenants
- Simpler code: No need to add WHERE restaurant_id = ? to every query
- PostgreSQL tested and proven for multi-tenancy

***

**This implementation guide provides a complete blueprint for building the voice AI restaurant platform with all best practices, error handling, and scalability considerations built in.**
