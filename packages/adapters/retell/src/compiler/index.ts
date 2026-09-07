/**
 * `compileTemplate` — the single entry point lowering a canonical
 * `AgentTemplate` into a Retell payload for its declared `compile_target`
 * (BACKEND_SPEC §1.3, SYSTEM_DESIGN §4.1, API_AND_FLOWS.md A.1). Returns a
 * `CompiledAgentArtifact` (canonical-types) whose `providerPayload` is this
 * package's internal `CompiledAgentPayload` — opaque to every caller outside
 * this package (CLAUDE.md Rule 2), and consumed directly by `agents.ts`
 * within it.
 */

import type { AgentTemplate, CompiledAgentArtifact, CompileTarget } from "@heyloo/canonical-types";
import { compileConversationFlow } from "./conversation-flow.js";
import { verifyDisclosureGate } from "./disclosure-gate.js";
import { compileMultiPrompt } from "./multi-prompt.js";
import { compileSinglePrompt } from "./single-prompt.js";
import type { CompiledAgentPayload, RetellFlowRequest } from "./types.js";

export { verifyDisclosureGate } from "./disclosure-gate.js";
export type { CompiledAgentPayload, RetellFlowRequest } from "./types.js";

export function compileRetellTemplate(
  template: AgentTemplate,
  target: CompileTarget,
  toolWebhookUrl: string,
): CompiledAgentPayload {
  const flowRequest = buildFlowRequest(template, target, toolWebhookUrl);
  const disclosureVerified = verifyDisclosureGate(flowRequest, template.disclosure_line);

  return { compileTarget: target, disclosureVerified, flowRequest };
}

function buildFlowRequest(
  template: AgentTemplate,
  target: CompileTarget,
  toolWebhookUrl: string,
): RetellFlowRequest {
  switch (target) {
    case "conversation_flow":
      return { kind: "conversation_flow", body: compileConversationFlow(template, toolWebhookUrl) };
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
): CompiledAgentArtifact {
  const compiled = compileRetellTemplate(template, target, toolWebhookUrl);
  return {
    compileTarget: compiled.compileTarget,
    disclosureVerified: compiled.disclosureVerified,
    providerPayload: compiled,
  };
}
