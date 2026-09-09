import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { registerA2p } from "./handler.ts";

const logger = createLogger();

function makeDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return {
    twilioFetch: fetchImpl as never,
    twilioAccountSid: "ACxxx",
    twilioAuthToken: "token",
    platformBrandSid: "BNxxx",
    privacyPolicyUrl: "https://heyloo.app/privacy",
    termsAndConditionsUrl: "https://heyloo.app/terms",
    logger,
  };
}

function sqlSequence(results: unknown[][]): SqlClient {
  let call = 0;
  return (() => {
    const result = results[call] ?? [];
    call += 1;
    return Promise.resolve(result);
  }) as SqlClient;
}

describe("registerA2p", () => {
  it("returns 404 for an unknown tenant", async () => {
    const sql = sqlSequence([[]]);
    const result = await registerA2p(
      sql,
      "t1",
      undefined,
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 404, error: "tenant_not_found" });
  });

  it("short-circuits when already verified", async () => {
    const sql = sqlSequence([
      [
        {
          name: "Joe",
          vertical: "auto",
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
    const sql = sqlSequence([
      [
        {
          name: "Joe's Auto",
          vertical: "auto",
          a2p_status: "pending_verification",
          a2p_messaging_service_sid: null,
          a2p_campaign_sid: null,
        },
      ],
      [], // update a2p_messaging_service_sid
      [{ twilio_sid: "PN123" }], // phone number lookup
      [], // update a2p_brand_sid/campaign_sid/status
    ]);
    let callCount = 0;
    const fetchImpl = async (url: string) => {
      callCount += 1;
      if (url.includes("Compliance/Usa2p")) {
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
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("marks a2p_status failed when campaign creation fails", async () => {
    const sql = sqlSequence([
      [
        {
          name: "Joe's Auto",
          vertical: "auto",
          a2p_status: "pending_verification",
          a2p_messaging_service_sid: "MG1",
          a2p_campaign_sid: null,
        },
      ],
      [], // update failed status
    ]);
    const fetchImpl = async () => new Response("{}", { status: 500 });
    const result = await registerA2p(sql, "t1", "register", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 502, error: "campaign_create_failed" });
  });

  it("refreshes an existing pending campaign and maps APPROVED to verified", async () => {
    const sql = sqlSequence([
      [
        {
          name: "Joe's Auto",
          vertical: "auto",
          a2p_status: "pending_verification",
          a2p_messaging_service_sid: "MG1",
          a2p_campaign_sid: "CU1",
        },
      ],
      [], // update tenants
    ]);
    const fetchImpl = async () =>
      new Response(JSON.stringify({ campaignStatus: "APPROVED" }), { status: 200 });
    const result = await registerA2p(sql, "t1", "refresh", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: true, a2p_status: "verified", campaign_sid: "CU1" });
  });

  it("maps a DECLINED refresh to failed with a reason", async () => {
    const sql = sqlSequence([
      [
        {
          name: "Joe's Auto",
          vertical: "auto",
          a2p_status: "pending_verification",
          a2p_messaging_service_sid: "MG1",
          a2p_campaign_sid: "CU1",
        },
      ],
      [],
    ]);
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ campaignStatus: "DECLINED", failureReason: "invalid use case" }),
        {
          status: 200,
        },
      );
    const result = await registerA2p(sql, "t1", "refresh", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: true, a2p_status: "failed", campaign_sid: "CU1" });
  });

  it("returns not_yet_registered when refresh is requested before anything was registered", async () => {
    const sql = sqlSequence([
      [
        {
          name: "Joe's Auto",
          vertical: "auto",
          a2p_status: "pending_verification",
          a2p_messaging_service_sid: null,
          a2p_campaign_sid: null,
        },
      ],
    ]);
    const result = await registerA2p(
      sql,
      "t1",
      "refresh",
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 422, error: "not_yet_registered" });
  });
});
