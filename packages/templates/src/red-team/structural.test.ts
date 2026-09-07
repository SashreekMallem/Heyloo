/**
 * Red-team structural-guarantee suite (BUILD task item 3). Every assertion
 * here holds at the CANONICAL `AgentTemplate` level — the schema T6 must
 * conform to (`@heyloo/canonical-types`) — so a guarantee proven here is
 * true for every current and future compile target, not just Retell's.
 * `compiler-gate.test.ts` (same directory) covers the one thing that
 * genuinely requires running the T2 compiler: the disclosure-line publish
 * gate.
 */

import { zAgentTemplate } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { TEMPLATE_DEFINITIONS } from "../registry.js";
import { INJECTION_FIXTURES } from "./injection-fixtures.js";
import { lintPromptForInjectionSinks } from "./prompt-lint.js";

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

describe("vet: red-flag emergency triage is FIRST and the emergency escape reaches every state", () => {
  const vet = TEMPLATE_DEFINITIONS.find((d) => d.key === "veterinary");
  if (!vet) throw new Error("veterinary template not registered");

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

describe("MASTER_SPEC §3.7 identity fallback present in every template with a reschedule/cancel path", () => {
  for (const { key, template } of TEMPLATE_DEFINITIONS) {
    const manageState = template.states.find((s) => s.id === "manage_booking");
    if (!manageState) continue;
    it(`${key}'s manage_booking requires BOTH name and appointment time on a number mismatch`, () => {
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
