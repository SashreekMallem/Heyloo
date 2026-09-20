/**
 * `compileTemplate` — the single entry point lowering a canonical
 * `AgentTemplate` into a Retell payload for its declared `compile_target`
 * (BACKEND_SPEC §1.3, SYSTEM_DESIGN §4.1, API_AND_FLOWS.md A.1). Returns a
 * `CompiledAgentArtifact` (canonical-types) whose `providerPayload` is this
 * package's internal `CompiledAgentPayload` — opaque to every caller outside
 * this package (CLAUDE.md Rule 2), and consumed directly by `agents.ts`
 * within it.
 */

import type {
  AgentTemplate,
  CompiledAgentArtifact,
  CompileTarget,
  CompileTemplateOptions,
} from "@heyloo/canonical-types";
import { compileConversationFlow } from "./conversation-flow.js";
import { verifyDisclosureGate } from "./disclosure-gate.js";
import { compilePostCallAnalysisData } from "./extraction.js";
import { compileMultiPrompt } from "./multi-prompt.js";
import { compileSinglePrompt } from "./single-prompt.js";
import type { CompiledAgentPayload, RetellFlowRequest } from "./types.js";

export { verifyDisclosureGate } from "./disclosure-gate.js";
export { compilePostCallAnalysisData } from "./extraction.js";
export type {
  CompiledAgentPayload,
  RetellFlowRequest,
  RetellPostCallAnalysisField,
} from "./types.js";

/**
 * OPS-5 (docs/BUILD_NOTES.md): `options` is the same optional tenant-config
 * compile input `VoiceProvider.compileTemplate` now carries
 * (`@heyloo/canonical-types`) — threaded straight through to
 * `compileConversationFlow`'s own already-existing `transferNumber` option
 * (this file's `buildFlowRequest`, `conversation_flow` target only;
 * `multi_prompt`/`single_prompt` have no transfer-call node concept, so
 * they simply ignore it). Optional and additive — every existing 3-arg
 * call keeps compiling exactly as it always has.
 */
export function compileRetellTemplate(
  template: AgentTemplate,
  target: CompileTarget,
  toolWebhookUrl: string,
  options: CompileTemplateOptions = {},
): CompiledAgentPayload {
  const flowRequest = buildFlowRequest(template, target, toolWebhookUrl, options);
  const disclosureVerified = verifyDisclosureGate(flowRequest, template.disclosure_line);
  const postCallAnalysisData = compilePostCallAnalysisData(template);

  return { compileTarget: target, disclosureVerified, flowRequest, postCallAnalysisData };
}

function buildFlowRequest(
  template: AgentTemplate,
  target: CompileTarget,
  toolWebhookUrl: string,
  options: CompileTemplateOptions,
): RetellFlowRequest {
  switch (target) {
    case "conversation_flow":
      return {
        kind: "conversation_flow",
        body: compileConversationFlow(template, toolWebhookUrl, {
          transferNumber: options.transferNumber ?? null,
        }),
      };
    case "multi_prompt":
      return { kind: "multi_prompt", body: compileMultiPrompt(template, toolWebhookUrl) };
    case "single_prompt":
      return { kind: "single_prompt", body: compileSinglePrompt(template, toolWebhookUrl) };
  }
}

/** Adapts `compileRetellTemplate`'s package-internal result to the canonical `VoiceProvider.compileTemplate` contract. */
export function compileTemplateArtifact(
  template: AgentTemplate,
  target: CompileTarget,
  toolWebhookUrl: string,
  options?: CompileTemplateOptions,
): CompiledAgentArtifact {
  const compiled = compileRetellTemplate(template, target, toolWebhookUrl, options);
  return {
    compileTarget: compiled.compileTarget,
    disclosureVerified: compiled.disclosureVerified,
    providerPayload: compiled,
  };
}
