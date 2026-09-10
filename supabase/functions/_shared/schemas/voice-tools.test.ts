import {
  zCancelBookingRequest,
  zCheckAvailabilityRequest,
  zCreateBookingRequest,
  zCreateOrderRequest,
  zJoinWaitlistRequest,
  zLookupCustomerRequest,
  zSendPaymentLinkRequest,
  zSendSmsConfirmationRequest,
  zTakeMessageRequest,
  zUpdateBookingRequest,
} from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import type { ZodObject } from "zod";
import {
  CancelBookingArgsSchema,
  CheckAvailabilityArgsSchema,
  CreateBookingArgsSchema,
  CreateOrderArgsSchema,
  JoinWaitlistArgsSchema,
  LookupCustomerArgsSchema,
  SendPaymentLinkArgsSchema,
  SendSmsConfirmationArgsSchema,
  TakeMessageArgsSchema,
  UpdateBookingArgsSchema,
} from "./voice-tools.js";

/**
 * GAP_REGISTER.md §1.9 / FIX-1 follow-up — `packages/canonical-types/src/
 * tools.ts` (the model-facing/dashboard-facing contract) and this file (the
 * schema actually enforced at the `/voice-tools` runtime edge) both claim to
 * be the single source of truth for tool argument shapes and had silently
 * drifted before.
 *
 * This file previously diffed the runtime schema against
 * `CANONICAL_TOP_LEVEL_KEYS`, a THIRD hand-copied literal of key names that
 * was never actually checked against `tools.ts` itself — it could silently
 * drift from the real canonical schema same as anything else. Now that
 * `@heyloo/canonical-types` is a real devDependency of `@heyloo/edge-
 * functions` (this file runs under Vitest/Node, not Deno — the Deno hot-path
 * entrypoints this package also ships still cannot and do not import it,
 * same documented constraint as `admin/schemas.ts`), this imports the real
 * canonical Zod schemas and diffs directly against them: top-level key sets
 * (added/removed field drift) AND each shared field's required/optional-ness
 * (a field silently becoming required on one side while staying optional on
 * the other — a shape drift a pure key-set diff can't catch).
 */

interface ParityCase {
  name: string;
  runtime: ZodObject;
  canonical: ZodObject;
}

const CASES: ParityCase[] = [
  {
    name: "check_availability",
    runtime: CheckAvailabilityArgsSchema,
    canonical: zCheckAvailabilityRequest,
  },
  { name: "create_booking", runtime: CreateBookingArgsSchema, canonical: zCreateBookingRequest },
  { name: "update_booking", runtime: UpdateBookingArgsSchema, canonical: zUpdateBookingRequest },
  { name: "cancel_booking", runtime: CancelBookingArgsSchema, canonical: zCancelBookingRequest },
  { name: "lookup_customer", runtime: LookupCustomerArgsSchema, canonical: zLookupCustomerRequest },
  { name: "take_message", runtime: TakeMessageArgsSchema, canonical: zTakeMessageRequest },
  {
    name: "send_sms_confirmation",
    runtime: SendSmsConfirmationArgsSchema,
    canonical: zSendSmsConfirmationRequest,
  },
  { name: "create_order", runtime: CreateOrderArgsSchema, canonical: zCreateOrderRequest },
  {
    name: "send_payment_link",
    runtime: SendPaymentLinkArgsSchema,
    canonical: zSendPaymentLinkRequest,
  },
  { name: "join_waitlist", runtime: JoinWaitlistArgsSchema, canonical: zJoinWaitlistRequest },
];

describe("schema parity with packages/canonical-types/src/tools.ts (GAP_REGISTER.md §1.9)", () => {
  for (const { name, runtime, canonical } of CASES) {
    it(`${name}: no top-level key drift`, () => {
      expect(Object.keys(runtime.shape).sort()).toEqual(Object.keys(canonical.shape).sort());
    });

    it(`${name}: no required/optional drift on shared fields`, () => {
      for (const key of Object.keys(runtime.shape)) {
        const runtimeField = runtime.shape[key];
        const canonicalField = canonical.shape[key];
        expect(
          canonicalField,
          `'${name}.${key}' exists on the runtime schema but not canonical`,
        ).toBeDefined();
        const runtimeOptional = runtimeField.safeParse(undefined).success;
        const canonicalOptional = canonicalField.safeParse(undefined).success;
        expect(
          runtimeOptional,
          `'${name}.${key}' is ${runtimeOptional ? "optional" : "required"} on the runtime schema ` +
            `but ${canonicalOptional ? "optional" : "required"} on the canonical schema`,
        ).toBe(canonicalOptional);
      }
    });
  }
});

describe("CreateBookingArgsSchema", () => {
  it("accepts consent + structured_payload", () => {
    expect(
      CreateBookingArgsSchema.parse({
        resource_id: "res_1",
        start: "2026-09-08T10:00:00Z",
        end: "2026-09-08T10:30:00Z",
        customer: { name: "Jane Doe", phone: "+15551234567" },
        consent: { sms: true },
        structured_payload: { vehicle_make: "Honda" },
      }),
    ).toBeTruthy();
  });
});

describe("CreateOrderArgsSchema", () => {
  it("accepts allergies + special_instructions + consent", () => {
    expect(
      CreateOrderArgsSchema.parse({
        items: [{ name: "Burger", qty: 1 }],
        fulfillment_type: "pickup",
        customer: { name: "Jane Doe", phone: "+15551234567" },
        allergies: ["peanuts"],
        special_instructions: "no onions",
        consent: { sms: true },
      }),
    ).toBeTruthy();
  });
});

describe("JoinWaitlistArgsSchema", () => {
  it("accepts a valid request", () => {
    expect(
      JoinWaitlistArgsSchema.parse({
        customer: { name: "Jane Doe", phone: "+15551234567" },
        resource_type: "room",
        preferred_window_start: "2026-09-08T00:00:00Z",
        preferred_window_end: "2026-09-09T00:00:00Z",
      }),
    ).toBeTruthy();
  });

  it("rejects a request with no preferred window", () => {
    expect(() =>
      JoinWaitlistArgsSchema.parse({ customer: { name: "Jane Doe", phone: "+15551234567" } }),
    ).toThrow();
  });
});
