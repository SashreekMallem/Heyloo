# AI Voice Agency Platform - Complete PRD (2025)
## Product Requirements Document - Refined Architecture

---

## 🎯 System Overview

### What You're Building
**Your AI voice agency** serving **any business type** (restaurants, retail stores, salons, service businesses, etc.) with:
- **YOU automate everything** - Businesses just sign up and talk to you
- **One Universal AI Assistant per business type** - Powered by Vapi, knowledge injected per business
- **Zero customization by business owners** - They see analytics only
- **Full POS integration** - Square & Clover auto-sync (supports multiple locations per business)
- **100% Supabase** - No separate backend servers

### Business Owner Experience
They **ONLY see**:
1. **Dashboard Analytics**: Calls, orders/appointments, revenue, costs
2. **Customer Data**: Names, phone numbers, order history from Vapi
3. **Product/Menu Management**: View/update their items (products, services, menu items)
4. **Basic Settings**: Business hours, location, AI name
5. **Call History**: Listen to recordings, read transcripts

They **DO NOT**:
- Configure AI prompts or personality
- Choose voice providers (you use Vapi for all)
- Build or customize anything technical

They **DO**:
- Connect their own POS system (Square/Clover) via OAuth flow
- Manage their menu/products (view, edit, toggle availability)
- View analytics and call history

---

## 🏗️ Core Architecture Decision: Vapi Universal Assistant

### Why Vapi (Not Retell)

**Key 2025 Vapi Features We'll Use:**

#### 1. **Knowledge Base Injection**
```
ONE Master Assistant per business type (e.g., "Restaurant AI", "Retail AI", "Salon AI")
Each business gets the SAME assistant for their type
Business-specific data injected via Knowledge Base API

How it works:
- Create assistant: "Universal Restaurant Assistant" (for all restaurants)
- On each call, inject dynamic knowledge:
  * Business name, hours, location
  * Current products/menu from database
  * Customer data
  * Order history
- Vapi's Knowledge Base supports real-time injection
```

#### 2. **Squads Feature** (Optional)
```
Use Vapi Squads for complex workflows:

Squad Members:
1. Greeter Assistant - Answers general questions
2. Order Taker - Handles order placement
3. Reservation Handler - Books appointments
4. Transfer Agent - Escalates to human

Transfer between assistants based on intent
Each member has access to same knowledge base
```

#### 3. **Dynamic Tool Calling**
```
Vapi calls your Edge Functions as "tools":
- get_menu(): Fetch real-time products/menu
- place_order(): Create order in POS
- check_availability(): Query inventory
- get_customer(): Fetch customer history
- process_payment(): Payment link generation

All tools are Edge Functions
Tools receive business_id to scope data
```

#### 4. **2025 Webhook Events**
```
Vapi sends comprehensive webhooks to separate handlers:

assistant-request → vapi-assistant function:
  - Call starting, needs config
  - Return: assistant ID, knowledge base, tools

function-call → vapi-tools function:
  - AI needs to execute action
  - Payload: function name, arguments, call context
  - Return: function result

end-of-call-report → vapi-events function:
  - Complete call data
  - Transcript, recording, summary
  - Customer data: name, phone, email, sentiment
  - Structured output: intents, entities, actions taken
  - Cost breakdown: tokens, minutes

status-update → vapi-events function:
  - Real-time call status updates
  - Speech updates during call
```

---

## 📊 Database Schema (Actual Implementation)

### Core Tables

#### **restaurants** (Note: Table name is "restaurants" but supports all business types)
```
What business owners manage:
- id (UUID, primary key)
- name, slug (unique), phone_number (unique)
- owner_email
- subscription_status: 'trial' | 'active' | 'paused' | 'cancelled'
- pos_type: 'square' | 'toast' | 'clover' | 'none'
- tax_rate, delivery_fee
- assistant_name (customizable: "Maria", "Alex")
- stripe_account_id, stripe_customer_id
- created_at, updated_at

What you (agency) manage:
- vapi_phone_number (assigned per business)
- vapi_assistant_id (the universal assistant for this business type)
- knowledge_base_id (Vapi knowledge base)
- squad_id (optional, for complex workflows)
- pos_location_id (legacy, use restaurant_pos_locations instead)
```

#### **app_users** (Authentication)
```
- id (UUID, primary key)
- email (unique)
- password_hash
- role: 'platform_admin' | 'restaurant_admin'
- restaurant_id (nullable, links to business)
- created_at, updated_at
```

#### **restaurant_pos_locations** (Multi-location POS support)
```
Supports businesses with multiple POS locations:
- id (UUID, primary key)
- restaurant_id (foreign key)
- pos_type: 'square' | 'clover' | 'toast'
- pos_location_id (external POS location ID)
- pos_merchant_id (external POS merchant ID)
- pos_location_name
- access_token, refresh_token (encrypted)
- vapi_phone_number (can assign different phone per location)
- is_active, is_primary
- created_at, updated_at
```

#### **menu_items** (Products/Services/Menu Items)
```
Works for any business type (products, services, menu items):
- id (UUID, primary key)
- restaurant_id (foreign key)
- name, description, price
- category
- pos_item_id (Square/Clover ID, nullable)
- sync_source: 'manual' | 'pos'
- last_synced_at
- is_available
- created_at, updated_at

Business owners can:
- View products/menu
- Toggle availability
- Update descriptions
- Add items (if no POS)
```

#### **customers**
```
Auto-populated from Vapi webhooks + manual entry:
- id (UUID, primary key)
- restaurant_id (foreign key)
- phone_number (unique per restaurant)
- first_name, last_name, email
- notes
- total_orders, total_spent
- created_at, updated_at

SOURCE: Vapi end-of-call-report provides:
  - caller_number
  - name (from conversation)
  - sentiment analysis
  - entities extracted
```

#### **customer_addresses**
```
Delivery addresses for customers:
- id (UUID, primary key)
- restaurant_id, customer_id (foreign keys)
- label, street, city, state, postal_code
- delivery_instructions
- is_default
- created_at
```

#### **orders**
```
Orders/appointments from AI calls + manual entry:
- id (UUID, primary key)
- restaurant_id, customer_id (foreign keys)
- customer_phone, customer_name
- order_type: 'delivery' | 'pickup'
- status: 'pending' → 'payment_pending' → 'paid' → 'confirmed' → 
          'preparing' → 'ready' → 'out_for_delivery' → 'delivered' | 'picked_up' | 'cancelled'
- payment_status: 'pending' | 'paid' | 'failed' | 'refunded'
- payment_method: 'stripe_link' | 'cash' | 'card_on_delivery'
- subtotal, tax, delivery_fee, total
- items (JSONB): [{ menuItemId, quantity, price, modifiers[] }]
- stripe_payment_link, stripe_payment_intent_id
- pos_order_id (if synced to POS)
- call_id (if from Vapi call)
- source: 'dashboard' | 'vapi' | 'pos'
- placed_at, updated_at

Created by: 
1. Vapi function call → place_order (vapi-tools)
2. Manual entry (dashboard)
3. POS webhook sync
```

#### **call_logs** (Voice Calls)
```
Every call record from Vapi:
- id (UUID, primary key)
- restaurant_id (foreign key)
- call_id (Vapi ID, unique)
- location_id (from restaurant_pos_locations, nullable)
- customer_phone
- phone_number_id (Vapi phone number ID)
- assistant_id (Vapi assistant ID)
- duration_seconds
- transcript (JSONB): [{ speaker, text, timestamp }]
- messages (JSONB): Full conversation
- status: 'in_progress' | 'completed' | 'failed'
- event_type (Vapi event type)
- summary (AI-generated)
- ended_reason
- outcome: 'order_placed' | 'question_answered' | 'transferred' | 'abandoned'
- recording_url
- cost (JSONB): { vapi_cost, tokens_used, minutes, cost_breakdown }
- structured_outputs (JSONB): Extracted intents, entities
- success_evaluation (JSONB)
- started_at, ended_at
- created_at, updated_at

SOURCE: Vapi end-of-call-report webhook (vapi-events)
All this data comes from Vapi automatically
```

#### **platform_usage_daily** (Analytics Aggregation)
```
Pre-aggregated for performance:
- id (UUID, primary key)
- restaurant_id (foreign key)
- date
- total_calls, successful_calls, failed_calls
- total_minutes
- total_orders, delivery_orders, pickup_orders
- total_order_value
- vapi_call_cost
- created_at, updated_at
- UNIQUE (restaurant_id, date)
```

#### **restaurant_usage_summary** (View)
```
Materialized view for quick analytics:
- restaurant_id, restaurant_name
- subscription_status
- date
- total_calls, total_minutes
- total_orders, total_order_value
```

#### **subscription_invoices** (Billing)
```
Monthly billing records:
- id (UUID, primary key)
- restaurant_id (foreign key)
- billing_period_start, billing_period_end
- base_fee_cents, included_minutes
- overage_minutes, overage_rate_cents
- total_amount_cents
- stripe_invoice_id
- status: 'draft' | 'pending' | 'paid' | 'failed'
- created_at, updated_at
```

#### **pos_sync_log** (POS Sync Tracking)
```
Tracks all POS sync operations:
- id (UUID, primary key)
- restaurant_id (foreign key)
- location_id (from restaurant_pos_locations, nullable)
- sync_type: 'menu_sync' | 'order_push' | 'webhook'
- sync_source: 'webhook' | 'cron' | 'manual'
- status: 'success' | 'failed'
- items_processed
- error_message
- created_at
```

#### **support_requests** (Support Tickets)
```
Customer support ticket system:
- id (UUID, primary key)
- restaurant_id (foreign key)
- customer_phone, customer_name
- call_id, order_id (nullable)
- request_type, priority
- subject, description
- ai_transcript (nullable)
- status: 'open' | 'in_progress' | 'resolved' | 'closed'
- assigned_to (nullable)
- resolved_at (nullable)
- created_at, updated_at
```

#### **support_request_notes**
```
Notes on support tickets:
- id (UUID, primary key)
- support_request_id (foreign key)
- author_email
- note
- is_internal
- created_at
```

---

## 🔄 How the System Actually Works

### 1. **You Onboard a New Business**

**Your Admin Dashboard Flow:**
```
1. Click "Add Business"
2. Fill form:
   - Business name: "Joe's Pizza" (or "Sarah's Salon", "Mike's Retail Store")
   - Business type: Restaurant / Retail / Salon / Service / etc.
   - POS: Square / Clover / None
   - Owner email

3. System automatically:
   a. Creates business record in restaurants table
   b. Creates admin user in app_users
   c. Provisions Vapi phone number (or assigns from pool)
   d. Assigns universal assistant based on business type
   e. Creates Knowledge Base for this business
   f. Sends welcome email to owner

4. Business owner connects POS (if applicable):
   - During onboarding or in Settings, owner clicks "Connect POS"
   - OAuth popup opens (owner logs into their Square/Clover account)
   - Owner authorizes access
   - Access tokens stored encrypted in restaurant_pos_locations
   - Owner can select which locations to connect (multi-location support)
   - System automatically syncs: products, customers, orders

5. Done! Business is live
```

**What Happens in Supabase:**
```sql
-- Edge Function: onboarding

1. INSERT INTO restaurants (name, slug, phone_number, owner_email, pos_type, ...)
2. INSERT INTO app_users (email, password_hash, role: 'restaurant_admin', restaurant_id)
3. Call Vapi API: POST /phone-numbers (provision or assign existing)
4. Store: vapi_phone_number in restaurants or restaurant_pos_locations
5. Assign universal assistant based on business type
6. Create Knowledge Base:
   POST /knowledge-bases
   Body: {
     name: "Joe's Pizza Knowledge",
     files: [],  -- empty initially
     provider: "custom"
   }
7. Store: knowledge_base_id
8. If POS selected during onboarding:
   - Generate OAuth URL (Square/Clover)
   - Owner completes OAuth in popup
   - Store tokens in restaurant_pos_locations
   - Trigger: pos-sync (Edge Function) to sync initial data
9. Send email to owner with login link
```

### 2. **Customer Calls Business**

**Complete Call Flow:**

#### Phase 1: Call Initiation (< 1 second)
```
Customer dials: +1-555-BUSINESS-01

Vapi receives call →
Vapi webhook → /functions/v1/vapi-assistant
Event: "assistant-request"

Payload:
{
  type: "assistant-request",
  call: {
    id: "call_abc123",
    to: "+15555551234",  // Vapi phone number
    from: "+15555556789"  // Customer
  }
}

Edge Function: vapi-assistant
1. Query: SELECT * FROM restaurant_pos_locations 
          WHERE vapi_phone_number = '+15555551234' AND is_active = true
   OR: SELECT * FROM restaurants WHERE phone_number = '+15555551234'
2. Found: Joe's Pizza (restaurant_id: xyz, location_id: loc_123)
3. Fetch current data:
   - Business name, assistant_name
   - Operating hours (if stored)
   - Today's menu/products (menu_items WHERE is_available = true)
   - AI assistant name from settings
4. Return to Vapi:
   {
     assistant_id: "asst_universal_restaurant",
     knowledge_base_id: "kb_joespizza",
     first_message: "Hi! This is Maria from Joe's Pizza. How can I help you?",
     tools: ["get_menu", "place_order", "get_customer", ...]
   }

Vapi: "Hi! This is Maria from Joe's Pizza. How can I help you?"
```

#### Phase 2: Conversation (Real-time)
```
Customer: "What's on the menu?"

Vapi webhook → function-call
Event: "function-call"
Payload:
{
  type: "function-call",
  function: {
    name: "get_menu",
    arguments: {
      restaurantId: "xyz",
      category: null  // all categories
    }
  },
  call_id: "call_abc123"
}

Edge Function: vapi-tools (handles get_menu)
1. Query: SELECT * FROM menu_items 
          WHERE restaurant_id = 'xyz' 
          AND is_available = true
          ORDER BY category, name
2. Return to Vapi:
   {
     menu: {
       "Pizzas": [
         { id: "...", name: "Margherita", price: 12.99, description: "..." },
         { name: "Pepperoni", price: 14.99, description: "..." }
       ],
       "Sides": [...]
     }
   }

Vapi: "We have pizzas, sides, and drinks. For pizzas, we have Margherita for $12.99..."
```

#### Phase 3: Order Placement
```
Customer: "I'll take a large pepperoni pizza"

Vapi (internal AI processing):
- Detects intent: place_order
- Extracts entities: size=large, item=pepperoni pizza

Vapi webhook → function-call
Event: "function-call"
Payload:
{
  type: "function-call",
  function: {
    name: "place_order",
    arguments: {
      restaurantId: "xyz",
      items: [{
        menuItemId: "item_123",
        quantity: 1
      }],
      customerPhone: "+15555556789",
      customerName: null,
      orderType: "pickup",
      paymentMethod: "stripe_link"
    }
  },
  call_id: "call_abc123"
}

Edge Function: vapi-tools (handles place_order)
1. Look up customer:
   SELECT * FROM customers 
   WHERE restaurant_id = 'xyz' AND phone_number = '+15555556789'
   If not found, create new customer
   
2. Find products:
   SELECT * FROM menu_items 
   WHERE restaurant_id = 'xyz' AND id IN (...)
   
3. Calculate total: subtotal + tax + delivery_fee
   Get tax_rate, delivery_fee from restaurants table

4. Create order in database:
   INSERT INTO orders (
     restaurant_id, customer_id, customer_phone,
     items, subtotal, tax, delivery_fee, total,
     order_type, payment_method, source: 'vapi', call_id
   )

5. Create Stripe payment link:
   POST /payment_links
   Store: stripe_payment_link

6. Push to POS (if connected):
   Call pos-push Edge Function
   Creates order in Square/Clover
   Updates: pos_order_id
   
7. Return to Vapi:
   {
     success: true,
     orderId: "order_456",
     total: 18.99,
     paymentLink: "https://buy.stripe.com/...",
     estimatedTime: "25 minutes"
   }

Vapi: "Perfect! One large pepperoni pizza for $18.99. 
       Your order will be ready in 25 minutes. 
       I'll send you a payment link. Can I get your name for the order?"

Customer: "John"

Vapi: Updates customer record internally
```

#### Phase 4: Call Completion
```
Customer: "That's all, thanks!"

Vapi detects end intent
Call ends

Vapi webhook → end-of-call-report
Event: "end-of-call-report"

Payload (RICH DATA FROM VAPI):
{
  type: "end-of-call-report",
  call: {
    id: "call_abc123",
    startedAt: "2025-01-15T19:30:00Z",
    endedAt: "2025-01-15T19:33:24Z",
    duration: 204,  // seconds
    recordingUrl: "https://vapi.ai/recordings/...",
    transcript: [
      { role: "assistant", content: "Hi! This is Maria...", timestamp: 0 },
      { role: "user", content: "What's on the menu?", timestamp: 3.2 },
      ...
    ],
    messages: [...],  // Full conversation
    summary: "Customer ordered a large pepperoni pizza for pickup.",
    
    // CUSTOMER DATA (extracted by Vapi AI)
    customer: {
      phone: "+15555556789",
      name: "John",  // extracted from conversation
    },
    
    // STRUCTURED OUTPUTS
    structuredOutputs: {
      primaryIntent: "place_order",
      secondaryIntents: ["menu_inquiry"],
      outcome: "order_completed",
      entities: {
        order_type: "pickup",
        payment_method: "stripe_link"
      }
    },
    
    // COST BREAKDOWN
    cost: {
      durationMinutes: 3.4,
      vapiCost: 0.31,  // $0.09/min
      tokensUsed: 1247,
      modelCost: 0.03,
      costBreakdown: {...}
    },
    
    // FUNCTION CALLS MADE
    toolCalls: [
      { function: "get_menu", success: true, latencyMs: 145 },
      { function: "place_order", success: true, latencyMs: 892 }
    ],
    
    endedReason: "customer_ended",
    successEvaluation: {...}
  }
}

Edge Function: vapi-events (handles end-of-call-report)
1. Upsert customer:
   INSERT INTO customers (...) 
   ON CONFLICT (restaurant_id, phone_number) DO UPDATE
   SET first_name = 'John', last_call_date = NOW(), 
       total_calls = total_calls + 1
   
2. Store call record:
   INSERT INTO call_logs (
     restaurant_id, call_id, location_id, customer_phone,
     transcript, messages, recording_url, summary,
     duration_seconds, status: 'completed',
     cost, structured_outputs, success_evaluation,
     started_at, ended_at, ...
   )
   
3. Update order with call_id:
   UPDATE orders SET call_id = 'call_abc123' WHERE id = 'order_456'
   
4. Update analytics:
   INSERT INTO platform_usage_daily (date, restaurant_id, ...)
   ON CONFLICT (restaurant_id, date) DO UPDATE
   SET total_calls = total_calls + 1,
       total_orders = total_orders + 1,
       total_revenue = total_revenue + 18.99,
       vapi_call_cost = vapi_call_cost + 0.31, ...
       
5. Send notifications:
   - SMS to business owner: "New order: Large Pepperoni - $18.99"
   - Email: "Call summary and order details"
   
6. Broadcast via Realtime:
   supabase.channel('restaurant_xyz').send({
     type: 'new_order',
     data: { order_id, total, customer_name: 'John' }
   })
```

### 3. **POS Webhook Sync** (Background)

**Square Webhook Example:**
```
Business adds new product in Square POS app

Square webhook → /functions/v1/square-webhook
Event: "catalog.version.updated"

Payload:
{
  type: "catalog.version.updated",
  merchant_id: "sq_merchant_123",
  data: {
    updated_at: "2025-01-15T14:30:00Z"
  }
}

Edge Function: square-webhook
1. Look up business:
   SELECT * FROM restaurant_pos_locations 
   WHERE pos_type = 'square' AND pos_merchant_id = 'sq_merchant_123'
   Found: Joe's Pizza (location_id: loc_123)
   
2. Fetch updated catalog:
   GET https://connect.squareup.com/v2/catalog/list
   (using access_token from restaurant_pos_locations)
   
3. Upsert products:
   FOR EACH item in catalog:
     INSERT INTO menu_items (...) 
     ON CONFLICT (restaurant_id, pos_item_id)
     DO UPDATE SET name = ..., price = ..., updated_at = NOW()
     
4. Log sync:
   INSERT INTO pos_sync_log (restaurant_id, location_id, sync_type: 'menu_sync', ...)
   
5. Notify dashboard:
   Realtime broadcast: "Menu updated"
```

**Clover Webhook Example:**
```
Similar flow via /functions/v1/clover-webhook
Handles: ORDER_UPDATED, PAYMENT_UPDATED, etc.
```

### 4. **Manual Order Creation** (Dashboard)
```
Business owner creates order manually via dashboard:

POST /functions/v1/orders
{
  restaurantId: "xyz",
  items: [{ menuItemId, quantity }],
  customerPhone: "+15555556789",
  customerName: "John",
  orderType: "pickup",
  paymentMethod: "cash"
}

Edge Function: orders
1. Create order in database
2. Optionally push to POS (if connected)
3. Return order details
```

---

## 📱 Business Owner Dashboard (Simple)

### What They See (Read-Only + Limited Editing)

#### 1. **Home / Analytics**
```
Today's Stats:
- Calls: 23
- Orders: 15 (65% conversion)
- Revenue: $387.50
- Costs: $6.90 (Vapi charges)

Charts:
- Calls over time (7 days)
- Revenue trend
- Peak call hours
- Customer sentiment gauge

Recent Activity:
- 2:14 PM - John ordered Large Pepperoni ($18.99)
- 2:09 PM - Sarah asked about hours
- 1:45 PM - Mike ordered 2 pizzas ($34.50)
```

#### 2. **Calls**
```
Table:
- Time | Customer | Duration | Outcome | Order | Recording

Click row → Call Detail:
- Full transcript
- Play recording
- Customer info
- Order created (if any)
- Sentiment score
- Cost breakdown
```

#### 3. **Customers**
```
Table:
- Name | Phone | Orders | Total Spent | Last Visit

Click customer → Profile:
- Order history
- Favorite items
- Preferences/notes (from AI conversations)
- Delivery addresses
- Total stats
```

#### 4. **Orders**
```
Table:
- Time | Customer | Items | Total | Status | Payment

Filters:
- Today / This Week / This Month
- Status: All / Pending / Completed
- Source: AI Calls / Dashboard / POS

Click order → Details:
- Full order breakdown
- Customer info
- Associated call (if from AI)
- Payment status
- POS sync status
```

#### 5. **Menu/Products**
```
Product List (grouped by category):
- Name | Price | Available | Actions

Actions:
☐ Mark unavailable (temporary)
✏️ Edit description
🖼️ Add/change image
➕ Add new item (if no POS)

POS Connected:
- "Synced with Square 2 min ago"
- "Last sync: All items current"
- Multiple locations shown if applicable
```

#### 6. **Settings** (Limited)
```
Business Info (Read-Only):
- Name, Slug
- Phone number
- Owner email

Editable:
- AI Assistant Name: "Maria" (dropdown or custom)
- Tax Rate, Delivery Fee
- Notification Email
- Transfer Phone (for human escalation)

Voice Settings (View Only):
- Voice: "English - Female - Professional"
- Language: English (US)
- [Contact Support to Change]

POS Integration:
- ✅ Connected to Square (Location: Main Store)
- Last Sync: 2 minutes ago
- [Connect POS] [Add Location] [Disconnect] buttons
- Business owner connects their own POS via OAuth popup
- Owner logs into their Square/Clover account to authorize
- Can connect multiple locations from same POS account
```

### What They DON'T See
- Vapi configuration
- Edge Function code
- Database queries
- Webhook logs
- AI prompts/personality
- Knowledge base content
- Tool definitions
- Your agency admin features
- Platform-wide analytics

---

## 🔧 Your Agency Admin Dashboard

### What YOU See and Control

#### 1. **Businesses Management**
```
List all clients:
- Name | Type | POS | Status | MRR | Actions

Actions:
- View Analytics
- Configure AI
- Manage POS
- Impersonate (view as business owner)
- Suspend/Activate
- Edit Settings
```

#### 2. **AI Configuration (Per Business Type)**
```
Universal Assistants:
- Restaurant Assistant (used by 45 businesses)
- Retail Assistant (used by 12 businesses)
- Salon Assistant (used by 8 businesses)
- Service Assistant (used by 5 businesses)

Edit Assistant:
- System Prompt (full control)
- Tools Enabled:
  ☑️ get_menu
  ☑️ place_order
  ☑️ check_availability
  ☑️ get_customer
  ☑️ make_reservation
  ☑️ transfer_to_human
- Voice Provider: Vapi
- Voice Selection: ElevenLabs / Azure / Play.ht
- Model: GPT-4o
- First Message Template: "Hi! This is {ai_name} from {business_name}..."
```

#### 3. **Platform Analytics**
```
Agency-Wide Metrics:
- Total Businesses: 65
- Total Calls: 12,847 (this month)
- Total Revenue Generated: $284,392
- Your Revenue: $15,275 (subscription fees)
- Costs: $3,842 (Vapi + Supabase)
- Profit Margin: 75%

Performance:
- Avg Call Duration: 2m 34s
- Order Conversion: 62%
- Customer Satisfaction: 8.3/10
- System Uptime: 99.8%

Per Business Type:
- Restaurants: 45 businesses, 8,234 calls
- Retail: 12 businesses, 2,456 calls
- Salons: 8 businesses, 2,157 calls
```

#### 4. **POS Integration Manager**
```
Square:
- 45 businesses connected
- 67 total locations
- Webhooks: ✅ Active
- API Health: ✅ Good
- Last Failed Sync: None

Clover:
- 12 businesses connected
- 18 total locations
- Webhooks: ✅ Active
- API Health: ✅ Good
- Last Failed Sync: 1 (retry successful)

Actions:
- Test webhooks
- Force full sync
- View error logs
- Regenerate tokens
- View sync history
```

#### 5. **System Monitoring**
```
Edge Functions:
- vapi-assistant: 8,492 invocations (99.97% success)
- vapi-tools: 12,847 invocations (99.95% success)
- vapi-events: 8,492 invocations (99.98% success)
- vapi-backfill: 234 invocations (100% success)
- square-webhook: 1,234 invocations (100% success)
- clover-webhook: 456 invocations (99.5% success)
- pos-sync: 892 invocations (98.2% success)
- pos-push: 3,456 invocations (99.8% success)
- onboarding: 12 invocations (100% success)
- restaurants: 45,678 invocations (99.9% success)
- orders: 8,234 invocations (99.7% success)
- platform: 1,234 invocations (100% success)
- support: 456 invocations (100% success)
- auth: 12,345 invocations (99.9% success)
- monthly-billing: 65 invocations (100% success)

Database:
- Connection pool: 23/100 used
- Query performance: 18ms avg
- Storage: 4.2 GB / 8 GB

Vapi:
- API calls: 12,847
- Avg latency: 487ms
- Token usage: 2.4M tokens
- Cost: $3,421.30

Alerts:
- No critical issues
- 2 warnings (review webhook retries)
```

---

## 🛠️ Supabase Edge Functions (Actual Implementation)

### VAPI Integration Functions

#### **vapi-assistant**
- **Purpose**: Handles `assistant-request` webhook from Vapi
- **Endpoint**: `POST /functions/v1/vapi-assistant`
- **Auth**: Uses VAPI_TOOL_TOKEN header
- **Flow**: 
  1. Receives call initiation
  2. Looks up business by phone number
  3. Returns assistant config, knowledge base, tools

#### **vapi-tools**
- **Purpose**: Handles `function-call` webhook from Vapi
- **Endpoint**: `POST /functions/v1/vapi-tools`
- **Auth**: Uses VAPI_TOOL_TOKEN header
- **Tools**:
  - `get_menu`: Fetch products/menu items
  - `place_order`: Create order
  - `get_customer`: Fetch customer data
  - `get_customer_addresses`: Fetch delivery addresses
  - `get_order_status`: Check order status

#### **vapi-events**
- **Purpose**: Handles `end-of-call-report` and `status-update` webhooks
- **Endpoint**: `POST /functions/v1/vapi-events`
- **Auth**: Uses VAPI_TOOL_TOKEN header
- **Flow**:
  1. Receives call completion data
  2. Upserts customer
  3. Stores call_logs
  4. Updates orders
  5. Updates analytics

#### **vapi-backfill**
- **Purpose**: Backfills historical Vapi data
- **Endpoint**: `POST /functions/v1/vapi-backfill`
- **Auth**: Uses VAPI_TOOL_TOKEN header
- **Flow**: Fetches past calls from Vapi API and syncs to database

### POS Integration Functions

#### **pos**
- **Purpose**: Main POS operations (sync menu, get items, sync logs)
- **Endpoints**: 
  - `POST /pos/:restaurantId/sync-menu` - Sync menu from POS
  - `GET /pos/:restaurantId/sync-logs` - Get sync history
- **Auth**: Optional (verify_jwt: false)

#### **pos-sync**
- **Purpose**: Manual/scheduled POS synchronization
- **Endpoint**: `POST /functions/v1/pos-sync`
- **Auth**: No (verify_jwt: false)
- **Flow**: Syncs menu items for all businesses with POS

#### **pos-push**
- **Purpose**: Push orders to POS systems
- **Endpoint**: `POST /functions/v1/pos-push`
- **Auth**: No (verify_jwt: false)
- **Flow**: Creates order in Square/Clover when order placed

#### **square-webhook**
- **Purpose**: Receives Square POS webhooks
- **Endpoint**: `POST /functions/v1/square-webhook`
- **Auth**: No (webhook signature verification)
- **Events**: catalog.version.updated, order.updated, payment.updated

#### **clover-webhook**
- **Purpose**: Receives Clover POS webhooks
- **Endpoint**: `POST /functions/v1/clover-webhook`
- **Auth**: No (webhook signature verification)
- **Events**: ORDER_UPDATED, PAYMENT_UPDATED

### Business Management Functions

#### **restaurants**
- **Purpose**: CRUD operations for businesses, POS management, manual orders
- **Endpoints**:
  - `GET /restaurants` - List businesses
  - `GET /restaurants/:id` - Get business details
  - `POST /restaurants` - Create business
  - `PATCH /restaurants/:id` - Update business
  - `DELETE /restaurants/:id` - Delete business
  - `POST /restaurants/:id/orders/manual` - Create manual order
  - `GET /restaurants/:id/pos/locations` - Get POS locations
  - `POST /restaurants/:id/pos/locations` - Add POS location
  - `PATCH /restaurants/:id/pos/locations/:locationId` - Update POS location
- **Auth**: Optional (verify_jwt: false, but verifyAuth internally)

#### **orders**
- **Purpose**: Order management
- **Endpoints**:
  - `POST /` - Create order
  - `PATCH /:orderId/status` - Update order status
- **Auth**: Required (verify_jwt: true)

#### **onboarding**
- **Purpose**: Complete business onboarding flow
- **Endpoints**:
  - `POST /` - Complete onboarding
  - `GET /status/:restaurantId` - Check onboarding status
  - `GET /check-email/:email` - Check if email exists
  - `GET /check-slug/:slug` - Check if slug available
- **Auth**: No (public onboarding)

### Platform Functions

#### **platform**
- **Purpose**: Platform-wide analytics
- **Endpoints**:
  - `GET /overview?range=today` - Platform overview
  - `GET /restaurants?range=today` - Restaurant summaries
  - `GET /analytics/timeline?range=today` - Usage timeline
  - `GET /analytics/call-center?range=today` - Call center metrics
- **Auth**: Required (verify_jwt: true)

#### **support**
- **Purpose**: Support ticket management
- **Endpoints**:
  - `POST /requests` - Create support request
  - `GET /requests` - List support requests
  - `GET /requests/:id` - Get support request with notes
  - `PATCH /requests/:id` - Update support request
  - `POST /requests/:id/notes` - Add note to request
- **Auth**: Required (verify_jwt: true)

#### **monthly-billing**
- **Purpose**: Calculate monthly billing
- **Endpoint**: `POST /functions/v1/monthly-billing`
- **Auth**: No (internal/cron)
- **Flow**: Calculates subscription fees, creates invoices

### Payment Functions

#### **stripe-webhook**
- **Purpose**: Handles Stripe payment events
- **Endpoint**: `POST /functions/v1/stripe-webhook`
- **Auth**: Stripe signature verification
- **Events**: payment_intent.succeeded, invoice.paid, etc.

### Authentication Functions

#### **auth**
- **Purpose**: User authentication
- **Endpoints**:
  - `POST /login` - User login
  - `POST /refresh` - Refresh access token
  - `POST /forgot-password` - Request password reset
  - `POST /reset-password` - Reset password with token
- **Auth**: No (public endpoints)

---

## 🚀 Implementation Roadmap

### Phase 1: Foundation ✅ (COMPLETED)
**Database Setup:**
- ✅ Created all tables
- ✅ Enabled RLS policies
- ✅ Set up indexes
- ✅ Created database functions
- ✅ Created views (restaurant_usage_summary)

**Supabase Edge Functions:**
- ✅ Deployed all functions
- ✅ Configured verify_jwt settings
- ✅ Set up CORS headers
- ✅ Implemented error handling

**Vapi Setup:**
- ✅ Created Vapi account
- ✅ Set up webhook endpoints
- ✅ Configured tools (functions)
- ✅ Tested calls in sandbox

### Phase 2: Core Features ✅ (COMPLETED)
**POS Integration:**
- ✅ Square OAuth flow
- ✅ Clover OAuth flow
- ✅ Webhook handlers
- ✅ Initial sync logic
- ✅ Incremental sync
- ✅ Multi-location support

**Business Owner Dashboard:**
- ✅ Authentication (Supabase Auth)
- ✅ Analytics page
- ✅ Calls list
- ✅ Orders list
- ✅ Menu management
- ✅ Settings page

### Phase 3: Agency Admin (~60% Complete)
**Admin Dashboard:**
- ✅ Business management (RestaurantsPage - list, view, manage businesses)
- ⏳ AI configuration (No UI yet - assistants configured via Vapi dashboard)
- ✅ System monitoring (via platform function - OverviewPage shows metrics)
- ✅ Analytics (via platform function - AnalyticsPage with timeline, call center metrics)
- ⚠️ Billing integration (BillingPage exists but Stripe integration incomplete)

**Automation:**
- ✅ Automated onboarding (onboarding function - full OAuth flow)
- ⏳ Email notifications (Not implemented - only SMS for order alerts)
- ⚠️ SMS alerts (Partially implemented - order notifications via Twilio in vapi-tools)
- ⏳ Daily reports (Not implemented - no scheduled report generation)

### Phase 4: Testing & Launch (~40% Complete)
**Testing:**
- ✅ End-to-end call flows (Vapi integration tested)
- ✅ POS sync accuracy (Square & Clover webhooks working)
- ✅ Basic function testing (All Edge Functions tested and working)
- ⏳ Load testing (Not performed)
- ⏳ Security audit (Not performed - RLS policies in place but not audited)

**Launch:**
- ⏳ Beta with 3 businesses (Not started)
- ⏳ Monitor for 2 weeks (Not started)
- ⏳ Fix issues (Ongoing)
- ⏳ Full launch (Not started)

---

## 📊 Overall Progress Summary

### ✅ Completed (~75%)
- **Phase 1: Foundation** - 100% ✅
- **Phase 2: Core Features** - 100% ✅
- **Phase 3: Agency Admin** - 60% ⚠️
- **Phase 4: Testing & Launch** - 40% ⏳

### 🎯 What's Working
1. **Complete Backend Infrastructure**
   - All database tables and relationships
   - All 18 Edge Functions deployed and tested
   - POS integration (Square & Clover) fully functional
   - Vapi integration complete with all webhook handlers

2. **Business Owner Dashboard** - Fully Functional
   - ✅ Authentication & authorization
   - ✅ Analytics/Overview page
   - ✅ Calls page with transcripts
   - ✅ Orders page with filters
   - ✅ Customers page
   - ✅ Menu/Products management
   - ✅ Settings with POS connection

3. **Platform Admin Dashboard** - Mostly Functional
   - ✅ Platform overview with metrics
   - ✅ Analytics page with timeline
   - ✅ Business management (list, view)
   - ✅ System monitoring via platform function
   - ⚠️ Billing page exists but incomplete

### ⚠️ What's Missing or Incomplete

1. **Agency Admin Features**
   - ⏳ AI Configuration UI (currently done via Vapi dashboard)
   - ⏳ Full business CRUD in admin dashboard
   - ⚠️ Complete billing integration with Stripe

2. **Automation & Notifications**
   - ⏳ Email notifications (welcome emails, order summaries, daily reports)
   - ⚠️ SMS alerts (partially working - only order notifications)
   - ⏳ Daily automated reports
   - ⏳ Scheduled tasks/cron jobs

3. **Testing & Production Readiness**
   - ⏳ Load testing
   - ⏳ Security audit
   - ⏳ Error monitoring/alerting
   - ⏳ Performance optimization

4. **Launch Readiness**
   - ⏳ Beta program
   - ⏳ Documentation for business owners
   - ⏳ Support system integration
   - ⏳ Marketing materials

### 🚀 Next Steps to Complete

**Priority 1 (Critical for Launch):**
1. Complete billing integration
2. Add email notifications (welcome, order confirmations)
3. Security audit
4. Load testing

**Priority 2 (Important for Scale):**
1. AI configuration UI in admin dashboard
2. Daily automated reports
3. Error monitoring/alerting
4. Performance optimization

**Priority 3 (Nice to Have):**
1. Enhanced analytics
2. Advanced reporting
3. Marketing automation
4. Customer support integration

---

## 📝 Notes

### Table Naming Convention
- The database uses `restaurants` as the table name, but this table supports **all business types** (restaurants, retail, salons, services, etc.)
- Future migration could rename to `businesses` for clarity, but current implementation works for all types
- All foreign keys reference `restaurant_id` but conceptually represent any business

### Multi-Location Support
- Businesses can have multiple POS locations via `restaurant_pos_locations` table
- Each location can have its own Vapi phone number
- Orders can be associated with specific locations
- Sync operations are per-location

### Authentication & Authorization
- Uses JWT-based authentication via `auth` Edge Function
- Two roles: `platform_admin` and `restaurant_admin`
- RLS policies enforce data isolation per business
- Platform admins can access all businesses

### VAPI Integration Architecture
- **Separate handlers** for different event types (not single vapi-webhook)
- `vapi-assistant`: Handles call initiation
- `vapi-tools`: Handles function calls during conversation
- `vapi-events`: Handles call completion and status updates
- `vapi-backfill`: Handles historical data sync

---
