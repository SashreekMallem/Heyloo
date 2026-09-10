/**
 * Lowers every `AgentState.extraction[]` field declared across a template
 * (GAP_REGISTER §1.1 — "the single highest-leverage fix in the whole
 * audit") into Retell's agent-level `post_call_analysis_data` array.
 *
 * RETELL-VERIFY: confirmed field-for-field against `retell-sdk`'s
 * `AgentResponse.{String,Enum,Boolean,Number}AnalysisData` — this is an
 * AGENT field, not part of either flow-resource request body (conversation
 * flow / Retell LLM), which is why this lives alongside the other compile
 * targets but is attached separately in `agents.ts` (see
 * `CompiledAgentPayload.postCallAnalysisData`, types.ts).
 *
 * `voice-events/handler.ts`'s `handleCallAnalyzed` already reads
 * `call.call_analysis.custom_analysis_data["<field>"]` keyed by the exact
 * extraction field name (`classification`, `outcome`, `follow_up_needed`,
 * `legal_advice_given`, `emergency_detected`) — Retell populates
 * `custom_analysis_data` from each entry's `name`, which this function sets
 * to `field.field` verbatim, so no reader-side change was needed (no
 * FIX_REQUESTS entry filed for that file).
 */

import type { AgentTemplate, ExtractionField } from "@heyloo/canonical-types";
import type { RetellPostCallAnalysisField } from "./types.js";

function toRetellFieldType(
  type: Exclude<ExtractionField["type"], "enum">,
): "string" | "boolean" | "number" {
  // Canonical "text" -> Retell's "string" is the only name mismatch; the rest are identical.
  return type === "text" ? "string" : type;
}

function defaultDescription(field: ExtractionField, stateName: string): string {
  const humanized = field.field.replace(/_/g, " ");
  return `Extracted during the "${stateName}" step of the call: ${humanized}.`;
}

/**
 * Field names are deduplicated (first declaration across `template.states`
 * wins) — Retell requires `post_call_analysis_data` entries to be unique by
 * `name`, and a field like `legal_advice_given` (compiled onto every state
 * via `withLegalGuardrail`, GAP_REGISTER §1.1) is deliberately declared
 * identically on many states.
 */
export function compilePostCallAnalysisData(
  template: AgentTemplate,
): RetellPostCallAnalysisField[] {
  const byName = new Map<string, RetellPostCallAnalysisField>();

  for (const state of template.states) {
    for (const field of state.extraction ?? []) {
      if (byName.has(field.field)) continue;

      const description = field.description ?? defaultDescription(field, state.name);
      const base = { name: field.field, description, required: false };

      if (field.type === "enum") {
        byName.set(field.field, { ...base, type: "enum", choices: field.enum_values ?? [] });
      } else {
        byName.set(field.field, { ...base, type: toRetellFieldType(field.type) });
      }
    }
  }

  return [...byName.values()];
}
