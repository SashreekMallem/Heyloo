import { type InboundCallResolution, PayloadValidationError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { buildRetellInboundResponse, resolveRetellInboundCall } from "./inbound.js";

// Fixture: Retell's REAL nested request shape, confirmed live (VERIFY-2,
// LIVE-MINE-FIXES — see raw-types.ts and docs/VERIFY.md). No call_id
// anywhere — Retell has not created/attached one yet at this point.
const INBOUND_FIXTURE = {
  event: "call_inbound",
  call_inbound: {
    from_number: "+15551234567",
    to_number: "+15559876543",
    agent_id: "agent_default_1",
  },
};

describe("resolveRetellInboundCall", () => {
  it("parses a well-formed inbound call webhook (nested call_inbound envelope)", () => {
    const context = resolveRetellInboundCall(JSON.stringify(INBOUND_FIXTURE));
    expect(context).toEqual({
      fromNumberE164: "+15551234567",
      toNumberE164: "+15559876543",
      providerAgentId: "agent_default_1",
    });
  });

  it("parses a fixture with no agent_id (Retell had not resolved one yet)", () => {
    const { agent_id, ...withoutAgentId } = INBOUND_FIXTURE.call_inbound;
    const context = resolveRetellInboundCall(
      JSON.stringify({ ...INBOUND_FIXTURE, call_inbound: withoutAgentId }),
    );
    expect(context.providerAgentId).toBeUndefined();
  });

  it("throws PayloadValidationError on invalid JSON", () => {
    expect(() => resolveRetellInboundCall("{not json")).toThrow(PayloadValidationError);
  });

  it("throws PayloadValidationError when the call_inbound wrapper is missing entirely (the OLD flat legacy-assumed shape)", () => {
    // This is exactly the flat body VERIFY-2 originally assumed
    // (`{call_id, from_number, to_number}` at the top level) — it must now
    // be REJECTED, proving the flat shape is no longer what's required.
    const flatLegacyShape = {
      call_id: "call_abc123",
      from_number: "+15551234567",
      to_number: "+15559876543",
    };
    expect(() => resolveRetellInboundCall(JSON.stringify(flatLegacyShape))).toThrow(
      PayloadValidationError,
    );
  });

  it("throws PayloadValidationError when from_number is not E.164", () => {
    expect(() =>
      resolveRetellInboundCall(
        JSON.stringify({
          ...INBOUND_FIXTURE,
          call_inbound: { ...INBOUND_FIXTURE.call_inbound, from_number: "555-1234" },
        }),
      ),
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
