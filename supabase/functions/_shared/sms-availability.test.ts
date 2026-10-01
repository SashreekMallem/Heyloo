import { findTextPromises } from "@heyloo/templates";
import { describe, expect, it } from "vitest";
import type { MessagingRegistry } from "./providers/messaging/registry.ts";
import type { SmsProvider } from "./providers/messaging/types.ts";
import type { SmsSenderRow } from "./sms-availability.ts";
import {
  evaluateSmsRoute,
  isSmsAvailable,
  loadSmsSenderRow,
  resolveSmsRoute,
  resolveTextingVariables,
  SMS_UNAVAILABLE_CONFIRMATION_MESSAGE,
  SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE,
  TEXTING_POLICY_OFF,
  TEXTING_POLICY_ON,
  WAITLIST_NO_TEXT_NOTE,
} from "./sms-availability.ts";
import type { SqlClient } from "./types.ts";

const provider = (id: string) => ({ id }) as SmsProvider;

/** A stub registry: `configured` provider ids resolve, everything else does not. */
function registry(configured: string[], platformDefault = "telnyx") {
  const calls: Array<{ senderProvider?: string | null; tenantOverride?: string | null }> = [];
  const stub: Pick<MessagingRegistry, "resolveSms"> & { calls: typeof calls } = {
    calls,
    resolveSms(input = {}) {
      calls.push(input);
      const id = (input.senderProvider || input.tenantOverride || platformDefault).toLowerCase();
      return configured.includes(id)
        ? { ok: true, provider: provider(id) }
        : { ok: false, reason: "provider_not_configured", providerId: id, missing: [] };
    },
  };
  return stub;
}

const ROW: SmsSenderRow = {
  a2p_status: "pending_verification",
  sms_provider: null,
  sender_e164: null,
  sender_provider: null,
  sender_status: null,
  primary_e164: "+15559990000",
};
const verifiedSender = (over: Partial<SmsSenderRow> = {}): SmsSenderRow => ({
  ...ROW,
  a2p_status: "verified",
  sender_e164: "+18885550100",
  sender_provider: "telnyx",
  sender_status: "verified",
  ...over,
});

describe("evaluateSmsRoute", () => {
  it("launch state: a Retell number with a2p pending and no sender is not verified", () => {
    expect(evaluateSmsRoute(ROW, registry(["telnyx"]), { requireVerified: true })).toEqual({
      ok: false,
      reason: "sender_not_verified",
    });
  });

  it("a tenant that does not exist has nothing to text from", () => {
    expect(evaluateSmsRoute(undefined, registry(["telnyx"]), { requireVerified: true })).toEqual({
      ok: false,
      reason: "sender_not_verified",
    });
    expect(evaluateSmsRoute(undefined, registry(["telnyx"]), { requireVerified: false })).toEqual({
      ok: false,
      reason: "no_sending_number",
    });
  });

  it("a verified messaging sender with a configured provider is usable, from that number", () => {
    const route = evaluateSmsRoute(verifiedSender(), registry(["telnyx"]), {
      requireVerified: true,
    });
    expect(route).toMatchObject({ ok: true, from: "+18885550100" });
  });

  it("the sender's provider beats the tenant override, which beats the platform default", () => {
    const stub = registry(["telnyx", "twilio"]);
    evaluateSmsRoute(verifiedSender({ sender_provider: "twilio", sms_provider: "telnyx" }), stub, {
      requireVerified: true,
    });
    expect(stub.calls[0]).toEqual({ senderProvider: "twilio", tenantOverride: "telnyx" });
  });

  it("a verified sender whose provider has no secrets is NOT usable (the worker would only park it)", () => {
    const route = evaluateSmsRoute(verifiedSender(), registry(["twilio"]), {
      requireVerified: true,
    });
    expect(route).toEqual({
      ok: false,
      reason: "provider_not_configured",
      detail: "provider_not_configured:telnyx",
    });
  });

  it("legacy fallback: no sender row, the primary number with a2p verified is usable", () => {
    const row = { ...ROW, a2p_status: "verified" };
    expect(evaluateSmsRoute(row, registry(["telnyx"]), { requireVerified: true })).toMatchObject({
      ok: true,
      from: "+15559990000",
    });
  });

  it("a sender that carriers have not approved yet is not verified, whatever a2p_status says", () => {
    const row = verifiedSender({ sender_status: "in_review" });
    expect(evaluateSmsRoute(row, registry(["telnyx"]), { requireVerified: true })).toEqual({
      ok: false,
      reason: "sender_not_verified",
    });
  });

  it("replies to an inbound text do not need approval (requireVerified: false)", () => {
    const row = verifiedSender({ sender_status: "in_review" });
    expect(evaluateSmsRoute(row, registry(["telnyx"]), { requireVerified: false })).toMatchObject({
      ok: true,
    });
  });

  it("no number at all", () => {
    const row = { ...ROW, primary_e164: null, a2p_status: "verified" };
    expect(evaluateSmsRoute(row, registry(["telnyx"]), { requireVerified: true })).toEqual({
      ok: false,
      reason: "no_sending_number",
    });
  });
});

describe("loading and asking", () => {
  const sqlReturning = (rows: unknown[]) => {
    const seen: string[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push(`${strings.join(" ")}|${values.join(",")}`);
      return Promise.resolve(rows);
    }) as SqlClient;
    return { sql, seen };
  };

  it("reads one tenant-scoped statement over tenants + messaging_senders", async () => {
    const { sql, seen } = sqlReturning([verifiedSender()]);
    expect(await loadSmsSenderRow(sql, "t1")).toEqual(verifiedSender());
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("from public.tenants t");
    expect(seen[0]).toContain("public.messaging_senders");
    expect(seen[0]).toContain("released_at is null");
    expect(seen[0]?.endsWith("|t1")).toBe(true);
  });

  it("isSmsAvailable is true only for a usable customer route", async () => {
    expect(
      await isSmsAvailable(sqlReturning([verifiedSender()]).sql, "t1", registry(["telnyx"])),
    ).toBe(true);
    expect(await isSmsAvailable(sqlReturning([ROW]).sql, "t1", registry(["telnyx"]))).toBe(false);
    expect(await isSmsAvailable(sqlReturning([]).sql, "t1", registry(["telnyx"]))).toBe(false);
    expect(await isSmsAvailable(sqlReturning([verifiedSender()]).sql, "t1", registry([]))).toBe(
      false,
    );
  });

  it("resolveSmsRoute keeps the worker's contract", async () => {
    const route = await resolveSmsRoute(
      sqlReturning([verifiedSender()]).sql,
      "t1",
      registry(["telnyx"]),
      { requireVerified: true },
    );
    expect(route.ok && route.provider.id).toBe("telnyx");
  });
});

describe("what the model is told", () => {
  it("resolves the per-call variables as strings", () => {
    expect(resolveTextingVariables(true)).toEqual({
      sms_enabled: "true",
      texting_policy_text: TEXTING_POLICY_ON,
    });
    expect(resolveTextingVariables(false)).toEqual({
      sms_enabled: "false",
      texting_policy_text: TEXTING_POLICY_OFF,
    });
  });

  it("the OFF policy forbids offering, promising or triggering any text", () => {
    expect(TEXTING_POLICY_OFF).toMatch(/NOT available/);
    expect(TEXTING_POLICY_OFF).toMatch(/Never offer to text/);
    expect(TEXTING_POLICY_OFF).toMatch(/do not call send_sms_confirmation or send_payment_link/);
    expect(TEXTING_POLICY_OFF).toMatch(/say so in one sentence with the day and time/);
  });

  it("the ON policy only lets the agent say a text is coming after the tool confirms it", () => {
    expect(TEXTING_POLICY_ON).toMatch(/only when that tool answers queued: true/);
  });

  it("every model-facing unavailable message states that nothing was sent and forbids implying it", () => {
    for (const message of [
      SMS_UNAVAILABLE_CONFIRMATION_MESSAGE,
      SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE,
      WAITLIST_NO_TEXT_NOTE,
    ]) {
      expect(message).toMatch(/Texting is not available/);
      // Nothing that reads like a promise, in English or Spanish.
      expect(findTextPromises(message)).toEqual([]);
    }
    expect(SMS_UNAVAILABLE_CONFIRMATION_MESSAGE).toMatch(/NO text was sent/);
    expect(SMS_UNAVAILABLE_PAYMENT_LINK_MESSAGE).toMatch(/NO payment link was created or sent/);
    expect(WAITLIST_NO_TEXT_NOTE).toMatch(/do not tell the caller they will be texted/);
  });
});
