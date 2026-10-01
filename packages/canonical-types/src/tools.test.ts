import { describe, expect, it } from "vitest";
import {
  DELIVERY_CHECK_STATUSES,
  TOOL_NAMES,
  TOOL_REQUEST_SCHEMAS,
  zCancelBookingRequest,
  zCheckAvailabilityRequest,
  zCheckAvailabilityResult,
  zCheckDeliveryAddressRequest,
  zCheckDeliveryAddressResult,
  zCreateBookingRequest,
  zCreateBookingResult,
  zCreateOrderRequest,
  zCreateOrderResult,
  zJoinWaitlistRequest,
  zJoinWaitlistResult,
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

  it("accepts a consent answer (GAP_REGISTER.md §1.9 drift fix)", () => {
    expect(
      zCreateBookingRequest.parse({
        resource_id: "res_1",
        start: "2026-09-08T10:00:00Z",
        end: "2026-09-08T10:30:00Z",
        customer: { name: "Jane Doe", phone: "+15551234567" },
        consent: { sms: true, call: false },
      }),
    ).toBeTruthy();
  });

  it("accepts a vertical-typed structured_payload (GAP_REGISTER.md §1.7)", () => {
    expect(
      zCreateBookingRequest.parse({
        resource_id: "res_1",
        start: "2026-09-08T10:00:00Z",
        end: "2026-09-08T10:30:00Z",
        customer: { name: "Jane Doe", phone: "+15551234567" },
        structured_payload: { vehicle_make: "Honda", vehicle_year: 2019 },
      }),
    ).toBeTruthy();
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

  it("accepts an update_booking identity-fallback verify block (GAP_REGISTER.md §1.9)", () => {
    expect(
      zUpdateBookingRequest.parse({
        booking_id: "bk_1",
        new_start: "2026-09-08T11:00:00Z",
        new_end: "2026-09-08T11:30:00Z",
        verify: { full_name: "Jane Doe", appointment_time: "2026-09-08T10:00:00Z" },
      }),
    ).toBeTruthy();
  });

  it("accepts a cancel_booking identity-fallback verify block", () => {
    expect(
      zCancelBookingRequest.parse({
        booking_id: "bk_1",
        verify: { full_name: "Jane Doe", appointment_time: "2026-09-08T10:00:00Z" },
      }),
    ).toBeTruthy();
  });
});

describe("join_waitlist (GAP_REGISTER.md §1.2)", () => {
  it("accepts a valid request", () => {
    expect(
      zJoinWaitlistRequest.parse({
        customer: { name: "Jane Doe", phone: "+15551234567" },
        resource_type: "room",
        preferred_window_start: "2026-09-08T00:00:00Z",
        preferred_window_end: "2026-09-09T00:00:00Z",
      }),
    ).toBeTruthy();
  });

  it("rejects a request with no preferred window", () => {
    expect(() =>
      zJoinWaitlistRequest.parse({ customer: { name: "Jane Doe", phone: "+15551234567" } }),
    ).toThrow();
  });

  it("discriminated result: joined branch", () => {
    expect(zJoinWaitlistResult.parse({ joined: true, waitlist_entry_id: "wl_1" })).toBeTruthy();
  });

  it("discriminated result: invalid_phone branch", () => {
    expect(zJoinWaitlistResult.parse({ joined: false, reason: "invalid_phone" })).toBeTruthy();
  });

  it("discriminated result: offering_not_found branch", () => {
    expect(zJoinWaitlistResult.parse({ joined: false, reason: "offering_not_found" })).toBeTruthy();
  });

  it("is registered in the tool dispatch table", () => {
    expect(TOOL_NAMES).toContain("join_waitlist");
    expect(TOOL_REQUEST_SCHEMAS.join_waitlist).toBe(zJoinWaitlistRequest);
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

  // CALL-9 (docs/BUILD_NOTES.md): `phone` is now optional — the model has
  // no way to know the true live caller-ID number itself, so the server
  // defaults to it automatically (`voice-tools/tools/lookup_customer.ts`)
  // when the model omits this field, which is now the NORMAL way this tool
  // is called, not an error case.
  it("accepts a request with no phone (the server defaults to the live caller number)", () => {
    expect(zLookupCustomerRequest.parse({})).toEqual({});
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

  it("accepts a delivery order referencing a saved address by address_id, with no street (CHANNELS-2 item 10)", () => {
    expect(
      zCreateOrderRequest.parse({
        ...baseOrder,
        fulfillment_type: "delivery",
        delivery_address: { address_id: "addr_1" },
      }),
    ).toBeTruthy();
  });

  it("REJECTS a delivery_address with neither address_id nor street", () => {
    expect(() =>
      zCreateOrderRequest.parse({
        ...baseOrder,
        fulfillment_type: "delivery",
        delivery_address: { set_as_default: true },
      }),
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

  it("accepts the confirmed branch with a delivery_fee_cents", () => {
    expect(
      zCreateOrderResult.parse({
        confirmed: true,
        order_id: "ord_1",
        subtotal_cents: 1500,
        tax_cents: 120,
        delivery_fee_cents: 399,
        total_cents: 2019,
      }),
    ).toBeTruthy();
  });

  it("accepts consent + allergies + special_instructions (GAP_REGISTER.md §1.10 / §2 Restaurant item 2)", () => {
    expect(
      zCreateOrderRequest.parse({
        ...baseOrder,
        fulfillment_type: "pickup",
        consent: { sms: true },
        allergies: ["peanuts"],
        special_instructions: "no onions",
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
        "join_waitlist",
        "check_delivery_address",
      ]),
    );
  });
});

describe("check_delivery_address (DELIVERY-1)", () => {
  it("requires a street; city/state/zip/unit are optional", () => {
    expect(zCheckDeliveryAddressRequest.parse({ street: "12 Elm St" })).toEqual({
      street: "12 Elm St",
    });
    expect(
      zCheckDeliveryAddressRequest.parse({
        street: "12 Elm St",
        city: "Richardson",
        state: "TX",
        zip: "75081",
        unit: "Apt 4",
      }),
    ).toBeTruthy();
    expect(() => zCheckDeliveryAddressRequest.parse({ city: "Richardson" })).toThrow();
    expect(() => zCheckDeliveryAddressRequest.parse({ street: "" })).toThrow();
  });

  it("result carries a status from the fixed set, a message, and integer-cent fees", () => {
    expect(
      zCheckDeliveryAddressResult.parse({
        status: "in_range",
        matched_address: "12 ELM ST, RICHARDSON, TX, 75081",
        distance_miles: 3.01,
        radius_miles: 5,
        delivery_fee_cents: 402,
        delivery_minimum_cents: 1500,
        message: "Read the matched address back to confirm.",
      }),
    ).toBeTruthy();
    for (const status of DELIVERY_CHECK_STATUSES) {
      expect(zCheckDeliveryAddressResult.parse({ status, message: "x" })).toBeTruthy();
    }
    expect(() => zCheckDeliveryAddressResult.parse({ status: "maybe", message: "x" })).toThrow();
    expect(() =>
      zCheckDeliveryAddressResult.parse({
        status: "in_range",
        message: "x",
        delivery_fee_cents: 4.5,
      }),
    ).toThrow();
  });

  it("create_order can decline below the delivery minimum with the amounts", () => {
    expect(
      zCreateOrderResult.parse({
        confirmed: false,
        reason: "below_delivery_minimum",
        delivery_minimum_cents: 2000,
        subtotal_cents: 1500,
        pickup_offered: true,
        message: "Offer to add items or switch to pickup.",
      }),
    ).toBeTruthy();
  });
});
