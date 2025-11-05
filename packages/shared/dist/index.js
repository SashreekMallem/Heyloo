// src/index.ts
import { z } from "zod";
var restaurantStatusSchema = z.enum([
  "trial",
  "active",
  "paused",
  "cancelled"
]);
var restaurantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  phoneNumber: z.string(),
  ownerEmail: z.string().email(),
  posType: z.enum(["square", "toast", "clover", "none"]).default("none"),
  taxRate: z.number(),
  deliveryFee: z.number(),
  subscriptionStatus: restaurantStatusSchema,
  stripeCustomerId: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
var posProviderSchema = z.enum(["square", "toast", "clover", "none"]);
var posMenuItemSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  price: z.number(),
  isAvailable: z.boolean().default(true)
});
var posOrderItemSchema = z.object({
  externalItemId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
  modifiers: z.array(
    z.object({
      name: z.string(),
      priceDelta: z.number()
    })
  ).default([])
});
var customerSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  phoneNumber: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  totalOrders: z.number(),
  totalSpent: z.number(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
var orderStatusSchema = z.enum([
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
var paymentStatusSchema = z.enum([
  "pending",
  "paid",
  "failed",
  "refunded"
]);
var orderItemSchema = z.object({
  menuItemId: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
  modifiers: z.array(
    z.object({
      name: z.string(),
      priceDelta: z.number()
    })
  )
});
var orderSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  subtotal: z.number(),
  tax: z.number(),
  deliveryFee: z.number(),
  total: z.number(),
  paymentMethod: z.enum(["stripe_link", "cash", "card_on_delivery"]),
  stripePaymentLink: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  items: z.array(orderItemSchema),
  placedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
var apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.array(
    z.object({
      message: z.string(),
      path: z.array(z.string()).optional()
    })
  ).optional()
});
var jwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  restaurantId: z.string().uuid().nullable(),
  // Platform admins have null
  email: z.string().email(),
  role: z.enum(["platform_admin", "restaurant_admin"]),
  exp: z.number()
});
var platformOverviewMetricsSchema = z.object({
  activeRestaurants: z.number(),
  totalRestaurants: z.number(),
  totalCalls: z.number(),
  totalCallMinutes: z.number(),
  totalOrders: z.number(),
  totalRevenue: z.number(),
  vapiCosts: z.number(),
  netProfit: z.number()
});
var restaurantSummaryMetricsSchema = z.object({
  restaurantId: z.string().uuid(),
  restaurantName: z.string(),
  calls: z.number(),
  callMinutes: z.number(),
  orders: z.number(),
  revenue: z.number(),
  status: restaurantStatusSchema
});
var createOrderPayloadSchema = z.object({
  restaurantId: z.string().uuid(),
  customerPhone: z.string(),
  customerName: z.string().optional(),
  items: z.array(
    z.object({
      menuItemId: z.string().uuid(),
      quantity: z.number().int().positive(),
      modifiers: z.array(
        z.object({
          name: z.string(),
          priceDelta: z.number()
        })
      ).default([])
    })
  ),
  orderType: z.enum(["delivery", "pickup"]),
  deliveryAddressId: z.string().uuid().nullable(),
  paymentMethod: z.enum(["stripe_link", "cash", "card_on_delivery"])
});
var vapiCallEventSchema = z.object({
  id: z.string(),
  type: z.enum(["call.created", "call.updated", "call.ended"]),
  createdAt: z.string().datetime(),
  data: z.object({
    callId: z.string(),
    restaurantId: z.string().uuid(),
    phoneNumber: z.string(),
    phoneNumberId: z.string().optional(),
    // VAPI phone number ID - used for multi-location lookup
    state: z.enum(["in_progress", "completed", "failed"]),
    durationSeconds: z.number().optional(),
    transcript: z.array(
      z.object({
        speaker: z.enum(["agent", "caller"]),
        text: z.string(),
        timestamp: z.number()
      })
    )
  })
});
var platformUsageDailySchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  date: z.string().date(),
  totalCalls: z.number(),
  successfulCalls: z.number(),
  failedCalls: z.number(),
  totalMinutes: z.number(),
  totalOrders: z.number(),
  deliveryOrders: z.number(),
  pickupOrders: z.number(),
  totalOrderValue: z.number(),
  vapiCallCost: z.number()
});
var subscriptionInvoiceSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  billingPeriodStart: z.string().datetime(),
  billingPeriodEnd: z.string().datetime(),
  baseFeeCents: z.number(),
  includedMinutes: z.number(),
  overageMinutes: z.number(),
  overageRateCents: z.number(),
  totalAmountCents: z.number(),
  stripeInvoiceId: z.string().nullable(),
  status: z.enum(["draft", "pending", "paid", "failed"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
var authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(["platform_admin", "restaurant_admin"]),
    restaurantId: z.string().uuid().nullable()
  })
});
var dashboardTimeRangeSchema = z.enum([
  "today",
  "yesterday",
  "last7",
  "last30",
  "month_to_date",
  "year_to_date"
]);
export {
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
};
