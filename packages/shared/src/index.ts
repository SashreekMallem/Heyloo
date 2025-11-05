import { z } from 'zod';

export const restaurantStatusSchema = z.enum([
  'trial',
  'active',
  'paused',
  'cancelled'
]);

export type RestaurantStatus = z.infer<typeof restaurantStatusSchema>;

export const restaurantSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  phoneNumber: z.string(),
  ownerEmail: z.string().email(),
  posType: z.enum(['square', 'toast', 'clover', 'none']).default('none'),
  taxRate: z.number(),
  deliveryFee: z.number(),
  subscriptionStatus: restaurantStatusSchema,
  stripeCustomerId: z.string().nullable(),
  stripeAccountId: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Restaurant = z.infer<typeof restaurantSchema>;

export const posProviderSchema = z.enum(['square', 'toast', 'clover', 'none']);
export type PosProvider = z.infer<typeof posProviderSchema>;

export const posMenuItemSchema = z.object({
  externalId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  price: z.number(),
  isAvailable: z.boolean().default(true)
});

export type PosMenuItem = z.infer<typeof posMenuItemSchema>;

export const posOrderItemSchema = z.object({
  externalItemId: z.string(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number(),
  modifiers: z
    .array(
      z.object({
        name: z.string(),
        priceDelta: z.number()
      })
    )
    .default([])
});

export type PosOrderItem = z.infer<typeof posOrderItemSchema>;

export const customerSchema = z.object({
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

export type Customer = z.infer<typeof customerSchema>;

export const orderStatusSchema = z.enum([
  'pending',
  'payment_pending',
  'paid',
  'confirmed',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'picked_up',
  'cancelled'
]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const paymentStatusSchema = z.enum([
  'pending',
  'paid',
  'failed',
  'refunded'
]);

export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const orderItemSchema = z.object({
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

export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  customerId: z.string().uuid().nullable(),
  status: orderStatusSchema,
  paymentStatus: paymentStatusSchema,
  subtotal: z.number(),
  tax: z.number(),
  deliveryFee: z.number(),
  total: z.number(),
  paymentMethod: z.enum(['stripe_link', 'cash', 'card_on_delivery']),
  stripePaymentLink: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  items: z.array(orderItemSchema),
  placedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type Order = z.infer<typeof orderSchema>;

export const apiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z
    .array(
      z.object({
        message: z.string(),
        path: z.array(z.string()).optional()
      })
    )
    .optional()
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const jwtPayloadSchema = z.object({
  sub: z.string().uuid(),
  restaurantId: z.string().uuid().nullable(), // Platform admins have null
  email: z.string().email(),
  role: z.enum(['platform_admin', 'restaurant_admin']),
  exp: z.number()
});

export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

export const platformOverviewMetricsSchema = z.object({
  activeRestaurants: z.number(),
  totalRestaurants: z.number(),
  totalCalls: z.number(),
  totalCallMinutes: z.number(),
  totalOrders: z.number(),
  totalRevenue: z.number(),
  vapiCosts: z.number(),
  netProfit: z.number()
});

export type PlatformOverviewMetrics = z.infer<
  typeof platformOverviewMetricsSchema
>;

export const restaurantSummaryMetricsSchema = z.object({
  restaurantId: z.string().uuid(),
  restaurantName: z.string(),
  calls: z.number(),
  callMinutes: z.number(),
  orders: z.number(),
  revenue: z.number(),
  status: restaurantStatusSchema
});

export type RestaurantSummaryMetrics = z.infer<
  typeof restaurantSummaryMetricsSchema
>;

export const createOrderPayloadSchema = z.object({
  restaurantId: z.string().uuid(),
  customerPhone: z.string(),
  customerName: z.string().optional(),
  items: z.array(
    z.object({
      menuItemId: z.string().uuid(),
      quantity: z.number().int().positive(),
      modifiers: z
        .array(
          z.object({
            name: z.string(),
            priceDelta: z.number()
          })
        )
        .default([])
    })
  ),
  orderType: z.enum(['delivery', 'pickup']),
  deliveryAddressId: z.string().uuid().nullable(),
  paymentMethod: z.enum(['stripe_link', 'cash', 'card_on_delivery'])
});

export type CreateOrderPayload = z.infer<typeof createOrderPayloadSchema>;

export const vapiCallEventSchema = z.object({
  id: z.string(),
  type: z.enum(['call.created', 'call.updated', 'call.ended']),
  createdAt: z.string().datetime(),
  data: z.object({
    callId: z.string(),
    restaurantId: z.string().uuid(),
    phoneNumber: z.string(),
    phoneNumberId: z.string().optional(), // VAPI phone number ID - used for multi-location lookup
    state: z.enum(['in_progress', 'completed', 'failed']),
    durationSeconds: z.number().optional(),
    transcript: z.array(
      z.object({
        speaker: z.enum(['agent', 'caller']),
        text: z.string(),
        timestamp: z.number()
      })
    )
  })
});

export type VapiCallEvent = z.infer<typeof vapiCallEventSchema>;

export const platformUsageDailySchema = z.object({
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

export type PlatformUsageDaily = z.infer<typeof platformUsageDailySchema>;

export const subscriptionInvoiceSchema = z.object({
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
  status: z.enum(['draft', 'pending', 'paid', 'failed']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type SubscriptionInvoice = z.infer<typeof subscriptionInvoiceSchema>;

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    role: z.enum(['platform_admin', 'restaurant_admin']),
    restaurantId: z.string().uuid().nullable()
  })
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

export const dashboardTimeRangeSchema = z.enum([
  'today',
  'yesterday',
  'last7',
  'last30',
  'month_to_date',
  'year_to_date'
]);

export type DashboardTimeRange = z.infer<typeof dashboardTimeRangeSchema>;
