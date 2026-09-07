import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  dynamicVariableOverridesSchemaForVertical,
  zAgentState,
  zAgentTemplate,
  zAgentTemplateRecord,
  zAutoOverrides,
  zCancellationPolicy,
  zCanonicalTool,
  zConsent,
  zDentalOverrides,
  zExtractionField,
  zGlobalIntent,
  zLegalOverrides,
  zMotelOverrides,
  zRestaurantOverrides,
  zStateId,
  zTransition,
  zVetOverrides,
} from "./agent-template.js";

// ---------------------------------------------------------------------------
// A minimal, valid template fixture reused across tests. Typed as the
// schema's (pre-transform) input shape so mutating a field to another
// legal-but-different variant (e.g. reachable_from: string[] instead of
// "any") doesn't fight object-literal type inference.
// ---------------------------------------------------------------------------

type TemplateInput = z.input<typeof zAgentTemplate>;
type StateInput = TemplateInput["states"][number];
type ToolInput = TemplateInput["tools"][number];

const greetingState: StateInput = {
  id: "greeting",
  name: "Greeting",
  prompt_fragment: "Greet the caller and ask how you can help.",
  allowed_tools: [],
};

const collectTimeState: StateInput = {
  id: "collect_time",
  name: "Collect time",
  prompt_fragment: "Ask what time works for drop-off.",
  allowed_tools: ["check_availability", "create_booking"],
  is_terminal: true,
};

const checkAvailabilityTool: ToolInput = {
  name: "check_availability",
  description: "Check open slots.",
  parameters: { type: "object" as const, properties: {}, required: [] },
  authorization: { scope: "none" as const },
};

const createBookingTool: ToolInput = {
  name: "create_booking",
  description: "Create a booking.",
  parameters: { type: "object" as const, properties: {}, required: [] },
  authorization: { scope: "none" as const },
};

function validTemplate(): TemplateInput {
  return {
    vertical: "auto",
    compile_target: "conversation_flow" as const,
    states: [greetingState, collectTimeState],
    transitions: [
      {
        from: "greeting",
        to: "collect_time",
        on: { intent: "wants_to_book" },
      },
    ],
    global_intents: [
      {
        name: "human_request",
        reachable_from: "any" as const,
        target_state: "collect_time",
        description: "Caller explicitly asks for a human.",
      },
    ],
    tools: [checkAvailabilityTool, createBookingTool],
    disclosure_line: "Thanks for calling, this is their AI assistant — this call may be recorded.",
  };
}

describe("zStateId", () => {
  it("accepts a lowercase slug", () => {
    expect(zStateId.parse("collect_time")).toBe("collect_time");
  });

  it("rejects uppercase/spaces", () => {
    expect(() => zStateId.parse("Collect Time")).toThrow();
  });
});

describe("zExtractionField", () => {
  it("accepts a non-enum field without enum_values", () => {
    expect(zExtractionField.parse({ field: "pain_level", type: "number" })).toMatchObject({
      field: "pain_level",
      type: "number",
    });
  });

  it("accepts an enum field with enum_values", () => {
    expect(
      zExtractionField.parse({
        field: "urgency",
        type: "enum",
        enum_values: ["low", "high"],
      }),
    ).toBeTruthy();
  });

  it("rejects an enum field with no enum_values", () => {
    expect(() => zExtractionField.parse({ field: "urgency", type: "enum" })).toThrow();
  });

  it("rejects an enum field with an empty enum_values array", () => {
    expect(() =>
      zExtractionField.parse({ field: "urgency", type: "enum", enum_values: [] }),
    ).toThrow();
  });
});

describe("zAgentState", () => {
  it("accepts a minimal valid state", () => {
    expect(
      zAgentState.parse({
        id: "greeting",
        name: "Greeting",
        prompt_fragment: "Say hello.",
        allowed_tools: [],
      }),
    ).toBeTruthy();
  });

  it("rejects a state missing prompt_fragment", () => {
    expect(() =>
      zAgentState.parse({ id: "greeting", name: "Greeting", allowed_tools: [] }),
    ).toThrow();
  });
});

describe("zTransition", () => {
  it("accepts a transition with only an intent condition", () => {
    expect(zTransition.parse({ from: "a", to: "b", on: { intent: "wants_to_book" } })).toBeTruthy();
  });

  it("accepts a transition with only a predicate condition", () => {
    expect(
      zTransition.parse({ from: "a", to: "b", on: { predicate: "slot_confirmed" } }),
    ).toBeTruthy();
  });

  it("rejects a transition whose `on` has neither intent nor predicate", () => {
    expect(() => zTransition.parse({ from: "a", to: "b", on: {} })).toThrow();
  });
});

describe("zGlobalIntent", () => {
  it("accepts reachable_from 'any'", () => {
    expect(
      zGlobalIntent.parse({
        name: "emergency",
        reachable_from: "any",
        target_state: "triage",
        description: "Red-flag escape.",
      }),
    ).toBeTruthy();
  });

  it("accepts reachable_from as a non-empty state-id list", () => {
    expect(
      zGlobalIntent.parse({
        name: "solicitor",
        reachable_from: ["greeting"],
        target_state: "deflect",
        description: "Polite deflect.",
      }),
    ).toBeTruthy();
  });

  it("rejects an empty reachable_from array", () => {
    expect(() =>
      zGlobalIntent.parse({
        name: "solicitor",
        reachable_from: [],
        target_state: "deflect",
        description: "x",
      }),
    ).toThrow();
  });
});

describe("zCanonicalTool", () => {
  it("accepts a well-formed tool definition", () => {
    expect(
      zCanonicalTool.parse({
        name: "lookup_customer",
        description: "Look up a customer by phone.",
        parameters: { type: "object", properties: { phone: { type: "string" } } },
        authorization: { scope: "caller_number" },
      }),
    ).toBeTruthy();
  });

  it("rejects an invalid authorization scope", () => {
    expect(() =>
      zCanonicalTool.parse({
        name: "transfer_call",
        description: "Transfer.",
        parameters: { type: "object" },
        authorization: { scope: "caller_supplied" },
      }),
    ).toThrow();
  });
});

describe("zAgentTemplate — structural cross-checks", () => {
  it("accepts a well-formed template", () => {
    const result = zAgentTemplate.parse(validTemplate());
    expect(result.states).toHaveLength(2);
    expect(result.global_intents[0]?.reachable_from).toBe("any");
  });

  it("rejects duplicate state ids", () => {
    const t = validTemplate();
    t.states = [...t.states, { ...greetingState }];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects duplicate tool names", () => {
    const t = validTemplate();
    t.tools = [...t.tools, { ...checkAvailabilityTool }];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects a state that allows an undeclared tool", () => {
    const t = validTemplate();
    t.states = [greetingState, { ...collectTimeState, allowed_tools: ["not_a_real_tool"] }];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects a transition referencing an unknown 'from' state", () => {
    const t = validTemplate();
    t.transitions = [{ from: "nonexistent", to: "collect_time", on: { intent: "x" } }];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects a transition referencing an unknown 'to' state", () => {
    const t = validTemplate();
    t.transitions = [{ from: "greeting", to: "nonexistent", on: { intent: "x" } }];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects a global_intent targeting an unknown state", () => {
    const t = validTemplate();
    t.global_intents = [
      { name: "emergency", reachable_from: "any", target_state: "nowhere", description: "x" },
    ];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects a global_intent reachable_from listing an unknown state", () => {
    const t = validTemplate();
    t.global_intents = [
      {
        name: "emergency",
        reachable_from: ["nowhere"],
        target_state: "collect_time",
        description: "x",
      },
    ];
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects single_prompt compile_target with no system_prompt", () => {
    const t = { ...validTemplate(), compile_target: "single_prompt" as const };
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("accepts single_prompt compile_target with a system_prompt and no states", () => {
    const t = {
      ...validTemplate(),
      compile_target: "single_prompt" as const,
      system_prompt: "You are a helpful assistant for a real estate agency.",
      states: [],
      transitions: [],
      global_intents: [],
    };
    expect(zAgentTemplate.parse(t)).toBeTruthy();
  });

  it("rejects a non-single-prompt template with zero states", () => {
    const t = { ...validTemplate(), states: [], transitions: [], global_intents: [] };
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });

  it("rejects an empty disclosure_line", () => {
    const t = { ...validTemplate(), disclosure_line: "" };
    expect(() => zAgentTemplate.parse(t)).toThrow();
  });
});

describe("zAgentTemplateRecord", () => {
  it("accepts a full DB row shape", () => {
    const record = {
      ...validTemplate(),
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "Auto v1",
      version: 1,
      system_prompt: null,
      voice_id: "11labs-Adrian",
      model: "gpt-4o-mini",
      is_active: true,
      created_by: null,
      created_at: "2026-09-07T00:00:00Z",
    };
    expect(zAgentTemplateRecord.parse(record)).toBeTruthy();
  });

  it("rejects a non-uuid id", () => {
    const record = {
      ...validTemplate(),
      id: "not-a-uuid",
      name: "Auto v1",
      version: 1,
      system_prompt: null,
      voice_id: "11labs-Adrian",
      model: "gpt-4o-mini",
      is_active: true,
      created_by: null,
      created_at: "2026-09-07T00:00:00Z",
    };
    expect(() => zAgentTemplateRecord.parse(record)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.5 per-vertical dynamic_variable_overrides
// ---------------------------------------------------------------------------

describe("zCancellationPolicy", () => {
  it("accepts a valid policy", () => {
    expect(
      zCancellationPolicy.parse({ window_hours: 24, fee_cents: 2500, text: "24hr notice" }),
    ).toBeTruthy();
  });

  it("rejects a negative window_hours", () => {
    expect(() => zCancellationPolicy.parse({ window_hours: -1, text: "x" })).toThrow();
  });
});

describe("per-vertical overrides", () => {
  it("dental accepts insurances_accepted", () => {
    expect(zDentalOverrides.parse({ insurances_accepted: ["Delta Dental", "Cigna"] })).toBeTruthy();
  });

  it("vet accepts species_treated + emergency_referral", () => {
    expect(
      zVetOverrides.parse({
        species_treated: ["dog", "cat"],
        emergency_referral: { name: "Metro Animal ER", phone: "+15551234567" },
      }),
    ).toBeTruthy();
  });

  it("vet rejects a non-E.164 emergency_referral phone", () => {
    expect(() =>
      zVetOverrides.parse({ emergency_referral: { name: "ER", phone: "555-1234" } }),
    ).toThrow();
  });

  it("auto accepts tow_partner + vehicle_makes_serviced", () => {
    expect(
      zAutoOverrides.parse({
        tow_partner: { name: "Joe's Towing", phone: "+15551234567" },
        vehicle_makes_serviced: ["Toyota", "Honda"],
      }),
    ).toBeTruthy();
  });

  it("legal accepts practice_areas + consult_fee_cents", () => {
    expect(
      zLegalOverrides.parse({ practice_areas: ["family", "criminal"], consult_fee_cents: 15000 }),
    ).toBeTruthy();
  });

  it("motel accepts deposit_policy + rate_table", () => {
    expect(
      zMotelOverrides.parse({
        deposit_policy: { required: true, amount_cents: 5000, text: "1 night deposit" },
        rate_table: [{ room_type: "Queen", nightly_rate_cents: 12500 }],
      }),
    ).toBeTruthy();
  });

  it("restaurant accepts delivery_radius_m + min_order_cents", () => {
    expect(
      zRestaurantOverrides.parse({ delivery_radius_m: 4000, min_order_cents: 1500 }),
    ).toBeTruthy();
  });

  it("all vertical schemas accept the shared base fields", () => {
    const base = {
      manager_name: "Pat",
      manager_phone: "+15551234567",
      parking_info: "Lot behind the building",
      accessibility_notes: "Ramp at side entrance",
      prep_time_minutes: 15,
      accepted_payment_types: ["visa", "mastercard"],
      cancellation_policy: { window_hours: 24, text: "24hr notice required" },
    };
    expect(zDentalOverrides.parse(base)).toBeTruthy();
    expect(zRestaurantOverrides.parse(base)).toBeTruthy();
  });

  it("dynamicVariableOverridesSchemaForVertical dispatches per vertical", () => {
    expect(
      dynamicVariableOverridesSchemaForVertical("restaurant").parse({ delivery_radius_m: 3000 }),
    ).toBeTruthy();
    // A field valid for one vertical is simply ignored (stripped) by another's schema — not an error;
    // the strictness that matters is that each vertical's OWN typed keys validate correctly.
    expect(dynamicVariableOverridesSchemaForVertical("generic").parse({})).toBeTruthy();
  });

  it("rejects an out-of-shape value for its vertical (wrong type)", () => {
    expect(() =>
      dynamicVariableOverridesSchemaForVertical("restaurant").parse({
        delivery_radius_m: "far",
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// MASTER_SPEC §3.6 consent shape
// ---------------------------------------------------------------------------

describe("zConsent", () => {
  it("accepts a valid consent record", () => {
    expect(
      zConsent.parse({
        sms: true,
        call: false,
        captured_at: "2026-09-07T14:00:00Z",
        call_id: "call_abc123",
      }),
    ).toBeTruthy();
  });

  it("rejects a missing captured_at", () => {
    expect(() => zConsent.parse({ sms: true, call: false, call_id: "call_abc123" })).toThrow();
  });

  it("rejects a non-ISO captured_at", () => {
    expect(() =>
      zConsent.parse({ sms: true, call: true, captured_at: "yesterday", call_id: "call_1" }),
    ).toThrow();
  });
});
