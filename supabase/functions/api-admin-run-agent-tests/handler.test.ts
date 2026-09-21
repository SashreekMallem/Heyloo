import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  runAgentTests,
  runChatSmokeAgainstChatAgent,
  simulateInboundCall,
  validateRequest,
  validateSimulateRequest,
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("validateRequest", () => {
  it("accepts a bare tenant_id", () => {
    expect(validateRequest({ tenant_id: "t1" })).toEqual({ ok: true, data: { tenant_id: "t1" } });
  });

  it("rejects a missing tenant_id", () => {
    expect(validateRequest({})).toEqual({ ok: false, error: "invalid_tenant_id" });
  });
});

describe("runAgentTests", () => {
  it("returns 422 when the tenant has no compiled agent", async () => {
    const { sql } = makeSql({
      "from public.tenants where id": [{ vertical: "auto" }],
      "from public.agent_configs": [{ compiled_config: null }],
    });
    const result = await runAgentTests(
      sql,
      { tenant_id: "t1" },
      { retellFetch: async () => jsonResponse({}), retellApiKey: "key", logger },
    );
    expect(result).toEqual({ status: 422, body: { error: "tenant_has_no_compiled_agent" } });
  });

  it("creates definitions + a batch test, polls to settlement, and returns per-scenario results plus tool_health counts", async () => {
    const { sql } = makeSql({
      "from public.tenants where id": [
        {
          vertical: "auto",
          business_name: "Riverside Auto",
          business_hours: {},
          hours_exceptions: [],
          manual_mode: false,
          language_primary: "en",
          timezone: "America/New_York",
        },
      ],
      "from public.agent_configs": [
        {
          compiled_config: {
            response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
          },
          assistant_name: "Riley",
          dynamic_variable_overrides: {
            tow_partner: { name: "Acme Towing", phone: "555-0100" },
          },
        },
      ],
      "from public.tool_health": [
        { tool_name: "lookup_customer", cnt: 3, success_cnt: 3 },
        { tool_name: "create_booking", cnt: 1, success_cnt: 1 },
      ],
      "from public.call_logs": [{ cnt: 0 }],
    });

    let definitionCount = 0;
    const capturedDynamicVariables: Array<Record<string, string>> = [];
    const retellFetch = async (url: string, init?: RequestInit) => {
      if (url.includes("/create-test-case-definition")) {
        definitionCount += 1;
        const parsed = init?.body ? JSON.parse(init.body as string) : {};
        capturedDynamicVariables.push(parsed.dynamic_variables ?? {});
        return jsonResponse({ test_case_definition_id: `def_${definitionCount}` });
      }
      if (url.includes("/create-batch-test")) {
        return jsonResponse({ test_case_batch_job_id: "batch_1", status: "in_progress" });
      }
      if (url.includes("/v2/list-test-runs/")) {
        return jsonResponse({
          items: Array.from({ length: definitionCount }, (_, i) => ({
            test_case_job_id: `job_${i}`,
            status: "pass",
            test_case_definition_id: `def_${i + 1}`,
            result_explanation: "ok",
            transcript_snapshot: { transcript_object: [] },
          })),
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await runAgentTests(
      sql,
      { tenant_id: "t1", scenarios: ["book_new_caller", "faq_hours_pricing"] },
      { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 5000, logger },
    );

    expect(result.status).toBe(200);
    const body = result.body as {
      settled: boolean;
      results: Array<{ case_id: string; status: string }>;
      tool_health: { total: number };
    };
    expect(body.settled).toBe(true);
    expect(body.results).toHaveLength(2);
    expect(body.results.every((r) => r.status === "pass")).toBe(true);
    expect(body.tool_health.total).toBe(4);
    // CALL-7: every compiled-prompt `{{token}}` this vertical's prompt can
    // reference — business_name/assistant_name (always) plus this
    // vertical's own resolveAutoTokens-derived tokens (tow_partner_name,
    // from the dynamic_variable_overrides fixture above) — must be present
    // on EVERY test-case definition, not left as a literal unresolved
    // placeholder (a batch test never goes through `/voice-inbound`, the
    // only other place these get set).
    expect(capturedDynamicVariables).toHaveLength(2);
    for (const vars of capturedDynamicVariables) {
      expect(vars["business_name"]).toBe("Riverside Auto");
      expect(vars["assistant_name"]).toBe("Riley");
      expect(vars["tow_partner_name"]).toBe("Acme Towing");
      expect(vars["cancellation_policy_text"]).toEqual(expect.any(String));
    }
  });

  it("returns settled:false with a resume payload when the batch doesn't finish within the poll budget", async () => {
    const { sql } = makeSql({
      "from public.tenants where id": [
        {
          vertical: "auto",
          business_hours: {},
          hours_exceptions: [],
          manual_mode: false,
          language_primary: "en",
          timezone: "America/New_York",
        },
      ],
      "from public.agent_configs": [
        {
          compiled_config: {
            response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
          },
        },
      ],
      "from public.tool_health": [],
      "from public.call_logs": [{ cnt: 0 }],
    });

    const retellFetch = async (url: string) => {
      if (url.includes("/create-test-case-definition")) {
        return jsonResponse({ test_case_definition_id: "def_1" });
      }
      if (url.includes("/create-batch-test")) {
        return jsonResponse({ test_case_batch_job_id: "batch_1", status: "in_progress" });
      }
      if (url.includes("/v2/list-test-runs/")) {
        return jsonResponse({
          items: [
            {
              test_case_job_id: "job_0",
              status: "in_progress",
              test_case_definition_id: "def_1",
            },
          ],
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await runAgentTests(
      sql,
      { tenant_id: "t1", scenarios: ["book_new_caller"] },
      { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 0, logger },
    );

    const body = result.body as { settled: boolean; resume?: { batch_job_id: string } };
    expect(body.settled).toBe(false);
    expect(body.resume?.batch_job_id).toBe("batch_1");
  });

  // CALL-8 (docs/BUILD_PLAN.md) — field_capture verification against the
  // real DB row a write-intent scenario's tool call produced.
  describe("CALL-8: field_capture (required-field verification per scenario)", () => {
    it("reports fields_missing: [] once the real bookings row has every auto-required field, for the scenario whose expectedPhone matches", async () => {
      const { sql } = makeSql({
        "from public.tenants where id": [
          {
            vertical: "auto",
            business_name: "Riverside Auto",
            business_hours: {},
            hours_exceptions: [],
            manual_mode: false,
            language_primary: "en",
            timezone: "America/New_York",
          },
        ],
        "from public.agent_configs": [
          {
            compiled_config: {
              response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
            },
          },
        ],
        "from public.bookings b": [
          {
            start_at: "2026-01-05T15:00:00Z",
            end_at: "2026-01-05T15:30:00Z",
            party_size: null,
            structured_payload: {
              vehicle_year: 2019,
              vehicle_make: "Honda",
              vehicle_model: "Civic",
              symptom_category: "oil_change",
            },
            customer_name: "Jamie Rivera",
            customer_phone: "+15552010199",
          },
        ],
        "from public.tool_health": [],
        "select count(*)::int as cnt from public.call_logs": [{ cnt: 0 }],
      });
      const retellFetch = async (url: string) => {
        if (url.includes("/create-test-case-definition")) {
          return jsonResponse({ test_case_definition_id: "def_1" });
        }
        if (url.includes("/create-batch-test")) {
          return jsonResponse({ test_case_batch_job_id: "batch_1" });
        }
        if (url.includes("/v2/list-test-runs/")) {
          return jsonResponse({
            items: [
              {
                test_case_job_id: "job_0",
                status: "pass",
                test_case_definition_id: "def_1",
                result_explanation: "ok",
                transcript_snapshot: {},
              },
            ],
          });
        }
        throw new Error(`unexpected call: ${url}`);
      };
      const result = await runAgentTests(
        sql,
        { tenant_id: "t1", scenarios: ["book_new_caller"] },
        { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 5000, logger },
      );
      const body = result.body as {
        results: Array<{
          case_id: string;
          field_capture: {
            write_intent: string;
            row_found: boolean;
            fields_missing: string[];
            fields_captured: string[];
          } | null;
        }>;
      };
      const scenario = body.results.find((r) => r.case_id === "book_new_caller");
      expect(scenario?.field_capture).toEqual(
        expect.objectContaining({
          write_intent: "create_booking",
          row_found: true,
          fields_missing: [],
        }),
      );
      expect(scenario?.field_capture?.fields_captured).toEqual(
        expect.arrayContaining([
          "customer.name",
          "customer.phone",
          "start",
          "end",
          "structured_payload.vehicle_year",
          "structured_payload.vehicle_make",
          "structured_payload.vehicle_model",
          "structured_payload.symptom_category",
        ]),
      );
    });

    it("reports the exact missing fields (never crashes) when no matching bookings row exists at all", async () => {
      const { sql } = makeSql({
        "from public.tenants where id": [
          {
            vertical: "auto",
            business_name: "Riverside Auto",
            business_hours: {},
            hours_exceptions: [],
            manual_mode: false,
            language_primary: "en",
            timezone: "America/New_York",
          },
        ],
        "from public.agent_configs": [
          {
            compiled_config: {
              response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
            },
          },
        ],
        "from public.tool_health": [],
        "select count(*)::int as cnt from public.call_logs": [{ cnt: 0 }],
      });
      const retellFetch = async (url: string) => {
        if (url.includes("/create-test-case-definition")) {
          return jsonResponse({ test_case_definition_id: "def_1" });
        }
        if (url.includes("/create-batch-test")) {
          return jsonResponse({ test_case_batch_job_id: "batch_1" });
        }
        if (url.includes("/v2/list-test-runs/")) {
          return jsonResponse({
            items: [
              {
                test_case_job_id: "job_0",
                status: "fail",
                test_case_definition_id: "def_1",
                result_explanation: "did not book",
              },
            ],
          });
        }
        throw new Error(`unexpected call: ${url}`);
      };
      const result = await runAgentTests(
        sql,
        { tenant_id: "t1", scenarios: ["book_new_caller"] },
        { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 5000, logger },
      );
      const body = result.body as {
        results: Array<{
          case_id: string;
          field_capture: { row_found: boolean; fields_missing: string[] } | null;
        }>;
      };
      const scenario = body.results.find((r) => r.case_id === "book_new_caller");
      expect(scenario?.field_capture?.row_found).toBe(false);
      expect(scenario?.field_capture?.fields_missing.length).toBeGreaterThan(0);
    });

    it("verifies take_message intent from call_logs.structured_booking_payload (caller_phone-matched), for a vertical whose take_message overlay requires extra fields (legal)", async () => {
      const { sql } = makeSql({
        "from public.tenants where id": [
          {
            vertical: "legal",
            business_name: "Firstlight Legal",
            business_hours: {},
            hours_exceptions: [],
            manual_mode: false,
            language_primary: "en",
            timezone: "America/New_York",
          },
        ],
        "from public.agent_configs": [
          {
            compiled_config: {
              response_engine: { type: "multi-prompt", llm_id: "llm_1" },
            },
          },
        ],
        "structured_booking_payload ->> 'caller_phone'": [
          {
            message_text: "New client intake.",
            structured_booking_payload: {
              caller_name: "Taylor Brooks",
              caller_phone: "+15552010166",
              matter_type: "car accident",
              opposing_party: "Jordan Reyes",
              urgency: "standard",
            },
          },
        ],
        "from public.tool_health": [],
        "select count(*)::int as cnt from public.call_logs": [{ cnt: 0 }],
      });
      const retellFetch = async (url: string) => {
        if (url.includes("/create-test-case-definition")) {
          return jsonResponse({ test_case_definition_id: "def_1" });
        }
        if (url.includes("/create-batch-test")) {
          return jsonResponse({ test_case_batch_job_id: "batch_1" });
        }
        if (url.includes("/v2/list-test-runs/")) {
          return jsonResponse({
            items: [
              {
                test_case_job_id: "job_0",
                status: "pass",
                test_case_definition_id: "def_1",
                result_explanation: "ok",
              },
            ],
          });
        }
        throw new Error(`unexpected call: ${url}`);
      };
      const result = await runAgentTests(
        sql,
        { tenant_id: "t1", scenarios: ["new_client_intake"] },
        { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 5000, logger },
      );
      const body = result.body as {
        results: Array<{
          case_id: string;
          field_capture: {
            write_intent: string;
            row_found: boolean;
            fields_missing: string[];
          } | null;
        }>;
      };
      const scenario = body.results.find((r) => r.case_id === "new_client_intake");
      expect(scenario?.field_capture).toEqual(
        expect.objectContaining({
          write_intent: "take_message",
          row_found: true,
          fields_missing: [],
        }),
      );
    });

    it("leaves field_capture null for a writeIntent:'none' scenario (e.g. faq_hours_pricing)", async () => {
      const { sql } = makeSql({
        "from public.tenants where id": [
          {
            vertical: "auto",
            business_name: "Riverside Auto",
            business_hours: {},
            hours_exceptions: [],
            manual_mode: false,
            language_primary: "en",
            timezone: "America/New_York",
          },
        ],
        "from public.agent_configs": [
          {
            compiled_config: {
              response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
            },
          },
        ],
        "from public.tool_health": [],
        "select count(*)::int as cnt from public.call_logs": [{ cnt: 0 }],
      });
      const retellFetch = async (url: string) => {
        if (url.includes("/create-test-case-definition")) {
          return jsonResponse({ test_case_definition_id: "def_1" });
        }
        if (url.includes("/create-batch-test")) {
          return jsonResponse({ test_case_batch_job_id: "batch_1" });
        }
        if (url.includes("/v2/list-test-runs/")) {
          return jsonResponse({
            items: [
              {
                test_case_job_id: "job_0",
                status: "pass",
                test_case_definition_id: "def_1",
                result_explanation: "ok",
              },
            ],
          });
        }
        throw new Error(`unexpected call: ${url}`);
      };
      const result = await runAgentTests(
        sql,
        { tenant_id: "t1", scenarios: ["faq_hours_pricing"] },
        { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 5000, logger },
      );
      const body = result.body as { results: Array<{ case_id: string; field_capture: unknown }> };
      expect(body.results.find((r) => r.case_id === "faq_hours_pricing")?.field_capture).toBeNull();
    });
  });

  it("resumes an in-flight batch without recreating test case definitions", async () => {
    const { sql } = makeSql({
      "from public.tool_health": [],
      "from public.call_logs": [{ cnt: 0 }],
    });
    let definitionCallCount = 0;
    const retellFetch = async (url: string) => {
      if (url.includes("/create-test-case-definition")) {
        definitionCallCount += 1;
        return jsonResponse({});
      }
      if (url.includes("/v2/list-test-runs/")) {
        return jsonResponse({
          items: [
            {
              test_case_job_id: "job_0",
              status: "pass",
              test_case_definition_id: "def_1",
              result_explanation: "ok",
              transcript_snapshot: {},
            },
          ],
        });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await runAgentTests(
      sql,
      {
        tenant_id: "t1",
        resume: {
          batch_job_id: "batch_1",
          case_definitions: [{ case_id: "book_new_caller", definition_id: "def_1" }],
          started_at: "2026-09-20T00:00:00.000Z",
        },
      },
      { retellFetch, retellApiKey: "key", pollIntervalMs: 0, pollBudgetMs: 5000, logger },
    );

    expect(definitionCallCount).toBe(0);
    const body = result.body as { settled: boolean; results: Array<{ status: string }> };
    expect(body.settled).toBe(true);
    expect(body.results[0]?.status).toBe("pass");
  });
});

describe("runAgentTests — chat_smoke mode (CALL-2: confirmed unsupported for a voice agent)", () => {
  it("reports unsupported without calling create-chat at all — docs.retellai.com/build/create-chat-agent confirms Chat requires a dedicated chat agent, never a voice agent", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [{ retell_agent_id: "agent_1" }] });
    let retellFetchCalls = 0;
    const result = await runAgentTests(
      sql,
      { tenant_id: "t1", mode: "chat_smoke" },
      {
        retellFetch: async () => {
          retellFetchCalls += 1;
          return jsonResponse({});
        },
        retellApiKey: "key",
        logger,
      },
    );
    expect(retellFetchCalls).toBe(0);
    expect(result).toEqual({
      status: 200,
      body: expect.objectContaining({
        tenant_id: "t1",
        mode: "chat_smoke",
        unsupported: true,
        reason: expect.stringContaining("chat agent"),
      }),
    });
  });
});

describe("runChatSmokeAgainstChatAgent (kept, not currently called by runAgentTests — CALL-2)", () => {
  it("returns 422 when the tenant has no compiled agent", async () => {
    const { sql } = makeSql({ "from public.agent_configs": [{ retell_agent_id: null }] });
    const result = await runChatSmokeAgainstChatAgent(sql, "t1", {
      retellFetch: async () => jsonResponse({}),
      retellApiKey: "key",
      logger,
    });
    expect(result).toEqual({ status: 422, body: { error: "tenant_has_no_compiled_agent" } });
  });

  it("creates a chat, drives two turns, and reports tool_health/call_logs counts since chat start", async () => {
    const { sql } = makeSql({
      "from public.agent_configs": [{ retell_agent_id: "agent_1" }],
      "from public.tool_health": [{ tool_name: "check_availability", cnt: 1, success_cnt: 1 }],
      "from public.call_logs": [{ cnt: 0 }],
    });
    let completionCalls = 0;
    const retellFetch = async (url: string) => {
      if (url.includes("/create-chat-completion")) {
        completionCalls += 1;
        return jsonResponse({ messages: [{ role: "agent", content: `reply ${completionCalls}` }] });
      }
      if (url.includes("/create-chat")) return jsonResponse({ chat_id: "chat_1" });
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await runChatSmokeAgainstChatAgent(sql, "t1", {
      retellFetch,
      retellApiKey: "key",
      logger,
    });

    expect(result.status).toBe(200);
    const body = result.body as {
      chat_id: string;
      messages: Array<{ role: string; content: string }>;
      tool_health: { total: number };
    };
    expect(body.chat_id).toBe("chat_1");
    expect(completionCalls).toBe(2);
    expect(body.messages.length).toBe(4);
    expect(body.tool_health.total).toBe(1);
  });
});

describe("validateSimulateRequest", () => {
  it("accepts a bare tenant_id", () => {
    expect(validateSimulateRequest({ tenant_id: "t1" })).toEqual({
      ok: true,
      data: { tenant_id: "t1" },
    });
  });

  it("accepts an optional from_number", () => {
    expect(validateSimulateRequest({ tenant_id: "t1", from_number: "+15552010199" })).toEqual({
      ok: true,
      data: { tenant_id: "t1", from_number: "+15552010199" },
    });
  });

  it("rejects a missing tenant_id", () => {
    expect(validateSimulateRequest({})).toEqual({ ok: false, error: "invalid_tenant_id" });
  });

  it("rejects a non-string from_number", () => {
    expect(validateSimulateRequest({ tenant_id: "t1", from_number: 5 })).toEqual({
      ok: false,
      error: "invalid_from_number",
    });
  });
});

describe("simulateInboundCall", () => {
  it("CALL-9: 404s when the tenant doesn't exist", async () => {
    const { sql } = makeSql({});
    const result = await simulateInboundCall(
      sql,
      { tenant_id: "no-such-tenant" },
      { retellFetch: async () => jsonResponse({}), retellApiKey: "key", logger },
    );
    expect(result).toEqual({ status: 404, body: { error: "tenant_not_found" } });
  });

  it("CALL-9: with no from_number, returns dynamic variables with the first-time-caller default caller_recent_context", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants t": [
        {
          business_name: "Riverside Auto Repair",
          vertical: "auto",
          timezone: "America/Los_Angeles",
          business_hours: {},
          hours_exceptions: [],
          manual_mode: false,
          language_primary: "en",
          assistant_name: "Sam",
          special_instructions: null,
          dynamic_variable_overrides: {},
          transfer_number: null,
          disclosure_line: "This call may be recorded, and you're speaking with an AI assistant.",
        },
      ],
    });
    const result = await simulateInboundCall(
      sql,
      { tenant_id: "t1" },
      {
        retellFetch: async () => jsonResponse({}),
        retellApiKey: "key",
        logger,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
      },
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      tenant_id: string;
      from_number: string | null;
      dynamic_variables: Record<string, unknown>;
    };
    expect(body.tenant_id).toBe("t1");
    expect(body.from_number).toBeNull();
    expect(body.dynamic_variables["business_name"]).toBe("Riverside Auto Repair");
    expect(body.dynamic_variables["assistant_name"]).toBe("Sam");
    // CALL-9: always a real sentence now, never omitted (see
    // inbound-dynamic-variables.ts#resolveCallerRecentContext).
    expect(body.dynamic_variables["caller_recent_context"]).toBe(
      "No caller ID is available for this call — treat this as a first-time caller and collect their name and phone number normally.",
    );
    // Never queried customers at all — no from_number to look up.
    expect(calls.some((c) => c.text.includes("from public.customers"))).toBe(false);
  });

  it("CALL-9: with a from_number matching a seeded customer, returns caller_recent_context — the live pre-call DB pull proof", async () => {
    const { sql, calls } = makeSql({
      "from public.tenants t": [
        {
          business_name: "Riverside Auto Repair",
          vertical: "auto",
          timezone: "America/Los_Angeles",
          business_hours: {},
          hours_exceptions: [],
          manual_mode: false,
          language_primary: "en",
          assistant_name: "Sam",
          special_instructions: null,
          dynamic_variable_overrides: {},
          transfer_number: null,
          disclosure_line: "This call may be recorded, and you're speaking with an AI assistant.",
        },
      ],
      "from public.customers": [
        { name: "Jamie Rivera", last_seen_at: "2026-09-01T00:00:00Z", lifetime_bookings: 2 },
      ],
    });
    const result = await simulateInboundCall(
      sql,
      { tenant_id: "t1", from_number: "555-201-0199" },
      {
        retellFetch: async () => jsonResponse({}),
        retellApiKey: "key",
        logger,
        now: () => new Date("2026-09-21T18:00:00.000Z"),
      },
    );
    expect(result.status).toBe(200);
    const body = result.body as {
      from_number: string | null;
      dynamic_variables: Record<string, unknown>;
    };
    expect(body.from_number).toBe("+15552010199"); // normalized E.164
    expect(body.dynamic_variables["caller_recent_context"]).toBe(
      "Jamie has booked with us before.",
    );
    const customerQuery = calls.find((c) => c.text.includes("from public.customers"));
    expect(customerQuery?.values).toContain("+15552010199");
  });
});
