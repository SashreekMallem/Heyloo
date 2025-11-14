# Clover API CRUD Operations Documentation

Complete documentation for all CRUD operations on Customers, Orders, and Menu/Inventory items using the Clover API.

## Table of Contents
- [Authentication](#authentication)
- [Customers](#customers)
  - [Create Customer](#create-customer)
  - [Read Customer](#read-customer)
  - [Update Customer](#update-customer)
  - [Delete Customer](#delete-customer)
- [Orders](#orders)
  - [Create Order](#create-order)
  - [Read Order](#read-order)
  - [Update Order](#update-order)
  - [Delete Order](#delete-order)
- [Menu/Inventory](#menuinventory)
  - [Fetch Menu Items](#fetch-menu-items)
  - [Get Single Item](#get-single-item)
  - [Get Item Stock](#get-item-stock)

---

## Authentication

All API requests require Bearer token authentication:

```http
Authorization: Bearer {access_token}
```

**Base URLs:**
- **Sandbox**: `https://apisandbox.dev.clover.com`
- **Production**: `https://api.clover.com`

**Token Refresh:**
```http
POST https://apisandbox.dev.clover.com/oauth/v2/refresh
Content-Type: application/json

{
  "client_id": "{CLIENT_ID}",
  "refresh_token": "{REFRESH_TOKEN}"
}
```

---

## Customers

### Create Customer

**Endpoint:** `POST /v3/merchants/{mId}/customers`

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Smith",
  "phoneNumber": "+14102452211",
  "emailAddress": "john.smith@example.com"
}
```

**cURL Example:**
```bash
curl -X POST "https://apisandbox.dev.clover.com/v3/merchants/{mId}/customers" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Smith",
    "phoneNumber": "+14102452211",
    "emailAddress": "john.smith@example.com"
  }'
```

**Response:**
```json
{
  "id": "CUSTOMER_ID",
  "firstName": "John",
  "lastName": "Smith",
  "phoneNumber": "+14102452211",
  "emailAddress": "john.smith@example.com"
}
```

**Required Permissions:** `CUSTOMERS_WRITE`

---

### Read Customer

**Endpoint:** `GET /v3/merchants/{mId}/customers/{customerId}`

**cURL Example:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/customers/{customerId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "id": "CUSTOMER_ID",
  "firstName": "John",
  "lastName": "Smith",
  "phoneNumber": "+14102452211",
  "emailAddress": "john.smith@example.com"
}
```

**List All Customers:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/customers" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Required Permissions:** `CUSTOMERS_READ`

**Note:** In sandbox environment, this endpoint may return `401 Unauthorized` even with proper permissions due to sandbox limitations.

---

### Update Customer

**Endpoint:** `POST /v3/merchants/{mId}/customers/{customerId}`

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Smith Updated",
  "phoneNumber": "+14102452212",
  "emailAddress": "john.smith.updated@example.com"
}
```

**cURL Example:**
```bash
curl -X POST "https://apisandbox.dev.clover.com/v3/merchants/{mId}/customers/{customerId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Smith Updated",
    "phoneNumber": "+14102452212",
    "emailAddress": "john.smith.updated@example.com"
  }'
```

**Response:**
```json
{
  "id": "CUSTOMER_ID",
  "firstName": "John",
  "lastName": "Smith Updated",
  "phoneNumber": "+14102452212",
  "emailAddress": "john.smith.updated@example.com"
}
```

**Required Permissions:** `CUSTOMERS_WRITE`

---

### Delete Customer

**Endpoint:** `DELETE /v3/merchants/{mId}/customers/{customerId}`

**cURL Example:**
```bash
curl -X DELETE "https://apisandbox.dev.clover.com/v3/merchants/{mId}/customers/{customerId}" \
  -H "Authorization: Bearer {access_token}"
```

**Response:**
- **200 OK**: Customer deleted successfully
- **404 Not Found**: Customer not found

**Required Permissions:** `CUSTOMERS_WRITE`

---

## Orders

### Create Order

**Endpoint:** `POST /v3/merchants/{mId}/orders`

**Request Body (Basic Order):**
```json
{
  "title": "Order for John Smith",
  "currency": "USD",
  "customer": {
    "id": "CUSTOMER_ID"
  }
}
```

**Request Body (Custom Order with Line Items):**
```json
{
  "orderType": {
    "id": "ORDER_TYPE_ID"
  },
  "taxRemoved": false,
  "currency": "USD",
  "total": 1500,
  "state": "Open",
  "customer": {
    "id": "CUSTOMER_ID"
  }
}
```

**cURL Example:**
```bash
curl -X POST "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Order for John Smith",
    "currency": "USD",
    "customer": {
      "id": "CUSTOMER_ID"
    }
  }'
```

**Response:**
```json
{
  "id": "ORDER_ID",
  "title": "Order for John Smith",
  "currency": "USD",
  "state": "open",
  "paymentState": "OPEN",
  "customer": {
    "id": "CUSTOMER_ID"
  }
}
```

**Add Line Item to Order:**
```bash
curl -X POST "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}/line_items" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "item": {
      "id": "ITEM_ID"
    },
    "price": 1000,
    "unitQty": 1
  }'
```

**Required Permissions:** `ORDERS_WRITE`

---

### Read Order

**Endpoint:** `GET /v3/merchants/{mId}/orders/{orderId}`

**cURL Example:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "id": "ORDER_ID",
  "title": "Order for John Smith",
  "state": "open",
  "paymentState": "OPEN",
  "currency": "USD",
  "total": 1500,
  "customer": {
    "id": "CUSTOMER_ID"
  },
  "lineItems": [
    {
      "id": "LINE_ITEM_ID",
      "item": {
        "id": "ITEM_ID",
        "name": "Item Name"
      },
      "price": 1000,
      "unitQty": 1
    }
  ]
}
```

**List All Orders:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Get Order Line Items:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}/line_items" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Check Order Status:**
The order status is available in the `state` and `paymentState` fields:
- `state`: `open`, `locked`, `closed`
- `paymentState`: `OPEN`, `PAID`, `REFUNDED`

**Required Permissions:** `ORDERS_READ`

---

### Update Order

**Endpoint:** `POST /v3/merchants/{mId}/orders/{orderId}`

**Request Body:**
```json
{
  "title": "Updated Order Title",
  "note": "Order updated successfully",
  "state": "open"
}
```

**cURL Example:**
```bash
curl -X POST "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated Order Title",
    "note": "Order updated successfully",
    "state": "open"
  }'
```

**Response:**
```json
{
  "id": "ORDER_ID",
  "title": "Updated Order Title",
  "note": "Order updated successfully",
  "state": "open"
}
```

**Update Line Item:**
```bash
curl -X POST "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}/line_items/{lineItemId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "price": 1200,
    "unitQty": 2
  }'
```

**Required Permissions:** `ORDERS_WRITE`

---

### Delete Order

**Endpoint:** `DELETE /v3/merchants/{mId}/orders/{orderId}`

**cURL Example:**
```bash
curl -X DELETE "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}" \
  -H "Authorization: Bearer {access_token}"
```

**Response:**
- **200 OK**: Order deleted successfully
- **404 Not Found**: Order not found

**Delete All Line Items:**
```bash
curl -X DELETE "https://apisandbox.dev.clover.com/v3/merchants/{mId}/orders/{orderId}/line_items" \
  -H "Authorization: Bearer {access_token}"
```

**Required Permissions:** `ORDERS_WRITE`

---

## Menu/Inventory

### Fetch Menu Items

**Endpoint:** `GET /v3/merchants/{mId}/items`

**Query Parameters:**
- `limit`: Number of items to return (default: 100)
- `offset`: Number of items to skip
- `expand`: Comma-separated list of fields to expand (e.g., `categories,modifierGroups`)

**cURL Example:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/items?limit=100" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "elements": [
    {
      "id": "ITEM_ID",
      "name": "Item Name",
      "price": 1000,
      "priceType": "FIXED",
      "defaultTaxRates": true,
      "cost": 500,
      "isRevenue": true,
      "stockCount": 100,
      "modifiedTime": 1623566507000
    }
  ]
}
```

**Get Items by Category:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/categories/{categoryId}/items" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Get All Categories:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/categories" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Required Permissions:** `INVENTORY_READ`

---

### Get Single Item

**Endpoint:** `GET /v3/merchants/{mId}/items/{itemId}`

**cURL Example:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/items/{itemId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "id": "ITEM_ID",
  "name": "Item Name",
  "price": 1000,
  "priceType": "FIXED",
  "defaultTaxRates": true,
  "cost": 500,
  "isRevenue": true,
  "stockCount": 100,
  "modifiedTime": 1623566507000,
  "categories": {
    "elements": [
      {
        "id": "CATEGORY_ID",
        "name": "Category Name"
      }
    ]
  }
}
```

**Required Permissions:** `INVENTORY_READ`

---

### Get Item Stock

**Endpoint:** `GET /v3/merchants/{mId}/item_stocks`

**Get All Item Stocks:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/item_stocks" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Get Single Item Stock:**
```bash
curl -X GET "https://apisandbox.dev.clover.com/v3/merchants/{mId}/item_stocks/{itemStockId}" \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json"
```

**Response:**
```json
{
  "id": "ITEM_STOCK_ID",
  "item": {
    "id": "ITEM_ID",
    "name": "Item Name"
  },
  "quantity": 100,
  "modifiedTime": 1623566507000
}
```

**Required Permissions:** `INVENTORY_READ`

---

## Required Permissions Summary

### Customer Operations
- **Create**: `CUSTOMERS_WRITE`
- **Read**: `CUSTOMERS_READ`
- **Update**: `CUSTOMERS_WRITE`
- **Delete**: `CUSTOMERS_WRITE`

### Order Operations
- **Create**: `ORDERS_WRITE`
- **Read**: `ORDERS_READ`
- **Update**: `ORDERS_WRITE`
- **Delete**: `ORDERS_WRITE`

### Inventory/Menu Operations
- **Read**: `INVENTORY_READ`
- **Create/Update/Delete**: `INVENTORY_WRITE`

---

## Error Handling

### Common HTTP Status Codes

- **200 OK**: Request successful
- **201 Created**: Resource created successfully
- **400 Bad Request**: Invalid request parameters
- **401 Unauthorized**: Invalid or expired access token, or missing permissions
- **404 Not Found**: Resource not found
- **500 Internal Server Error**: Server error

### Error Response Format

```json
{
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

---

## Notes

1. **Sandbox Limitations**: Some operations (like `GET /customers/{customerId}`) may return `401 Unauthorized` in sandbox even with proper permissions. This is a known sandbox limitation.

2. **Token Expiration**: Access tokens expire after a certain period. Always refresh tokens using the `/oauth/v2/refresh` endpoint before making API calls.

3. **Rate Limiting**: Clover API has rate limits. Implement exponential backoff for retries.

4. **Currency**: All monetary values are in cents (e.g., $10.00 = 1000).

5. **Timestamps**: All timestamps are in milliseconds since Unix epoch.

---

## References

- [Clover API Documentation](https://docs.clover.com)
- [Clover OAuth Documentation](https://docs.clover.com/build/oauth)
- [Working with Orders](https://docs.clover.com/build/working-with-orders)
- [Creating Custom Orders](https://docs.clover.com/dev/docs/creating-custom-orders)

