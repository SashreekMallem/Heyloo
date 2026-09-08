/**
 * `POST /import-phone-number` (API_AND_FLOWS.md A.1 "Phone number: create vs
 * import" — we NEVER buy a Retell-managed number, always import a
 * Twilio-owned one; SYSTEM_DESIGN §3 anti-lock-in decision). See
 * raw-types.ts VERIFY-7 (resolved, RETELL-VERIFY) for the confirmed
 * `inbound_agents`/`outbound_agents` array shapes (both REQUIRE a `weight`
 * per entry) and for why `inbound_webhook_url` belongs here rather than on
 * the agent.
 */

import {
  type ImportPhoneNumberInput,
  type ImportPhoneNumberResult,
  VoiceProviderError,
} from "@heyloo/canonical-types";
import type { RetellClient } from "./client.js";
import { zRetellImportPhoneNumberResponse } from "./raw-types.js";

export async function importTwilioNumberIntoRetell(
  client: RetellClient,
  input: ImportPhoneNumberInput,
): Promise<ImportPhoneNumberResult> {
  const body = {
    phone_number: input.phoneNumberE164,
    termination_uri: input.terminationUri,
    // `weight` is REQUIRED per agent entry ("total weights must add up to
    // 1") — confirmed via retell-typescript-sdk's `PhoneNumberImportParams`.
    // This product never load-balances a number across multiple agents, so
    // a single entry always carries the full weight of 1.
    inbound_agents: [{ agent_id: input.inboundAgentId, weight: 1 }],
    ...(input.outboundAgentId !== undefined
      ? { outbound_agents: [{ agent_id: input.outboundAgentId, weight: 1 }] }
      : {}),
    ...(input.inboundWebhookUrl !== undefined
      ? { inbound_webhook_url: input.inboundWebhookUrl }
      : {}),
    ...(input.sipTrunkAuthUsername !== undefined
      ? { sip_trunk_auth_username: input.sipTrunkAuthUsername }
      : {}),
    ...(input.sipTrunkAuthPassword !== undefined
      ? { sip_trunk_auth_password: input.sipTrunkAuthPassword }
      : {}),
  };

  const raw = await client.request("POST", "/import-phone-number", body);

  const parsed = zRetellImportPhoneNumberResponse.safeParse(raw);
  if (!parsed.success) {
    throw new VoiceProviderError("retell import-phone-number returned an unexpected shape", {
      code: "validation",
      provider: "retell",
      retryable: false,
      cause: parsed.error,
    });
  }

  return { providerPhoneNumberId: parsed.data.phone_number };
}
