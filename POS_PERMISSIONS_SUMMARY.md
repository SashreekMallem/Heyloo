# POS Integration Permissions Summary

## Square Permissions

### OAuth Scopes Currently Requested:
```
MERCHANT_PROFILE_READ ITEMS_READ ITEMS_WRITE INVENTORY_READ INVENTORY_WRITE 
ORDERS_READ ORDERS_WRITE CUSTOMERS_READ CUSTOMERS_WRITE PAYMENTS_READ PAYMENTS_WRITE
```

### Permission Breakdown:

| Permission | Purpose | API Endpoints |
|------------|---------|---------------|
| **MERCHANT_PROFILE_READ** | Read merchant/location info | `GET /v2/locations` |
| **ITEMS_READ** | Read catalog/menu items | `GET /v2/catalog/list` |
| **ITEMS_WRITE** | Update catalog/menu items | `POST /v2/catalog/object` |
| **INVENTORY_READ** | Read inventory levels | `GET /v2/inventory` |
| **INVENTORY_WRITE** | Update inventory levels | `POST /v2/inventory` |
| **ORDERS_READ** | Read order information | `GET /v2/orders/search` |
| **ORDERS_WRITE** | Create/update orders | `POST /v2/orders` |
| **CUSTOMERS_READ** | Read customer data | `GET /v2/customers/search` |
| **CUSTOMERS_WRITE** | Create/update customers | `POST /v2/customers` |
| **PAYMENTS_READ** | Read payment information | `GET /v2/payments` |
| **PAYMENTS_WRITE** | Process payments | `POST /v2/payments` |

### Verification Commands:

```bash
# Check if app has Locations access
curl https://connect.squareup.com/v2/locations \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"

# Check if app has Catalog access
curl "https://connect.squareup.com/v2/catalog/list?types=ITEM" \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"

# Check if app has Orders access
curl "https://connect.squareup.com/v2/orders/search" \
  -X POST \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": {}}'

# Check if app has Customers access
curl "https://connect.squareup.com/v2/customers/search" \
  -X POST \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": {}}'

# Check if app has Payments access
curl "https://connect.squareup.com/v2/payments" \
  -H "Square-Version: 2025-01-23" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

---

## Clover Permissions

### Required Permissions (Configure in Developer Dashboard):

Clover permissions are **configured in the Clover Developer Dashboard**, not via OAuth scopes.

### Permission Breakdown:

| Permission | Purpose | API Endpoints |
|------------|---------|---------------|
| **READ_INVENTORY** | Read menu items | `GET /v3/merchants/{mId}/items` |
| **WRITE_INVENTORY** | Create/update menu items | `POST/PUT /v3/merchants/{mId}/items` |
| **READ_ORDERS** | Read order information | `GET /v3/merchants/{mId}/orders` |
| **WRITE_ORDERS** | Create/update orders | `POST /v3/merchants/{mId}/orders` |
| **READ_CUSTOMERS** | Read customer data | `GET /v3/merchants/{mId}/customers` |
| **WRITE_CUSTOMERS** | Create/update customers | `POST/PUT /v3/merchants/{mId}/customers` |
| **READ_PAYMENTS** | Read payment information | `GET /v3/merchants/{mId}/payments` |
| **WRITE_PAYMENTS** | Add payments to orders | `POST /v3/merchants/{mId}/orders/{orderId}/payments` |
| **READ_MERCHANT** | Read merchant info | `GET /v3/merchants/{mId}` |
| **ONLINE_PAYMENTS** | Process ecommerce payments | `POST /v1/charges` |

### How to Configure:

1. Log into [Clover Developer Dashboard](https://dev.clover.com)
2. Select your app (App ID: `6C9HSCSJNCT4T`)
3. Go to **"App Permissions"** section
4. Enable these permissions:
   - ✅ Read inventory
   - ✅ Write inventory
   - ✅ Read orders
   - ✅ Write orders
   - ✅ Read customers
   - ✅ Write customers
   - ✅ Read payments
   - ✅ Write payments
   - ✅ Read merchant
   - ✅ Online payments (for ecommerce)

### Verification Commands:

```bash
# Check if app has Merchant access
curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"

# Check if app has Inventory access
curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/items" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"

# Check if app has Orders access
curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/orders" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"

# Check if app has Customers access
curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/customers" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"

# Check if app has Payments access
curl "https://api.clover.com/v3/merchants/{MERCHANT_ID}/payments" \
  -H "Authorization: Bearer {ACCESS_TOKEN}"
```

---

## Integration Status

### ✅ Square
- OAuth scopes configured in code
- All required permissions included in OAuth request
- Ready for testing with merchant OAuth flow

### ⚠️ Clover
- OAuth flow configured
- **ACTION REQUIRED**: Configure permissions in Clover Developer Dashboard
- App ID: `6C9HSCSJNCT4T`
- Dashboard: https://dev.clover.com

---

## Next Steps

1. **Square**: Test OAuth flow - permissions are automatically requested
2. **Clover**: 
   - Log into Developer Dashboard
   - Configure app permissions (see list above)
   - Re-test OAuth flow after permissions are set

