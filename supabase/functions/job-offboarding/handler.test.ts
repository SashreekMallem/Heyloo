import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import { createPhoneNumberRegistry } from "../_shared/providers/phone-numbers/registry.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { OffboardingDeps, PortOutCandidateRow } from "./handler.ts";
import {
  archiveOneTenant,
  findArchiveCandidates,
  findPortOutCandidates,
  PORT_OUT_GRACE_DAYS,
  releaseOneNumber,
  runOffboarding,
} from "./handler.ts";

const logger = createLogger();

function candidateRow(overrides: Partial<PortOutCandidateRow> = {}): PortOutCandidateRow {
  return {
    phone_number_id: "pn1",
    tenant_id: "t1",
    e164: "+15551234567",
    twilio_sid: "PN123",
    ...overrides,
  };
}

interface FakeRetell {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  requests: { method: string; path: string }[];
}

/** Models Retell's phone-number resource for ONE e164: GET/DELETE per the
 * current docs (204 on delete, 422 "asset not found" once it is gone). */
function fakeRetell(
  opts: {
    exists?: boolean;
    boundAgents?: string[];
    deleteStatus?: number;
    getStatus?: number;
  } = {},
): FakeRetell {
  let exists = opts.exists ?? true;
  const requests: { method: string; path: string }[] = [];
  return {
    requests,
    fetch: async (url, init) => {
      const method = init?.method ?? "GET";
      requests.push({ method, path: new URL(url).pathname });
      if (method === "GET" && new URL(url).pathname === "/v2/list-phone-numbers") {
        // Retell's list endpoint is the source of truth when a GET/DELETE says 422.
        return new Response(
          JSON.stringify({
            items: exists
              ? [
                  {
                    phone_number: "+15551234567",
                    inbound_agents: (opts.boundAgents ?? ["agent_tenant"]).map((agent_id) => ({
                      agent_id,
                      weight: 1,
                    })),
                  },
                ]
              : [],
            has_more: false,
          }),
          { status: 200 },
        );
      }
      if (method === "GET") {
        if (opts.getStatus) return new Response("{}", { status: opts.getStatus });
        if (!exists) return new Response("{}", { status: 422 });
        return new Response(
          JSON.stringify({
            phone_number: "+15551234567",
            inbound_agents: (opts.boundAgents ?? ["agent_tenant"]).map((agent_id) => ({
              agent_id,
              weight: 1,
            })),
          }),
          { status: 200 },
        );
      }
      if (opts.deleteStatus && opts.deleteStatus !== 204) {
        return new Response("{}", { status: opts.deleteStatus });
      }
      if (!exists) return new Response("{}", { status: 422 });
      exists = false;
      return new Response(null, { status: 204 });
    },
  };
}

function makeDeps(
  overrides: {
    retell?: FakeRetell;
    twilioFetch?: (u: string) => Promise<Response>;
    twilioAccountSid?: string | undefined;
    twilioAuthToken?: string | undefined;
    protectedAgentIds?: string[];
  } = {},
): { deps: OffboardingDeps; retell: FakeRetell; twilioCalls: string[] } {
  const retell = overrides.retell ?? fakeRetell();
  const twilioCalls: string[] = [];
  const hasSid = "twilioAccountSid" in overrides;
  const hasToken = "twilioAuthToken" in overrides;
  const numbers = createPhoneNumberRegistry({
    retellFetch: retell.fetch,
    retellApiKey: "rk",
    protectedAgentIds: overrides.protectedAgentIds ?? ["agent_demo"],
    twilioFetch: (async (u: string) => {
      twilioCalls.push(u);
      return overrides.twilioFetch ? overrides.twilioFetch(u) : new Response(null, { status: 204 });
    }) as never,
    twilioAccountSid: hasSid ? overrides.twilioAccountSid : "AC1",
    twilioAuthToken: hasToken ? overrides.twilioAuthToken : "tok",
  });
  return { deps: { numbers, logger }, retell, twilioCalls };
}

describe("PORT_OUT_GRACE_DAYS", () => {
  it("is a 30-day guaranteed port-out window", () => {
    expect(PORT_OUT_GRACE_DAYS).toBe(30);
  });
});

function makeSql(fixtures: unknown[] = []): {
  sql: SqlClient;
  calls: unknown[][];
  texts: string[];
} {
  const calls: unknown[][] = [];
  const texts: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);
    texts.push(strings.join("?"));
    return Promise.resolve(fixtures);
  }) as SqlClient;
  return { sql, calls, texts };
}

describe("releaseOneNumber — Retell-native numbers (NUMBERS-1)", () => {
  for (const [label, sid] of [
    ["NULL twilio_sid (bought through Retell by api-provision)", null],
    [
      "retell-native:<e164> placeholder (api-admin-attach-retell-number)",
      "retell-native:+15551234567",
    ],
  ] as const) {
    it(`releases a number with ${label} in Retell only — no Twilio call, even with Twilio unconfigured`, async () => {
      const { sql, calls, texts } = makeSql();
      const { deps, retell, twilioCalls } = makeDeps({
        twilioAccountSid: undefined,
        twilioAuthToken: undefined,
      });
      const outcome = await releaseOneNumber(sql, candidateRow({ twilio_sid: sid }), deps);
      expect(outcome).toBe("released");
      expect(twilioCalls).toEqual([]);
      expect(retell.requests).toEqual([
        { method: "GET", path: "/get-phone-number/%2B15551234567" },
        { method: "DELETE", path: "/delete-phone-number/%2B15551234567" },
      ]);
      // released_at is written for exactly this row AND tenant.
      expect(texts[0]).toContain("released_at = now()");
      expect(texts[0]).toContain("tenant_id =");
      expect(calls[0]).toEqual(["pn1", "t1"]);
    });
  }

  it("is idempotent: a number Retell no longer has (422 asset not found) is released without a DELETE", async () => {
    const { sql, calls } = makeSql();
    const { deps, retell } = makeDeps({ retell: fakeRetell({ exists: false }) });
    const outcome = await releaseOneNumber(sql, candidateRow({ twilio_sid: null }), deps);
    expect(outcome).toBe("released");
    expect(retell.requests.map((r) => r.method)).toEqual(["GET", "GET"]); // get + list confirm, no DELETE
    expect(calls).toHaveLength(1);
  });

  it("a second run after a successful release finds the number gone and still succeeds", async () => {
    const retell = fakeRetell();
    const { deps } = makeDeps({ retell });
    const { sql } = makeSql();
    const row = candidateRow({ twilio_sid: null });
    expect(await releaseOneNumber(sql, row, deps)).toBe("released");
    expect(await releaseOneNumber(sql, row, deps)).toBe("released");
    expect(retell.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("reports retell_delete_failed, writes no released_at and raises an ops alert on a Retell 500", async () => {
    const { sql, texts, calls } = makeSql();
    const { deps } = makeDeps({ retell: fakeRetell({ deleteStatus: 500 }) });
    const outcome = await releaseOneNumber(sql, candidateRow({ twilio_sid: null }), deps);
    expect(outcome).toBe("retell_delete_failed");
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("insert into public.alerts");
    expect(calls[0]).toContain("number_release_failed");
    expect(texts.some((t) => t.includes("released_at"))).toBe(false);
  });

  it("a DELETE 422 that a re-read shows is NOT gone stays a failure (422 is not blindly 'already gone')", async () => {
    const { sql, texts } = makeSql();
    const { deps } = makeDeps({ retell: fakeRetell({ deleteStatus: 422 }) });
    const outcome = await releaseOneNumber(sql, candidateRow({ twilio_sid: null }), deps);
    expect(outcome).toBe("retell_delete_failed");
    expect(texts.some((t) => t.includes("released_at"))).toBe(false);
  });

  it("refuses a number bound to the demo agent: nothing is deleted, critical ops alert raised", async () => {
    const { sql, texts, calls } = makeSql();
    const { deps, retell } = makeDeps({
      retell: fakeRetell({ boundAgents: ["agent_tenant", "agent_demo"] }),
    });
    const outcome = await releaseOneNumber(sql, candidateRow({ twilio_sid: null }), deps);
    expect(outcome).toBe("protected_agent_bound");
    expect(retell.requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(texts[0]).toContain("insert into public.alerts");
    expect(calls[0]).toEqual(expect.arrayContaining(["number_release_failed", "critical", "t1"]));
    expect(texts.some((t) => t.includes("released_at"))).toBe(false);
  });
});

describe("releaseOneNumber — Twilio-imported numbers (Twilio not configured, QA-BILL precedent)", () => {
  it("fails closed with twilio_not_configured (no Twilio call, no DB write) when the Twilio secrets are unset", async () => {
    const { sql, calls } = makeSql();
    const { deps, twilioCalls } = makeDeps({
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
    });
    const outcome = await releaseOneNumber(sql, candidateRow(), deps);
    expect(outcome).toBe("twilio_not_configured");
    expect(twilioCalls).toEqual([]);
    // Not an incident: no ops alert either.
    expect(calls).toHaveLength(0);
  });

  it("still un-imports from Retell first even when Twilio is unconfigured", async () => {
    const { sql } = makeSql();
    const { deps, retell } = makeDeps({
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
    });
    await releaseOneNumber(sql, candidateRow(), deps);
    expect(retell.requests.some((r) => r.method === "DELETE")).toBe(true);
  });
});

describe("releaseOneNumber — Twilio-imported numbers", () => {
  it("un-imports from Retell, releases the SID at Twilio, and marks phone_numbers.released_at", async () => {
    const { sql, calls } = makeSql();
    const { deps, twilioCalls, retell } = makeDeps();
    const outcome = await releaseOneNumber(sql, candidateRow(), deps);
    expect(outcome).toBe("released");
    expect(twilioCalls).toEqual([
      "https://api.twilio.com/2010-04-01/Accounts/AC1/IncomingPhoneNumbers/PN123.json",
    ]);
    expect(retell.requests.some((r) => r.method === "DELETE")).toBe(true);
    expect(calls[0]).toContain("pn1");
  });

  it("does not release in Twilio (or write anything but the alert) when the Retell delete fails", async () => {
    const { sql, texts } = makeSql();
    const { deps, twilioCalls } = makeDeps({ retell: fakeRetell({ deleteStatus: 500 }) });
    const outcome = await releaseOneNumber(sql, candidateRow(), deps);
    expect(outcome).toBe("retell_delete_failed");
    expect(twilioCalls).toEqual([]);
    expect(texts.every((t) => t.includes("public.alerts"))).toBe(true);
  });

  it("treats a number Retell already lost as success and still proceeds to the Twilio release", async () => {
    const { sql, calls } = makeSql();
    const { deps, twilioCalls } = makeDeps({ retell: fakeRetell({ exists: false }) });
    const outcome = await releaseOneNumber(sql, candidateRow(), deps);
    expect(outcome).toBe("released");
    expect(twilioCalls).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("reports twilio_release_failed and writes no released_at on a non-404 Twilio failure", async () => {
    const { sql, texts } = makeSql();
    const { deps } = makeDeps({ twilioFetch: async () => new Response("{}", { status: 500 }) });
    const outcome = await releaseOneNumber(sql, candidateRow(), deps);
    expect(outcome).toBe("twilio_release_failed");
    expect(texts.some((t) => t.includes("released_at"))).toBe(false);
  });

  it("treats a Twilio 404 (already released) as success", async () => {
    const { sql } = makeSql();
    const { deps } = makeDeps({ twilioFetch: async () => new Response("{}", { status: 404 }) });
    expect(await releaseOneNumber(sql, candidateRow(), deps)).toBe("released");
  });
});

describe("archiveOneTenant / finders", () => {
  it("findPortOutCandidates/findArchiveCandidates pass through query results", async () => {
    const { sql: sql1 } = makeSql([candidateRow()]);
    expect(await findPortOutCandidates(sql1, new Date())).toHaveLength(1);
    const { sql: sql2 } = makeSql([{ tenant_id: "t1" }]);
    expect(await findArchiveCandidates(sql2, new Date())).toHaveLength(1);
  });

  it("neither finder ever picks a seasonally paused tenant (its number must survive the pause)", async () => {
    const { sql, texts } = makeSql();
    await findPortOutCandidates(sql, new Date());
    await findArchiveCandidates(sql, new Date());
    expect(texts[0]).toContain("not t.seasonal_pause");
    expect(texts[1]).toContain("not t.seasonal_pause");
  });

  it("archiveOneTenant issues an update scoped to that tenant", async () => {
    const { sql, calls } = makeSql();
    await archiveOneTenant(sql, "t1");
    expect(calls[0]).toContain("t1");
  });
});

describe("runOffboarding", () => {
  it("releases eligible numbers then archives tenants with none left active", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([candidateRow({ twilio_sid: null })]); // findPortOutCandidates
      if (call === 2) return Promise.resolve([]); // update phone_numbers.released_at
      if (call === 3) return Promise.resolve([{ tenant_id: "t1" }]); // findArchiveCandidates
      return Promise.resolve([]); // archive update
    }) as SqlClient;

    const { deps } = makeDeps();
    const result = await runOffboarding(sql, new Date("2026-09-10T00:00:00Z"), deps);
    expect(result).toEqual({
      numbers_released: 1,
      numbers_failed: 0,
      numbers_skipped_not_configured: 0,
      numbers_refused_protected: 0,
      tenants_archived: 1,
    });
  });

  it("counts a protected-agent refusal separately and does not archive around it", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([candidateRow({ twilio_sid: null })]);
      return Promise.resolve([]); // alert insert, then no archive candidates
    }) as SqlClient;
    const { deps } = makeDeps({ retell: fakeRetell({ boundAgents: ["agent_demo"] }) });
    const result = await runOffboarding(sql, new Date("2026-09-10T00:00:00Z"), deps);
    expect(result).toMatchObject({
      numbers_released: 0,
      numbers_refused_protected: 1,
      tenants_archived: 0,
    });
  });

  it("archives a tenant with zero outstanding phone numbers even when Twilio is entirely unconfigured (QA-BILL: the throwaway-test-tenant path)", async () => {
    let call = 0;
    const sql = ((_strings: TemplateStringsArray, ..._values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([]); // findPortOutCandidates — no numbers
      if (call === 2) return Promise.resolve([{ tenant_id: "t1" }]); // findArchiveCandidates
      return Promise.resolve([]); // archive update
    }) as SqlClient;

    const { deps } = makeDeps({ twilioAccountSid: undefined, twilioAuthToken: undefined });
    const result = await runOffboarding(sql, new Date("2026-09-10T00:00:00Z"), deps);
    expect(result).toEqual({
      numbers_released: 0,
      numbers_failed: 0,
      numbers_skipped_not_configured: 0,
      numbers_refused_protected: 0,
      tenants_archived: 1,
    });
  });
});
