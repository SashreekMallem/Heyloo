import { describe, expect, it, vi } from "vitest";
import { buildMessagingRegistryFromEnv, createMessagingRegistry } from "./registry.ts";
import type { EmailProvider, SmsProvider, SmsProviderId } from "./types.ts";

function sms(id: SmsProviderId): SmsProvider {
  return { id } as SmsProvider;
}
const email = { id: "resend" } as EmailProvider;

function registry(overrides: Partial<Parameters<typeof createMessagingRegistry>[0]> = {}) {
  return createMessagingRegistry({
    smsDefault: "telnyx",
    emailDefault: "resend",
    sms: {
      telnyx: { configured: true, provider: sms("telnyx") },
      twilio: { configured: true, provider: sms("twilio") },
    },
    email: { resend: { configured: true, provider: email } },
    emailFromAddress: "alerts@heyloo.app",
    ...overrides,
  });
}

describe("createMessagingRegistry — SMS selection", () => {
  it("uses the platform default when nothing more specific is set", () => {
    const r = registry().resolveSms();
    expect(r.ok && r.provider.id).toBe("telnyx");
  });

  it("tenant override beats the platform default", () => {
    const r = registry().resolveSms({ tenantOverride: "twilio" });
    expect(r.ok && r.provider.id).toBe("twilio");
  });

  it("the sending number's own provider beats the tenant override", () => {
    const r = registry().resolveSms({ senderProvider: "twilio", tenantOverride: "telnyx" });
    expect(r.ok && r.provider.id).toBe("twilio");
  });

  it("ignores blank overrides and normalizes case", () => {
    const r = registry({ smsDefault: "TWILIO" }).resolveSms({ tenantOverride: "  " });
    expect(r.ok && r.provider.id).toBe("twilio");
  });

  it("fails closed with provider_not_configured (never falls back to another vendor)", () => {
    const r = registry({
      sms: {
        telnyx: { configured: false, missing: ["TELNYX_API_KEY"] },
        twilio: { configured: true, provider: sms("twilio") },
      },
    }).resolveSms();
    expect(r).toEqual({
      ok: false,
      reason: "provider_not_configured",
      providerId: "telnyx",
      missing: ["TELNYX_API_KEY"],
    });
  });

  it("rejects an unknown provider id", () => {
    expect(registry().resolveSms({ tenantOverride: "carrier-pigeon" })).toMatchObject({
      ok: false,
      reason: "unknown_provider",
    });
    expect(registry().smsProvider("plivo")).toMatchObject({
      ok: false,
      reason: "unknown_provider",
    });
  });
});

describe("createMessagingRegistry — email + configuration summary", () => {
  it("email needs both the provider secret and a from address", () => {
    expect(registry().resolveEmail().ok).toBe(true);
    expect(registry({ emailFromAddress: null }).resolveEmail()).toMatchObject({
      ok: false,
      reason: "provider_not_configured",
      missing: ["EMAIL_FROM_ADDRESS"],
    });
  });

  it("anyConfigured is true with email alone and false with nothing", () => {
    const emailOnly = registry({
      sms: { telnyx: { configured: false, missing: ["TELNYX_API_KEY"] } },
    });
    expect(emailOnly.anyConfigured()).toBe(true);
    const none = registry({
      sms: { telnyx: { configured: false, missing: ["TELNYX_API_KEY"] } },
      email: { resend: { configured: false, missing: ["RESEND_API_KEY"] } },
    });
    expect(none.anyConfigured()).toBe(false);
    expect(none.missing()).toEqual(["RESEND_API_KEY", "TELNYX_API_KEY"]);
  });
});

describe("buildMessagingRegistryFromEnv", () => {
  const fetchImpl = vi.fn();

  it("defaults SMS to telnyx and email to resend, each needing its own secrets", () => {
    const env: Record<string, string> = { TELNYX_API_KEY: "k" };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    expect(r.smsDefault).toBe("telnyx");
    expect(r.emailDefault).toBe("resend");
    const resolved = r.resolveSms();
    expect(resolved.ok && resolved.provider.id).toBe("telnyx");
    expect(r.resolveSms({ tenantOverride: "twilio" })).toMatchObject({
      ok: false,
      missing: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
    });
  });

  it("switching the platform provider is one env var", () => {
    const env: Record<string, string> = {
      SMS_PROVIDER: "twilio",
      TWILIO_ACCOUNT_SID: "AC1",
      TWILIO_AUTH_TOKEN: "t",
      TELNYX_API_KEY: "k",
    };
    const resolved = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl).resolveSms();
    expect(resolved.ok && resolved.provider.id).toBe("twilio");
  });

  it("accepts the legacy RESEND_FROM_ADDRESS name for the email from address", () => {
    const env: Record<string, string> = { RESEND_API_KEY: "re", RESEND_FROM_ADDRESS: "a@b.co" };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    expect(r.emailFromAddress).toBe("a@b.co");
    expect(r.resolveEmail().ok).toBe(true);
  });
});

describe("buildMessagingRegistryFromEnv — SMTP email (MSG-3)", () => {
  const fetchImpl = vi.fn();
  const SMTP_ENV: Record<string, string> = {
    EMAIL_PROVIDER: "smtp",
    EMAIL_FROM_ADDRESS: "Heyloo <alerts@example.com>",
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USERNAME: "alerts@example.com",
    SMTP_PASSWORD: "abcdefghijklmnop",
  };

  it("EMAIL_PROVIDER=smtp selects the SMTP adapter; the port defaults to 465", () => {
    const r = buildMessagingRegistryFromEnv((n) => SMTP_ENV[n], fetchImpl);
    expect(r.emailDefault).toBe("smtp");
    const resolved = r.resolveEmail();
    expect(resolved.ok && resolved.provider.id).toBe("smtp");
    expect(r.anyConfigured()).toBe(true);
  });

  it("Resend stays the default, and stays unconfigured without its key, when SMTP is merely set", () => {
    const env: Record<string, string> = { ...SMTP_ENV, EMAIL_PROVIDER: "" };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    expect(r.resolveEmail()).toMatchObject({
      ok: false,
      reason: "provider_not_configured",
      providerId: "resend",
      missing: ["RESEND_API_KEY"],
    });
  });

  it("fails closed and names each missing SMTP variable (honest 'not configured')", () => {
    const env = { EMAIL_PROVIDER: "smtp", EMAIL_FROM_ADDRESS: "alerts@example.com" };
    const r = buildMessagingRegistryFromEnv((n) => (env as Record<string, string>)[n], fetchImpl);
    expect(r.resolveEmail()).toMatchObject({
      ok: false,
      reason: "provider_not_configured",
      providerId: "smtp",
      missing: ["SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD"],
    });
    expect(r.anyConfigured()).toBe(false);
  });

  it.each(["25", "587"])(
    "rejects SMTP_PORT=%s at configuration time with a clear error",
    (port) => {
      const env: Record<string, string> = { ...SMTP_ENV, SMTP_PORT: port };
      const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
      const resolved = r.resolveEmail();
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.missing).toEqual([
        expect.stringMatching(/^SMTP_PORT \(.*ports 25 and 587 are blocked.*465\)\)$/),
      ]);
      expect(r.missing().some((m) => m.startsWith("SMTP_PORT ("))).toBe(true);
      expect(r.anyConfigured()).toBe(false);
    },
  );

  it("still needs EMAIL_FROM_ADDRESS", () => {
    const env: Record<string, string> = { ...SMTP_ENV, EMAIL_FROM_ADDRESS: "" };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    expect(r.resolveEmail()).toMatchObject({ ok: false, missing: ["EMAIL_FROM_ADDRESS"] });
  });
});

describe("buildMessagingRegistryFromEnv — Microsoft Graph email (EMAIL-MSGRAPH)", () => {
  const fetchImpl = vi.fn();
  const GRAPH_ENV: Record<string, string> = {
    EMAIL_PROVIDER: "microsoft_graph",
    EMAIL_FROM_ADDRESS: "Heyloo <ms@heycuey.com>",
    MS_TENANT_ID: "11111111-2222-3333-4444-555555555555",
    MS_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    MS_CLIENT_SECRET: "a-secret-value",
  };

  it("EMAIL_PROVIDER=microsoft_graph selects the Graph adapter", () => {
    const r = buildMessagingRegistryFromEnv((n) => GRAPH_ENV[n], fetchImpl);
    expect(r.emailDefault).toBe("microsoft_graph");
    const resolved = r.resolveEmail();
    expect(resolved.ok && resolved.provider.id).toBe("microsoft_graph");
    expect(r.emailFromAddress).toBe("Heyloo <ms@heycuey.com>");
    expect(r.anyConfigured()).toBe(true);
  });

  it("fails closed and names each missing Graph variable", () => {
    const env: Record<string, string> = {
      EMAIL_PROVIDER: "microsoft_graph",
      EMAIL_FROM_ADDRESS: "ms@heycuey.com",
    };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    expect(r.resolveEmail()).toMatchObject({
      ok: false,
      reason: "provider_not_configured",
      providerId: "microsoft_graph",
      missing: ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET"],
    });
    expect(r.anyConfigured()).toBe(false);
  });

  it("an invalid id is reported as NAME (why), never with the secret", () => {
    const env: Record<string, string> = { ...GRAPH_ENV, MS_CLIENT_ID: "nope" };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    const resolved = r.resolveEmail();
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.missing).toEqual([expect.stringMatching(/^MS_CLIENT_ID \(/)]);
    expect(JSON.stringify(resolved)).not.toContain("a-secret-value");
  });

  it("Resend stays the default when Graph is merely configured", () => {
    const env: Record<string, string> = { ...GRAPH_ENV, EMAIL_PROVIDER: "" };
    const r = buildMessagingRegistryFromEnv((n) => env[n], fetchImpl);
    expect(r.resolveEmail()).toMatchObject({ ok: false, providerId: "resend" });
  });
});
