/**
 * `/voice/inbound` support (BACKEND_SPEC §7.1, API_AND_FLOWS.md A.1 "Inbound
 * webhook"). Signature verification is a SEPARATE step (`verifyWebhookSignature`,
 * shared across all three webhook types) the caller (T3's edge function) runs
 * first — these two functions are parse-only / build-only, matching the
 * `VoiceProvider` interface split.
 */

import {
  type AgentDynamicVariables,
  type InboundCallContext,
  type InboundCallResolution,
  PayloadValidationError,
  zE164,
} from "@heyloo/canonical-types";
import {
  type RetellInboundCallResponse,
  zRetellInboundCallResponse,
  zRetellInboundCallWebhook,
} from "./raw-types.js";

export function resolveRetellInboundCall(rawBody: string): InboundCallContext {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (cause) {
    throw new PayloadValidationError("retell", "inbound call webhook: invalid JSON", cause);
  }

  const parsed = zRetellInboundCallWebhook.safeParse(json);
  if (!parsed.success) {
    throw new PayloadValidationError("retell", "inbound call webhook", parsed.error);
  }

  const from = zE164.safeParse(parsed.data.from_number);
  const to = zE164.safeParse(parsed.data.to_number);
  if (!from.success || !to.success) {
    throw new PayloadValidationError(
      "retell",
      "inbound call webhook: from_number/to_number must be E.164",
      { from: parsed.data.from_number, to: parsed.data.to_number },
    );
  }

  const context: InboundCallContext = {
    providerCallId: parsed.data.call_id,
    fromNumberE164: from.data,
    toNumberE164: to.data,
  };
  if (parsed.data.agent_id !== undefined) {
    context.providerAgentId = parsed.data.agent_id;
  }
  return context;
}

export function buildRetellInboundResponse(
  resolution: InboundCallResolution,
): RetellInboundCallResponse {
  const dynamicVariables: AgentDynamicVariables = resolution.dynamicVariables;

  const body: RetellInboundCallResponse = {
    call_inbound: {
      // AgentDynamicVariables is a closed, fully-typed shape upstream; the
      // wire response just needs a plain string-keyed record.
      dynamic_variables: dynamicVariables as unknown as Record<string, unknown>,
    },
  };
  if (resolution.overrideAgentId !== undefined) {
    body.call_inbound.override_agent_id = resolution.overrideAgentId;
  }

  // Validate our OWN outbound shape before returning it — catches a future
  // accidental drift between AgentDynamicVariables and what we promise Retell.
  return zRetellInboundCallResponse.parse(body);
}
