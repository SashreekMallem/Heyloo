"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  apiErrorSchema: () => apiErrorSchema,
  authResponseSchema: () => authResponseSchema,
  createOrderPayloadSchema: () => createOrderPayloadSchema,
  customerSchema: () => customerSchema,
  dashboardTimeRangeSchema: () => dashboardTimeRangeSchema,
  jwtPayloadSchema: () => jwtPayloadSchema,
  orderItemSchema: () => orderItemSchema,
  orderSchema: () => orderSchema,
  orderStatusSchema: () => orderStatusSchema,
  paymentStatusSchema: () => paymentStatusSchema,
  platformOverviewMetricsSchema: () => platformOverviewMetricsSchema,
  platformUsageDailySchema: () => platformUsageDailySchema,
  posMenuItemSchema: () => posMenuItemSchema,
  posOrderItemSchema: () => posOrderItemSchema,
  posProviderSchema: () => posProviderSchema,
  restaurantSchema: () => restaurantSchema,
  restaurantStatusSchema: () => restaurantStatusSchema,
  restaurantSummaryMetricsSchema: () => restaurantSummaryMetricsSchema,
  subscriptionInvoiceSchema: () => subscriptionInvoiceSchema,
  vapiCallEventSchema: () => vapiCallEventSchema
});
module.exports = __toCommonJS(index_exports);
var import_zod = require("zod");
var restaurantStatusSchema = import_zod.z.enum([
  "trial",
  "active",
  "paused",
  "cancelled"
]);
var restaurantSchema = import_zod.z.object({
  id: import_zod.z.string().uuid(),
  name: import_zod.z.string(),
  slug: import_zod.z.string(),
  phoneNumber: import_zod.z.string(),
  ownerEmail: import_zod.z.string().email(),
  posType: import_zod.z.enum(["square", "toast", "clover", "none"]).default("none"),
  taxRate: import_zod.z.number(),
  deliveryFee: import_zod.z.number(),
  subscriptionStatus: restaurantStatusSchema,
  stripeCustomerId: import_zod.z.string().nullable(),
  stripeAccountId: import_zod.z.string().nullable(),
  createdAt: import_zod.z.string().datetime(),
  updatedAt: import_zod.z.string().datetime()
});
var posProviderSchema = import_zod.z.enum(["square", "toast", "clover", "none"]);
var posMenuItemSchema = import_zod.z.object({
  externalId: import_zod.z.string(),
  name: import_zod.z.string(),
  description: import_zod.z.string().optional(),
  category: import_zod.z.string().optional(),
  price: import_zod.z.number(),
  isAvailable: import_zod.z.boolean().default(true)
});
var posOrderItemSchema = import_zod.z.object({
  externalItemId: import_zod.z.string(),
  name: import_zod.z.string(),
  quantity: import_zod.z.number().int().positive(),
  unitPrice: import_zod.z.number(),
  modifiers: import_zod.z.array(
    import_zod.z.object({
      name: import_zod.z.string(),
      priceDelta: import_zod.z.number()
    })
  ).default([])
});
var customerSchema = import_zod.z.object({
  id: import_zod.z.string().uuid(),
  restaurantId: import_zod.z.string().uuid(),
  phoneNumber: import_zod.z.string(),
  firstName: import_zod.z.string().nullable(),
  lastName: import_zod.z.string().nullable(),
  email: import_zod.z.string().nullable(),
  notes: import_zod.z.string().nullable(),
  totalOrders: import_zod.z.number(),
  totalSpent: import_zod.z.number(),
  createdAt: import_zod.z.string().datetime(),
  updatedAt: import_zod.z.string().datetime()
});
var orderStatusSchema = import_zod.z.enum([
  "pending",
  "payment_pending",
  "paid",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "picked_up",
  "cancelled"
]);
var paymentStatusSchema = import_zod.z.enum([
  "pending",
  "paid",
  "failed",
  "refunded"
]);
var orderItemSchema = import_zod.z.object({
  menuItemId: import_zod.z.string().uuid(),
  name: import_zod.z.string(),
  quantity: import_zod.z.number().int().positive(),
  unitPrice: import_zod.z.number(),
  modifiers: import_zod.z.array(
    import_zod.z.object({
      name: import_zod.z.string(),
      priceDelta: import_zod.z.number()
    })
  )
});
var orderSchema = import_zod.z.object({
  id: import_zod.z.string().uuid(),
  restaurantId: import_zod.z.string().uuid(),
  customerId: import_zod.z.string().uuid().nullable(),
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  subtotal: import_zod.z.number(),
  tax: import_zod.z.number(),
  deliveryFee: import_zod.z.number(),
  total: import_zod.z.number(),
  paymentMethod: import_zod.z.enum(["stripe_link", "cash", "card_on_delivery"]),
  stripePaymentLink: import_zod.z.string().nullable(),
  stripePaymentIntentId: import_zod.z.string().nullable(),
  items: import_zod.z.array(orderItemSchema),
  placedAt: import_zod.z.string().datetime(),
  updatedAt: import_zod.z.string().datetime()
});
var apiErrorSchema = import_zod.z.object({
  message: import_zod.z.string(),
  code: import_zod.z.string().optional(),
  details: import_zod.z.array(
    import_zod.z.object({
      message: import_zod.z.string(),
      path: import_zod.z.array(import_zod.z.string()).optional()
    })
  ).optional()
});
var jwtPayloadSchema = import_zod.z.object({
  sub: import_zod.z.string().uuid(),
  restaurantId: import_zod.z.string().uuid().nullable(),
  // Platform admins have null
  email: import_zod.z.string().email(),
  role: import_zod.z.enum(["platform_admin", "restaurant_admin"]),
  exp: import_zod.z.number()
});
var platformOverviewMetricsSchema = import_zod.z.object({
  activeRestaurants: import_zod.z.number(),
  totalRestaurants: import_zod.z.number(),
  totalCalls: import_zod.z.number(),
  totalCallMinutes: import_zod.z.number(),
  totalOrders: import_zod.z.number(),
  totalRevenue: import_zod.z.number(),
  vapiCosts: import_zod.z.number(),
  netProfit: import_zod.z.number()
});
var restaurantSummaryMetricsSchema = import_zod.z.object({
  restaurantId: import_zod.z.string().uuid(),
  restaurantName: import_zod.z.string(),
  calls: import_zod.z.number(),
  callMinutes: import_zod.z.number(),
  orders: import_zod.z.number(),
  revenue: import_zod.z.number(),
  status: restaurantStatusSchema
});
var createOrderPayloadSchema = import_zod.z.object({
  restaurantId: import_zod.z.string().uuid(),
  customerPhone: import_zod.z.string(),
  customerName: import_zod.z.string().optional(),
  items: import_zod.z.array(
    import_zod.z.object({
      menuItemId: import_zod.z.string().uuid(),
      quantity: import_zod.z.number().int().positive(),
      modifiers: import_zod.z.array(
        import_zod.z.object({
          name: import_zod.z.string(),
          priceDelta: import_zod.z.number()
        })
      ).default([])
    })
  ),
  orderType: import_zod.z.enum(["delivery", "pickup"]),
  deliveryAddressId: import_zod.z.string().uuid().nullable(),
  paymentMethod: import_zod.z.enum(["stripe_link", "cash", "card_on_delivery"])
});
var vapiCallEventSchema = import_zod.z.object({
  id: import_zod.z.string(),
  type: import_zod.z.enum(["call.created", "call.updated", "call.ended"]),
  createdAt: import_zod.z.string().datetime(),
  data: import_zod.z.object({
    callId: import_zod.z.string(),
    restaurantId: import_zod.z.string().uuid(),
    phoneNumber: import_zod.z.string(),
    phoneNumberId: import_zod.z.string().optional(),
    // VAPI phone number ID - used for multi-location lookup
    state: import_zod.z.enum(["in_progress", "completed", "failed"]),
    durationSeconds: import_zod.z.number().optional(),
    transcript: import_zod.z.array(
      import_zod.z.object({
        speaker: import_zod.z.enum(["agent", "caller"]),
        text: import_zod.z.string(),
        timestamp: import_zod.z.number()
      })
    )
  })
});
var platformUsageDailySchema = import_zod.z.object({
  id: import_zod.z.string().uuid(),
  restaurantId: import_zod.z.string().uuid(),
  date: import_zod.z.string().date(),
  totalCalls: import_zod.z.number(),
  successfulCalls: import_zod.z.number(),
  failedCalls: import_zod.z.number(),
  totalMinutes: import_zod.z.number(),
  totalOrders: import_zod.z.number(),
  deliveryOrders: import_zod.z.number(),
  pickupOrders: import_zod.z.number(),
  totalOrderValue: import_zod.z.number(),
  vapiCallCost: import_zod.z.number()
});
var subscriptionInvoiceSchema = import_zod.z.object({
  id: import_zod.z.string().uuid(),
  restaurantId: import_zod.z.string().uuid(),
  billingPeriodStart: import_zod.z.string().datetime(),
  billingPeriodEnd: import_zod.z.string().datetime(),
  baseFeeCents: import_zod.z.number(),
  includedMinutes: import_zod.z.number(),
  overageMinutes: import_zod.z.number(),
  overageRateCents: import_zod.z.number(),
  totalAmountCents: import_zod.z.number(),
  stripeInvoiceId: import_zod.z.string().nullable(),
  status: import_zod.z.enum(["draft", "pending", "paid", "failed"]),
  createdAt: import_zod.z.string().datetime(),
  updatedAt: import_zod.z.string().datetime()
});
var authResponseSchema = import_zod.z.object({
  accessToken: import_zod.z.string(),
  refreshToken: import_zod.z.string(),
  expiresIn: import_zod.z.number(),
  user: import_zod.z.object({
    id: import_zod.z.string().uuid(),
    email: import_zod.z.string().email(),
    role: import_zod.z.enum(["platform_admin", "restaurant_admin"]),
    restaurantId: import_zod.z.string().uuid().nullable()
  })
});
var dashboardTimeRangeSchema = import_zod.z.enum([
  "today",
  "yesterday",
  "last7",
  "last30",
  "month_to_date",
  "year_to_date"
]);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  apiErrorSchema,
  authResponseSchema,
  createOrderPayloadSchema,
  customerSchema,
  dashboardTimeRangeSchema,
  jwtPayloadSchema,
  orderItemSchema,
  orderSchema,
  orderStatusSchema,
  paymentStatusSchema,
  platformOverviewMetricsSchema,
  platformUsageDailySchema,
  posMenuItemSchema,
  posOrderItemSchema,
  posProviderSchema,
  restaurantSchema,
  restaurantStatusSchema,
  restaurantSummaryMetricsSchema,
  subscriptionInvoiceSchema,
  vapiCallEventSchema
});
