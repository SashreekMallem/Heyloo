import { z } from 'zod';

declare const restaurantStatusSchema: z.ZodEnum<["trial", "active", "paused", "cancelled"]>;
type RestaurantStatus = z.infer<typeof restaurantStatusSchema>;
declare const restaurantSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    slug: z.ZodString;
    phoneNumber: z.ZodString;
    ownerEmail: z.ZodString;
    posType: z.ZodDefault<z.ZodEnum<["square", "toast", "clover", "none"]>>;
    taxRate: z.ZodNumber;
    deliveryFee: z.ZodNumber;
    subscriptionStatus: z.ZodEnum<["trial", "active", "paused", "cancelled"]>;
    stripeCustomerId: z.ZodNullable<z.ZodString>;
    stripeAccountId: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    slug: string;
    phoneNumber: string;
    ownerEmail: string;
    posType: "square" | "toast" | "clover" | "none";
    taxRate: number;
    deliveryFee: number;
    subscriptionStatus: "trial" | "active" | "paused" | "cancelled";
    stripeCustomerId: string | null;
    stripeAccountId: string | null;
    createdAt: string;
    updatedAt: string;
}, {
    id: string;
    name: string;
    slug: string;
    phoneNumber: string;
    ownerEmail: string;
    taxRate: number;
    deliveryFee: number;
    subscriptionStatus: "trial" | "active" | "paused" | "cancelled";
    stripeCustomerId: string | null;
    stripeAccountId: string | null;
    createdAt: string;
    updatedAt: string;
    posType?: "square" | "toast" | "clover" | "none" | undefined;
}>;
type Restaurant = z.infer<typeof restaurantSchema>;
declare const posProviderSchema: z.ZodEnum<["square", "toast", "clover", "none"]>;
type PosProvider = z.infer<typeof posProviderSchema>;
declare const posMenuItemSchema: z.ZodObject<{
    externalId: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    category: z.ZodOptional<z.ZodString>;
    price: z.ZodNumber;
    isAvailable: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    externalId: string;
    price: number;
    isAvailable: boolean;
    description?: string | undefined;
    category?: string | undefined;
}, {
    name: string;
    externalId: string;
    price: number;
    description?: string | undefined;
    category?: string | undefined;
    isAvailable?: boolean | undefined;
}>;
type PosMenuItem = z.infer<typeof posMenuItemSchema>;
declare const posOrderItemSchema: z.ZodObject<{
    externalItemId: z.ZodString;
    name: z.ZodString;
    quantity: z.ZodNumber;
    unitPrice: z.ZodNumber;
    modifiers: z.ZodDefault<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        priceDelta: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        name: string;
        priceDelta: number;
    }, {
        name: string;
        priceDelta: number;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    name: string;
    externalItemId: string;
    quantity: number;
    unitPrice: number;
    modifiers: {
        name: string;
        priceDelta: number;
    }[];
}, {
    name: string;
    externalItemId: string;
    quantity: number;
    unitPrice: number;
    modifiers?: {
        name: string;
        priceDelta: number;
    }[] | undefined;
}>;
type PosOrderItem = z.infer<typeof posOrderItemSchema>;
declare const customerSchema: z.ZodObject<{
    id: z.ZodString;
    restaurantId: z.ZodString;
    phoneNumber: z.ZodString;
    firstName: z.ZodNullable<z.ZodString>;
    lastName: z.ZodNullable<z.ZodString>;
    email: z.ZodNullable<z.ZodString>;
    notes: z.ZodNullable<z.ZodString>;
    totalOrders: z.ZodNumber;
    totalSpent: z.ZodNumber;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    phoneNumber: string;
    createdAt: string;
    updatedAt: string;
    restaurantId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    notes: string | null;
    totalOrders: number;
    totalSpent: number;
}, {
    id: string;
    phoneNumber: string;
    createdAt: string;
    updatedAt: string;
    restaurantId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    notes: string | null;
    totalOrders: number;
    totalSpent: number;
}>;
type Customer = z.infer<typeof customerSchema>;
declare const orderStatusSchema: z.ZodEnum<["pending", "payment_pending", "paid", "confirmed", "preparing", "ready", "out_for_delivery", "delivered", "picked_up", "cancelled"]>;
type OrderStatus = z.infer<typeof orderStatusSchema>;
declare const paymentStatusSchema: z.ZodEnum<["pending", "paid", "failed", "refunded"]>;
type PaymentStatus = z.infer<typeof paymentStatusSchema>;
declare const orderItemSchema: z.ZodObject<{
    menuItemId: z.ZodString;
    name: z.ZodString;
    quantity: z.ZodNumber;
    unitPrice: z.ZodNumber;
    modifiers: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        priceDelta: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        name: string;
        priceDelta: number;
    }, {
        name: string;
        priceDelta: number;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    quantity: number;
    unitPrice: number;
    modifiers: {
        name: string;
        priceDelta: number;
    }[];
    menuItemId: string;
}, {
    name: string;
    quantity: number;
    unitPrice: number;
    modifiers: {
        name: string;
        priceDelta: number;
    }[];
    menuItemId: string;
}>;
type OrderItem = z.infer<typeof orderItemSchema>;
declare const orderSchema: z.ZodObject<{
    id: z.ZodString;
    restaurantId: z.ZodString;
    customerId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<["pending", "payment_pending", "paid", "confirmed", "preparing", "ready", "out_for_delivery", "delivered", "picked_up", "cancelled"]>;
    paymentStatus: z.ZodEnum<["pending", "paid", "failed", "refunded"]>;
    subtotal: z.ZodNumber;
    tax: z.ZodNumber;
    deliveryFee: z.ZodNumber;
    total: z.ZodNumber;
    paymentMethod: z.ZodEnum<["stripe_link", "cash", "card_on_delivery"]>;
    stripePaymentLink: z.ZodNullable<z.ZodString>;
    stripePaymentIntentId: z.ZodNullable<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        menuItemId: z.ZodString;
        name: z.ZodString;
        quantity: z.ZodNumber;
        unitPrice: z.ZodNumber;
        modifiers: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            priceDelta: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            priceDelta: number;
        }, {
            name: string;
            priceDelta: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        quantity: number;
        unitPrice: number;
        modifiers: {
            name: string;
            priceDelta: number;
        }[];
        menuItemId: string;
    }, {
        name: string;
        quantity: number;
        unitPrice: number;
        modifiers: {
            name: string;
            priceDelta: number;
        }[];
        menuItemId: string;
    }>, "many">;
    placedAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "cancelled" | "pending" | "payment_pending" | "paid" | "confirmed" | "preparing" | "ready" | "out_for_delivery" | "delivered" | "picked_up";
    id: string;
    deliveryFee: number;
    updatedAt: string;
    restaurantId: string;
    customerId: string | null;
    paymentStatus: "pending" | "paid" | "failed" | "refunded";
    subtotal: number;
    tax: number;
    total: number;
    paymentMethod: "stripe_link" | "cash" | "card_on_delivery";
    stripePaymentLink: string | null;
    stripePaymentIntentId: string | null;
    items: {
        name: string;
        quantity: number;
        unitPrice: number;
        modifiers: {
            name: string;
            priceDelta: number;
        }[];
        menuItemId: string;
    }[];
    placedAt: string;
}, {
    status: "cancelled" | "pending" | "payment_pending" | "paid" | "confirmed" | "preparing" | "ready" | "out_for_delivery" | "delivered" | "picked_up";
    id: string;
    deliveryFee: number;
    updatedAt: string;
    restaurantId: string;
    customerId: string | null;
    paymentStatus: "pending" | "paid" | "failed" | "refunded";
    subtotal: number;
    tax: number;
    total: number;
    paymentMethod: "stripe_link" | "cash" | "card_on_delivery";
    stripePaymentLink: string | null;
    stripePaymentIntentId: string | null;
    items: {
        name: string;
        quantity: number;
        unitPrice: number;
        modifiers: {
            name: string;
            priceDelta: number;
        }[];
        menuItemId: string;
    }[];
    placedAt: string;
}>;
type Order = z.infer<typeof orderSchema>;
declare const apiErrorSchema: z.ZodObject<{
    message: z.ZodString;
    code: z.ZodOptional<z.ZodString>;
    details: z.ZodOptional<z.ZodArray<z.ZodObject<{
        message: z.ZodString;
        path: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        path?: string[] | undefined;
    }, {
        message: string;
        path?: string[] | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    message: string;
    code?: string | undefined;
    details?: {
        message: string;
        path?: string[] | undefined;
    }[] | undefined;
}, {
    message: string;
    code?: string | undefined;
    details?: {
        message: string;
        path?: string[] | undefined;
    }[] | undefined;
}>;
type ApiError = z.infer<typeof apiErrorSchema>;
declare const jwtPayloadSchema: z.ZodObject<{
    sub: z.ZodString;
    restaurantId: z.ZodNullable<z.ZodString>;
    email: z.ZodString;
    role: z.ZodEnum<["platform_admin", "restaurant_admin"]>;
    exp: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    restaurantId: string | null;
    email: string;
    sub: string;
    role: "platform_admin" | "restaurant_admin";
    exp: number;
}, {
    restaurantId: string | null;
    email: string;
    sub: string;
    role: "platform_admin" | "restaurant_admin";
    exp: number;
}>;
type JwtPayload = z.infer<typeof jwtPayloadSchema>;
declare const platformOverviewMetricsSchema: z.ZodObject<{
    activeRestaurants: z.ZodNumber;
    totalRestaurants: z.ZodNumber;
    totalCalls: z.ZodNumber;
    totalCallMinutes: z.ZodNumber;
    totalOrders: z.ZodNumber;
    totalRevenue: z.ZodNumber;
    vapiCosts: z.ZodNumber;
    netProfit: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    totalOrders: number;
    activeRestaurants: number;
    totalRestaurants: number;
    totalCalls: number;
    totalCallMinutes: number;
    totalRevenue: number;
    vapiCosts: number;
    netProfit: number;
}, {
    totalOrders: number;
    activeRestaurants: number;
    totalRestaurants: number;
    totalCalls: number;
    totalCallMinutes: number;
    totalRevenue: number;
    vapiCosts: number;
    netProfit: number;
}>;
type PlatformOverviewMetrics = z.infer<typeof platformOverviewMetricsSchema>;
declare const restaurantSummaryMetricsSchema: z.ZodObject<{
    restaurantId: z.ZodString;
    restaurantName: z.ZodString;
    calls: z.ZodNumber;
    callMinutes: z.ZodNumber;
    orders: z.ZodNumber;
    revenue: z.ZodNumber;
    status: z.ZodEnum<["trial", "active", "paused", "cancelled"]>;
}, "strip", z.ZodTypeAny, {
    status: "trial" | "active" | "paused" | "cancelled";
    restaurantId: string;
    restaurantName: string;
    calls: number;
    callMinutes: number;
    orders: number;
    revenue: number;
}, {
    status: "trial" | "active" | "paused" | "cancelled";
    restaurantId: string;
    restaurantName: string;
    calls: number;
    callMinutes: number;
    orders: number;
    revenue: number;
}>;
type RestaurantSummaryMetrics = z.infer<typeof restaurantSummaryMetricsSchema>;
declare const createOrderPayloadSchema: z.ZodObject<{
    restaurantId: z.ZodString;
    customerPhone: z.ZodString;
    customerName: z.ZodOptional<z.ZodString>;
    items: z.ZodArray<z.ZodObject<{
        menuItemId: z.ZodString;
        quantity: z.ZodNumber;
        modifiers: z.ZodDefault<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            priceDelta: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            name: string;
            priceDelta: number;
        }, {
            name: string;
            priceDelta: number;
        }>, "many">>;
    }, "strip", z.ZodTypeAny, {
        quantity: number;
        modifiers: {
            name: string;
            priceDelta: number;
        }[];
        menuItemId: string;
    }, {
        quantity: number;
        menuItemId: string;
        modifiers?: {
            name: string;
            priceDelta: number;
        }[] | undefined;
    }>, "many">;
    orderType: z.ZodEnum<["delivery", "pickup"]>;
    deliveryAddressId: z.ZodNullable<z.ZodString>;
    paymentMethod: z.ZodEnum<["stripe_link", "cash", "card_on_delivery"]>;
}, "strip", z.ZodTypeAny, {
    restaurantId: string;
    paymentMethod: "stripe_link" | "cash" | "card_on_delivery";
    items: {
        quantity: number;
        modifiers: {
            name: string;
            priceDelta: number;
        }[];
        menuItemId: string;
    }[];
    customerPhone: string;
    orderType: "delivery" | "pickup";
    deliveryAddressId: string | null;
    customerName?: string | undefined;
}, {
    restaurantId: string;
    paymentMethod: "stripe_link" | "cash" | "card_on_delivery";
    items: {
        quantity: number;
        menuItemId: string;
        modifiers?: {
            name: string;
            priceDelta: number;
        }[] | undefined;
    }[];
    customerPhone: string;
    orderType: "delivery" | "pickup";
    deliveryAddressId: string | null;
    customerName?: string | undefined;
}>;
type CreateOrderPayload = z.infer<typeof createOrderPayloadSchema>;
declare const vapiCallEventSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodEnum<["call.created", "call.updated", "call.ended"]>;
    createdAt: z.ZodString;
    data: z.ZodObject<{
        callId: z.ZodString;
        restaurantId: z.ZodString;
        phoneNumber: z.ZodString;
        phoneNumberId: z.ZodOptional<z.ZodString>;
        state: z.ZodEnum<["in_progress", "completed", "failed"]>;
        durationSeconds: z.ZodOptional<z.ZodNumber>;
        transcript: z.ZodArray<z.ZodObject<{
            speaker: z.ZodEnum<["agent", "caller"]>;
            text: z.ZodString;
            timestamp: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            speaker: "agent" | "caller";
            text: string;
            timestamp: number;
        }, {
            speaker: "agent" | "caller";
            text: string;
            timestamp: number;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        phoneNumber: string;
        restaurantId: string;
        callId: string;
        state: "failed" | "in_progress" | "completed";
        transcript: {
            speaker: "agent" | "caller";
            text: string;
            timestamp: number;
        }[];
        phoneNumberId?: string | undefined;
        durationSeconds?: number | undefined;
    }, {
        phoneNumber: string;
        restaurantId: string;
        callId: string;
        state: "failed" | "in_progress" | "completed";
        transcript: {
            speaker: "agent" | "caller";
            text: string;
            timestamp: number;
        }[];
        phoneNumberId?: string | undefined;
        durationSeconds?: number | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    type: "call.created" | "call.updated" | "call.ended";
    id: string;
    createdAt: string;
    data: {
        phoneNumber: string;
        restaurantId: string;
        callId: string;
        state: "failed" | "in_progress" | "completed";
        transcript: {
            speaker: "agent" | "caller";
            text: string;
            timestamp: number;
        }[];
        phoneNumberId?: string | undefined;
        durationSeconds?: number | undefined;
    };
}, {
    type: "call.created" | "call.updated" | "call.ended";
    id: string;
    createdAt: string;
    data: {
        phoneNumber: string;
        restaurantId: string;
        callId: string;
        state: "failed" | "in_progress" | "completed";
        transcript: {
            speaker: "agent" | "caller";
            text: string;
            timestamp: number;
        }[];
        phoneNumberId?: string | undefined;
        durationSeconds?: number | undefined;
    };
}>;
type VapiCallEvent = z.infer<typeof vapiCallEventSchema>;
declare const platformUsageDailySchema: z.ZodObject<{
    id: z.ZodString;
    restaurantId: z.ZodString;
    date: z.ZodString;
    totalCalls: z.ZodNumber;
    successfulCalls: z.ZodNumber;
    failedCalls: z.ZodNumber;
    totalMinutes: z.ZodNumber;
    totalOrders: z.ZodNumber;
    deliveryOrders: z.ZodNumber;
    pickupOrders: z.ZodNumber;
    totalOrderValue: z.ZodNumber;
    vapiCallCost: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    id: string;
    date: string;
    restaurantId: string;
    totalOrders: number;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalMinutes: number;
    deliveryOrders: number;
    pickupOrders: number;
    totalOrderValue: number;
    vapiCallCost: number;
}, {
    id: string;
    date: string;
    restaurantId: string;
    totalOrders: number;
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;
    totalMinutes: number;
    deliveryOrders: number;
    pickupOrders: number;
    totalOrderValue: number;
    vapiCallCost: number;
}>;
type PlatformUsageDaily = z.infer<typeof platformUsageDailySchema>;
declare const subscriptionInvoiceSchema: z.ZodObject<{
    id: z.ZodString;
    restaurantId: z.ZodString;
    billingPeriodStart: z.ZodString;
    billingPeriodEnd: z.ZodString;
    baseFeeCents: z.ZodNumber;
    includedMinutes: z.ZodNumber;
    overageMinutes: z.ZodNumber;
    overageRateCents: z.ZodNumber;
    totalAmountCents: z.ZodNumber;
    stripeInvoiceId: z.ZodNullable<z.ZodString>;
    status: z.ZodEnum<["draft", "pending", "paid", "failed"]>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    status: "pending" | "paid" | "failed" | "draft";
    id: string;
    createdAt: string;
    updatedAt: string;
    restaurantId: string;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    baseFeeCents: number;
    includedMinutes: number;
    overageMinutes: number;
    overageRateCents: number;
    totalAmountCents: number;
    stripeInvoiceId: string | null;
}, {
    status: "pending" | "paid" | "failed" | "draft";
    id: string;
    createdAt: string;
    updatedAt: string;
    restaurantId: string;
    billingPeriodStart: string;
    billingPeriodEnd: string;
    baseFeeCents: number;
    includedMinutes: number;
    overageMinutes: number;
    overageRateCents: number;
    totalAmountCents: number;
    stripeInvoiceId: string | null;
}>;
type SubscriptionInvoice = z.infer<typeof subscriptionInvoiceSchema>;
declare const authResponseSchema: z.ZodObject<{
    accessToken: z.ZodString;
    refreshToken: z.ZodString;
    expiresIn: z.ZodNumber;
    user: z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        role: z.ZodEnum<["platform_admin", "restaurant_admin"]>;
        restaurantId: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        restaurantId: string | null;
        email: string;
        role: "platform_admin" | "restaurant_admin";
    }, {
        id: string;
        restaurantId: string | null;
        email: string;
        role: "platform_admin" | "restaurant_admin";
    }>;
}, "strip", z.ZodTypeAny, {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
        id: string;
        restaurantId: string | null;
        email: string;
        role: "platform_admin" | "restaurant_admin";
    };
}, {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: {
        id: string;
        restaurantId: string | null;
        email: string;
        role: "platform_admin" | "restaurant_admin";
    };
}>;
type AuthResponse = z.infer<typeof authResponseSchema>;
declare const dashboardTimeRangeSchema: z.ZodEnum<["today", "yesterday", "last7", "last30", "month_to_date", "year_to_date"]>;
type DashboardTimeRange = z.infer<typeof dashboardTimeRangeSchema>;

export { type ApiError, type AuthResponse, type CreateOrderPayload, type Customer, type DashboardTimeRange, type JwtPayload, type Order, type OrderItem, type OrderStatus, type PaymentStatus, type PlatformOverviewMetrics, type PlatformUsageDaily, type PosMenuItem, type PosOrderItem, type PosProvider, type Restaurant, type RestaurantStatus, type RestaurantSummaryMetrics, type SubscriptionInvoice, type VapiCallEvent, apiErrorSchema, authResponseSchema, createOrderPayloadSchema, customerSchema, dashboardTimeRangeSchema, jwtPayloadSchema, orderItemSchema, orderSchema, orderStatusSchema, paymentStatusSchema, platformOverviewMetricsSchema, platformUsageDailySchema, posMenuItemSchema, posOrderItemSchema, posProviderSchema, restaurantSchema, restaurantStatusSchema, restaurantSummaryMetricsSchema, subscriptionInvoiceSchema, vapiCallEventSchema };
