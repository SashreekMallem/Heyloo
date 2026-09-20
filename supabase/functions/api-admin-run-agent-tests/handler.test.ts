import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { runAgentTests, runChatSmokeAgainstChatAgent, validateRequest } from "./handler.ts";

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
      "from public.tenants where id": [{ vertical: "auto" }],
      "from public.agent_configs": [
        {
          compiled_config: {
            response_engine: { type: "conversation-flow", conversation_flow_id: "flow_1" },
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
    const retellFetch = async (url: string) => {
      if (url.includes("/create-test-case-definition")) {
        definitionCount += 1;
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
  });

  it("returns settled:false with a resume payload when the batch doesn't finish within the poll budget", async () => {
    const { sql } = makeSql({
      "from public.tenants where id": [{ vertical: "auto" }],
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
