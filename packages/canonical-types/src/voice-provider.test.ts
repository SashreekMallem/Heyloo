import { describe, expect, it } from "vitest";
import type { CompileTarget } from "./agent-template.js";
import {
  type ProviderCapabilities,
  supportsCompileTarget,
  zAgentDynamicVariables,
  zCallEndedEvent,
  zCanonicalCostBreakdown,
  zCanonicalCostLineItem,
} from "./voice-provider.js";

const fullCapabilities: ProviderCapabilities = {
  supportsConversationFlow: true,
  supportsMultiPrompt: true,
  supportsSinglePrompt: true,
  supportsGlobalIntents: true,
  supportsWarmTransferContext: true,
  supportsNativeSmsChannel: true,
  supportsBatchSimulationTesting: true,
  supportsConcurrencyQuery: true,
  supportsPhoneNumberImport: true,
  costGranularity: "exact",
};

describe("supportsCompileTarget", () => {
  it("reflects the capability flag for each target", () => {
    const limited: ProviderCapabilities = { ...fullCapabilities, supportsMultiPrompt: false };
    const targets: CompileTarget[] = ["conversation_flow", "multi_prompt", "single_prompt"];
    expect(targets.map((t) => supportsCompileTarget(fullCapabilities, t))).toEqual([
      true,
      true,
      true,
    ]);
    expect(supportsCompileTarget(limited, "multi_prompt")).toBe(false);
    expect(supportsCompileTarget(limited, "conversation_flow")).toBe(true);
  });
});

describe("zCanonicalCostLineItem / zCanonicalCostBreakdown", () => {
  it("accepts a well-formed exact line item", () => {
    expect(
      zCanonicalCostLineItem.parse({
        product: "voice_engine",
        cost_cents: 12,
        unit_price_cents: 6,
        is_transfer_leg_cost: false,
      }),
    ).toBeTruthy();
  });

  it("accepts a full breakdown with granularity 'estimated'", () => {
    expect(
      zCanonicalCostBreakdown.parse({
        total_cents: 30,
        currency: "USD",
        granularity: "estimated",
        line_items: [
          { product: "llm", cost_cents: 20, is_transfer_leg_cost: false },
          { product: "telephony", cost_cents: 10, is_transfer_leg_cost: true },
        ],
      }),
    ).toBeTruthy();
  });

  it("rejects a non-USD currency", () => {
    expect(() =>
      zCanonicalCostBreakdown.parse({
        total_cents: 30,
        currency: "EUR",
        granularity: "exact",
        line_items: [],
      }),
    ).toThrow();
  });

  it("rejects an invalid granularity", () => {
    expect(() =>
      zCanonicalCostBreakdown.parse({
        total_cents: 30,
        currency: "USD",
        granularity: "approx",
        line_items: [],
      }),
    ).toThrow();
  });

  it("rejects negative cost_cents on a line item", () => {
    expect(() =>
      zCanonicalCostLineItem.parse({
        product: "llm",
        cost_cents: -5,
        is_transfer_leg_cost: false,
      }),
    ).toThrow();
  });
});

describe("zAgentDynamicVariables", () => {
  it("accepts the full BACKEND_SPEC §7.1 response shape", () => {
    expect(
      zAgentDynamicVariables.parse({
        business_name: "Joe's Auto",
        assistant_name: "Ava",
        greeting_hours_context: "we're open until 6pm",
        timezone: "America/Chicago",
        current_date: "2026-09-20",
        current_weekday: "Sunday",
        special_instructions: "",
        is_manual_mode: false,
        language: "en-US",
        disclosure_line: "This call may be recorded.",
      }),
    ).toBeTruthy();
  });

  it("rejects a payload missing disclosure_line (never omitted, G1/G2)", () => {
    expect(() =>
      zAgentDynamicVariables.parse({
        business_name: "Joe's Auto",
        assistant_name: "Ava",
        greeting_hours_context: "open",
        timezone: "America/Chicago",
        current_date: "2026-09-20",
        current_weekday: "Sunday",
        special_instructions: "",
        is_manual_mode: false,
        language: "en-US",
      }),
    ).toThrow();
  });

  it("rejects a payload missing current_date (CALL-2: the model's only real-date anchor)", () => {
    expect(() =>
      zAgentDynamicVariables.parse({
        business_name: "Joe's Auto",
        assistant_name: "Ava",
        greeting_hours_context: "open",
        timezone: "America/Chicago",
        current_weekday: "Sunday",
        special_instructions: "",
        is_manual_mode: false,
        language: "en-US",
        disclosure_line: "This call may be recorded.",
      }),
    ).toThrow();
  });
});

describe("zCallEndedEvent", () => {
  it("accepts a well-formed call_ended event", () => {
    expect(
      zCallEndedEvent.parse({
        providerCallId: "call_abc123",
        startedAt: "2026-09-07T14:00:00Z",
        endedAt: "2026-09-07T14:03:12Z",
        durationSeconds: 192,
        disconnectionReason: "user_hangup",
        transferOccurred: false,
        costBreakdown: {
          total_cents: 42,
          currency: "USD",
          granularity: "exact",
          line_items: [{ product: "voice_engine", cost_cents: 42, is_transfer_leg_cost: false }],
        },
      }),
    ).toBeTruthy();
  });

  it("rejects an unknown disconnectionReason", () => {
    expect(() =>
      zCallEndedEvent.parse({
        providerCallId: "call_abc123",
        startedAt: "2026-09-07T14:00:00Z",
        endedAt: "2026-09-07T14:03:12Z",
        durationSeconds: 192,
        disconnectionReason: "reticulated_splines",
        transferOccurred: false,
        costBreakdown: {
          total_cents: 0,
          currency: "USD",
          granularity: "exact",
          line_items: [],
        },
      }),
    ).toThrow();
  });
});
