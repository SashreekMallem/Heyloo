/**
 * Outbound calling (GAP_REGISTER Cluster A item 6 — reminders/reactivation/
 * reschedule-offer outbound calling; `CreateOutboundCallInput`/`Result` are
 * canonical, `@heyloo/canonical-types/voice-provider.js`).
 *
 * RETELL-VERIFY: confirmed via `retell-sdk`'s `Call.createPhoneCall` that
 * the endpoint is `POST /v2/create-phone-call` (the `/v2` prefix, unlike
 * `/create-agent` elsewhere in this package — `raw-types.ts` header) and
 * takes `{from_number, to_number, override_agent_id?,
 * retell_llm_dynamic_variables?, metadata?}`.
 *
 * Wired onto `RetellProvider.createOutboundCall` (`provider.ts`), which
 * delegates to this module (per `docs/audit/FIX_REQUESTS.md`) — this
 * module remains the complete, independently testable Retell
 * implementation.
 */

import {
  type CreateOutboundCallInput,
  type CreateOutboundCallResult,
  VoiceProviderError,
} from "@heyloo/canonical-types";
import type { RetellClient } from "./client.js";
import { zRetellCreatePhoneCallResponse } from "./raw-types.js";

const CREATE_PHONE_CALL_PATH = "/v2/create-phone-call";

/**
 * Places an outbound call. Fails CLOSED (never calls Retell) when
 * `input.dynamicVariables.disclosure_line` is missing or blank — an
 * outbound call has no compiled-in first turn the way an inbound template
 * does (`disclosure-gate.ts`'s publish gate only covers inbound), so this
 * function is the enforcement point for that call instead (G1/G2: the AI +
 * recording disclosure is non-negotiable on every call, inbound or
 * outbound).
 *
 * `input.fromNumberE164` MUST already be a number this tenant owns — that
 * check happens in the CALLER (this adapter has no tenant/DB context,
 * CLAUDE.md Rule 2); this function does not and cannot verify it.
 */
export async function createRetellOutboundCall(
  client: RetellClient,
  input: CreateOutboundCallInput,
): Promise<CreateOutboundCallResult> {
  if (
    !input.dynamicVariables.disclosure_line ||
    input.dynamicVariables.disclosure_line.trim() === ""
  ) {
    throw new VoiceProviderError(
      "refusing to place outbound call: dynamicVariables.disclosure_line is missing/empty (G1/G2)",
      { code: "validation", provider: "retell", retryable: false },
    );
  }

  const body = {
    from_number: input.fromNumberE164,
    to_number: input.toNumberE164,
    override_agent_id: input.providerAgentId,
    retell_llm_dynamic_variables: input.dynamicVariables,
    metadata: { consent_ref: input.consentRef },
  };

  const raw = await client.request("POST", CREATE_PHONE_CALL_PATH, body);
  const parsed = zRetellCreatePhoneCallResponse.safeParse(raw);
  if (!parsed.success) {
    throw new VoiceProviderError(`retell ${CREATE_PHONE_CALL_PATH} returned an unexpected shape`, {
      code: "validation",
      provider: "retell",
      retryable: false,
      cause: parsed.error,
    });
  }

  return { providerCallId: parsed.data.call_id };
}
