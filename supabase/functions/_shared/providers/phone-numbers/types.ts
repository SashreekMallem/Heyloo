/**
 * Phone-number lifecycle port (NUMBERS-1). Jobs that release or re-route a
 * tenant's voice number (`job-offboarding`, `job-retell-health-failover`)
 * depend ONLY on the types here, never on a vendor's REST shape or on the
 * meaning of `phone_numbers.twilio_sid` (CLAUDE.md Rule 2, provider
 * isolation). Which adapter handles a number is decided from the canonical
 * `phone_numbers` row by `resolveNumberProviderId`.
 *
 * Two provisioning paths exist and both write `phone_numbers` rows:
 * - `retell-native`: the number was bought through Retell
 *   (`POST /create-phone-number`, api-provision) or is an existing Retell
 *   account number re-pointed at a tenant (api-admin-attach-retell-number).
 *   There is no Twilio resource on our side; `twilio_sid` is NULL or the
 *   `retell-native:<e164>` placeholder.
 * - `twilio`: a Twilio-owned number that is imported into Retell
 *   (`twilio_sid` = the real IncomingPhoneNumber SID, `PN...`).
 *
 * Deno cannot import `packages/adapters/*` (see providers/retell.ts), so the
 * port lives beside the other `_shared/providers` adapters, like messaging.
 */

export const NUMBER_PROVIDER_IDS = ["retell-native", "twilio"] as const;
export type NumberProviderId = (typeof NUMBER_PROVIDER_IDS)[number];

/** api-admin-attach-retell-number writes this prefix into `twilio_sid`
 * (the column was NOT NULL until 20260921065200). */
export const RETELL_NATIVE_SID_PREFIX = "retell-native:";

/** The canonical `phone_numbers` row, as the lifecycle jobs read it. */
export interface NumberRecord {
  id: string;
  tenantId: string;
  /** E.164; also Retell's own identifier for the number. */
  e164: string;
  twilioSid: string | null;
}

export function resolveNumberProviderId(record: Pick<NumberRecord, "twilioSid">): NumberProviderId {
  const sid = record.twilioSid?.trim() ?? "";
  if (sid === "" || sid.startsWith(RETELL_NATIVE_SID_PREFIX)) return "retell-native";
  return "twilio";
}

export type ReleaseFailureReason =
  | "retell_delete_failed"
  | "twilio_release_failed"
  | "twilio_not_configured"
  /** The number is bound to an agent this platform must never detach
   * (e.g. the shared demo agent) — refused before anything is deleted. */
  | "protected_agent_bound";

export type ReleaseResult =
  | {
      ok: true;
      /** True when the provider(s) no longer had the number (a retried run). */
      alreadyReleased: boolean;
    }
  | { ok: false; reason: ReleaseFailureReason; status: number };

export type FailoverSupport = { supported: true } | { supported: false; reason: string };

/** `token` is opaque to callers: whatever `restoreRouting` needs to put the
 * number back exactly as it was (persisted by the job, never interpreted). */
export type RoutingCapture = { ok: true; token: string } | { ok: false; status: number };
export type RoutingChange = { ok: true } | { ok: false; status: number };

export interface PhoneNumberProvider {
  readonly id: NumberProviderId;
  /** Whether calls to this number can be diverted away from Retell when
   * Retell is down. Retell-native numbers cannot (see retell-native.ts). */
  failoverSupport(): FailoverSupport;
  /** Idempotent: a number the provider no longer has counts as released. */
  release(number: NumberRecord): Promise<ReleaseResult>;
  captureRouting(number: NumberRecord): Promise<RoutingCapture>;
  divertRouting(number: NumberRecord, failoverUrl: string): Promise<RoutingChange>;
  restoreRouting(number: NumberRecord, token: string): Promise<RoutingChange>;
}
