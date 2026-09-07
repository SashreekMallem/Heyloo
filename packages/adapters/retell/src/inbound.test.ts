import { type InboundCallResolution, PayloadValidationError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { buildRetellInboundResponse, resolveRetellInboundCall } from "./inbound.js";

// Fixture: BACKEND_SPEC §7.1's documented request shape (VERIFY-2, raw-types.ts).
const INBOUND_FIXTURE = {
  call_id: "call_abc123",
  from_number: "+15551234567",
  to_number: "+15559876543",
  agent_id: "agent_default_1",
};

describe("resolveRetellInboundCall", () => {
  it("parses a well-formed inbound call webhook", () => {
    const context = resolveRetellInboundCall(JSON.stringify(INBOUND_FIXTURE));
    expect(context).toEqual({
      providerCallId: "call_abc123",
      fromNumberE164: "+15551234567",
      toNumberE164: "+15559876543",
      providerAgentId: "agent_default_1",
    });
  });

  it("parses a fixture with no agent_id (Retell had not resolved one yet)", () => {
    const { agent_id, ...withoutAgentId } = INBOUND_FIXTURE;
    const context = resolveRetellInboundCall(JSON.stringify(withoutAgentId));
    expect(context.providerAgentId).toBeUndefined();
  });

  it("throws PayloadValidationError on invalid JSON", () => {
    expect(() => resolveRetellInboundCall("{not json")).toThrow(PayloadValidationError);
  });

  it("throws PayloadValidationError when call_id is missing", () => {
    const { call_id, ...rest } = INBOUND_FIXTURE;
    expect(() => resolveRetellInboundCall(JSON.stringify(rest))).toThrow(PayloadValidationError);
  });

  it("throws PayloadValidationError when from_number is not E.164", () => {
    expect(() =>
      resolveRetellInboundCall(JSON.stringify({ ...INBOUND_FIXTURE, from_number: "555-1234" })),
    ).toThrow(PayloadValidationError);
  });
});

describe("buildRetellInboundResponse", () => {
  const resolution: InboundCallResolution = {
    dynamicVariables: {
      business_name: "Joe's Auto",
      assistant_name: "Ava",
      greeting_hours_context: "we're open until 6pm",
      timezone: "America/Chicago",
      special_instructions: "",
      is_manual_mode: false,
      language: "en-US",
      disclosure_line:
        "Thanks for calling Joe's Auto, this is their AI assistant — this call may be recorded.",
    },
  };

  it("builds the call_inbound wrapper with dynamic_variables", () => {
    const response = buildRetellInboundResponse(resolution);
    expect(response).toEqual({
      call_inbound: {
        dynamic_variables: resolution.dynamicVariables,
      },
    });
  });

  it("includes override_agent_id only when set", () => {
    const withOverride = buildRetellInboundResponse({ ...resolution, overrideAgentId: "agent_2" });
    expect(withOverride.call_inbound.override_agent_id).toBe("agent_2");

    const withoutOverride = buildRetellInboundResponse(resolution);
    expect(withoutOverride.call_inbound.override_agent_id).toBeUndefined();
  });

  it("ALWAYS carries disclosure_line in the response (G1/G2 — never omitted)", () => {
    const response = buildRetellInboundResponse(resolution);
    expect(response.call_inbound.dynamic_variables["disclosure_line"]).toBeTruthy();
  });
});
