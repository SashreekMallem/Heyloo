/**
 * `POST /import-phone-number` (API_AND_FLOWS.md A.1 "Phone number: create vs
 * import" — we NEVER buy a Retell-managed number, always import a
 * Twilio-owned one; SYSTEM_DESIGN §3 anti-lock-in decision). See
 * raw-types.ts VERIFY-7 for the confirmed `inbound_agents` array shape.
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
    inbound_agents: [{ agent_id: input.inboundAgentId }],
    ...(input.outboundAgentId !== undefined ? { outbound_agent_id: input.outboundAgentId } : {}),
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
