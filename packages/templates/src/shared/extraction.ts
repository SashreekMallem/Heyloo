/**
 * The three call-outcome extraction fields every template must carry
 * (GAP_REGISTER.md — post-call extraction gap: `classification`/`outcome`/
 * `follow_up_needed` compile into Retell's `post_call_analysis_data` for
 * EVERY template, not just vet/dental/legal's vertical-specific fields).
 *
 * `voice-events/handler.ts`'s `handleCallAnalyzed` already reads
 * `custom_analysis_data["classification"]` / `["outcome"]` /
 * `["follow_up_needed"]` verbatim and writes them to `call_logs` —
 * SYSTEM_DESIGN calls `classification` from `call_analyzed` "the
 * AUTHORITATIVE final classification" (`@heyloo/canonical-types`
 * `call-taxonomy.ts`), so it must be requested on every call regardless of
 * vertical or which state the call ends in. Applied the same way
 * `legal.ts`'s `withLegalGuardrail` applies `legal_advice_given` to every
 * state: `state.extraction[]` is deduplicated by `field` name across the
 * whole template (`packages/adapters/retell/src/compiler/extraction.ts`),
 * so declaring the identical field on every state is exactly the pattern
 * that mechanism expects, not redundant per-state authoring.
 */

import type { AgentState, ExtractionField } from "@heyloo/canonical-types";
import { CALL_CLASSIFICATIONS } from "@heyloo/canonical-types";

export const CALL_OUTCOME_EXTRACTION_FIELDS: readonly ExtractionField[] = [
  {
    field: "classification",
    type: "enum",
    enum_values: [...CALL_CLASSIFICATIONS],
    description:
      "The single best-fitting final classification for this entire call, chosen from the " +
      "full taxonomy regardless of which state the call ends in or started in — the " +
      "authoritative post-call classification, which may differ from how the call began if " +
      "the caller's need shifted mid-call (e.g. a routine booking call that turns out to " +
      "reveal an emergency).",
  },
  {
    field: "outcome",
    type: "text",
    description:
      "A short, plain-language summary of what was actually accomplished or decided on this " +
      'call (e.g. "booked a 2pm Tuesday appointment", "took a message for the owner to call ' +
      'back", "caller hung up before finishing intake").',
  },
  {
    field: "follow_up_needed",
    type: "boolean",
    description:
      "True if a staff member needs to follow up with the caller after this call for any " +
      "reason — an unresolved request, a message that needs a callback, or anything left " +
      "incomplete or unconfirmed.",
  },
];

/**
 * Splices the shared call-outcome fields onto one state's `extraction[]`,
 * preserving whatever vertical-specific fields (e.g. `emergency_detected`,
 * `legal_advice_given`) that state already declares. Every vertical
 * template maps its full `states[]` array through this so the fields are
 * present regardless of which state a given call ends in.
 */
export function withCallOutcomeExtraction(state: AgentState): AgentState {
  return {
    ...state,
    extraction: [...(state.extraction ?? []), ...CALL_OUTCOME_EXTRACTION_FIELDS],
  };
}
