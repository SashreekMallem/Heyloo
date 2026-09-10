import { describe, expect, it } from "vitest";
import { ALLOWED_DYNAMIC_VARIABLES, lintPromptForInjectionSinks } from "./prompt-lint.js";

describe("ALLOWED_DYNAMIC_VARIABLES is schema-derived (GAP_REGISTER §1.6)", () => {
  it("includes base call-scoped variables from zAgentDynamicVariables", () => {
    expect(ALLOWED_DYNAMIC_VARIABLES.has("business_name")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("assistant_name")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("manager_name")).toBe(true);
  });

  it("includes per-vertical override fields, including derived _text/_name/_phone forms", () => {
    expect(ALLOWED_DYNAMIC_VARIABLES.has("species_treated")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("emergency_referral_name")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("emergency_referral_phone")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("tow_partner_name")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("tow_partner_phone")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("cancellation_policy_text")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("deposit_policy_text")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("consult_fee_text")).toBe(true);
    expect(ALLOWED_DYNAMIC_VARIABLES.has("menu_text")).toBe(true);
  });

  it("does not allow a raw override field name that the resolver actually derives (e.g. the raw *_cents field, not *_text)", () => {
    expect(ALLOWED_DYNAMIC_VARIABLES.has("consult_fee_cents")).toBe(false);
  });
});

describe("lintPromptForInjectionSinks", () => {
  it("flags a placeholder not on the schema-derived allowlist", () => {
    const findings = lintPromptForInjectionSinks("Hello {{caller_last_message}}.");
    expect(findings).toEqual([{ kind: "unknown_placeholder", match: "{{caller_last_message}}" }]);
  });

  it("allows every schema-derived dynamic variable", () => {
    const findings = lintPromptForInjectionSinks(
      "{{business_name}} refers pets to {{emergency_referral_name}} at {{emergency_referral_phone}}.",
    );
    expect(findings).toEqual([]);
  });

  it("flags a leftover JS template-literal interpolation", () => {
    const leak = "$" + "{businessName}";
    const findings = lintPromptForInjectionSinks(`Welcome to ${leak}.`);
    expect(findings).toEqual([{ kind: "template_literal_leak", match: "${" }]);
  });
});
