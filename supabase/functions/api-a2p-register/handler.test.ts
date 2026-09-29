import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { createMessagingRegistry } from "../_shared/providers/messaging/registry.ts";
import { createTelnyxSmsProvider } from "../_shared/providers/messaging/telnyx.ts";
import { createTwilioSmsProvider } from "../_shared/providers/messaging/twilio.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { A2pRegisterDeps } from "./handler.ts";
import { registerA2p } from "./handler.ts";

const logger = createLogger();

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Real Twilio messaging adapter over a fake fetch — the registration
 * requests must stay exactly what they were before MESSAGING-1. */
function makeDeps(fetchImpl: FetchImpl, overrides: Partial<A2pRegisterDeps> = {}): A2pRegisterDeps {
  return {
    registry: createMessagingRegistry({
      smsDefault: "twilio",
      emailDefault: "resend",
      sms: {
        twilio: {
          configured: true,
          provider: createTwilioSmsProvider({ fetchImpl, accountSid: "ACxxx", authToken: "token" }),
        },
      },
      email: {},
      emailFromAddress: null,
    }),
    brandRef: "BNxxx",
    privacyPolicyUrl: "https://heyloo.app/privacy",
    termsAndConditionsUrl: "https://heyloo.app/terms",
    logger,
    ...overrides,
  };
}

function sqlSequence(results: unknown[][]): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  let call = 0;
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    const result = results[call] ?? [];
    call += 1;
    return Promise.resolve(result);
  }) as SqlClient;
  return { sql, calls };
}

const PENDING_TENANT = {
  name: "Joe's Auto",
  vertical: "auto",
  a2p_status: "pending_verification",
  a2p_messaging_service_sid: null,
  a2p_campaign_sid: null,
  sms_provider: null,
};

describe("registerA2p", () => {
  it("returns 404 for an unknown tenant", async () => {
    const { sql } = sqlSequence([[]]);
    const result = await registerA2p(
      sql,
      "t1",
      undefined,
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 404, error: "tenant_not_found" });
  });

  it("short-circuits when already verified", async () => {
    const { sql } = sqlSequence([
      [
        {
          ...PENDING_TENANT,
          a2p_status: "verified",
          a2p_messaging_service_sid: "MG1",
          a2p_campaign_sid: "CU1",
        },
      ],
    ]);
    const result = await registerA2p(
      sql,
      "t1",
      undefined,
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: true, a2p_status: "verified", campaign_sid: "CU1" });
  });

  it("registers a new messaging service + campaign end to end when nothing exists yet", async () => {
    const { sql, calls } = sqlSequence([
      [PENDING_TENANT],
      [], // update a2p_messaging_service_sid
      [{ provider_number_id: "PN123" }], // provider-owned number lookup
      [], // update a2p_brand_sid/campaign_sid/status/sms_provider
    ]);
    const urls: string[] = [];
    const fetchImpl: FetchImpl = async (url, init) => {
      urls.push(url);
      if (url.includes("Compliance/Usa2p")) {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("BrandRegistrationSid")).toBe("BNxxx");
        expect(form.getAll("MessageSamples")).toHaveLength(2);
        return new Response(JSON.stringify({ sid: "CU999", campaignStatus: "PENDING" }), {
          status: 201,
        });
      }
      if (url.includes("PhoneNumbers")) {
        return new Response(JSON.stringify({ sid: "PN123" }), { status: 201 });
      }
      if (url.includes("/Services")) {
        return new Response(JSON.stringify({ sid: "MG999" }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    };
    const result = await registerA2p(sql, "t1", "register", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: true, a2p_status: "pending_verification", campaign_sid: "CU999" });
    expect(urls).toEqual([
      "https://messaging.twilio.com/v1/Services",
      "https://messaging.twilio.com/v1/Services/MG999/PhoneNumbers",
      "https://messaging.twilio.com/v1/Services/MG999/Compliance/Usa2p",
    ]);
    // Pins the tenant to the provider that holds the registration.
    const finalUpdate = calls[3];
    expect(finalUpdate?.text).toContain("sms_provider = coalesce(sms_provider,");
    expect(finalUpdate?.values).toContain("twilio");
    // Retell-native placeholders are never attached as provider numbers.
    expect(calls[2]?.text).toContain("not like 'retell-native:%'");
  });

  it("skips attaching a number when the tenant has no provider-owned number", async () => {
    const { sql } = sqlSequence([[PENDING_TENANT], [], [], []]);
    const urls: string[] = [];
    const fetchImpl: FetchImpl = async (url) => {
      urls.push(url);
      if (url.includes("Compliance/Usa2p")) {
        return new Response(JSON.stringify({ sid: "CU1", campaignStatus: "IN_PROGRESS" }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ sid: "MG1" }), { status: 201 });
    };
    const result = await registerA2p(sql, "t1", "register", makeDeps(fetchImpl));
    expect(result.ok).toBe(true);
    expect(urls.some((u) => u.includes("PhoneNumbers"))).toBe(false);
  });

  it("marks a2p_status failed when campaign creation fails", async () => {
    const { sql } = sqlSequence([[{ ...PENDING_TENANT, a2p_messaging_service_sid: "MG1" }], []]);
    const fetchImpl: FetchImpl = async () => new Response("{}", { status: 500 });
    const result = await registerA2p(sql, "t1", "register", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 502, error: "campaign_create_failed" });
  });

  it("refreshes an existing pending campaign and maps APPROVED to verified", async () => {
    const { sql } = sqlSequence([
      [{ ...PENDING_TENANT, a2p_messaging_service_sid: "MG1", a2p_campaign_sid: "CU1" }],
      [],
    ]);
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ campaignStatus: "APPROVED" }), { status: 200 });
    const result = await registerA2p(sql, "t1", "refresh", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: true, a2p_status: "verified", campaign_sid: "CU1" });
  });

  it("maps a DECLINED refresh to failed with a reason", async () => {
    const { sql, calls } = sqlSequence([
      [{ ...PENDING_TENANT, a2p_messaging_service_sid: "MG1", a2p_campaign_sid: "CU1" }],
      [],
    ]);
    const fetchImpl: FetchImpl = async () =>
      new Response(
        JSON.stringify({ campaignStatus: "DECLINED", failureReason: "invalid use case" }),
        { status: 200 },
      );
    const result = await registerA2p(sql, "t1", "refresh", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: true, a2p_status: "failed", campaign_sid: "CU1" });
    expect(calls[1]?.values).toContain("invalid use case");
  });

  it("returns not_yet_registered when refresh is requested before anything was registered", async () => {
    const { sql } = sqlSequence([[PENDING_TENANT]]);
    const result = await registerA2p(
      sql,
      "t1",
      "refresh",
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 422, error: "not_yet_registered" });
  });

  it("answers 503 (never crashes) when the tenant's provider has no secrets", async () => {
    const { sql } = sqlSequence([[PENDING_TENANT]]);
    const deps = makeDeps(async () => new Response("{}"), {
      registry: createMessagingRegistry({
        smsDefault: "twilio",
        emailDefault: "resend",
        sms: { twilio: { configured: false, missing: ["TWILIO_ACCOUNT_SID"] } },
        email: {},
        emailFromAddress: null,
      }),
    });
    const result = await registerA2p(sql, "t1", "register", deps);
    expect(result).toEqual({ ok: false, status: 503, error: "provider_not_configured" });
  });

  it("answers 501 for a provider whose registration is done outside the API (Telnyx)", async () => {
    const { sql } = sqlSequence([[{ ...PENDING_TENANT, sms_provider: "telnyx" }]]);
    const deps = makeDeps(async () => new Response("{}"), {
      registry: createMessagingRegistry({
        smsDefault: "twilio",
        emailDefault: "resend",
        sms: {
          telnyx: {
            configured: true,
            provider: createTelnyxSmsProvider({
              fetchImpl: async () => new Response("{}"),
              apiKey: "k",
            }),
          },
        },
        email: {},
        emailFromAddress: null,
      }),
    });
    const result = await registerA2p(sql, "t1", "register", deps);
    expect(result).toEqual({ ok: false, status: 501, error: "registration_not_automated" });
  });

  it("answers 503 when the brand/policy settings aren't configured", async () => {
    const { sql } = sqlSequence([[PENDING_TENANT]]);
    const result = await registerA2p(
      sql,
      "t1",
      "register",
      makeDeps(async () => new Response("{}"), { brandRef: null }),
    );
    expect(result).toEqual({ ok: false, status: 503, error: "registration_not_configured" });
  });
});
