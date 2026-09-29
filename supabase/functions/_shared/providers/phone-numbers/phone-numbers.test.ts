import { describe, expect, it } from "vitest";
import { raiseNumberOpsAlert, resolveNumberOpsAlerts } from "./ops-alert.ts";
import { createPhoneNumberRegistry } from "./registry.ts";
import { releaseRetellNumber } from "./retell-native.ts";
import { resolveNumberProviderId } from "./types.ts";

const E164 = "+15551234567";

describe("resolveNumberProviderId", () => {
  it("NULL, empty and retell-native: placeholder twilio_sid values are Retell-native", () => {
    expect(resolveNumberProviderId({ twilioSid: null })).toBe("retell-native");
    expect(resolveNumberProviderId({ twilioSid: "" })).toBe("retell-native");
    expect(resolveNumberProviderId({ twilioSid: `retell-native:${E164}` })).toBe("retell-native");
  });

  it("a real PN... SID is a Twilio-imported number", () => {
    expect(resolveNumberProviderId({ twilioSid: "PN0123456789abcdef0123456789abcdef" })).toBe(
      "twilio",
    );
  });
});

function scripted(responses: Array<{ status: number; body?: unknown }>) {
  const seen: { method: string; url: string }[] = [];
  let i = 0;
  const fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ method: init?.method ?? "GET", url });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(r?.body === undefined ? null : JSON.stringify(r.body), {
      status: r?.status ?? 500,
    });
  }) as never;
  return { fetch, seen };
}

describe("releaseRetellNumber", () => {
  const deps = (fetch: never, protectedAgentIds: string[] = []) => ({
    retellFetch: fetch,
    retellApiKey: "k",
    protectedAgentIds,
  });

  it("GETs, then DELETEs exactly the one E.164 with the documented paths", async () => {
    const { fetch, seen } = scripted([
      { status: 200, body: { inbound_agents: [] } },
      { status: 204 },
    ]);
    const result = await releaseRetellNumber(deps(fetch), E164);
    expect(result).toEqual({ ok: true, alreadyReleased: false });
    expect(seen).toEqual([
      { method: "GET", url: "https://api.retellai.com/get-phone-number/%2B15551234567" },
      { method: "DELETE", url: "https://api.retellai.com/delete-phone-number/%2B15551234567" },
    ]);
  });

  it("a GET 422 (documented 'asset not found') means already released; no DELETE", async () => {
    const { fetch, seen } = scripted([{ status: 422 }]);
    expect(await releaseRetellNumber(deps(fetch), E164)).toEqual({
      ok: true,
      alreadyReleased: true,
    });
    expect(seen).toHaveLength(1);
  });

  it("a DELETE 404/422 counts as released only when a re-read confirms the number is gone", async () => {
    const gone = scripted([{ status: 200, body: {} }, { status: 422 }, { status: 422 }]);
    expect(await releaseRetellNumber(deps(gone.fetch), E164)).toEqual({
      ok: true,
      alreadyReleased: true,
    });
    const stillThere = scripted([
      { status: 200, body: {} },
      { status: 422 },
      { status: 200, body: {} },
    ]);
    expect(await releaseRetellNumber(deps(stillThere.fetch), E164)).toEqual({
      ok: false,
      reason: "retell_delete_failed",
      status: 422,
    });
  });

  it("a non-gone GET failure (e.g. 500 or 401) is a failure and never deletes", async () => {
    const { fetch, seen } = scripted([{ status: 500 }]);
    expect(await releaseRetellNumber(deps(fetch), E164)).toEqual({
      ok: false,
      reason: "retell_delete_failed",
      status: 500,
    });
    expect(seen.map((s) => s.method)).toEqual(["GET"]);
  });

  it("refuses a number bound (inbound, outbound or SMS) to a protected agent", async () => {
    for (const key of ["inbound_agents", "outbound_agents", "inbound_sms_agents"]) {
      const { fetch, seen } = scripted([
        { status: 200, body: { [key]: [{ agent_id: "agent_demo", weight: 1 }] } },
      ]);
      const result = await releaseRetellNumber(deps(fetch, ["agent_demo"]), E164);
      expect(result).toMatchObject({ ok: false, reason: "protected_agent_bound" });
      expect(seen.map((s) => s.method)).toEqual(["GET"]);
    }
  });
});

describe("phone-number registry dispatch", () => {
  const registry = createPhoneNumberRegistry({
    retellFetch: (async () => new Response("{}", { status: 200 })) as never,
    retellApiKey: "k",
    protectedAgentIds: [],
    twilioFetch: (async () => new Response("{}", { status: 200 })) as never,
    twilioAccountSid: "AC1",
    twilioAuthToken: "t",
  });

  it("dispatches on the canonical row and reports failover support per provider", () => {
    const native = registry.forNumber({ twilioSid: null });
    expect(native.id).toBe("retell-native");
    expect(native.failoverSupport()).toMatchObject({ supported: false });
    const twilio = registry.forNumber({ twilioSid: "PN1" });
    expect(twilio.id).toBe("twilio");
    expect(twilio.failoverSupport()).toEqual({ supported: true });
  });

  it("a Twilio-imported number reports failover unsupported when Twilio is unconfigured", () => {
    const unconfigured = createPhoneNumberRegistry({
      retellFetch: (async () => new Response("{}")) as never,
      retellApiKey: "k",
      protectedAgentIds: [],
      twilioFetch: (async () => new Response("{}")) as never,
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
    });
    expect(unconfigured.forNumber({ twilioSid: "PN1" }).failoverSupport()).toMatchObject({
      supported: false,
    });
  });
});

describe("ops alerts", () => {
  it("dedupes open alerts per (rule, tenant) inside the insert itself", async () => {
    const texts: string[] = [];
    const sql = ((s: TemplateStringsArray) => {
      texts.push(s.join("?"));
      return Promise.resolve([]);
    }) as never;
    await raiseNumberOpsAlert(sql, { rule: "r", severity: "warning", tenantId: "t", payload: {} });
    await resolveNumberOpsAlerts(sql, "r");
    expect(texts[0]).toContain("where not exists");
    expect(texts[0]).toContain("a.status = 'open'");
    expect(texts[1]).toContain("update public.alerts set status = 'resolved'");
  });
});
