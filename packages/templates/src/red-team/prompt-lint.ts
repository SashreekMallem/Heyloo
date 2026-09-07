/**
 * Static lint for template-injection sinks in authored prompt text (BUILD
 * task item 3: "prompts contain no template-injection sinks (lint the
 * prompt fragments for unescaped caller-content interpolation)").
 *
 * Every prompt fragment in this package is a plain authored string; the
 * only "interpolation" mechanism at all is Retell's `{{dynamic_variable}}`
 * placeholder syntax, resolved server-side from `agent_configs.
 * dynamic_variable_overrides` (tenant-configured data) BEFORE the model
 * ever sees the prompt — never from live caller speech. This lint flags
 * two things that would indicate a real sink: (1) a leftover JS template-
 * literal `${...}` (a sign a string was built by interpolating something
 * at authoring time rather than staying a static constant), and (2) a
 * `{{...}}` placeholder whose name isn't on the known-safe allowlist of
 * tenant-configured dynamic variables — which would be the shape a
 * caller-content sink (e.g. a stray `{{caller_last_message}}`) would take.
 */

/** Every `{{name}}` placeholder actually used across the 8 templates + shared fragments — tenant-configured, never caller-supplied. */
export const ALLOWED_DYNAMIC_VARIABLES: ReadonlySet<string> = new Set([
  "business_name",
  "assistant_name",
  "manager_name",
  "manager_phone",
  "parking_info",
  "accessibility_notes",
  "cancellation_policy_text",
  "consult_fee_text",
  "deposit_policy_text",
  "emergency_referral_name",
  "emergency_referral_phone",
  "menu_text",
  "practice_areas",
  "rate_table",
  "species_treated",
  "tow_partner_name",
  "tow_partner_phone",
  "vehicle_makes_serviced",
]);

const TEMPLATE_LITERAL_LEAK = /\$\{/;
const MUSTACHE_PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export interface PromptLintFinding {
  kind: "template_literal_leak" | "unknown_placeholder";
  match: string;
}

export function lintPromptForInjectionSinks(text: string): PromptLintFinding[] {
  const findings: PromptLintFinding[] = [];

  if (TEMPLATE_LITERAL_LEAK.test(text)) {
    findings.push({ kind: "template_literal_leak", match: "${" });
  }

  for (const match of text.matchAll(MUSTACHE_PLACEHOLDER)) {
    const name = match[1];
    const full = match[0];
    if (name && !ALLOWED_DYNAMIC_VARIABLES.has(name)) {
      findings.push({ kind: "unknown_placeholder", match: full });
    }
  }

  return findings;
}
