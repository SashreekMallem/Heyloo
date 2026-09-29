import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  runSelfCall,
  SCENARIO_DEFAULT_DURATION_S,
  SCENARIO_MAX_PROMPT_CHARS,
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

describe("validateRequest — scenario (HARNESS-1)", () => {
  it("accepts a full scenario and passes it through", () => {
    expect(
      validateRequest({
        scenario: { caller_prompt: "You are Ana.", max_duration_s: 90, language: "es" },
      }),
    ).toEqual({
      ok: true,
      data: {
        action: "run",
        scenario: { caller_prompt: "You are Ana.", max_duration_s: 90, language: "es" },
      },
    });
  });

  it("defaults language to en and duration to the default", () => {
    expect(validateRequest({ scenario: { caller_prompt: "Hi" } })).toEqual({
      ok: true,
      data: {
        action: "run",
        scenario: {
          caller_prompt: "Hi",
          max_duration_s: SCENARIO_DEFAULT_DURATION_S,
          language: "en",
        },
      },
    });
  });

  it.each([
    [{ caller_prompt: "" }, "invalid_scenario_caller_prompt"],
    [{ caller_prompt: "   " }, "invalid_scenario_caller_prompt"],
    [{ caller_prompt: 5 }, "invalid_scenario_caller_prompt"],
    [{}, "invalid_scenario_caller_prompt"],
    [
      { caller_prompt: "x".repeat(SCENARIO_MAX_PROMPT_CHARS + 1) },
      "scenario_caller_prompt_too_long",
    ],
    [{ caller_prompt: "x", max_duration_s: 241 }, "invalid_scenario_max_duration_s"],
    [{ caller_prompt: "x", max_duration_s: 30 }, "invalid_scenario_max_duration_s"],
    [{ caller_prompt: "x", max_duration_s: 90.5 }, "invalid_scenario_max_duration_s"],
    [{ caller_prompt: "x", max_duration_s: "90" }, "invalid_scenario_max_duration_s"],
    [{ caller_prompt: "x", language: "fr" }, "invalid_scenario_language"],
    [{ caller_prompt: "x", to_number: "+15555550100" }, "invalid_scenario_unknown_field"],
  ])("rejects %j", (scenario, error) => {
    expect(validateRequest({ scenario })).toEqual({ ok: false, error });
  });

  it("accepts the exact max prompt length and max duration", () => {
    const r = validateRequest({
      scenario: { caller_prompt: "x".repeat(SCENARIO_MAX_PROMPT_CHARS), max_duration_s: 240 },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects non-object scenarios", () => {
    expect(validateRequest({ scenario: "hi" })).toEqual({ ok: false, error: "invalid_scenario" });
    expect(validateRequest({ scenario: null })).toEqual({ ok: false, error: "invalid_scenario" });
    expect(validateRequest({ scenario: [] })).toEqual({ ok: false, error: "invalid_scenario" });
  });
});

describe("runSelfCall — scenario (HARNESS-1)", () => {
  const scenarioDeps = (fetch: RetellFetch) => ({
    retellFetch: fetch,
    retellApiKey: "key",
    logger,
    pollIntervalMs: 1,
    sleep: async () => {},
  });

  it("creates a separate cached scenario agent and sends prompt, language, duration cap; numbers stay hardcoded", async () => {
    const { sql, calls: sqlCalls } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
    });
    const bodies: Record<string, unknown> = {};
    const { fetch } = makeRetellFetch([
      (url, init) => {
        if (init?.body && typeof init.body === "string") {
          bodies[`${init.method} ${url.replace("https://api.retellai.com", "")}`] = JSON.parse(
            init.body,
          );
        }
        return undefined;
      },
      ...HAPPY_PATH_RESPONDERS,
    ]);

    const result = await runSelfCall(
      sql,
      {
        scenario: {
          caller_prompt: "You are Ana, your battery is dead.",
          max_duration_s: 120,
          language: "es",
        },
      },
      scenarioDeps(fetch),
    );
    expect(result.status).toBe(200);

    const llm = bodies["POST /create-retell-llm"] as { general_prompt: string };
    expect(llm.general_prompt.startsWith("{{scenario_prompt}}")).toBe(true);

    const placed = bodies["POST /v2/create-phone-call"] as {
      from_number: string;
      to_number: string;
      retell_llm_dynamic_variables: Record<string, string>;
      agent_override: { agent: { language: string; max_call_duration_ms: number } };
      metadata: Record<string, unknown>;
    };
    expect(placed.from_number).toBe(SELF_CALL_CALLER_NUMBER);
    expect(placed.to_number).toBe(SELF_CALL_CALLEE_NUMBER);
    expect(placed.retell_llm_dynamic_variables["scenario_prompt"]).toBe(
      "You are Ana, your battery is dead.",
    );
    expect(placed.retell_llm_dynamic_variables["disclosure_line"]).toBeTruthy();
    expect(placed.agent_override).toEqual({
      agent: { language: "es-ES", max_call_duration_ms: 120_000 },
    });
    expect(placed.metadata).toMatchObject({ task_id: "HARNESS-1", scenario: true });

    // The scenario agent is cached under its OWN platform_settings key.
    expect(
      sqlCalls.some(
        (c) =>
          c.text.includes("insert into public.platform_settings") &&
          c.values[0] === "self_call_scenario_caller_agent",
      ),
    ).toBe(true);
  });

  it("does not send agent_override or scenario_prompt for the default (no scenario) run", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
    });
    let placedBody: {
      retell_llm_dynamic_variables?: Record<string, string>;
      metadata?: Record<string, unknown>;
    } = {};
    const { fetch } = makeRetellFetch([
      (url, init) => {
        if (url.includes("/v2/create-phone-call") && typeof init?.body === "string") {
          placedBody = JSON.parse(init.body);
        }
        return undefined;
      },
      ...HAPPY_PATH_RESPONDERS,
    ]);
    await runSelfCall(sql, { action: "run" }, scenarioDeps(fetch));
    expect(placedBody).not.toHaveProperty("agent_override");
    expect(placedBody.retell_llm_dynamic_variables).not.toHaveProperty("scenario_prompt");
    expect(placedBody.metadata).toMatchObject({ task_id: "SELFCALL-1" });
  });

  it("reuses the cached scenario agent without creating a new one", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
      "select value from public.platform_settings": [
        { value: { agent_id: "agent_scn_1", llm_id: "llm_scn_1" } },
      ],
    });
    const { fetch, calls } = makeRetellFetch([
      (url, init) =>
        url.includes("/get-agent/agent_scn_1") && init?.method === "GET"
          ? { status: 200, body: { agent_id: "agent_scn_1", version: 1 } }
          : undefined,
      ...HAPPY_PATH_RESPONDERS,
    ]);
    await runSelfCall(sql, { scenario: { caller_prompt: "Hi" } }, scenarioDeps(fetch));
    expect(calls.some((c) => c.startsWith("POST") && c.includes("/create-agent"))).toBe(false);
    expect(calls.some((c) => c.includes("/v2/create-phone-call"))).toBe(true);
  });

  it("returns 422 for an invalid scenario without touching Retell", async () => {
    const { sql } = makeSql();
    const { fetch, calls } = makeRetellFetch([]);
    const result = await runSelfCall(
      sql,
      { scenario: { caller_prompt: "x", max_duration_s: 999 } },
      scenarioDeps(fetch),
    );
    expect(result.status).toBe(422);
    expect(calls).toEqual([]);
  });

  it("surfaces the caller leg's combined cost in cents", async () => {
    const { sql } = makeSql({
      "select t.id as tenant_id, t.name as business_name": [CALLEE_TENANT_FIXTURE],
    });
    const { fetch } = makeRetellFetch([
      (url, init) =>
        url.includes("/v2/get-call/") && init?.method === "GET"
          ? {
              status: 200,
              body: {
                call_status: "ended",
                duration_ms: 60_000,
                call_cost: { combined_cost: 12.5 },
              },
            }
          : undefined,
      ...HAPPY_PATH_RESPONDERS,
    ]);
    const result = await runSelfCall(
      sql,
      { scenario: { caller_prompt: "Hi" } },
      scenarioDeps(fetch),
    );
    const body = result.body as { caller_leg: { combined_cost_cents: number | null } };
    expect(body.caller_leg.combined_cost_cents).toBe(12.5);
  });
});
