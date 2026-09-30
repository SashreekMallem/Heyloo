import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  FORWARDING_TEST_AGENT_SETTINGS_KEY,
  FORWARDING_TEST_WINDOW_MS,
  type ForwardingVerifyDeps,
  failureReasonFor,
  forwardingTestStatus,
  isDialableBusinessPhone,
  startForwardingTest,
} from "./handler.ts";

const T0 = Date.parse("2026-09-30T16:00:00Z");
const TEST_LINE = "+16105383920";

interface RowOver {
  business_phone?: string | null;
  forwarding_test_started_at?: string | null;
  forwarding_test_call_id?: string | null;
}

function numberRow(over: RowOver = {}) {
  return {
    number_id: "pn1",
    heyloo_e164: "+12627551967",
    business_phone: "+12145550199",
    business_name: "Imperial Biryani",
    forwarding_test_started_at: null,
    forwarding_test_call_id: null,
    forwarding_verified_at: null,
    ...over,
  };
}

function makeSql(opts: {
  row?: ReturnType<typeof numberRow> | null;
  cachedAgentId?: string;
  claim?: boolean;
  arrived?: boolean;
}) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("from public.phone_numbers pn")) {
      return Promise.resolve(opts.row === null ? [] : [opts.row ?? numberRow()]);
    }
    if (text.includes("from public.platform_settings")) {
      return Promise.resolve(
        opts.cachedAgentId ? [{ value: { agent_id: opts.cachedAgentId } }] : [],
      );
    }
    if (text.includes("set forwarding_test_started_at = ?::timestamptz")) {
      return Promise.resolve(opts.claim === false ? [] : [{ id: "pn1" }]);
    }
    if (text.includes("from public.call_logs")) {
      return Promise.resolve(opts.arrived ? [{ id: "cl1" }] : []);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function makeRetell(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const requests: { path: string; body: unknown }[] = [];
  const retellFetch = async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(overrides).find((p) => path.startsWith(p));
    const defaults: Record<string, { status: number; body: unknown }> = {
      "/create-retell-llm": { status: 201, body: { llm_id: "llm_1" } },
      "/create-agent": { status: 201, body: { agent_id: "ag_new", version: 0 } },
      "/get-agent": { status: 200, body: { agent_id: "ag_new", version: 0 } },
      "/publish-agent": { status: 200, body: {} },
      "/v2/create-phone-call": { status: 201, body: { call_id: "call_1" } },
      "/v2/get-call": { status: 200, body: { call_status: "ongoing" } },
    };
    const hit =
      (key ? overrides[key] : undefined) ??
      Object.entries(defaults).find(([p]) => path.startsWith(p))?.[1];
    return new Response(JSON.stringify(hit?.body ?? {}), { status: hit?.status ?? 404 });
  };
  return { retellFetch, requests };
}

function deps(retellFetch: ForwardingVerifyDeps["retellFetch"], nowMs = T0): ForwardingVerifyDeps {
  return {
    now: () => new Date(nowMs),
    retellFetch,
    retellApiKey: "key_test",
    testFromNumber: TEST_LINE,
    logger: createLogger({ fn: "forwarding-verify-test" }),
  };
}

describe("isDialableBusinessPhone — a platform-paid call only ever reaches an ordinary NANP line", () => {
  it("accepts ordinary US/Canada numbers, including toll-free", () => {
    expect(isDialableBusinessPhone("+12145550199")).toBe(true);
    expect(isDialableBusinessPhone("+18005551234")).toBe(true);
    expect(isDialableBusinessPhone("+14165551234")).toBe(true);
  });
  it("rejects premium, service-code, malformed and non-NANP numbers", () => {
    expect(isDialableBusinessPhone("+19005551234")).toBe(false); // 900 premium
    expect(isDialableBusinessPhone("+12129761234")).toBe(false); // NXX-976 premium
    expect(isDialableBusinessPhone("+14115551234")).toBe(false); // N11 area
    expect(isDialableBusinessPhone("+12124111234")).toBe(false); // N11 exchange
    expect(isDialableBusinessPhone("+11235551234")).toBe(false); // area can't start 0/1
    expect(isDialableBusinessPhone("+442071234567")).toBe(false); // outside +1
  });
});

describe("failureReasonFor — explains a test with no forwarded call from the outbound leg", () => {
  it("maps Retell's disconnection reasons", () => {
    expect(failureReasonFor("dial_no_answer")).toBe("no_answer");
    expect(failureReasonFor("dial_busy")).toBe("busy");
    expect(failureReasonFor("invalid_destination")).toBe("invalid_number");
    expect(failureReasonFor("voicemail_reached")).toBe("answered");
    expect(failureReasonFor("agent_hangup")).toBe("answered");
    expect(failureReasonFor("error_retell")).toBe("not_forwarded");
    expect(failureReasonFor(undefined)).toBe("unknown");
  });
});

describe("startForwardingTest", () => {
  it("404 when the tenant has no Heyloo number yet", async () => {
    const { sql } = makeSql({ row: null });
    const { retellFetch, requests } = makeRetell();
    const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(result).toEqual({ status: 404, body: { error: "tenant_number_not_found" } });
    expect(requests).toHaveLength(0);
  });

  it("422 without a business phone, and never dials", async () => {
    const { sql } = makeSql({ row: numberRow({ business_phone: null }) });
    const { retellFetch, requests } = makeRetell();
    const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(result).toEqual({ status: 422, body: { error: "business_phone_missing" } });
    expect(requests).toHaveLength(0);
  });

  it("422 for a premium number or the Heyloo number itself, and never dials", async () => {
    for (const phone of ["+19005551234", "+12627551967", TEST_LINE]) {
      const { sql } = makeSql({ row: numberRow({ business_phone: phone }) });
      const { retellFetch, requests } = makeRetell();
      const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
      expect(result).toEqual({ status: 422, body: { error: "business_phone_not_allowed" } });
      expect(requests).toHaveLength(0);
    }
  });

  it("429 while a test started inside the window is still running", async () => {
    const { sql } = makeSql({
      row: numberRow({ forwarding_test_started_at: new Date(T0 - 30_000).toISOString() }),
    });
    const { retellFetch, requests } = makeRetell();
    const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(result.status).toBe(429);
    expect(result.body).toMatchObject({ error: "test_in_progress", retry_after_s: 60 });
    expect(requests).toHaveLength(0);
  });

  it("creates and caches the caller agent once, claims the window, then dials the business phone from the test line", async () => {
    const { sql, calls } = makeSql({});
    const { retellFetch, requests } = makeRetell();
    const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));

    expect(result).toEqual({
      status: 200,
      body: {
        started: true,
        calling: "+12145550199",
        expires_at: new Date(T0 + FORWARDING_TEST_WINDOW_MS).toISOString(),
      },
    });
    const llm = requests.find((r) => r.path === "/create-retell-llm")?.body as Record<
      string,
      unknown
    >;
    expect(llm["start_speaker"]).toBe("user");
    expect(llm["general_tools"]).toEqual([
      expect.objectContaining({ type: "end_call", name: "end_call" }),
    ]);
    expect(
      calls.some(
        (c) =>
          c.text.includes("insert into public.platform_settings") &&
          c.values.includes(FORWARDING_TEST_AGENT_SETTINGS_KEY),
      ),
    ).toBe(true);

    const placed = requests.find((r) => r.path === "/v2/create-phone-call")?.body as Record<
      string,
      unknown
    >;
    expect(placed).toMatchObject({
      from_number: TEST_LINE,
      to_number: "+12145550199",
      override_agent_id: "ag_new",
      agent_override: { agent: { max_call_duration_ms: 60_000 } },
    });
    const vars = placed["retell_llm_dynamic_variables"] as Record<string, string>;
    expect(vars["disclosure_line"]).toMatch(/AI/);
    expect(vars["disclosure_line"]).toMatch(/recorded/);

    // The window is claimed BEFORE the call is placed, and the call id stored after.
    const claimIdx = calls.findIndex((c) =>
      c.text.includes("set forwarding_test_started_at = ?::timestamptz"),
    );
    const storeIdx = calls.findIndex(
      (c) => c.text.includes("set forwarding_test_call_id = ?") && c.values.includes("call_1"),
    );
    expect(claimIdx).toBeGreaterThan(-1);
    expect(storeIdx).toBeGreaterThan(claimIdx);
  });

  it("reuses a cached caller agent that still exists", async () => {
    const { sql } = makeSql({ cachedAgentId: "ag_cached" });
    const { retellFetch, requests } = makeRetell();
    await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(requests.some((r) => r.path === "/create-agent")).toBe(false);
    const placed = requests.find((r) => r.path === "/v2/create-phone-call")?.body as Record<
      string,
      unknown
    >;
    expect(placed["override_agent_id"]).toBe("ag_cached");
  });

  it("does not dial when another request claimed the window first", async () => {
    const { sql } = makeSql({ cachedAgentId: "ag_cached", claim: false });
    const { retellFetch, requests } = makeRetell();
    const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(result.status).toBe(429);
    expect(requests.some((r) => r.path === "/v2/create-phone-call")).toBe(false);
  });

  it("502 and releases the window when Retell refuses the call", async () => {
    const { sql, calls } = makeSql({ cachedAgentId: "ag_cached" });
    const { retellFetch } = makeRetell({
      "/v2/create-phone-call": { status: 402, body: { error: "no_valid_payment" } },
    });
    const result = await startForwardingTest(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(result).toEqual({ status: 502, body: { error: "call_failed" } });
    expect(calls.some((c) => c.text.includes("set forwarding_test_started_at = null"))).toBe(true);
  });
});

describe("forwardingTestStatus", () => {
  const started = new Date(T0).toISOString();

  it("404 when no test was ever started", async () => {
    const { sql } = makeSql({});
    const { retellFetch } = makeRetell();
    const result = await forwardingTestStatus(sql, { tenantId: "t1" }, deps(retellFetch));
    expect(result).toEqual({ status: 404, body: { error: "no_test_running" } });
  });

  it("verified once a call from the test line (or the business phone) lands on the Heyloo number", async () => {
    const { sql, calls } = makeSql({
      row: numberRow({ forwarding_test_started_at: started, forwarding_test_call_id: "call_1" }),
      arrived: true,
    });
    const { retellFetch } = makeRetell();
    const result = await forwardingTestStatus(
      sql,
      { tenantId: "t1", carrierHint: "tmobile" },
      deps(retellFetch, T0 + 40_000),
    );
    expect(result).toEqual({ status: 200, body: { state: "verified" } });
    const lookup = calls.find((c) => c.text.includes("from public.call_logs"));
    expect(lookup?.values).toContainEqual([TEST_LINE, "+12145550199"]);
    expect(
      calls.some(
        (c) =>
          c.text.includes("set forwarding_verified_at = now()") && c.values.includes("tmobile"),
      ),
    ).toBe(true);
  });

  it("pending while the outbound call is still ringing inside the window", async () => {
    const { sql } = makeSql({
      row: numberRow({ forwarding_test_started_at: started, forwarding_test_call_id: "call_1" }),
    });
    const { retellFetch } = makeRetell();
    const result = await forwardingTestStatus(
      sql,
      { tenantId: "t1" },
      deps(retellFetch, T0 + 20_000),
    );
    expect(result).toEqual({ status: 200, body: { state: "pending" } });
  });

  it("failed with the reason once the outbound call ended without a forwarded call (after a log grace)", async () => {
    const { sql } = makeSql({
      row: numberRow({ forwarding_test_started_at: started, forwarding_test_call_id: "call_1" }),
    });
    const { retellFetch } = makeRetell({
      "/v2/get-call": {
        status: 200,
        body: {
          call_status: "ended",
          disconnection_reason: "voicemail_reached",
          end_timestamp: T0 + 25_000,
        },
      },
    });
    // Just ended: still inside the grace for the call_logs row to land.
    expect(
      await forwardingTestStatus(sql, { tenantId: "t1" }, deps(retellFetch, T0 + 30_000)),
    ).toEqual({ status: 200, body: { state: "pending" } });
    expect(
      await forwardingTestStatus(sql, { tenantId: "t1" }, deps(retellFetch, T0 + 40_000)),
    ).toEqual({ status: 200, body: { state: "failed", reason: "answered" } });
  });

  it("failed/unknown once the whole window has passed", async () => {
    const { sql } = makeSql({
      row: numberRow({ forwarding_test_started_at: started, forwarding_test_call_id: "call_1" }),
    });
    const { retellFetch } = makeRetell();
    const result = await forwardingTestStatus(
      sql,
      { tenantId: "t1" },
      deps(retellFetch, T0 + FORWARDING_TEST_WINDOW_MS + 1),
    );
    expect(result).toEqual({ status: 200, body: { state: "failed", reason: "unknown" } });
  });
});
