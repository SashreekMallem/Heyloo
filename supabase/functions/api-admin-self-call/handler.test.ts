import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  runSelfCall,
  SELF_CALL_CALLEE_NUMBER,
  SELF_CALL_CALLER_NUMBER,
  validateRequest,
} from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

type FetchResponder = (
  url: string,
  init?: RequestInit,
) => { status: number; body: unknown } | undefined;

function makeRetellFetch(responders: FetchResponder[]): { fetch: RetellFetch; calls: string[] } {
  const calls: string[] = [];
  const fetch: RetellFetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    for (const responder of responders) {
      const result = responder(url, init);
      if (result) {
        return new Response(JSON.stringify(result.body), { status: result.status });
      }
    }
    return new Response(JSON.stringify({ error: "unmocked_url", url }), { status: 500 });
  };
  return { fetch, calls };
}

const CALLEE_TENANT_FIXTURE = {
  tenant_id: "tenant-riverside",
  business_name: "Riverside Auto Repair (TEST)",
};

const HAPPY_PATH_RESPONDERS: FetchResponder[] = [
  (url, init) =>
    url.includes("/create-retell-llm") && init?.method === "POST"
      ? { status: 201, body: { llm_id: "llm_caller_1", version: 0 } }
      : undefined,
  (url, init) =>
    url.includes("/create-agent") && init?.method === "POST"
      ? { status: 201, body: { agent_id: "agent_caller_1", version: 0 } }
      : undefined,
  (url, init) =>
    url.includes("/get-agent/") && init?.method === "GET"
      ? { status: 200, body: { agent_id: "agent_caller_1", version: 0 } }
      : undefined,
  (url, init) =>
    url.includes("/publish-agent-version/") && init?.method === "POST"
      ? { status: 200, body: {} }
      : undefined,
  (url, init) =>
    url.includes("/update-phone-number/") && init?.method === "PATCH"
      ? { status: 200, body: { phone_number: SELF_CALL_CALLER_NUMBER } }
      : undefined,
  (url, init) =>
    url.includes("/v2/create-phone-call") && init?.method === "POST"
      ? { status: 201, body: { call_id: "call_caller_leg_1", call_status: "registered" } }
      : undefined,
  (url, init) =>
    url.includes("/v2/get-call/") && init?.method === "GET"
      ? {
          status: 200,
          body: {
            call_status: "ended",
            disconnection_reason: "user_hangup",
            duration_ms: 42_000,
            transcript: "hello world",
            recording_url: "https://example.com/rec.wav",
          },
        }
      : undefined,
];

describe("validateRequest", () => {
  it("defaults action to 'run' and accepts an empty body", () => {
    expect(validateRequest({})).toEqual({ ok: true, data: { action: "run" } });
  });

  it("accepts force_recreate_caller_agent on run", () => {
    expect(validateRequest({ force_recreate_caller_agent: true })).toEqual({
      ok: true,
      data: { action: "run", force_recreate_caller_agent: true },
    });
  });

  it("rejects a non-boolean force_recreate_caller_agent", () => {
    expect(validateRequest({ force_recreate_caller_agent: "yes" })).toEqual({
      ok: false,
      error: "invalid_force_recreate_caller_agent",
    });
  });

  it("requires caller_call_id for action: status", () => {
    expect(validateRequest({ action: "status" })).toEqual({
      ok: false,
      error: "missing_caller_call_id",
    });
  });

  it("accepts a well-formed status request", () => {
    expect(validateRequest({ action: "status", caller_call_id: "call_1" })).toEqual({
      ok: true,
      data: { action: "status", caller_call_id: "call_1" },
    });
  });

  it("rejects an invalid action", () => {
    expect(validateRequest({ action: "bogus" })).toEqual({ ok: false, error: "invalid_action" });
  });

  it("rejects a non-object body", () => {
    expect(validateRequest(null)).toEqual({ ok: false, error: "invalid_body" });
  });
});

describe("runSelfCall — action: run", () => {
  it("creates the caller agent, binds it, places the call, polls to settled, and returns callee evidence", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select value from public.platform_settings": [],
      "select id, retell_call_id, is_test_call, classification, call_summary, recording_url, transcript":
        [
          {
            id: "call_log_1",
            retell_call_id: "call_callee_leg_1",
            is_test_call: true,
            classification: "new_booking",
            call_summary: "Booked an oil change.",
            recording_url: null,
            transcript: { turns: [] },
          },
        ],
      "select b.id, b.customer_id": [{ id: "booking_1", customer_id: "customer_1" }],
    });
    const { fetch, calls } = makeRetellFetch(HAPPY_PATH_RESPONDERS);

    const result = await runSelfCall(
      sql,
      { action: "run" },
      { retellFetch: fetch, retellApiKey: "key", logger, pollIntervalMs: 1, sleep: async () => {} },
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      settled: boolean;
      caller_call_id: string;
      callee: { found: boolean } | null;
    };
    expect(body.settled).toBe(true);
    expect(body.caller_call_id).toBe("call_caller_leg_1");
    expect(body.callee?.found).toBe(true);

    expect(calls.some((c) => c.includes("/v2/create-phone-call"))).toBe(true);
    expect(
      calls.some((c) =>
        c.includes(`/update-phone-number/${encodeURIComponent(SELF_CALL_CALLER_NUMBER)}`),
      ),
    ).toBe(true);
  });

  it("reuses a cached caller agent (idempotent by name) without creating a new one", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select value from public.platform_settings": [
        { value: { agent_id: "agent_cached_1", llm_id: "llm_cached_1" } },
      ],
    });
    const { fetch, calls } = makeRetellFetch([
      (url, init) =>
        url.includes("/get-agent/agent_cached_1") && init?.method === "GET"
          ? { status: 200, body: { agent_id: "agent_cached_1", version: 1 } }
          : undefined,
      ...HAPPY_PATH_RESPONDERS,
    ]);

    await runSelfCall(
      sql,
      { action: "run" },
      { retellFetch: fetch, retellApiKey: "key", logger, pollIntervalMs: 1, sleep: async () => {} },
    );

    expect(calls.some((c) => c.startsWith("POST") && c.includes("/create-agent"))).toBe(false);
    expect(calls.some((c) => c.includes("/v2/create-phone-call"))).toBe(true);
  });

  it("force_recreate_caller_agent deletes the old cached agent before creating a new one", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select value from public.platform_settings": [
        { value: { agent_id: "agent_old_1", llm_id: "llm_old_1" } },
      ],
    });
    const { fetch, calls } = makeRetellFetch([
      (url, init) =>
        url.includes("/delete-agent/agent_old_1") && init?.method === "DELETE"
          ? { status: 200, body: {} }
          : undefined,
      ...HAPPY_PATH_RESPONDERS,
    ]);

    await runSelfCall(
      sql,
      { action: "run", force_recreate_caller_agent: true },
      { retellFetch: fetch, retellApiKey: "key", logger, pollIntervalMs: 1, sleep: async () => {} },
    );

    expect(calls.some((c) => c.includes("/delete-agent/agent_old_1"))).toBe(true);
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/create-agent"))).toBe(true);
  });

  it("captures the exact Retell error (e.g. KYC/outbound-verification rejection) and never polls", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select value from public.platform_settings": [],
    });
    const { fetch, calls } = makeRetellFetch([
      ...HAPPY_PATH_RESPONDERS.slice(0, 5), // llm/agent/get-agent/publish/bind all succeed
      (url, init) =>
        url.includes("/v2/create-phone-call") && init?.method === "POST"
          ? { status: 403, body: { error: "outbound_calling_not_verified" } }
          : undefined,
    ]);

    const result = await runSelfCall(
      sql,
      { action: "run" },
      { retellFetch: fetch, retellApiKey: "key", logger },
    );

    expect(result.status).toBe(502);
    const body = result.body as { error: string; retell_status?: number; retell_body?: unknown };
    expect(body.error).toBe("retell_create_phone_call_failed");
    expect(body.retell_status).toBe(403);
    expect(body.retell_body).toEqual({ error: "outbound_calling_not_verified" });
    expect(calls.some((c) => c.includes("/v2/get-call/"))).toBe(false);
  });

  it("returns 422 when the callee number isn't provisioned to any tenant", async () => {
    const { sql } = makeSql({});
    const { fetch } = makeRetellFetch(HAPPY_PATH_RESPONDERS);
    const result = await runSelfCall(
      sql,
      { action: "run" },
      { retellFetch: fetch, retellApiKey: "key", logger },
    );
    expect(result).toEqual({ status: 422, body: { error: "callee_number_not_provisioned" } });
  });

  it("returns settled: false with a resume token when the call hasn't ended within the poll budget", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select value from public.platform_settings": [],
    });
    const ongoingResponders: FetchResponder[] = [
      ...HAPPY_PATH_RESPONDERS.slice(0, 6),
      (url, init) =>
        url.includes("/v2/get-call/") && init?.method === "GET"
          ? { status: 200, body: { call_status: "ongoing" } }
          : undefined,
    ];
    const { fetch } = makeRetellFetch(ongoingResponders);

    const result = await runSelfCall(
      sql,
      { action: "run" },
      {
        retellFetch: fetch,
        retellApiKey: "key",
        logger,
        pollBudgetMs: 5,
        pollIntervalMs: 1,
        sleep: async () => {},
      },
    );

    expect(result.status).toBe(202);
    const body = result.body as { settled: boolean; resume?: { caller_call_id: string } };
    expect(body.settled).toBe(false);
    expect(body.resume?.caller_call_id).toBe("call_caller_leg_1");
  });
});

describe("runSelfCall — action: status", () => {
  it("polls an existing caller_call_id without re-creating the agent or re-placing the call", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select id, retell_call_id, is_test_call, classification, call_summary, recording_url, transcript":
        [
          {
            id: "call_log_1",
            retell_call_id: "call_callee_leg_1",
            is_test_call: true,
            classification: null,
            call_summary: null,
            recording_url: "https://example.com/rec.wav",
            transcript: null,
          },
        ],
    });
    const { fetch, calls } = makeRetellFetch([
      (url, init) =>
        url.includes("/v2/get-call/call_caller_leg_1") && init?.method === "GET"
          ? {
              status: 200,
              body: {
                call_status: "ended",
                disconnection_reason: "agent_hangup",
                duration_ms: 5000,
              },
            }
          : undefined,
    ]);

    const result = await runSelfCall(
      sql,
      { action: "status", caller_call_id: "call_caller_leg_1" },
      { retellFetch: fetch, retellApiKey: "key", logger, pollIntervalMs: 1, sleep: async () => {} },
    );

    expect(result.status).toBe(200);
    expect(calls).toEqual(["GET https://api.retellai.com/v2/get-call/call_caller_leg_1"]);
    const body = result.body as {
      settled: boolean;
      callee: { recording_url: string | null } | null;
    };
    expect(body.settled).toBe(true);
    expect(body.callee?.recording_url).toBe("https://example.com/rec.wav");
  });
});

// SELF_CALL_CALLEE_NUMBER is asserted here so a future edit can't silently
// widen this function's hardcoded destination (docs/BUILD_PLAN.md's own
// safety instruction — never call any number other than +12602354330).
describe("hardcoded numbers", () => {
  it("never changes without a deliberate, reviewed edit", () => {
    expect(SELF_CALL_CALLER_NUMBER).toBe("+16105383920");
    expect(SELF_CALL_CALLEE_NUMBER).toBe("+12602354330");
  });
});
