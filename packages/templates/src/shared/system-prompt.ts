/**
 * Composes a template's `system_prompt` (the conversation_flow/multi_prompt
 * `global_prompt`, or the single_prompt preamble — see each compiler's own
 * docstring in `packages/adapters/retell/src/compiler/`) from a
 * vertical-specific intro/persona paragraph plus the shared quality/
 * collection fragments every template must carry (BUILD task item 2) and
 * any extra vertical-specific fragments (e.g. legal's no-advice guardrail,
 * dental's PHI deferral).
 */

import { QUALITY_AND_COLLECTION_FRAGMENT } from "./fragments.js";

export function buildSystemPrompt(intro: string, ...extraFragments: string[]): string {
  return [intro, QUALITY_AND_COLLECTION_FRAGMENT, ...extraFragments].join("\n\n");
}
