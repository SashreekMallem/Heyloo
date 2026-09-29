import { createMicrosoftGraphEmailProvider, parseMsGraphEnv } from "./microsoft-graph.ts";
import { createResendEmailProvider } from "./resend.ts";
import { createSmtpEmailProvider, parseSmtpEnv } from "./smtp.ts";
import { createTelnyxSmsProvider } from "./telnyx.ts";
import { createTwilioSmsProvider } from "./twilio.ts";
import type {
  EmailProvider,
  EmailProviderId,
  MessagingFetch,
  SmsProvider,
  SmsProviderId,
} from "./types.ts";
import { isEmailProviderId, isSmsProviderId } from "./types.ts";

/** Provider-neutral name; `RESEND_FROM_ADDRESS` (the pre-existing name) is
 * still honored as a fallback so no deployed secret has to be renamed. */
export const EMAIL_FROM_ENV = "EMAIL_FROM_ADDRESS";

/**
 * Picks the provider for each message (docs/design/MESSAGING_PROVIDERS.md
 * "Choosing a provider"). Precedence for SMS, most specific first:
 *   1. the sending number's own provider (`messaging_senders.provider`) —
 *      a number can only be sent from the account that owns it;
 *   2. the tenant override (`tenants.sms_provider`);
 *   3. the platform default (`SMS_PROVIDER` env, default `telnyx`).
 * Email: tenant override (none stored yet) then `EMAIL_PROVIDER` (default
 * `resend`; `smtp` sends from the owner's own mailbox, MSG-3;
 * `microsoft_graph` sends from the owner's Microsoft 365 mailbox over HTTPS,
 * EMAIL-MSGRAPH).
 *
 * Fails CLOSED: a chosen provider whose secrets are missing resolves to
 * `provider_not_configured` (never a silent fallback to a different
 * vendor — the number belongs to one account), which the worker turns into
 * OPS-8's park-then-dead-letter behavior.
 */

export type ProviderSlot<P> =
  | { configured: true; provider: P }
  | { configured: false; missing: readonly string[] };

export type ProviderResolution<P> =
  | { ok: true; provider: P }
  | {
      ok: false;
      reason: "provider_not_configured" | "unknown_provider";
      providerId: string;
      missing: readonly string[];
    };

export interface MessagingRegistryConfig {
  smsDefault: string;
  emailDefault: string;
  sms: Partial<Record<SmsProviderId, ProviderSlot<SmsProvider>>>;
  email: Partial<Record<EmailProviderId, ProviderSlot<EmailProvider>>>;
  /** Email "from" address (e.g. `Heyloo <notifications@heyloo.app>`), on a
   * domain verified with the email provider. */
  emailFromAddress: string | null;
}

export interface MessagingRegistry {
  resolveSms(input?: {
    senderProvider?: string | null;
    tenantOverride?: string | null;
  }): ProviderResolution<SmsProvider>;
  resolveEmail(input?: { tenantOverride?: string | null }): ProviderResolution<EmailProvider>;
  /** Exact provider by id (webhook routing) — no default fallback. */
  smsProvider(id: string): ProviderResolution<SmsProvider>;
  readonly emailFromAddress: string | null;
  /** True when at least one SMS or email provider can send. */
  anyConfigured(): boolean;
  /** Every env var that is unset or invalid across all known providers (ops
   * logging): a bare name when unset, `NAME (why)` when its value is unusable. */
  missing(): string[];
  readonly smsDefault: string;
  readonly emailDefault: string;
}

function resolveSlot<P>(
  id: string,
  isKnown: (value: string) => boolean,
  slots: Partial<Record<string, ProviderSlot<P>>>,
): ProviderResolution<P> {
  if (!isKnown(id)) return { ok: false, reason: "unknown_provider", providerId: id, missing: [] };
  const slot = slots[id];
  if (!slot) {
    return { ok: false, reason: "provider_not_configured", providerId: id, missing: [] };
  }
  if (!slot.configured) {
    return { ok: false, reason: "provider_not_configured", providerId: id, missing: slot.missing };
  }
  return { ok: true, provider: slot.provider };
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    const trimmed = v?.trim().toLowerCase();
    if (trimmed) return trimmed;
  }
  return null;
}

export function createMessagingRegistry(config: MessagingRegistryConfig): MessagingRegistry {
  const smsSlots = config.sms as Partial<Record<string, ProviderSlot<SmsProvider>>>;
  const emailSlots = config.email as Partial<Record<string, ProviderSlot<EmailProvider>>>;
  const emailUsable = (slot: ProviderSlot<EmailProvider> | undefined) =>
    !!slot?.configured && !!config.emailFromAddress;

  return {
    smsDefault: config.smsDefault,
    emailDefault: config.emailDefault,
    emailFromAddress: config.emailFromAddress,

    resolveSms(input = {}) {
      const id = firstNonEmpty(input.senderProvider, input.tenantOverride, config.smsDefault) ?? "";
      return resolveSlot(id, isSmsProviderId, smsSlots);
    },

    resolveEmail(input = {}) {
      const id = firstNonEmpty(input.tenantOverride, config.emailDefault) ?? "";
      const resolution = resolveSlot(id, isEmailProviderId, emailSlots);
      if (resolution.ok && !config.emailFromAddress) {
        return {
          ok: false,
          reason: "provider_not_configured",
          providerId: id,
          missing: [EMAIL_FROM_ENV],
        };
      }
      return resolution;
    },

    smsProvider(id: string) {
      return resolveSlot(id.trim().toLowerCase(), isSmsProviderId, smsSlots);
    },

    anyConfigured() {
      const smsReady = Object.values(smsSlots).some((slot) => slot?.configured);
      const emailReady = Object.values(emailSlots).some((slot) => emailUsable(slot));
      return smsReady || emailReady;
    },

    missing() {
      const names = new Set<string>();
      for (const slot of [...Object.values(smsSlots), ...Object.values(emailSlots)]) {
        if (slot && !slot.configured) for (const name of slot.missing) names.add(name);
      }
      if (!config.emailFromAddress) names.add(EMAIL_FROM_ENV);
      return [...names].sort();
    },
  };
}

// ---------------------------------------------------------------------------
// Env wiring — portable (takes a getter, not `Deno.env`) so every edge
// function builds the registry identically and tests can drive it.
// ---------------------------------------------------------------------------

export type EnvGetter = (name: string) => string | undefined;

/** Env vars each adapter needs to SEND. Webhook-verification secrets that
 * are separate from the send credential (Telnyx public key) are checked per
 * request by the adapter itself, failing closed. */
export const PROVIDER_REQUIRED_ENV: Record<SmsProviderId | EmailProviderId, readonly string[]> = {
  telnyx: ["TELNYX_API_KEY"],
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
  resend: ["RESEND_API_KEY"],
  // SMTP_PORT is optional (default 465) but validated when set (`parseSmtpEnv`).
  smtp: ["SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD"],
  // Validated in full (GUID shapes, mailbox address) by `parseMsGraphEnv`;
  // the sending mailbox is the shared EMAIL_FROM_ADDRESS.
  microsoft_graph: ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"],
};

function slotFor<P>(
  env: EnvGetter,
  id: SmsProviderId | EmailProviderId,
  build: () => P,
): ProviderSlot<P> {
  const missing = PROVIDER_REQUIRED_ENV[id].filter((name) => !env(name));
  return missing.length > 0
    ? { configured: false, missing }
    : { configured: true, provider: build() };
}

export function buildMessagingRegistryFromEnv(
  env: EnvGetter,
  fetchImpl: MessagingFetch,
): MessagingRegistry {
  const value = (name: string) => env(name) ?? "";
  const sms: MessagingRegistryConfig["sms"] = {
    telnyx: slotFor(env, "telnyx", () =>
      createTelnyxSmsProvider({
        fetchImpl,
        apiKey: value("TELNYX_API_KEY"),
        ...(env("TELNYX_PUBLIC_KEY") ? { publicKey: value("TELNYX_PUBLIC_KEY") } : {}),
        ...(env("TELNYX_MESSAGING_PROFILE_ID")
          ? { messagingProfileId: value("TELNYX_MESSAGING_PROFILE_ID") }
          : {}),
      }),
    ),
    twilio: slotFor(env, "twilio", () =>
      createTwilioSmsProvider({
        fetchImpl,
        accountSid: value("TWILIO_ACCOUNT_SID"),
        authToken: value("TWILIO_AUTH_TOKEN"),
      }),
    ),
  };
  const smtp = parseSmtpEnv(env);
  const msGraph = parseMsGraphEnv(env);
  const email: MessagingRegistryConfig["email"] = {
    resend: slotFor(env, "resend", () =>
      createResendEmailProvider({ fetchImpl, apiKey: value("RESEND_API_KEY") }),
    ),
    smtp: smtp.ok
      ? { configured: true, provider: createSmtpEmailProvider({ config: smtp.config }) }
      : { configured: false, missing: smtp.missing },
    microsoft_graph: msGraph.ok
      ? {
          configured: true,
          provider: createMicrosoftGraphEmailProvider({ fetchImpl, config: msGraph.config }),
        }
      : { configured: false, missing: msGraph.missing },
  };
  return createMessagingRegistry({
    smsDefault: env("SMS_PROVIDER") || "telnyx",
    emailDefault: env("EMAIL_PROVIDER") || "resend",
    sms,
    email,
    emailFromAddress: env(EMAIL_FROM_ENV) || env("RESEND_FROM_ADDRESS") || null,
  });
}
