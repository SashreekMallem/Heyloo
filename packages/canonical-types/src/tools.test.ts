import { describe, expect, it } from "vitest";
import {
  TOOL_NAMES,
  TOOL_REQUEST_SCHEMAS,
  zCancelBookingRequest,
  zCheckAvailabilityRequest,
  zCheckAvailabilityResult,
  zCreateBookingRequest,
  zCreateBookingResult,
  zCreateOrderRequest,
  zCreateOrderResult,
  zLookupCustomerRequest,
  zLookupCustomerResult,
  zSendPaymentLinkRequest,
  zSendSmsConfirmationRequest,
  zTakeMessageRequest,
  zToolFallbackResult,
  zTransferCallConfig,
  zUpdateBookingRequest,
} from "./tools.js";

describe("check_availability", () => {
  it("accepts a minimal valid request", () => {
    expect(
      zCheckAvailabilityRequest.parse({
        date_range: { start: "2026-09-08T00:00:00Z", end: "2026-09-09T00:00:00Z" },
      }),
    ).toBeTruthy();
  });

  it("rejects a request missing date_range", () => {
    expect(() => zCheckAvailabilityRequest.parse({})).toThrow();
  });

  it("accepts a none_available response with a nearest_alternative", () => {
    expect(
      zCheckAvailabilityResult.parse({
        slots: [],
        none_available: true,
        nearest_alternative: { start: "2026-09-10T10:00:00Z", end: "2026-09-10T10:30:00Z" },
      }),
    ).toBeTruthy();
  });
});

describe("create_booking", () => {
  it("accepts a valid request", () => {
    expect(
      zCreateBookingRequest.parse({
        resource_id: "res_1",
        start: "2026-09-08T10:00:00Z",
        end: "2026-09-08T10:30:00Z",
        customer: { name: "Jane Doe", phone: "+15551234567" },
      }),
    ).toBeTruthy();
  });

  it("rejects a request with no customer", () => {
    expect(() =>
      zCreateBookingRequest.parse({
        resource_id: "res_1",
        start: "2026-09-08T10:00:00Z",
        end: "2026-09-08T10:30:00Z",
      }),
    ).toThrow();
  });

  it("discriminated result: confirmed branch", () => {
    expect(
      zCreateBookingResult.parse({
        confirmed: true,
        booking_id: "bk_1",
        start: "2026-09-08T10:00:00Z",
        end: "2026-09-08T10:30:00Z",
      }),
    ).toBeTruthy();
  });

  it("discriminated result: slot_taken branch", () => {
    expect(zCreateBookingResult.parse({ confirmed: false, reason: "slot_taken" })).toBeTruthy();
  });

  it("rejects a confirmed:true result missing booking_id", () => {
    expect(() => zCreateBookingResult.parse({ confirmed: true, start: "x", end: "y" })).toThrow();
  });
});

describe("update_booking / cancel_booking", () => {
  it("accepts a valid reschedule request", () => {
    expect(
      zUpdateBookingRequest.parse({
        booking_id: "bk_1",
        new_start: "2026-09-08T11:00:00Z",
        new_end: "2026-09-08T11:30:00Z",
      }),
    ).toBeTruthy();
  });

  it("accepts a valid cancel request without a reason", () => {
    expect(zCancelBookingRequest.parse({ booking_id: "bk_1" })).toBeTruthy();
  });
});

describe("lookup_customer (G6 authorization)", () => {
  it("accepts a found result", () => {
    expect(
      zLookupCustomerResult.parse({ found: true, name: "Jane", segment: "returning" }),
    ).toBeTruthy();
  });

  it("accepts the unauthorized_lookup error branch", () => {
    expect(zLookupCustomerResult.parse({ error: "unauthorized_lookup" })).toBeTruthy();
  });

  it("rejects a request with no phone", () => {
    expect(() => zLookupCustomerRequest.parse({})).toThrow();
  });
});

describe("take_message / send_sms_confirmation", () => {
  it("accepts a valid take_message request", () => {
    expect(
      zTakeMessageRequest.parse({ caller_phone: "+15551234567", message_text: "Call me back" }),
    ).toBeTruthy();
  });

  it("accepts a valid send_sms_confirmation request", () => {
    expect(
      zSendSmsConfirmationRequest.parse({
        booking_id: "bk_1",
        phone: "+15551234567",
        template_key: "booking_confirmation",
      }),
    ).toBeTruthy();
  });
});

describe("transfer_call config (G6 tenant-config-only destination)", () => {
  it("accepts a valid config", () => {
    expect(
      zTransferCallConfig.parse({
        destination_number: "+15559876543",
        context_summary_enabled: true,
      }),
    ).toBeTruthy();
  });

  it("rejects context_summary_enabled: false (warm transfers always carry context, SYSTEM_DESIGN §4.5)", () => {
    expect(() =>
      zTransferCallConfig.parse({
        destination_number: "+15559876543",
        context_summary_enabled: false,
      }),
    ).toThrow();
  });
});

describe("create_order (MASTER_SPEC §3.0)", () => {
  const baseOrder = {
    items: [{ name: "Burger", qty: 2 }],
    customer: { name: "Jane Doe", phone: "+15551234567" },
  };

  it("accepts a pickup order with no delivery_address", () => {
    expect(zCreateOrderRequest.parse({ ...baseOrder, fulfillment_type: "pickup" })).toBeTruthy();
  });

  it("accepts a delivery order WITH delivery_address", () => {
    expect(
      zCreateOrderRequest.parse({
        ...baseOrder,
        fulfillment_type: "delivery",
        delivery_address: { street: "42 Oak St", city: "Springfield", state: "IL", zip: "62701" },
      }),
    ).toBeTruthy();
  });

  it("REJECTS a delivery order with no delivery_address (§3.0 mandatory address capture)", () => {
    expect(() =>
      zCreateOrderRequest.parse({ ...baseOrder, fulfillment_type: "delivery" }),
    ).toThrow();
  });

  it("rejects an order with zero items", () => {
    expect(() =>
      zCreateOrderRequest.parse({ ...baseOrder, items: [], fulfillment_type: "pickup" }),
    ).toThrow();
  });

  it("accepts the out_of_delivery_radius decline branch with a pickup offer", () => {
    expect(
      zCreateOrderResult.parse({
        confirmed: false,
        reason: "out_of_delivery_radius",
        pickup_offered: true,
      }),
    ).toBeTruthy();
  });

  it("accepts the confirmed branch with cent totals", () => {
    expect(
      zCreateOrderResult.parse({
        confirmed: true,
        order_id: "ord_1",
        subtotal_cents: 1500,
        tax_cents: 120,
        total_cents: 1620,
      }),
    ).toBeTruthy();
  });
});

describe("send_payment_link (MASTER_SPEC §3.2)", () => {
  it("accepts a request tied to an order", () => {
    expect(
      zSendPaymentLinkRequest.parse({
        order_id: "ord_1",
        phone: "+15551234567",
        purpose: "order",
        amount_cents: 1620,
      }),
    ).toBeTruthy();
  });

  it("accepts a request tied to a booking (deposit)", () => {
    expect(
      zSendPaymentLinkRequest.parse({
        booking_id: "bk_1",
        phone: "+15551234567",
        purpose: "deposit",
        amount_cents: 5000,
      }),
    ).toBeTruthy();
  });

  it("rejects a request with neither order_id nor booking_id", () => {
    expect(() =>
      zSendPaymentLinkRequest.parse({
        phone: "+15551234567",
        purpose: "deposit",
        amount_cents: 5000,
      }),
    ).toThrow();
  });

  it("rejects a negative amount_cents", () => {
    expect(() =>
      zSendPaymentLinkRequest.parse({
        order_id: "ord_1",
        phone: "+15551234567",
        purpose: "order",
        amount_cents: -100,
      }),
    ).toThrow();
  });
});

describe("tool fallback result", () => {
  it("accepts the standard circuit-breaker fallback shape", () => {
    expect(
      zToolFallbackResult.parse({
        fallback: true,
        message: "I'll take your details and have someone confirm.",
      }),
    ).toBeTruthy();
  });
});

describe("tool registry", () => {
  it("TOOL_NAMES matches the keys of TOOL_REQUEST_SCHEMAS", () => {
    expect(TOOL_NAMES.sort()).toEqual(Object.keys(TOOL_REQUEST_SCHEMAS).sort());
  });

  it("includes every BACKEND_SPEC §7.2 + MASTER_SPEC §3.0/§3.2 tool", () => {
    expect(TOOL_NAMES).toEqual(
      expect.arrayContaining([
        "check_availability",
        "create_booking",
        "update_booking",
        "cancel_booking",
        "lookup_customer",
        "take_message",
        "send_sms_confirmation",
        "create_order",
        "send_payment_link",
      ]),
    );
  });
});
