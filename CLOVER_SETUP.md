# Clover OAuth Setup Guide

## Problem
You're seeing a 404 error on Clover's website after login. This can happen for two reasons:
1. Your app is in **"Draft"** status - Draft apps cannot use OAuth and need to be published to Sandbox or Production
2. The `redirect_uri` is not properly registered in Clover Developer Dashboard

## ⚠️ IMPORTANT: Draft Status Apps
**If your app shows "Draft" status**, it won't work with OAuth at all. You must:
- **For Testing**: Publish to **Sandbox** (no approval needed, recommended for development)
- **For Production**: Submit for approval and publish to **Production** (requires developer account approval)

**Recommended**: Use **Sandbox** for testing (no approval required).

## Solution: Register Redirect URI in Clover Dashboard

### Step 1: Access Clover Developer Dashboard
1. Go to: **https://www.clover.com/global-developer-home**
2. Log in with your Clover developer account
3. Find your app (App ID: `6C9HSCSJNCT4T`)

### Step 1.5: Publish App (If in Draft Status)
**If your app shows "Draft" status:**
1. **For Sandbox Testing** (Recommended - No Approval Needed):
   - Go to Sandbox Developer Dashboard: **https://sandbox.dev.clover.com/**
   - Create a sandbox developer account if you don't have one
   - Create/publish your app in the sandbox environment
   - You'll get a **new App ID** for sandbox
   - Update your `.env` with the sandbox App ID and Secret
   - Set `CLOVER_ENVIRONMENT=sandbox` in `.env`

2. **For Production** (Requires Approval):
   - Submit your developer account for approval
   - Once approved, publish your app to production
   - Use production App ID and credentials
   - Do NOT set `CLOVER_ENVIRONMENT=sandbox`

**For now, we recommend using Sandbox for testing.**

### Step 2: Configure Site URL
1. In your app settings, find **"REST Configuration"** or **"OAuth Settings"**
2. Look for **"Site URL"** field
3. Enter your base API URL: `https://eely-val-provocatively.ngrok-free.dev`
   - ⚠️ **Important**: Use `https://` (not `http://`)
   - ⚠️ **Important**: Use your actual ngrok URL (check `.env` file for `API_URL`)

### Step 3: Register Redirect URI
The `redirect_uri` must be a **subpath** of your Site URL:

**Site URL**: `https://eely-val-provocatively.ngrok-free.dev`  
**Redirect URI**: `https://eely-val-provocatively.ngrok-free.dev/v1/onboarding/pos/clover/callback`

Clover allows redirect URIs that are subpaths of your Site URL, so:
- ✅ Valid: `https://eely-val-provocatively.ngrok-free.dev/v1/onboarding/pos/clover/callback`
- ✅ Valid: `https://eely-val-provocatively.ngrok-free.dev/oauth/callback`
- ❌ Invalid: `https://different-domain.com/callback` (different domain)
- ❌ Invalid: `http://eely-val-provocatively.ngrok-free.dev/...` (http vs https)

### Step 4: Verify Configuration
1. In Clover Dashboard, ensure:
   - **Site URL** is set to your ngrok URL
   - **Default OAuth Response** is set to **"Code"**
   - App permissions are enabled (Inventory, Orders, Customers, Payments, Merchant)

### Step 5: Test Again
1. Restart your server (if needed)
2. Try connecting Clover again from your dashboard
3. After login, Clover should redirect to your callback URL instead of showing 404

## Troubleshooting

### If redirect URI still doesn't work:
1. **Check ngrok URL**: Ensure `API_URL` in `.env` matches your current ngrok URL
2. **Verify exact match**: The redirect_uri in the code must match exactly (case-sensitive, including `/v1/onboarding/pos/clover/callback`)
3. **Check Clover Dashboard logs**: Some dashboards show OAuth attempts and errors
4. **Try sandbox**: Test in Clover sandbox environment first if available

### Common Errors:
- **404 on Clover site**: 
  - **Draft status**: App not published → Publish to Sandbox or Production
  - **Redirect URI not registered**: Register Site URL in Clover Dashboard
- **"Invalid redirect_uri"**: Mismatch between registered and used URI → Verify exact match
- **"App not found"**: 
  - App ID incorrect → Check App ID matches environment (sandbox vs production)
  - App not published → Publish app from Draft status
  - Wrong environment → Use sandbox endpoints for sandbox apps, production for production apps

## Current Configuration
- **App ID**: `6C9HSCSJNCT4T`
- **Authorization URL (Production)**: `https://www.clover.com/oauth/v2/authorize`
- **Authorization URL (Sandbox)**: `https://apisandbox.dev.clover.com/oauth/v2/authorize`
- **Token Exchange URL (Production)**: `https://api.clover.com/oauth/v2/token`
- **Token Exchange URL (Sandbox)**: `https://apisandbox.dev.clover.com/oauth/v2/token`
- **Callback Endpoint**: `/v1/onboarding/pos/clover/callback`
- **Expected Redirect URI**: `${API_URL}/v1/onboarding/pos/clover/callback`

## Environment Detection
The code automatically detects sandbox vs production:
- **Sandbox**: Used if `CLOVER_ENVIRONMENT=sandbox` in `.env` OR `NODE_ENV !== 'production'`
- **Production**: Used otherwise

**Important**: Make sure your app is configured in the correct environment in Clover Dashboard:
- If app is in **Sandbox** → Set `CLOVER_ENVIRONMENT=sandbox` in `.env`
- If app is in **Production** → Leave `CLOVER_ENVIRONMENT` unset or remove it

## Next Steps After Setup
Once registered:
1. The OAuth flow should complete successfully
2. Your callback endpoint will receive the authorization code
3. The code will be exchanged for access/refresh tokens
4. Merchants will be fetched and displayed for selection
