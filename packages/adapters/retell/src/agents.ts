/**
 * Agent lifecycle (API_AND_FLOWS.md A.1 "Agent lifecycle: create / update /
 * delete agent" + "Conversation flow / LLM: create + publish version").
 *
 * This is a two-step provider protocol, not one call: (1) create/update the
 * underlying conversation-flow or retell-llm RESOURCE from the compiler's
 * output, getting back its id; (2) create/update the AGENT whose
 * `response_engine` references that id. `publishAgentVersion` is the
 * separate, later step that makes a version immutable (BACKEND_SPEC §1.3).
 * See raw-types.ts VERIFY-6/VERIFY-7 for shape-confidence notes.
 */

import {
  type CreateOrUpdateAgentInput,
  type CreateOrUpdateAgentResult,
  DisclosureGateError,
  type PublishAgentVersionInput,
  type PublishAgentVersionResult,
  VoiceProviderError,
} from "@heyloo/canonical-types";
import type { RetellClient } from "./client.js";
import type { CompiledAgentPayload } from "./compiler/index.js";
import {
  zRetellCreateOrUpdateAgentResponse,
  zRetellFlowResourceResponse,
  zRetellPublishAgentVersionResponse,
} from "./raw-types.js";

const FLOW_RESOURCE_ENDPOINT: Record<CompiledAgentPayload["flowRequest"]["kind"], string> = {
  conversation_flow: "/create-conversation-flow",
  multi_prompt: "/create-retell-llm",
  single_prompt: "/create-retell-llm",
};

/**
 * Create (or, when `existingProviderAgentId` is set, update) the Retell
 * agent for a compiled config. Refuses outright — never calls Retell at all
 * — when the compiler's disclosure-line publish gate did not pass
 * (BACKEND_SPEC §1.3, "a CI/publish gate, not just a code-review
 * convention").
 */
export async function createOrUpdateRetellAgent(
  client: RetellClient,
  input: CreateOrUpdateAgentInput,
  compiled: CompiledAgentPayload,
): Promise<CreateOrUpdateAgentResult> {
  if (!compiled.disclosureVerified) {
    throw new DisclosureGateError(input.tenantId, compiled.compileTarget);
  }

  // Step 1: create/update the underlying conversation-flow or retell-llm resource.
  const flowEndpoint = FLOW_RESOURCE_ENDPOINT[compiled.flowRequest.kind];
  const flowBody = { ...compiled.flowRequest.body, model: input.model };
  const flowRaw = await client.request("POST", flowEndpoint, flowBody);

  const flowParsed = zRetellFlowResourceResponse.safeParse(flowRaw);
  if (!flowParsed.success) {
    throw new VoiceProviderError(`retell ${flowEndpoint} returned an unexpected shape`, {
      code: "validation",
      provider: "retell",
      retryable: false,
      cause: flowParsed.error,
    });
  }
  const flowId = flowParsed.data.conversation_flow_id ?? flowParsed.data.llm_id;
  if (!flowId) {
    throw new VoiceProviderError(
      `retell ${flowEndpoint} response carried neither conversation_flow_id nor llm_id`,
      { code: "validation", provider: "retell", retryable: false },
    );
  }

  // Step 2: create/update the agent, pointing response_engine at that resource.
  const responseEngine =
    compiled.flowRequest.kind === "conversation_flow"
      ? { type: "conversation-flow" as const, conversation_flow_id: flowId }
      : { type: "retell-llm" as const, llm_id: flowId };

  const agentBody = {
    agent_name: `heyloo-${input.tenantId}`,
    voice_id: input.voiceId,
    response_engine: responseEngine,
    webhook_url: input.eventsWebhookUrl,
    // VERIFY-6 (raw-types.ts): confirm whether the inbound-call resolver
    // webhook is configured per-agent or per-phone-number in the current
    // API — wiring it here optimistically as a per-agent field.
    inbound_webhook_url: input.inboundWebhookUrl,
  };

  const agentRaw = input.existingProviderAgentId
    ? await client.request("PATCH", `/update-agent/${input.existingProviderAgentId}`, agentBody)
    : await client.request("POST", "/create-agent", agentBody);

  const agentParsed = zRetellCreateOrUpdateAgentResponse.safeParse(agentRaw);
  if (!agentParsed.success) {
    throw new VoiceProviderError("retell create/update-agent returned an unexpected shape", {
      code: "validation",
      provider: "retell",
      retryable: false,
      cause: agentParsed.error,
    });
  }

  return { providerAgentId: agentParsed.data.agent_id, providerLlmId: flowId };
}

export async function publishRetellAgentVersion(
  client: RetellClient,
  input: PublishAgentVersionInput,
): Promise<PublishAgentVersionResult> {
  const raw = await client.request(
    "POST",
    `/publish-agent-version/${input.providerAgentId}`,
    undefined,
  );

  const parsed = zRetellPublishAgentVersionResponse.safeParse(raw);
  if (!parsed.success) {
    throw new VoiceProviderError("retell publish-agent-version returned an unexpected shape", {
      code: "validation",
      provider: "retell",
      retryable: false,
      cause: parsed.error,
    });
  }

  return {
    providerAgentId: parsed.data.agent_id,
    version: parsed.data.version,
    publishedAt: new Date().toISOString(),
  };
}
