import { createHmac } from "node:crypto";
import { PayloadValidationError, SignatureVerificationError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { normalizeCostBreakdown, verifyAndParseRetellCallEndedWebhook } from "./call-events.js";

const API_KEY = "test-api-key";

function sign(rawBody: string): string {
  const ts = Date.now();
  const digest = createHmac("sha256", API_KEY)
    .update(rawBody + String(ts), "utf8")
    .digest("hex");
  return `v=${ts},d=${digest}`;
}

// Fixture: call_ended webhook per API_AND_FLOWS.md A.1 + BACKEND_SPEC §7.3 (VERIFY-4/VERIFY-5, raw-types.ts).
const CALL_ENDED_FIXTURE = {
  event: "call_ended" as const,
  call: {
    call_id: "call_abc123",
    agent_id: "agent_1",
    from_number: "+15551234567",
    to_number: "+15559876543",
    start_timestamp: 1_757_000_000_000,
    end_timestamp: 1_757_000_192_000, // 192 seconds later
    disconnection_reason: "user_hangup",
    call_cost: {
      product_costs: [
        { product: "voice_engine", cost: 30, unit_price: 15, is_transfer_leg_cost: false },
        { product: "telephony", cost: 12, is_transfer_leg_cost: false },
      ],
      total_duration_seconds: 192,
      combined_cost: 42,
    },
  },
};

describe("verifyAndParseRetellCallEndedWebhook", () => {
  it("verifies + parses a well-formed call_ended event, normalizing costs", () => {
    const rawBody = JSON.stringify(CALL_ENDED_FIXTURE);
    const event = verifyAndParseRetellCallEndedWebhook(rawBody, sign(rawBody), API_KEY);

    expect(event.providerCallId).toBe("call_abc123");
    expect(event.durationSeconds).toBe(192);
    expect(event.disconnectionReason).toBe("user_hangup");
    expect(event.transferOccurred).toBe(false);
    expect(event.costBreakdown).toEqual({
      total_cents: 42,
      currency: "USD",
      granularity: "exact",
      line_items: [
        {
          product: "voice_engine",
          cost_cents: 30,
          unit_price_cents: 15,
          is_transfer_leg_cost: false,
          raw: CALL_ENDED_FIXTURE.call.call_cost.product_costs[0],
        },
        {
          product: "telephony",
          cost_cents: 12,
          is_transfer_leg_cost: false,
          raw: CALL_ENDED_FIXTURE.call.call_cost.product_costs[1],
        },
      ],
    });
  });

  it("marks transferOccurred true when disconnection_reason is call_transfer", () => {
    const fixture = {
      ...CALL_ENDED_FIXTURE,
      call: { ...CALL_ENDED_FIXTURE.call, disconnection_reason: "call_transfer" },
    };
    const rawBody = JSON.stringify(fixture);
    const event = verifyAndParseRetellCallEndedWebhook(rawBody, sign(rawBody), API_KEY);
    expect(event.transferOccurred).toBe(true);
    expect(event.disconnectionReason).toBe("call_transfer");
  });

  it("normalizes an unrecognized disconnection_reason to 'unknown' rather than rejecting the event", () => {
    const fixture = {
      ...CALL_ENDED_FIXTURE,
      call: { ...CALL_ENDED_FIXTURE.call, disconnection_reason: "some_future_reason_we_dont_know" },
    };
    const rawBody = JSON.stringify(fixture);
    const event = verifyAndParseRetellCallEndedWebhook(rawBody, sign(rawBody), API_KEY);
    expect(event.disconnectionReason).toBe("unknown");
  });

  it("rejects (fail closed) with no signature header", () => {
    const rawBody = JSON.stringify(CALL_ENDED_FIXTURE);
    expect(() => verifyAndParseRetellCallEndedWebhook(rawBody, null, API_KEY)).toThrow(
      SignatureVerificationError,
    );
  });

  it("throws PayloadValidationError for a call_started event (wrong event type for this function)", () => {
    const fixture = { event: "call_started" as const, call: CALL_ENDED_FIXTURE.call };
    const rawBody = JSON.stringify(fixture);
    expect(() => verifyAndParseRetellCallEndedWebhook(rawBody, sign(rawBody), API_KEY)).toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError when end_timestamp is missing on a call_ended event", () => {
    const { end_timestamp, ...callWithoutEnd } = CALL_ENDED_FIXTURE.call;
    const fixture = { event: "call_ended" as const, call: callWithoutEnd };
    const rawBody = JSON.stringify(fixture);
    expect(() => verifyAndParseRetellCallEndedWebhook(rawBody, sign(rawBody), API_KEY)).toThrow(
      PayloadValidationError,
    );
  });
});

describe("normalizeCostBreakdown", () => {
  it("returns a zeroed 'estimated' breakdown when call_cost is absent", () => {
    expect(normalizeCostBreakdown(undefined)).toEqual({
      total_cents: 0,
      currency: "USD",
      granularity: "estimated",
      line_items: [],
    });
  });

  it("falls back to summing line items when combined_cost is zero/absent", () => {
    const result = normalizeCostBreakdown({
      product_costs: [{ product: "llm", cost: 10, is_transfer_leg_cost: false }],
      combined_cost: 0,
    });
    expect(result.total_cents).toBe(10);
    expect(result.granularity).toBe("exact");
  });

  it("marks a transfer-leg line item's is_transfer_leg_cost true", () => {
    const result = normalizeCostBreakdown({
      product_costs: [{ product: "telephony", cost: 5, is_transfer_leg_cost: true }],
      combined_cost: 5,
    });
    expect(result.line_items[0]?.is_transfer_leg_cost).toBe(true);
  });
});
