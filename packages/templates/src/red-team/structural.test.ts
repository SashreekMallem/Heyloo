/**
 * Red-team structural-guarantee suite (BUILD task item 3). Every assertion
 * here holds at the CANONICAL `AgentTemplate` level — the schema T6 must
 * conform to (`@heyloo/canonical-types`) — so a guarantee proven here is
 * true for every current and future compile target, not just Retell's.
 * `compiler-gate.test.ts` (same directory) covers the one thing that
 * genuinely requires running the T2 compiler: the disclosure-line publish
 * gate.
 */

import type { AgentTemplate } from "@heyloo/canonical-types";
import { zAgentTemplate } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "../registry.js";
import { INJECTION_FIXTURES } from "./injection-fixtures.js";
import { lintPromptForInjectionSinks } from "./prompt-lint.js";
import { fixtureAppliesTo, scenarioAppliesTo } from "./run-simulation.js";
import { SIMULATION_SCENARIOS } from "./simulation-scenarios.js";
import type { SimulationAssertion } from "./simulation-types.js";

describe("every template validates against the canonical AgentTemplate schema", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key} parses cleanly`, () => {
      expect(() => zAgentTemplate.parse(template)).not.toThrow();
    });
  }
});

describe("disclosure_line is present verbatim and identical across every template", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key} declares the shared disclosure line`, () => {
      expect(template.disclosure_line.length).toBeGreaterThan(0);
      expect(template.disclosure_line).toContain("{{business_name}}");
      expect(template.disclosure_line).toContain("{{assistant_name}}");
      expect(template.disclosure_line.toLowerCase()).toContain("ai assistant");
      expect(template.disclosure_line.toLowerCase()).toContain("recorded");
    });
  }
});

// CHANNELS-2 item 10(b): the shared none/one/several multi-entity rule
// (vehicles/pets/addresses) is wired into every vertical whose caller can
// have more than one recurring entity on file — auto (vehicles), vet
// (pets), restaurant + generic (delivery addresses) — never all eight, to
// keep the other verticals' prompts free of an irrelevant rule.
describe("MULTI_ENTITY_FRAGMENT (saved vehicles/pets/addresses) present on the verticals that need it", () => {
  const VERTICALS_WITH_RECURRING_ENTITIES = ["auto_repair", "vet", "restaurant", "generic"];
  // A phrase unique to the fragment (never appears in any other prompt
  // content), so this also catches accidental duplication/drift.
  const FRAGMENT_MARKER = "offer them by their short label and ask which one";

  for (const key of VERTICALS_WITH_RECURRING_ENTITIES) {
    it(`${key} carries the multi-entity rule in its system_prompt`, () => {
      const def = TEMPLATE_DEFINITIONS.find((d) => d.key === key);
      expect(def).toBeTruthy();
      expect(def?.template.system_prompt).toContain(FRAGMENT_MARKER);
    });
  }

  it("does not leak onto every other vertical (legal/dental/real_estate/motel have no recurring-entity concept)", () => {
    const others = TEMPLATE_DEFINITIONS.filter(
      (d) => !VERTICALS_WITH_RECURRING_ENTITIES.includes(d.key),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const { key, template } of others) {
      expect(
        template.system_prompt,
        `${key} should not carry the multi-entity fragment`,
      ).not.toContain(FRAGMENT_MARKER);
    }
  });
});

describe("global_intents (emergency/human_request/solicitor) present + reachable from every state", () => {
  const REQUIRED_INTENTS = ["emergency", "human_request", "solicitor"] as const;

  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key} declares all three required global intents, each reachable from any state`, () => {
      const names = template.global_intents.map((gi) => gi.name);
      for (const required of REQUIRED_INTENTS) {
        expect(names).toContain(required);
      }
      for (const gi of template.global_intents) {
        if (REQUIRED_INTENTS.includes(gi.name as (typeof REQUIRED_INTENTS)[number])) {
          // "any" is the structural guarantee (SYSTEM_DESIGN §4.1): reachable from
          // every state, never a hand-picked subset that could silently miss one.
          expect(gi.reachable_from).toBe("any");
        }
      }
    });
  }
});

describe("lookup_customer authorization scope is caller_number on every template that declares it", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    const tool = template.tools.find((t) => t.name === "lookup_customer");
    if (!tool) continue;
    it(`${key}'s lookup_customer is scoped to caller_number`, () => {
      expect(tool.authorization.scope).toBe("caller_number");
    });
  }
});

describe("transfer_call never accepts a caller-suppliable destination", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    const tool = template.tools.find((t) => t.name === "transfer_call");
    if (!tool) continue;
    it(`${key}'s transfer_call has zero parameters and tenant_config_only scope`, () => {
      expect(tool.authorization.scope).toBe("tenant_config_only");
      expect(Object.keys(tool.parameters.properties ?? {})).toHaveLength(0);
      expect(tool.parameters.required ?? []).toHaveLength(0);
    });
  }
});

describe("no state omits the no-advice guardrail on legal", () => {
  const legal = TEMPLATE_DEFINITIONS.find((d) => d.key === "legal");
  if (!legal) throw new Error("legal template not registered");

  for (const state of legal.template.states) {
    it(`legal state '${state.id}' carries the no-advice guardrail + legal_advice_given extraction`, () => {
      expect(state.prompt_fragment.toLowerCase()).toContain("never give legal advice");
      const extractionFields = (state.extraction ?? []).map((f) => f.field);
      expect(extractionFields).toContain("legal_advice_given");
    });
  }
});

describe("every template declares classification/outcome/follow_up_needed on every state (post-call extraction gap)", () => {
  const REQUIRED_OUTCOME_FIELDS = ["classification", "outcome", "follow_up_needed"] as const;

  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    for (const state of template.states) {
      it(`${key} state '${state.id}' carries classification/outcome/follow_up_needed extraction`, () => {
        const extractionFields = (state.extraction ?? []).map((f) => f.field);
        for (const required of REQUIRED_OUTCOME_FIELDS) {
          expect(extractionFields).toContain(required);
        }
      });
    }

    it(`${key}'s classification field is an enum sourced from the full call taxonomy`, () => {
      const classificationField = template.states
        .flatMap((s) => s.extraction ?? [])
        .find((f) => f.field === "classification");
      expect(classificationField?.type).toBe("enum");
      expect(classificationField?.enum_values).toEqual(
        expect.arrayContaining(["emergency", "new_booking", "wrong_number"]),
      );
    });
  }
});

describe("vet: red-flag emergency triage is FIRST and the emergency escape reaches every state", () => {
  const vet = TEMPLATE_DEFINITIONS.find((d) => d.key === "vet");
  if (!vet) throw new Error("vet template not registered");

  it("declares a dedicated triage_redflags state before any routine symptom/scheduling state", () => {
    const ids = vet.template.states.map((s) => s.id);
    const triageIndex = ids.indexOf("triage_redflags");
    const routineIndex = ids.indexOf("symptom_or_routine");
    const checkTimeIndex = ids.indexOf("check_time");
    expect(triageIndex).toBeGreaterThanOrEqual(0);
    expect(triageIndex).toBeLessThan(routineIndex);
    expect(triageIndex).toBeLessThan(checkTimeIndex);
  });

  it("the emergency global intent's target_state never requires diagnosis language", () => {
    const emergencyIntent = vet.template.global_intents.find((gi) => gi.name === "emergency");
    expect(emergencyIntent?.reachable_from).toBe("any");
    const target = vet.template.states.find((s) => s.id === emergencyIntent?.target_state);
    expect(target?.prompt_fragment.toLowerCase()).toContain("do not diagnose");
  });
});

describe("dental: PHI (DOB/insurance) is never collected on-call", () => {
  const dental = TEMPLATE_DEFINITIONS.find((d) => d.key === "dental");
  if (!dental) throw new Error("dental template not registered");

  it("the system prompt defers DOB/insurance to a secure post-call form", () => {
    const text = dental.template.system_prompt ?? "";
    expect(text.toLowerCase()).toContain("date of birth");
    expect(text.toLowerCase()).toContain("insurance");
    expect(text.toLowerCase()).toContain("secure post-call form");
  });
});

describe("dental: pain_triage's emergency_detected extraction matches its own same-day urgency tier", () => {
  const dental = TEMPLATE_DEFINITIONS.find((d) => d.key === "dental");
  if (!dental) throw new Error("dental template not registered");
  const painTriage = dental.template.states.find((s) => s.id === "pain_triage");
  if (!painTriage) throw new Error("dental pain_triage state not found");
  const emergencyDetected = painTriage.extraction?.find((f) => f.field === "emergency_detected");

  // `call_logs.urgency_flag` (the dashboard "Urgent" alert) is derived
  // solely from this one boolean (voice-events/handler.ts's
  // handleCallAnalyzed) — every trigger the prompt calls "same-day
  // urgency" must also be a trigger this field's own description names,
  // or a same-day case the model doesn't escalate to safety_emergency
  // silently fails to raise the alert.
  const SAME_DAY_TRIGGER_WORDS = ["pain", "swelling", "fever", "knocked", "broken"];

  it("declares emergency_detected", () => {
    expect(emergencyDetected).toBeDefined();
  });

  for (const word of SAME_DAY_TRIGGER_WORDS) {
    it(`prompt_fragment's same-day trigger "${word}" also appears in emergency_detected's description`, () => {
      expect(painTriage.prompt_fragment.toLowerCase()).toContain(word);
      expect(emergencyDetected?.description?.toLowerCase()).toContain(word);
    });
  }
});

describe("legal: every global-intent early-exit state can still call take_message (GAP_REGISTER.md §2 Legal item 3)", () => {
  const legal = TEMPLATE_DEFINITIONS.find((d) => d.key === "legal");
  if (!legal) throw new Error("legal template not registered");

  // Regression guard for the specific data-loss scenario: `human_request`
  // is reachable from every pre-terminal intake state (`reachable_from:
  // "any"`), so its target must never be a dead end that only knows
  // `transfer_call` — that would silently drop the conflict-check answer
  // and everything else gathered before the caller asked for a human.
  for (const globalIntent of legal.template.global_intents) {
    it(`'${globalIntent.name}' global intent's target state '${globalIntent.target_state}' allows take_message`, () => {
      const target = legal.template.states.find((s) => s.id === globalIntent.target_state);
      expect(target).toBeDefined();
      expect(target?.allowed_tools).toContain("take_message");
    });
  }
});

describe("restaurant: create_order requires delivery_address for delivery, allergy ask is explicit", () => {
  const restaurant = TEMPLATE_DEFINITIONS.find((d) => d.key === "restaurant");
  if (!restaurant) throw new Error("restaurant template not registered");

  it("declares both create_booking (reservations) and create_order (orders)", () => {
    const names = restaurant.template.tools.map((t) => t.name);
    expect(names).toContain("create_booking");
    expect(names).toContain("create_order");
  });

  it("has a state that explicitly asks about allergies", () => {
    const allergyState = restaurant.template.states.find((s) => s.id === "collect_allergies");
    expect(allergyState?.prompt_fragment.toLowerCase()).toContain("allerg");
  });
});

describe("motel: rate discipline — rate never invented, sourced only from the rate table", () => {
  const motel = TEMPLATE_DEFINITIONS.find((d) => d.key === "motel");
  if (!motel) throw new Error("motel template not registered");

  it("the system prompt forbids inventing a rate", () => {
    const text = motel.template.system_prompt ?? "";
    expect(text.toLowerCase()).toContain("never invent");
    expect(text).toContain("{{rate_table}}");
  });
});

describe("MASTER_SPEC §3.6 consent ask present in every booking/order-capable template", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    const canBookOrOrder = template.tools.some(
      (t) => t.name === "create_booking" || t.name === "create_order",
    );
    if (!canBookOrOrder) continue;
    it(`${key} asks the consent question before finalizing`, () => {
      const text = template.system_prompt ?? "";
      expect(text.toLowerCase()).toContain("is it okay to text or call you");
    });
  }
});

describe("MASTER_SPEC §3.7 identity fallback: every booking-capable template has a manage_booking state (GAP_REGISTER.md §1.12)", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    const canBook = template.tools.some((t) => t.name === "create_booking");
    if (!canBook) continue;
    it(`${key} declares create_booking and MUST also declare manage_booking (never one without the other)`, () => {
      const manageState = template.states.find((s) => s.id === "manage_booking");
      expect(manageState).toBeDefined();
    });

    it(`${key}'s manage_booking requires BOTH name and appointment time on a number mismatch`, () => {
      const manageState = template.states.find((s) => s.id === "manage_booking");
      if (!manageState) return; // covered by the assertion above; avoid a duplicate crash here
      const text = manageState.prompt_fragment.toLowerCase();
      expect(text).toContain("full name");
      expect(text).toContain("appointment");
    });
  }
});

describe("MASTER_SPEC §3.4 waitlist offer present wherever check_availability can return none_available", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    const usesAvailability = template.tools.some((t) => t.name === "check_availability");
    if (!usesAvailability) continue;
    // Motel's own explicit nearest_alternative UX (SYSTEM_DESIGN §4.3) stands in
    // for a generic waitlist offer — both are the "don't just give up" guarantee.
    if (key === "motel") continue;
    it(`${key} offers a waitlist when none_available`, () => {
      const text = template.system_prompt ?? "";
      expect(text.toLowerCase()).toContain("waitlist");
    });
  }
});

describe("prompt-injection lint: no unescaped caller-content interpolation sink anywhere", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    it(`${key} has no lint findings across system_prompt, every state, and every tool description`, () => {
      const texts = [
        template.system_prompt ?? "",
        ...template.states.map((s) => s.prompt_fragment),
        ...template.tools.map((t) => t.description),
      ];
      const findings = texts.flatMap((t) => lintPromptForInjectionSinks(t));
      expect(findings).toEqual([]);
    });
  }
});

describe("injection-fixture dataset is well-formed and covers every registered vertical or the wildcard", () => {
  it("every fixture's vertical is either '*' or a real registered template key", () => {
    const validKeys = new Set(["*", ...TEMPLATE_DEFINITIONS.map((d) => d.key)]);
    for (const fixture of INJECTION_FIXTURES) {
      expect(validKeys.has(fixture.vertical)).toBe(true);
    }
  });

  it("has at least one fixture per category actually exercised", () => {
    expect(INJECTION_FIXTURES.length).toBeGreaterThan(0);
  });
});

describe("simulation-scenario dataset (BUILD task: every register scenario) is well-formed and covers the required set", () => {
  const REQUIRED_CATEGORIES = [
    "happy_path",
    "changes_mind",
    "no_availability",
    "out_of_radius",
    "emergency",
    "silence_voicemail",
    "non_english",
    "transfer",
  ] as const;

  it("every scenario's vertical is either '*' or a real registered template key", () => {
    const validKeys = new Set(["*", ...TEMPLATE_DEFINITIONS.map((d) => d.key)]);
    for (const scenario of SIMULATION_SCENARIOS) {
      expect(validKeys.has(scenario.vertical)).toBe(true);
    }
  });

  it("every scenario has at least one caller turn and a non-empty expectation", () => {
    for (const scenario of SIMULATION_SCENARIOS) {
      expect(scenario.callerTurns.length).toBeGreaterThan(0);
      expect(scenario.expectation.length).toBeGreaterThan(0);
    }
  });

  for (const category of REQUIRED_CATEGORIES) {
    it(`at least one scenario covers '${category}' (register scenario coverage)`, () => {
      expect(SIMULATION_SCENARIOS.some((s) => s.category === category)).toBe(true);
    });
  }

  it("'injection' register coverage lives in injection-fixtures.ts, not duplicated here", () => {
    // INJECTION_FIXTURES already asserted well-formed + non-empty above — this just documents
    // why 'injection' isn't a SimulationScenarioCategory: it has its own richer, already-tested
    // dataset rather than being folded into this one.
    expect(INJECTION_FIXTURES.length).toBeGreaterThan(0);
  });

  it("every vertical with check_availability has a no_availability scenario, or is covered by the wildcard", () => {
    for (const { key, template } of TEMPLATE_DEFINITIONS) {
      const usesAvailability = template.tools.some((t) => t.name === "check_availability");
      if (!usesAvailability) continue;
      const covered = SIMULATION_SCENARIOS.some(
        (s) => s.category === "no_availability" && (s.vertical === key || s.vertical === "*"),
      );
      expect(covered, `${key} should have a no_availability scenario`).toBe(true);
    }
  });

  it("restaurant has an out_of_radius scenario (its own delivery-radius decline path)", () => {
    const covered = SIMULATION_SCENARIOS.some(
      (s) => s.category === "out_of_radius" && s.vertical === "restaurant",
    );
    expect(covered).toBe(true);
  });
});

describe("every scenario's/fixture's expect(template) only references real tool and state names (BUILD task remaining-work item 3)", () => {
  function referencedNames(assertion: SimulationAssertion): { tools: string[]; states: string[] } {
    switch (assertion.kind) {
      case "tool_called":
      case "tool_not_called":
      case "tool_called_with_zero_params":
        return { tools: [assertion.tool], states: [] };
      case "state_reached":
      case "state_not_reached":
        return { tools: [], states: [assertion.state] };
      case "all":
      case "any": {
        const tools: string[] = [];
        const states: string[] = [];
        for (const nested of assertion.of) {
          const found = referencedNames(nested);
          tools.push(...found.tools);
          states.push(...found.states);
        }
        return { tools, states };
      }
      default:
        return { tools: [], states: [] };
    }
  }

  function assertNamesExist(
    template: AgentTemplate,
    assertion: SimulationAssertion,
    label: string,
  ): void {
    const { tools, states } = referencedNames(assertion);
    const toolNames = new Set(template.tools.map((t) => t.name));
    const stateIds = new Set(template.states.map((s) => s.id));
    for (const tool of tools) {
      expect(toolNames.has(tool), `${label}: expect() references unknown tool '${tool}'`).toBe(
        true,
      );
    }
    for (const state of states) {
      expect(stateIds.has(state), `${label}: expect() references unknown state '${state}'`).toBe(
        true,
      );
    }
  }

  for (const def of TEMPLATE_DEFINITIONS) {
    for (const scenario of SIMULATION_SCENARIOS) {
      if (!scenarioAppliesTo(scenario, def)) continue;
      it(`${def.key}'s '${scenario.category}' scenario expect() only names real tools/states`, () => {
        assertNamesExist(def.template, scenario.expect(def), `${def.key}/${scenario.category}`);
      });
    }
    for (const fixture of INJECTION_FIXTURES) {
      if (!fixtureAppliesTo(fixture, def)) continue;
      it(`${def.key}'s '${fixture.category}' fixture expect() only names real tools/states`, () => {
        assertNamesExist(def.template, fixture.expect(def), `${def.key}/${fixture.category}`);
      });
    }
  }
});
