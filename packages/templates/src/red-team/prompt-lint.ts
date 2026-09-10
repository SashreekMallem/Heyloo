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

import {
  dynamicVariableOverridesSchemaForVertical,
  VERTICALS,
  verticalDetailsSchema,
  zAgentDynamicVariables,
} from "@heyloo/canonical-types";

/**
 * A raw override-schema field name isn't always the literal token name a
 * prompt uses — `voice-inbound`'s dynamic-variable resolver formats/derives
 * some fields (cents -> a "_text" string, a `{name,phone}` contact struct ->
 * two separate tokens) rather than speaking the raw stored value. Mirrors
 * `packages/adapters/retell/src/compiler/registry-consistency.test.ts`'s
 * identically-named function byte-for-byte (duplicated rather than imported
 * across the package boundary — importing `@heyloo/adapter-retell` here
 * would create the same circular package dependency that file's own
 * INTEGRATION NOTE documents avoiding) so a field rename/removal in
 * `agent-template.ts`/`vertical-details.ts` is caught here too, instead of
 * silently drifting from a second hand-maintained allowlist.
 */
function derivedTokensForField(fieldName: string): string[] {
  if (fieldName.endsWith("_cents")) {
    return [`${fieldName.slice(0, -"_cents".length)}_text`];
  }
  if (fieldName === "tow_partner" || fieldName === "emergency_referral") {
    return [`${fieldName}_name`, `${fieldName}_phone`];
  }
  if (fieldName === "cancellation_policy" || fieldName === "deposit_policy") {
    return [`${fieldName}_text`];
  }
  return [fieldName];
}

function computeAllowedDynamicVariables(): ReadonlySet<string> {
  const allowed = new Set<string>(Object.keys(zAgentDynamicVariables.shape));

  for (const vertical of VERTICALS) {
    const overridesSchema = dynamicVariableOverridesSchemaForVertical(vertical);
    const overridesShape = (overridesSchema as unknown as { shape: Record<string, unknown> }).shape;
    for (const field of Object.keys(overridesShape)) {
      for (const token of derivedTokensForField(field)) allowed.add(token);
    }
  }

  for (const field of Object.keys(verticalDetailsSchema.shape)) {
    for (const token of derivedTokensForField(field)) allowed.add(token);
  }

  return allowed;
}

/**
 * Every `{{name}}` placeholder a template is allowed to reference —
 * schema-derived (GAP_REGISTER §1.6) from `zAgentDynamicVariables` (base
 * call-scoped variables) plus every vertical's `z*Overrides`/
 * `verticalDetailsSchema` fields, rather than a second hand-maintained list
 * that could silently drift from the schema a field was renamed/removed in.
 */
export const ALLOWED_DYNAMIC_VARIABLES: ReadonlySet<string> = computeAllowedDynamicVariables();

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
