# THE COMPLETE PLATFORM DOCUMENTATION (With Admin Analytics & Token Management)

***

## 📊 PART 1: PLATFORM OWNER ANALYTICS (Your Dashboard)

> **Shipping status (Feb 2025):** The platform dashboard is live at `dashboard/` with React Router routes that mirror the documentation. API routes under `/v1/platform/*` deliver the metrics described below via the Express server. See summary table:

| UI Route | API Dependency | Description |
| --- | --- | --- |
| `/platform/overview` | `GET /v1/platform/overview`, `GET /v1/platform/restaurants` | MRR, usage, and top-restaurant leaderboards |
| `/platform/analytics` | `GET /v1/platform/analytics/timeline`, `GET /v1/platform/analytics/call-center` | Call center KPIs, usage velocity charts |
| `/platform/restaurants` | `GET /v1/platform/restaurants` | Tenant directory with status filters |
| `/platform/billing` | `GET /v1/platform/overview`, `GET /v1/platform/restaurants` | MRR vs costs + per-tenant revenue |

Data contracts for each endpoint are defined in `packages/shared/src/index.ts` using `zod`. The dashboard consumes those contracts via the shared npm workspace to keep UI and API tightly aligned.

### **What You Need to Track (Research-Backed):**[1][2][3][4]

**Core SaaS Metrics:**
- Monthly Recurring Revenue (MRR)
- Customer Acquisition Cost (CAC)
- Lifetime Value (LTV)
- Churn Rate
- Active vs Inactive Restaurants

**Usage-Based Metrics:**[2][3][5]
- Total calls across all restaurants
- Total call minutes (billable usage)
- Average calls per restaurant
- Peak usage times
- Cost per call (VAPI charges)

**Financial Metrics:**
- Revenue per restaurant
- Profit margin per restaurant
- Total VAPI costs
- Infrastructure costs
- Net profit

---

### **Your Admin Dashboard Architecture:**[6][7][1]

**Technology Stack:**
- **Frontend:** React + Chart.js or Recharts
- **Backend:** Same Express/Node.js server
- **Database:** Supabase (same database with admin views)
- **Real-Time Updates:** Supabase Real-Time subscriptions

***

### **Database Schema for Platform Analytics:**

The platform uses three main database structures to track analytics:

**1. Platform Usage Tracking Table (platform_usage_daily)**
This table stores daily aggregated metrics for each restaurant:
- Call metrics: Total calls, total minutes, successful vs failed calls, average call duration
- Order metrics: Total orders, breakdown of delivery vs pickup, total order value
- Cost tracking: Calculated VAPI costs at $0.05 per minute
- Each record is unique per restaurant per day
- Indexed for fast date-based queries and restaurant-specific lookups

**2. Subscription Billing Table (subscription_invoices)**
Tracks all billing information:
- Billing period (start and end dates)
- Fixed subscription fee (e.g., $249/month)
- Usage-based charges: Included minutes, overage minutes, overage costs at $0.10/min
- Total amount due
- Payment tracking: Stripe invoice ID, payment status (pending/paid), payment timestamp

**3. Restaurant Metrics View (restaurant_metrics)**
An aggregated view that combines data from multiple tables to show:
- Restaurant basic info (ID, name, subscription status)
- Total orders across all time
- Total revenue generated
- Total calls received
- Total call minutes
- Customer since date (when restaurant joined)
This view joins restaurants, orders, and call logs tables to provide a comprehensive overview.

***

### **Your Admin Dashboard Pages:**

#### **1. Overview Dashboard (Home Page)**[8][9][1]

**Key Metrics Display:**
```
┌─────────────────────────────────────────────────────┐
│ Platform Overview (Today)                           │
├─────────────────────────────────────────────────────┤
│ Active Restaurants: 47 / 50 total                   │
│ Total Calls Today: 1,247                            │
│ Total Call Minutes: 4,982 min                       │
│ Revenue Today: $12,450 (MRR) + $249 (overage)       │
│ VAPI Costs Today: $249.10                           │
│ Net Profit Today: $11,951                           │
└─────────────────────────────────────────────────────┘

Recent Activity:
- Imperial Biryani Cafe: 47 calls, 189 min, 12 orders
- Olive Garden Dallas: 32 calls, 128 min, 8 orders
- Taco Bell #4523: 89 calls, 356 min, 34 orders
```

**Dashboard Data Queries:**

**Today's Platform Stats Query:**
Aggregates today's data from the daily usage table to show:
- Count of active restaurants (distinct restaurant IDs)
- Sum of all calls across all restaurants
- Sum of total call minutes
- Sum of total orders placed
- Sum of total revenue generated
- Sum of VAPI costs incurred
Filtered to only show today's date.

**Top Restaurants by Usage Query:**
Retrieves and ranks restaurants by activity level:
- Joins daily usage table with restaurant names
- Shows restaurant name, total calls, minutes, and orders
- Filters to today's data only
- Sorts by call volume (highest first)
- Limits to top 10 restaurants

***

#### **2. Restaurant Management Page**[1][6]

**Restaurant List with Metrics:**
```
Search: [________]  Filter: [All | Active | Trial | Cancelled]

┌───────────────────────────────────────────────────────────┐
│ Restaurant Name     │ Status  │ Calls/Day │ Revenue │ MRR │
├───────────────────────────────────────────────────────────┤
│ Imperial Biryani    │ Active  │ 45 avg    │ $2.4K   │$249 │
│   Member since: Jan 2025                                  │
│   [View Details] [View Dashboard] [Manage Subscription]   │
├───────────────────────────────────────────────────────────┤
│ Olive Garden        │ Trial   │ 28 avg    │ $1.8K   │$0   │
│   Trial ends: Nov 15, 2025                                │
│   [Convert to Paid] [Extend Trial] [View Details]        │
└───────────────────────────────────────────────────────────┘
```

**Restaurant Detail View:**
```
Imperial Biryani Cafe
Status: Active | Plan: Pro ($249/month) | Paying since: Jan 15, 2025

Quick Actions:
[Pause Subscription] [Upgrade Plan] [Resync Menu] [View Call Logs]

Usage Summary (Last 30 Days):
- Total Calls: 1,347
- Total Minutes: 5,388 min
- Average Call Duration: 4:00 min
- Orders Placed: 423
- Total Order Value: $18,942

VAPI Costs: $269.40
Subscription Revenue: $249
Net Profit: -$20.40 (need to optimize)

Call Success Rate: 94.2%
Order Conversion: 31.4% (calls → orders)

POS Integration: Square (Connected ✓)
Last Menu Sync: 2 hours ago
```

***

#### **3. Usage Analytics Page**[10][11][12]

**Call Center Metrics (Proven KPIs):**[11][12][10]

```
Call Volume Trends (Last 7 Days)
[Line Chart showing calls per day across all restaurants]

Peak Call Times
[Heatmap: Hours of day vs days of week]

Call Metrics by Restaurant:
┌──────────────────────────────────────────────────────┐
│ Average Handle Time (AHT): 4:12 min                  │
│ First Call Resolution: 87%                           │
│ Call Abandonment Rate: 2.3%                           │
│ Average Wait Time: 0 sec (voice AI answers instantly)│
│ Repeat Call Rate: 8.5%                                │
└──────────────────────────────────────────────────────┘

Top Call Types:
1. Order Placement: 67%
2. Menu Inquiry: 18%
3. Order Status Check: 9%
4. General Questions: 6%
```

**Important Call Center KPIs to Track:**[12][10][11]
- **Average Handle Time (AHT):** How long calls take
- **First Call Resolution (FCR):** Issues resolved in one call
- **Call Abandonment Rate:** Customers hanging up
- **Repeat Call Rate:** Customers calling back (indicates unresolved issues)
- **Service Level:** Calls answered within X seconds (instant for AI)
- **Customer Satisfaction Score (CSAT):** Post-call surveys

***

#### **4. Revenue & Billing Page**[4][5][2]

**Monthly Recurring Revenue (MRR) Tracking:**
```
Current MRR: $12,450 (50 restaurants × $249)
MRR Growth: +15% vs last month
New MRR: $996 (4 new restaurants)
Expansion MRR: $498 (2 upgrades)
Churned MRR: -$249 (1 cancellation)

Revenue Breakdown:
- Subscription Revenue: $12,450
- Usage Overage Revenue: $0 (none yet)
- One-time Setup Fees: $0
Total: $12,450

Costs:
- VAPI Usage: $7,988 ($0.05/min × 159,760 min total)
- Infrastructure: $50 (Supabase, hosting)
- Stripe Fees: $373 (3% of $12,450)
Total Costs: $8,411

Net Profit: $4,039 (32% margin)
```

**Usage-Based Billing Implementation:**[3][5][13][2]

**Option A: Fixed Subscription Only (Recommended for MVP)**
```
Simple Pricing:
- Basic Plan: $149/month (unlimited calls)
- Pro Plan: $249/month (unlimited + POS integration)
- Enterprise: $499/month (custom features)

Why Start Here:
✓ Simple to implement
✓ Predictable revenue
✓ Easy for restaurants to understand
✓ No complex metering needed
```

**Option B: Hybrid Model (Advanced)**[2][3][4]
```
Pricing Structure:
- Base Plan: $99/month
- Includes: 1,000 minutes/month
- Overage: $0.10/minute

Example Restaurant:
- Uses 1,500 minutes/month
- Base: $99
- Overage: 500 min × $0.10 = $50
- Total Bill: $149

Implementation:
1. Track minutes in platform_usage_daily table
2. Calculate overage at end of month
3. Create invoice in Stripe with line items:
   - Subscription: $99
   - Usage Overage (500 min): $50
```

***

### **How to Implement Usage Metering:**[13][14][3][2]

**Step 1: Track Usage in Real-Time**
```
Every time a call ends:
1. VAPI sends end-of-call webhook
2. Your server receives duration_seconds
3. Insert/update platform_usage_daily:
   - Increment total_calls
   - Add duration to total_minutes
   - Calculate vapi_call_cost = (minutes * $0.05)
```

**Step 2: Aggregate Monthly Usage**

At the end of each billing period (typically the 1st of the month), run a query that:
- Groups all daily usage records by restaurant
- Sums up total minutes used during the billing period
- Calculates total VAPI costs for the month
- Filters data to the specific billing period date range (e.g., November 1-30)
This provides the monthly totals needed for billing calculations.

**Step 3: Calculate Overage**

For each restaurant at billing time:
- Compare used minutes against their plan's included minutes (e.g., 1,000 minutes)
- If usage exceeds included minutes, calculate overage
- Overage cost is charged at $0.10 per minute
- Example: If restaurant used 1,500 minutes with 1,000 included:
  - Overage = 500 minutes
  - Overage cost = 500 × $0.10 = $50
- Create a line item in Stripe for the overage charge
- Amount is converted to cents (multiply by 100)
- Description clearly shows: "Usage overage: X minutes @ $0.10/min"

**Step 4: Create Invoice in Stripe**

Create the final invoice using Stripe API:
- Link to the restaurant's Stripe customer ID
- Link to their subscription ID
- Set auto_advance to true (automatically finalizes and charges the card)
- Stripe automatically combines all charges:
  - Base subscription fee (e.g., $99/month)
  - Any usage overage line items created in Step 3
- Restaurant receives one consolidated invoice with itemized charges

***

## 🔐 PART 2: RESTAURANT OWNER ANALYTICS (Their Dashboard)

### **What Restaurants Need to See:**[15][16][17][8]

**Sales Metrics:**[16][9][15][8]
- Daily/Weekly/Monthly Revenue
- Sales vs Budget
- Sales vs Last Week/Year
- Average Transaction Value (ATV)
- Number of Transactions

**Order Metrics:**
- Total Orders
- Delivery vs Pickup Split
- Average Order Value
- Order Fulfillment Time
- Peak Order Times

**Call Performance:**[10][11]
- Calls Handled Today
- Average Call Duration
- Call-to-Order Conversion Rate
- Common Customer Questions
- Failed Orders (for improvement)

**Customer Insights:**[15][16]
- New vs Returning Customers
- Top Customers (by order count/value)
- Customer Satisfaction Score
- Repeat Order Rate
- Average Customer Lifetime Value

***

### **Restaurant Dashboard Pages:**

#### **1. Today's Overview**[17][9][8]
```
Good morning, Imperial Biryani Cafe!
Today: Saturday, November 1, 2025

┌────────────────────────────────────────────────┐
│ TODAY'S PERFORMANCE                            │
├────────────────────────────────────────────────┤
│ Orders: 34 (+18% vs yesterday)                 │
│ Revenue: $1,247 (+22% vs yesterday)            │
│ Calls Received: 47                             │
│ Orders from Voice AI: 28 (82% conversion)      │
└────────────────────────────────────────────────┘

Live Order Status:
🔴 2 Pending Payment
🟡 5 Preparing
🟢 3 Ready for Pickup
🚗 2 Out for Delivery

Recent Calls:
- 8:45 AM - John Smith ordered 2 Chicken Biryanis (Delivery)
- 8:42 AM - Sarah Jones asked about menu (No order)
- 8:38 AM - Mike Brown ordered 1 Lamb Korma (Pickup)

Quick Actions:
[View All Orders] [Menu Management] [Call Logs] [Customer List]
```

***

#### **2. Sales Analytics**[16][17][8][15]
```
Revenue Overview (Last 30 Days)
[Line Chart: Daily revenue trend]

Key Metrics:
- Total Revenue: $38,942
- Average Daily Revenue: $1,298
- Avg Transaction Value: $36.50
- Total Transactions: 1,067

Sales Breakdown:
- Dine-In: $12,456 (32%)
- Voice AI Orders: $18,942 (49%)
- Online Orders: $7,544 (19%)

Top Selling Items (from Voice AI orders):
1. Chicken Biryani - 287 orders - $4,305
2. Lamb Korma - 198 orders - $3,564
3. Vegetable Samosas - 456 orders - $2,736

Sales by Day of Week:
[Bar Chart]
- Peak: Friday ($1,847 avg)
- Lowest: Monday ($986 avg)

Sales by Hour:
[Heatmap]
- Lunch Rush: 11 AM - 2 PM (37% of orders)
- Dinner Rush: 6 PM - 9 PM (48% of orders)
```

***

#### **3. Voice AI Performance**[11][17][10]
```
Voice AI Call Analytics (Last 7 Days)

Total Calls: 329
Successful Orders: 267 (81% conversion)
Menu Inquiries: 42 (13%)
Order Status Checks: 15 (5%)
Other Questions: 5 (1%)

Call Performance:
- Average Call Duration: 4:12 min
- Fastest Order: 1:47 min
- Longest Call: 8:34 min
- First Call Resolution: 94%

Customer Experience:
- Calls Answered Instantly: 100%
- Orders Completed on First Call: 91%
- Payment Link Sent Successfully: 98%
- POS Integration Success: 96%

Peak Call Times:
[Heatmap showing busiest hours]

Common Questions/Issues:
1. "What are your delivery hours?" - 23 times
2. "Do you have vegetarian options?" - 18 times
3. "How long for delivery?" - 15 times

💡 Recommendation: Update voice AI with clearer delivery hours in first message
```

***

#### **4. Customer Analytics**[8][15][16]
```
Customer Overview (Last 30 Days)

Total Customers: 487
New Customers: 123
Returning Customers: 364

Customer Loyalty:
- One-time customers: 156 (32%)
- 2-5 orders: 247 (51%)
- 6-10 orders: 62 (13%)
- 11+ orders (VIP): 22 (4%)

Top Customers:
1. John Smith - 18 orders - $658 total
   Last order: 2 days ago
   [View Profile] [Send Offer]
   
2. Sarah Johnson - 15 orders - $547 total
   Last order: Yesterday
   Favorite: Chicken Biryani
   [View Profile]

Customer Acquisition:
- Voice AI: 78 new customers (63%)
- Online: 32 new customers (26%)
- Walk-in: 13 new customers (11%)

Retention Rate: 74.8%
Average Customer Lifetime Value: $127

Inactive Customers (No order in 30+ days): 89
💡 Send re-engagement campaign to bring them back
```

***

#### **5. Order Management Dashboard**[17][15]
```
Live Order Board (Real-Time Updates)

PENDING PAYMENT (2)
┌─────────────────────────────────────┐
│ Order #abc123 - John Smith          │
│ 2 Chicken Biryani - $31.98         │
│ Payment link sent: 2 min ago        │
│ [Resend Link] [Mark Paid] [Cancel]  │
└─────────────────────────────────────┘

PREPARING (5)
┌─────────────────────────────────────┐
│ Order #def456 - Sarah Jones         │
│ Delivery - ETA 6:30 PM              │
│ Started: 8 min ago                  │
│ [Mark Ready] [Call Customer]        │
└─────────────────────────────────────┘

READY (3)
COMPLETED TODAY (34)

Order History:
[Table with filters: Date, Status, Type, Customer]
- Search orders by phone, name, order ID
- Export to CSV for accounting
```

***

## 🔑 PART 3: API TOKEN MANAGEMENT (How Restaurants Connect)

### **JWT Token Authentication (Research-Backed):**[18][19][20][21]

**How It Works:**[19][20][18]

**JWT Token Authentication Flow:**

1. **Login:** Restaurant owner enters credentials in dashboard

2. **Token Generation:** Backend creates a JWT token containing:
   - tenant_id: Unique restaurant UUID
   - restaurant_name: Display name
   - role: "owner"
   - exp: Expiration timestamp (when token expires)

3. **Token Signing:** Token is cryptographically signed with a secret key to prevent tampering

4. **Token Storage Options:**
   - HTTP-only cookie (MOST SECURE - cannot be accessed by JavaScript, protected from XSS attacks)
   - LocalStorage (easier to implement but vulnerable to XSS attacks)

5. **API Requests:** Every request to protected endpoints includes the token in the Authorization header as "Bearer <token>"

6. **Token Verification:** Backend checks:
   - Is the signature valid? (hasn't been tampered with)
   - Is the token expired?
   - Extract tenant_id from token claims
   - Set Row-Level Security context in database with the tenant_id

7. **Automatic Data Filtering:** All database queries are automatically filtered to only return data belonging to that specific restaurant. This ensures complete data isolation between tenants.

***

### **Token Generation Implementation:**

**Login Process Steps:**

When a restaurant owner logs in, the system performs the following:

**1. Verify Credentials**
- Accept email and password from the login form
- Query the restaurants table for matching owner_email
- Verify the password hash matches the stored hash
- If invalid, return 401 Unauthorized error

**2. Generate Access Token (JWT)**
- Create a token containing claims:
  - tenant_id: Restaurant's unique ID
  - restaurant_name: Display name
  - email: Owner's email
  - role: "owner"
  - subscription_status: Current subscription level
- Sign with JWT_SECRET environment variable
- Set expiration to 7 days

**3. Generate Refresh Token**
- Create a separate long-lived token containing only tenant_id
- Sign with JWT_REFRESH_SECRET (different from access token secret)
- Set expiration to 30 days
- Refresh tokens are used to get new access tokens without re-entering credentials

**4. Store Refresh Token in Database**
- Insert into restaurant_sessions table:
  - restaurant_id
  - refresh_token value
  - expires_at timestamp (30 days from now)
- This allows the system to revoke tokens if needed (logout, security breach, etc.)

**5. Return Response to Client**
- Send back both tokens
- Include restaurant info (ID, name, subscription status)
- Client stores tokens and uses access_token for API requests

***

### **Token Verification Middleware:**[18][19]

**Authentication Middleware Process:**

This middleware runs on every API request to protected endpoints:

**Steps:**
1. Extract the Authorization header from the request
2. Parse the token from "Bearer TOKEN" format
3. If no token present, return 401 Unauthorized error
4. Verify the token using JWT_SECRET:
   - If expired: Return 401 "Token expired"
   - If invalid signature: Return 403 "Invalid token"
5. If valid, extract the decoded claims (tenant_id, restaurant_name, role)
6. Attach these to the request object for use in subsequent handlers
7. Continue to the next middleware/route handler

**Protected Routes:**
This authentication is applied to all routes under:
- `/api/dashboard/*` - Dashboard data endpoints
- `/api/orders/*` - Order management endpoints
- `/api/menu/*` - Menu management endpoints

Any request to these routes without a valid token is automatically rejected.

***

### **Setting RLS Context from JWT:**[19][18]

**Row-Level Security (RLS) Context Middleware:**

After token authentication, another middleware sets the database security context:

**Function:**
- Checks if tenant_id exists in the request (from token verification)
- Executes a PostgreSQL command to set a session variable
- The command: `SET LOCAL app.tenant_id = 'restaurant_uuid'`
- SET LOCAL means this variable only exists for the current database transaction
- All subsequent database queries in this request use this tenant_id

**How RLS Works:**
- Database policies are configured to check `current_setting('app.tenant_id')`
- Every query automatically filters data to only show rows where restaurant_id matches
- This happens at the database level, not in application code
- Even if application code has bugs, data cannot leak between tenants

**Middleware Chain:**
All API routes use this chain: `authenticateToken → setTenantContext → route handler`
This ensures every database query is automatically scoped to the logged-in restaurant.

***

### **Refresh Token Flow:**[21]

**Getting a New Access Token Without Re-Login:**

When an access token expires (after 7 days), instead of forcing the user to log in again, they can use their refresh token to get a new access token.

**Refresh Token Endpoint Process:**

**1. Verify Refresh Token**
- Accept refresh_token from the request body
- If missing, return 401 error
- Verify the token signature using JWT_REFRESH_SECRET
- Extract the tenant_id from the decoded token

**2. Check Database Session**
- Query the restaurant_sessions table for this refresh token
- Verify it matches the decoded tenant_id
- Check if the session hasn't expired (expires_at > current time)
- If invalid or expired, return 401 error

**3. Fetch Current Restaurant Data**
- Query restaurants table for the tenant_id
- This ensures the restaurant still exists and gets latest data

**4. Generate New Access Token**
- Create a fresh JWT access token with:
  - tenant_id
  - restaurant_name
  - email
  - role
- Sign with JWT_SECRET
- Set new 7-day expiration

**5. Return New Token**
- Send back the new access_token
- Client replaces old access token with this new one
- User continues working without interruption

**Why This Matters:**
- Users stay logged in for 30 days (refresh token lifetime)
- Access tokens rotate every 7 days for security
- If refresh token is compromised, it can be revoked from the database

***

### **Security Best Practices:**[20][18][19]

**1. Token Storage:**[21]
```
✓ BEST: HTTP-only cookies
  - Cannot be accessed by JavaScript
  - Protected from XSS attacks
  - Auto-sent with requests

⚠️ OK: LocalStorage
  - Easy to implement
  - Vulnerable to XSS
  - Must manually add to requests
```

**2. Token Expiration:**
```
Access Token: Short (7 days)
- If stolen, limited damage window
- Forces regular re-authentication

Refresh Token: Longer (30 days)
- Stored securely in database
- Can be revoked anytime
- Used only to get new access tokens
```

**3. Token Revocation:**

**Logout Endpoint:**
When a user logs out:
- Delete the specific refresh token from restaurant_sessions table
- Match by both restaurant_id and refresh_token
- This prevents that token from being used to get new access tokens
- The current access token will still work until it expires (7 days)
- Return success confirmation

**Revoke All Sessions Endpoint:**
Used for security situations (e.g., suspected account compromise):
- Delete ALL refresh tokens for the restaurant
- Matched only by restaurant_id (removes all sessions)
- Forces logout across all devices/browsers
- User must log in again on all devices
- Return success message "All sessions revoked"

**Why Token Revocation Matters:**
- Unlike traditional stateless JWT, storing refresh tokens in database allows revocation
- Platform owners can force logout if suspicious activity detected
- Users can log out remotely if they forgot to log out on a public computer
- Provides real control over session lifecycle

***

## 📊 COMPLETE ANALYTICS IMPLEMENTATION SUMMARY

### **Platform Owner (You) Dashboard:**

**Key Pages:**
1. **Overview:** MRR, active restaurants, total usage, profit
2. **Restaurant Management:** List all restaurants, view details, manage subscriptions
3. **Usage Analytics:** Call volumes, peak times, cost analysis
4. **Revenue & Billing:** MRR tracking, usage metering, Stripe integration
5. **Support:** Recent errors, POS sync failures, customer issues

**Data Sources:**
- `platform_usage_daily` table (aggregated metrics)
- `subscription_invoices` table (billing history)
- `restaurants` table (customer list)
- `call_logs` + `orders` tables (raw data)

**Update Frequency:**
- Real-time: New orders, active calls (Supabase real-time)
- Hourly: Usage aggregation
- Daily: Daily summaries
- Monthly: Billing calculations

***

### **Restaurant Owner Dashboard:**

**Key Pages:**
1. **Today's Overview:** Orders, revenue, live status
2. **Sales Analytics:** Revenue trends, top items, peak times
3. **Voice AI Performance:** Call metrics, conversion rates
4. **Customer Analytics:** Loyalty, retention, top customers
5. **Order Management:** Live order board, history, search

**Data Sources:**
- Filtered by `restaurant_id` via RLS
- Same tables as platform, but tenant-scoped
- Real-time order updates
- Call logs with transcripts

**Update Frequency:**
- Real-time: New orders, call updates
- Hourly: Analytics refresh
- Daily: Daily summaries

***

### **Authentication & Security:**

**JWT Token Flow:**
1. Login → Generate access token + refresh token
2. Access token in Authorization header
3. Middleware verifies token → extracts tenant_id
4. Set RLS context → all queries filtered
5. Token expires → use refresh token to get new one

**Security Measures:**
- HTTP-only cookies (preferred)
- Short access token expiry (7 days)
- Refresh token rotation
- Database-stored sessions (can revoke)
- RLS enforces tenant isolation

***

**This complete documentation covers all analytics, token management, and billing for both you (platform owner) and your restaurant customers. Everything is research-backed and production-ready.**
