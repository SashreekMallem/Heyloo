# 🏪 POS INTEGRATION SETUP GUIDE
## Complete Step-by-Step Instructions for Square, Toast, and Clover

---

## 📋 TABLE OF CONTENTS
1. [Overview](#overview)
2. [Square POS Setup](#square-pos-setup)
3. [Toast POS Setup](#toast-pos-setup)
4. [Clover POS Setup](#clover-pos-setup)
5. [Environment Variables](#environment-variables)
6. [Testing Your Integration](#testing-your-integration)

---

## OVERVIEW

This guide provides complete instructions for creating and configuring apps in Square, Toast, and Clover POS systems. Each integration requires:
- Developer account creation
- OAuth app configuration
- Permission/scope setup
- API credentials
- Webhook configuration (optional but recommended)

**What You're Building:** A voice-powered ordering system that:
- Syncs restaurant menus from POS
- Pushes orders to POS when customers call
- Supports delivery, pickup, and dine-in orders
- Handles customer information and modifiers

---

## 1️⃣ SQUARE POS SETUP

### Step 1: Create Square Developer Account
1. Go to [https://developer.squareup.com/](https://developer.squareup.com/)
2. Click **"Sign Up"** or **"Get Started"**
3. Create account with your email
4. Verify your email address

### Step 2: Create a New Application
1. Log in to [Square Developer Dashboard](https://developer.squareup.com/apps)
2. Click **"+ Create App"** or **"New Application"**
3. Fill in application details:
   - **App Name:** `Heyloo Voice Ordering` (or your company name)
   - **Description:** "AI-powered voice ordering system for restaurants"
   - **Organization:** Your company name
4. Click **"Save"**

### Step 3: Configure OAuth Settings
1. In your app dashboard, click **"OAuth"** in the left sidebar
2. **Add Redirect URL:**
   - For local testing (via ngrok): `https://<your-ngrok-domain>/v1/onboarding/pos/square/callback`
   - For production: `https://yourdomain.com/v1/onboarding/pos/square/callback`
3. Click **"Save"**

### Step 4: Get API Credentials
1. In your app dashboard, go to **"Credentials"**
2. Note these values (you'll need them):
   - **Sandbox Credentials (for testing):**
     - Sandbox Application ID: `sq0idp-xxxxx`
     - Sandbox Access Token: `EAAAl....` (copy this)
   - **Production Credentials (when ready):**
     - Production Application ID: `sq0idp-xxxxx`
     - Production Application Secret: `sq0csp-xxxxx` (keep secret!)

### Step 5: Set Required Permissions (Scopes)
When implementing OAuth, request these scopes:
```
MERCHANT_PROFILE_READ
ITEMS_READ
ITEMS_WRITE
ORDERS_READ
ORDERS_WRITE
INVENTORY_READ
INVENTORY_WRITE
CUSTOMERS_READ
CUSTOMERS_WRITE
PAYMENTS_READ
PAYMENTS_WRITE
```

**How to implement:** When redirecting users to Square OAuth, use this URL:
```
https://connect.squareup.com/oauth2/authorize?client_id=YOUR_APP_ID&scope=MERCHANT_PROFILE_READ+ITEMS_READ+ITEMS_WRITE+ORDERS_READ+ORDERS_WRITE+INVENTORY_READ+INVENTORY_WRITE+CUSTOMERS_READ+CUSTOMERS_WRITE+PAYMENTS_READ+PAYMENTS_WRITE&state=RANDOM_STRING&redirect_uri=https%3A%2F%2Fyour-domain%2Fv1%2Fonboarding%2Fpos%2Fsquare%2Fcallback
```

### Step 6: Configure Webhooks (Optional but Recommended)
1. In app dashboard, click **"Webhooks"**
2. Add webhook URL: `https://yourdomain.com/v1/webhooks/square`
3. Subscribe to events:
   - `order.created`
   - `order.updated`
   - `inventory.count.updated`
4. Save and note the **Webhook Signature Key**

### Step 7: Test with Sandbox
1. Use **Sandbox Access Token** in your `.env` file
2. Test with Square's sandbox environment:
   - Base URL: `https://connect.squareupsandbox.com`
   - Use test credit cards from [Square docs](https://developer.squareup.com/docs/devtools/sandbox/testing)

### Step 8: Environment Variables for Square
Add to your `.env` file:
```env
# Square Integration (start with Sandbox)
SQUARE_ENVIRONMENT=sandbox
SQUARE_ACCESS_TOKEN=EAAAl...your-sandbox-token
SQUARE_LOCATION_ID=   # Leave empty initially, get from restaurant
SQUARE_CLIENT_ID=sq0idp-xxxxx
SQUARE_CLIENT_SECRET=sq0csp-xxxxx
# API_URL must be publicly reachable over HTTPS (use ngrok for local dev)
API_URL=https://<your-ngrok-domain>
```

> **Note:** `SQUARE_ENVIRONMENT` defaults to `production`. Set it to `sandbox` when testing against Square's sandbox cluster.

### Square API Endpoints We Use:
- **Menu Sync:** `GET /v2/catalog/list?types=ITEM`
- **Create Order:** `POST /v2/orders`
- **Get Locations:** `GET /v2/locations`

### 📚 Square Documentation:
- Main Docs: https://developer.squareup.com/docs
- OAuth Guide: https://developer.squareup.com/docs/oauth-api/overview
- Orders API: https://developer.squareup.com/docs/orders-api/what-it-does
- Catalog API: https://developer.squareup.com/docs/catalog-api/what-it-does

---

## 2️⃣ TOAST POS SETUP

### Step 1: Apply to Toast Partner Program
1. Go to [Toast Partner Program](https://pos.toasttab.com/partners)
2. Click **"Become a Partner"** or **"Join Now"**
3. Fill out partner application:
   - Company information
   - Integration type: **"Online Ordering"** or **"Third-Party Delivery"**
   - Description of your voice ordering solution
4. Submit and wait for approval (can take 1-2 weeks)

### Step 2: Access Developer Portal
Once approved:
1. You'll receive email with access to **Toast Developer Portal**
2. Log in to [Toast Developer Portal](https://developer.toasttab.com)
3. Accept Terms of Service

### Step 3: Create Partner API Account
1. In Developer Portal, click **"API Accounts"**
2. Click **"Create New Account"**
3. Choose **"Partner Integration"** (not Restaurant Management Group)
4. Fill in details:
   - **Account Name:** `Heyloo Voice Ordering`
   - **Environment:** Start with **Sandbox**

### Step 4: Get API Credentials
1. After creating account, note these values:
   - **Toast-Restaurant-External-Id:** (you'll get this per restaurant)
   - **Toast-API-Key:** `your-api-key-here`
   - **Client ID:** `your-client-id`
   - **Client Secret:** `your-client-secret` (keep secret!)

### Step 5: Set Required Scopes
Request these scopes in your integration:
```
config:read          # Read restaurant configuration
restaurants:read     # Read restaurant information  
menus:read          # Read menu data
orders:read         # Read orders
orders:write        # Create and update orders
```

### Step 6: Configure Webhooks
1. In Developer Portal, go to **"Webhooks"**
2. Register webhook URL: `https://yourdomain.com/v1/webhooks/toast`
3. Subscribe to events:
   - `RestaurantAddedIntegration`
   - `RestaurantRemovedIntegration`
   - `OrderStatusChanged`
   - `MenuUpdated`

### Step 7: Get Connected Restaurants
Toast requires per-restaurant authorization:
1. Restaurant owner installs your integration via Toast App Marketplace
2. You receive webhook: `RestaurantAddedIntegration`
3. Use **Partners API** to get restaurant list:
```bash
GET https://toast-api-server.toasttab.com/partners/v1/restaurants
```

### Step 8: Test with Sandbox
1. Toast provides sandbox restaurant accounts for testing
2. Contact Toast support to get sandbox restaurant GUIDs
3. Test environment base URL: `https://toast-api-server.toasttab.com`

### Step 9: Environment Variables for Toast
Add to your `.env` file:
```env
# Toast Integration
TOAST_API_KEY=your-api-key-here
TOAST_PARTNER_CLIENT_ID=your-client-id
TOAST_CLIENT_SECRET=your-client-secret
```

### Toast API Endpoints We Use:
- **Menu Sync:** `GET /config/v1/menus?restaurantGuid={guid}`
- **Create Order:** `POST /orders/v2`
- **Get Restaurants:** `GET /partners/v1/restaurants`

### 📚 Toast Documentation:
- Main Docs: https://doc.toasttab.com
- Partner Guide: https://doc.toasttab.com/doc/devguide/apiPartnersGettingAccessibleRestaurants
- Orders API: https://doc.toasttab.com/doc/devguide/portalOrdersApiOverview
- Menus API: https://doc.toasttab.com/openapi/menus/overview

---

## 3️⃣ CLOVER POS SETUP

### Step 1: Create Clover Developer Account
1. Go to [Clover Developer Portal](https://www.clover.com/developers)
2. Click **"Sign Up"** or **"Create Account"**
3. Complete registration with email verification

### Step 2: Create a New App
1. Log in to [Clover Developer Dashboard](https://sandbox.dev.clover.com/developer-home/login)
2. Click **"Create App"**
3. Fill in app details:
   - **App Name:** `Heyloo Voice Ordering`
   - **Description:** "AI-powered voice ordering for restaurants"
   - **Category:** "Online Ordering"
   - **Website:** Your website URL

### Step 3: Configure App Settings
1. In your app settings, configure:
   - **Web Endpoint:** `https://yourdomain.com/v1/onboarding/pos/clover/callback`
   - **CORS Domain:** `https://yourdomain.com`

### Step 4: Set Required Permissions
In app settings, enable these permissions:
- **Read Merchant:** Access basic merchant information
- **Read Inventory:** View menu items
- **Write Inventory:** Sync menu changes (if needed)
- **Read Orders:** View order information
- **Write Orders:** Create and update orders
- **Read Customers:** Access customer data (optional)

### Step 5: Get API Credentials
1. In app dashboard, go to **"API Tokens"**
2. Note these values:
   - **App ID:** `your-app-id`
   - **App Secret:** `your-app-secret` (keep secret!)
   - **Sandbox Merchant ID:** For testing
   - **API Token:** Generated per merchant

### Step 6: Understand Clover OAuth Flow
Clover uses merchant-specific tokens:
1. Merchant installs your app from Clover App Market
2. You receive OAuth callback with authorization code
3. Exchange code for API token:
```bash
POST https://sandbox.dev.clover.com/oauth/token
{
  "client_id": "YOUR_APP_ID",
  "client_secret": "YOUR_APP_SECRET",
  "code": "AUTHORIZATION_CODE"
}
```

### Step 7: Configure Webhooks
1. In app settings, add **Webhook URLs:**
   - `https://yourdomain.com/v1/webhooks/clover`
2. Subscribe to events:
   - `MERCHANT_UPDATE`
   - `INVENTORY_UPDATE`
   - `ORDER_CREATE`
   - `ORDER_UPDATE`

### Step 8: Test with Sandbox
1. Clover provides sandbox merchant accounts
2. Generate test API token in dashboard
3. Sandbox base URL: `https://sandbox.dev.clover.com/v3/merchants/{merchantId}`

### Step 9: Environment Variables for Clover
Add to your `.env` file:
```env
# Clover Integration
CLOVER_API_KEY=your-api-token-here
CLOVER_MERCHANT_ID=your-merchant-id
CLOVER_APP_ID=your-app-id
CLOVER_APP_SECRET=your-app-secret
```

### Clover API Endpoints We Use:
- **Menu Sync:** `GET /v3/merchants/{merchantId}/items?expand=categories`
- **Create Order:** `POST /v3/merchants/{merchantId}/orders`
- **Add Line Items:** `POST /v3/merchants/{merchantId}/orders/{orderId}/line_items`

### 📚 Clover Documentation:
- Main Docs: https://docs.clover.com
- REST API: https://docs.clover.com/docs/making-rest-api-calls
- Orders API: https://docs.clover.com/docs/working-with-orders
- Inventory: https://docs.clover.com/docs/working-with-inventory

---

## 4️⃣ ENVIRONMENT VARIABLES

### Complete `.env` File Template

Create `.env` file in `/server/` directory:

```env
# ═══════════════════════════════════════════════════════
# HEYLOO VOICE ORDERING - ENVIRONMENT VARIABLES
# ═══════════════════════════════════════════════════════

# Application
NODE_ENV=development
PORT=4000
LOG_LEVEL=info

# Supabase Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# JWT Authentication
JWT_SECRET=your-very-long-random-secret-min-32-chars-here
JWT_REFRESH_SECRET=another-very-long-random-secret-min-32-chars-here

# VAPI Voice AI
VAPI_WEBHOOK_SECRET=your-vapi-webhook-secret
VAPI_API_KEY=your-vapi-private-key
VAPI_ASSISTANT_ID=2e88a407-72e4-451b-a327-61e039752275
VAPI_TOOL_TOKEN=your-random-tool-token

# Stripe Payments
STRIPE_SECRET_KEY=sk_test_xxxxx  # Use sk_live_ for production
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# Twilio SMS
TWILIO_ACCOUNT_SID=ACxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# ─────────────────────────────────────────────────────────
# SQUARE POS INTEGRATION
# ─────────────────────────────────────────────────────────
SQUARE_ACCESS_TOKEN=EAAAl...  # Sandbox token for testing
SQUARE_LOCATION_ID=           # Per-restaurant, leave empty
SQUARE_CLIENT_ID=sq0idp-xxxxx
SQUARE_CLIENT_SECRET=sq0csp-xxxxx

# ─────────────────────────────────────────────────────────
# TOAST POS INTEGRATION  
# ─────────────────────────────────────────────────────────
TOAST_API_KEY=your-toast-api-key
TOAST_PARTNER_CLIENT_ID=your-toast-client-id
TOAST_CLIENT_SECRET=your-toast-client-secret

# ─────────────────────────────────────────────────────────
# CLOVER POS INTEGRATION
# ─────────────────────────────────────────────────────────
CLOVER_API_KEY=your-clover-api-token
CLOVER_MERCHANT_ID=your-merchant-id
CLOVER_APP_ID=your-clover-app-id
CLOVER_APP_SECRET=your-clover-app-secret
```

### Security Best Practices:
✅ **NEVER** commit `.env` file to git (already in `.gitignore`)
✅ Use different credentials for development/staging/production
✅ Rotate secrets regularly (every 90 days minimum)
✅ Use environment-specific Supabase projects
✅ Enable 2FA on all POS developer accounts

---

## 5️⃣ TESTING YOUR INTEGRATION

### Testing Checklist

#### Square Testing:
- [ ] Can list locations using API token
- [ ] Can retrieve catalog items (menu)
- [ ] Can create a test order
- [ ] Order appears in Square Dashboard
- [ ] Webhook receives order updates

**Test Commands:**
```bash
# Test Square connection
curl https://connect.squareupsandbox.com/v2/locations \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer YOUR_SANDBOX_TOKEN"

# Test catalog list
curl https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer YOUR_SANDBOX_TOKEN"
```

#### Toast Testing:
- [ ] Can access Partners API with credentials
- [ ] Can retrieve restaurant list
- [ ] Can get menu for test restaurant
- [ ] Can create test order
- [ ] Order appears in Toast POS

**Test Commands:**
```bash
# Test Toast connection
curl https://toast-api-server.toasttab.com/partners/v1/restaurants \
  -H "Authorization: Bearer YOUR_API_KEY"

# Test menu retrieval
curl https://toast-api-server.toasttab.com/config/v1/menus?restaurantGuid=TEST_GUID \
  -H "Toast-Restaurant-External-Id: TEST_GUID" \
  -H "Toast-API-Key: YOUR_API_KEY"
```

#### Clover Testing:
- [ ] Can access merchant information
- [ ] Can list inventory items (menu)
- [ ] Can create test order
- [ ] Can add line items to order
- [ ] Order appears in Clover Dashboard

**Test Commands:**
```bash
# Test Clover connection
curl https://sandbox.dev.clover.com/v3/merchants/YOUR_MERCHANT_ID \
  -H "Authorization: Bearer YOUR_API_TOKEN"

# Test inventory list
curl https://sandbox.dev.clover.com/v3/merchants/YOUR_MERCHANT_ID/items \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

### Using Our Built-in Test Endpoints

Once your server is running (`npm run dev:api`):

```bash
# Test menu sync from POS
POST http://localhost:4000/v1/pos/{restaurantId}/sync-menu

# Test order push to POS
# (Create an order via dashboard or API, it will auto-push)
```

---

## 6️⃣ PRODUCTION DEPLOYMENT

### Before Going Live:

#### Square:
1. Switch from Sandbox to Production credentials
2. Update base URL to `https://connect.squareup.com`
3. Submit app for Square App Marketplace review (optional)
4. Update webhook URLs to production domain

#### Toast:
1. Request production API access from Toast
2. Get approved by Toast compliance team
3. Restaurants install from Toast App Marketplace
4. Monitor via Partners API webhook events

#### Clover:
1. Submit app for Clover App Market approval
2. Clover reviews app (1-2 weeks)
3. Once approved, merchants can install
4. Switch to production base URL: `https://api.clover.com`

---

## 🆘 TROUBLESHOOTING

### Common Issues:

**"Invalid credentials" error:**
- Double-check API keys in `.env`
- Ensure using correct environment (sandbox vs production)
- Verify keys haven't expired

**"Permission denied" error:**
- Check OAuth scopes requested
- Verify app has required permissions enabled
- Re-authorize if permissions changed

**"Restaurant not found" error:**
- Verify restaurant GUID/Location ID is correct
- Ensure restaurant has granted access to your app
- Check restaurant is active (not archived)

**Orders not appearing in POS:**
- Check webhook logs for errors
- Verify POS location ID is configured
- Test with minimal order first
- Check POS-specific requirements (e.g., Toast needs exact 10-digit phone)

---

## 📞 SUPPORT CONTACTS

- **Square Developer Support:** https://developer.squareup.com/support
- **Toast Partner Support:** partners@toasttab.com
- **Clover Developer Support:** https://community.clover.com

---

## 🎉 NEXT STEPS

Once all three POS systems are configured:

1. **Test the full flow:**
   - Restaurant onboards via `/onboarding` page
   - Connects their POS system
   - Menu syncs automatically
   - Place test order via VAPI call
   - Verify order reaches POS

2. **Monitor integration health:**
   - Check `pos_sync_log` table in Supabase
   - Review server logs for errors
   - Set up alerts for failed syncs

3. **Scale to production:**
   - Deploy to production environment
   - Update all webhook URLs
   - Switch to production API credentials
   - Submit apps for marketplace review

---

**Document Version:** 1.0
**Last Updated:** January 2025
**Maintained By:** Heyloo Development Team
