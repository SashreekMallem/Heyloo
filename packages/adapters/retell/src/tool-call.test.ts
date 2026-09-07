import { createHmac } from "node:crypto";
import { PayloadValidationError, SignatureVerificationError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { buildRetellToolCallResponse, verifyAndParseRetellToolCall } from "./tool-call.js";

const API_KEY = "test-api-key";

function sign(rawBody: string): string {
  const ts = Date.now();
  const digest = createHmac("sha256", API_KEY)
    .update(rawBody + String(ts), "utf8")
    .digest("hex");
  return `v=${ts},d=${digest}`;
}

// Fixture: flat shape per BACKEND_SPEC §7.2's documented dispatch envelope (VERIFY-3, raw-types.ts).
const FLAT_FIXTURE = {
  call_id: "call_abc123",
  name: "check_availability",
  args: { date_range: { start: "2026-09-08T00:00:00Z", end: "2026-09-09T00:00:00Z" } },
};

// Fixture: nested `call` object shape per the indexed custom-function docs (VERIFY-3).
const NESTED_FIXTURE = {
  call: { call_id: "call_xyz789", from_number: "+15551234567" },
  name: "lookup_customer",
  args: { phone: "+15551234567" },
};

describe("verifyAndParseRetellToolCall", () => {
  it("verifies signature + parses the flat dispatch envelope", () => {
    const rawBody = JSON.stringify(FLAT_FIXTURE);
    const request = verifyAndParseRetellToolCall(rawBody, sign(rawBody), API_KEY);
    expect(request).toEqual({
      providerCallId: "call_abc123",
      toolName: "check_availability",
      args: FLAT_FIXTURE.args,
    });
  });

  it("verifies signature + parses the nested `call` envelope, extracting the caller number for G6", () => {
    const rawBody = JSON.stringify(NESTED_FIXTURE);
    const request = verifyAndParseRetellToolCall(rawBody, sign(rawBody), API_KEY);
    expect(request).toEqual({
      providerCallId: "call_xyz789",
      toolName: "lookup_customer",
      args: NESTED_FIXTURE.args,
      callerNumberE164: "+15551234567",
    });
  });

  it("throws SignatureVerificationError (fail closed) on a missing signature header", () => {
    const rawBody = JSON.stringify(FLAT_FIXTURE);
    expect(() => verifyAndParseRetellToolCall(rawBody, null, API_KEY)).toThrow(
      SignatureVerificationError,
    );
  });

  it("throws SignatureVerificationError on a tampered body", () => {
    const rawBody = JSON.stringify(FLAT_FIXTURE);
    const header = sign(rawBody);
    const tampered = JSON.stringify({ ...FLAT_FIXTURE, name: "create_booking" });
    expect(() => verifyAndParseRetellToolCall(tampered, header, API_KEY)).toThrow(
      SignatureVerificationError,
    );
  });

  it("throws PayloadValidationError when neither call_id nor call.call_id is present", () => {
    const bad = { name: "check_availability", args: {} };
    const rawBody = JSON.stringify(bad);
    expect(() => verifyAndParseRetellToolCall(rawBody, sign(rawBody), API_KEY)).toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError on invalid JSON (even with a valid-looking signature)", () => {
    const rawBody = "{not valid json";
    expect(() => verifyAndParseRetellToolCall(rawBody, sign(rawBody), API_KEY)).toThrow(
      PayloadValidationError,
    );
  });
});

describe("buildRetellToolCallResponse", () => {
  it("wraps a business result in {result}", () => {
    expect(buildRetellToolCallResponse({ result: { found: true, name: "Jane" } })).toEqual({
      result: { found: true, name: "Jane" },
    });
  });

  it("wraps the circuit-breaker fallback shape the same way", () => {
    expect(
      buildRetellToolCallResponse({
        result: { fallback: true, message: "I'll take your details and have someone confirm." },
      }),
    ).toEqual({
      result: { fallback: true, message: "I'll take your details and have someone confirm." },
    });
  });
});
