#!/bin/bash

# Script to check what permissions Square and Clover apps have access to

echo "========================================="
echo "CHECKING SQUARE APP PERMISSIONS"
echo "========================================="
echo ""
echo "Square App ID: sq0idp-Za407knMYHZiquLLvRNJHA"
echo ""
echo "Current OAuth Scopes Being Requested:"
echo "MERCHANT_PROFILE_READ ITEMS_READ ITEMS_WRITE INVENTORY_READ INVENTORY_WRITE ORDERS_READ ORDERS_WRITE CUSTOMERS_READ CUSTOMERS_WRITE PAYMENTS_READ PAYMENTS_WRITE"
echo ""
echo "To verify actual permissions granted:"
echo "1. Check Square Developer Dashboard: https://developer.squareup.com/apps"
echo "2. Or make API test calls with an access token:"
echo ""
echo "Test Locations API (requires MERCHANT_PROFILE_READ):"
echo 'curl https://connect.squareup.com/v2/locations \'
echo '  -H "Square-Version: 2025-01-23" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo "Test Catalog API (requires ITEMS_READ):"
echo 'curl "https://connect.squareup.com/v2/catalog/list?types=ITEM" \'
echo '  -H "Square-Version: 2025-01-23" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo "Test Orders API (requires ORDERS_READ):"
echo 'curl "https://connect.squareup.com/v2/orders/search" \'
echo '  -X POST \'
echo '  -H "Square-Version: 2025-01-23" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d "{\"query\": {}}"'
echo ""
echo "Test Customers API (requires CUSTOMERS_READ):"
echo 'curl "https://connect.squareup.com/v2/customers/search" \'
echo '  -X POST \'
echo '  -H "Square-Version: 2025-01-23" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}" \'
echo '  -H "Content-Type: application/json" \'
echo '  -d "{\"query\": {}}"'
echo ""
echo "Test Payments API (requires PAYMENTS_READ):"
echo 'curl "https://connect.squareup.com/v2/payments" \'
echo '  -H "Square-Version: 2025-01-23" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo ""
echo "========================================="
echo "CHECKING CLOVER APP PERMISSIONS"
echo "========================================="
echo ""
echo "Clover App ID: 6C9HSCSJNCT4T"
echo ""
echo "Clover permissions are configured in the Developer Dashboard:"
echo "https://docs.clover.com/dev/docs/gdp-set-app-permissions"
echo ""
echo "To check Clover app permissions:"
echo "1. Log into Clover Developer Dashboard"
echo "2. Go to your app settings"
echo "3. Check 'App Permissions' section"
echo ""
echo "Required Permissions for Full Integration:"
echo "- Read inventory: GET /v3/merchants/{mId}/items"
echo "- Write inventory: POST/PUT /v3/merchants/{mId}/items"
echo "- Read orders: GET /v3/merchants/{mId}/orders"
echo "- Write orders: POST /v3/merchants/{mId}/orders"
echo "- Read customers: GET /v3/merchants/{mId}/customers"
echo "- Write customers: POST/PUT /v3/merchants/{mId}/customers"
echo "- Read payments: GET /v3/merchants/{mId}/payments"
echo "- Write payments: POST /v3/merchants/{mId}/orders/{orderId}/payments"
echo "- Read merchant: GET /v3/merchants/{mId}"
echo ""
echo "Test Clover API permissions (requires access token from OAuth):"
echo ""
echo "Test Merchant API (requires READ_MERCHANT):"
echo 'curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo "Test Inventory API (requires READ_INVENTORY):"
echo 'curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/items" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo "Test Orders API (requires READ_ORDERS):"
echo 'curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/orders" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo "Test Customers API (requires READ_CUSTOMERS):"
echo 'curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/customers" \'
echo '  -H "Authorization: Bearer {ACCESS_TOKEN}"'
echo ""
echo ""
echo "========================================="
echo "NEXT STEPS"
echo "========================================="
echo ""
echo "For Square: Permissions are requested in OAuth flow - update scopes in onboarding.ts"
echo "For Clover: Configure permissions in Clover Developer Dashboard app settings"
echo ""

