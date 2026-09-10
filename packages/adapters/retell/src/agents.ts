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
import { zRetellCreateOrUpdateAgentResponse, zRetellFlowResourceResponse } from "./raw-types.js";

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
  // VERIFY-8 (resolved, RETELL-VERIFY): confirmed via
  // retell-typescript-sdk's src/resources/conversation-flow.ts that
  // `ConversationFlowCreateParams` takes a REQUIRED nested
  // `model_choice: {model, type: "cascading", high_priority?}` object, NOT a
  // flat `model` string — unlike `LlmCreateParams` (multi_prompt/
  // single_prompt), which DOES keep `model` flat and optional. The two flow
  // kinds are not wire-compatible here; branch accordingly.
  const flowBody =
    compiled.flowRequest.kind === "conversation_flow"
      ? { ...compiled.flowRequest.body, model_choice: { model: input.model, type: "cascading" } }
      : { ...compiled.flowRequest.body, model: input.model };
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
    // The inbound-call resolver webhook is NOT an agent field at all —
    // VERIFY-6 (resolved, RETELL-VERIFY): confirmed via retell-typescript-sdk
    // that `inbound_webhook_url` only exists on the PhoneNumber resource.
    // It's wired in `importTwilioNumberIntoRetell` (numbers.ts) instead.
    webhook_url: input.eventsWebhookUrl,
    // LIVE-MINE-FIXES (docs/BUILD_NOTES.md LIVE-MINE-EDGE item 2): legacy's
    // live create_agent always paired webhook_url with an explicit
    // webhook_timeout_ms rather than relying on Retell's undocumented
    // default — cheap, free knob, kept configurable via the input type.
    webhook_timeout_ms: input.webhookTimeoutMs ?? 10000,
    // GAP_REGISTER §1.1: confirmed via retell-typescript-sdk that
    // `post_call_analysis_data` is an AGENT field (not part of either flow
    // resource body) — every shipped template's `AgentState.extraction[]`
    // reaches Retell here, never previously sent at all. Omitted entirely
    // (rather than `[]`) when a template declares no extraction fields, to
    // avoid clobbering anything Retell defaults for an absent key.
    ...(compiled.postCallAnalysisData.length > 0
      ? { post_call_analysis_data: compiled.postCallAnalysisData }
      : {}),
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

  return {
    providerAgentId: agentParsed.data.agent_id,
    providerLlmId: flowId,
    version: agentParsed.data.version,
  };
}

/**
 * VERIFY-6 (resolved, RETELL-VERIFY): `POST /publish-agent-version/{id}`
 * REQUIRES a `{version: number, ...}` body (confirmed via
 * `retell-typescript-sdk`'s `AgentPublishParams` — there is no "publish
 * whatever's latest draft" shorthand) and returns `void` (confirmed via
 * `Agent.publish`'s own return type) — no response body to parse. The
 * caller must supply `input.version` (from `CreateOrUpdateAgentResult`, or a
 * fresh `GET /get-agent/{id}` for an agent this process didn't just
 * create/update).
 */
export async function publishRetellAgentVersion(
  client: RetellClient,
  input: PublishAgentVersionInput,
): Promise<PublishAgentVersionResult> {
  await client.request("POST", `/publish-agent-version/${input.providerAgentId}`, {
    version: input.version,
  });

  return {
    providerAgentId: input.providerAgentId,
    version: input.version,
    publishedAt: new Date().toISOString(),
  };
}
