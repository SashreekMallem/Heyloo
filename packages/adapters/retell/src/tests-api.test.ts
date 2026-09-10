import { describe, expect, it, vi } from "vitest";
import { createRetellBatchSimulationClient, encodeResponseEngineRef } from "./tests-api.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const RESPONSE_ENGINE_REF = encodeResponseEngineRef({
  type: "conversation-flow",
  conversation_flow_id: "conversation_flow_1",
  version: 3,
});

describe("createRetellBatchSimulationClient", () => {
  it("resolves an empty map without any request when given zero cases", async () => {
    const fetchImpl = vi.fn();
    const client = createRetellBatchSimulationClient({ apiKey: "k", fetchImpl });
    const result = await client.runScenarios("auto", RESPONSE_ENGINE_REF, []);
    expect(result.size).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates one definition per case, one batch test, polls until settled, and normalizes each transcript", async () => {
    const paths: string[] = [];
    let listCallCount = 0;

    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url);
      paths.push(u.pathname);

      if (u.pathname === "/create-test-case-definition") {
        // Two cases submitted — return a distinct definition id per call in order.
        const id = paths.filter((p) => p === "/create-test-case-definition").length;
        return jsonResponse(200, { test_case_definition_id: `def_${id}` });
      }
      if (u.pathname === "/create-batch-test") {
        return jsonResponse(200, { test_case_batch_job_id: "batch_1", status: "in_progress" });
      }
      if (u.pathname === "/v2/list-test-runs/batch_1") {
        listCallCount++;
        if (listCallCount === 1) {
          // First poll: def_1 still in progress, def_2 already passed.
          return jsonResponse(200, {
            items: [
              {
                test_case_job_id: "job_1",
                status: "in_progress",
                test_case_definition_id: "def_1",
              },
              {
                test_case_job_id: "job_2",
                status: "pass",
                test_case_definition_id: "def_2",
                transcript_snapshot: {
                  transcript_with_tool_calls: [
                    { role: "agent", content: "Thanks for calling, this call may be recorded." },
                    { role: "user", content: "I need to book an oil change." },
                    {
                      role: "node_transition",
                      new_node_id: "check_time",
                      new_node_name: "Check availability",
                    },
                    {
                      role: "tool_call_invocation",
                      name: "check_availability",
                      tool_call_id: "tc_1",
                      arguments: JSON.stringify({ date_range: { start: "2026-09-11" } }),
                    },
                  ],
                },
              },
            ],
          });
        }
        // Second poll: def_1 settles too.
        return jsonResponse(200, {
          items: [
            {
              test_case_job_id: "job_1",
              status: "fail",
              test_case_definition_id: "def_1",
              result_explanation: "never called the tool",
              transcript_snapshot: {
                transcript_with_tool_calls: [{ role: "agent", content: "Hello!" }],
              },
            },
          ],
        });
      }
      throw new Error(`unexpected path ${u.pathname}`);
    });

    const client = createRetellBatchSimulationClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 0,
      sleep: async () => {},
    });

    const result = await client.runScenarios("auto", RESPONSE_ENGINE_REF, [
      { id: "case_1", personaPrompt: "Say you want to book an oil change." },
      { id: "case_2", personaPrompt: "Say you want to book an oil change." },
    ]);

    expect(result.size).toBe(2);
    expect(result.get("case_2")?.toolCalls).toEqual([
      { name: "check_availability", arguments: { date_range: { start: "2026-09-11" } } },
    ]);
    expect(result.get("case_2")?.reachedStates).toEqual(["check_time"]);
    expect(result.get("case_1")?.firstAgentUtterance).toBe("Hello!");
    expect(paths.filter((p) => p === "/create-test-case-definition")).toHaveLength(2);
    expect(paths.filter((p) => p === "/create-batch-test")).toHaveLength(1);
  });

  it("throws (never fabricates a pass) when a case errors during simulation", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url);
      if (u.pathname === "/create-test-case-definition") {
        return jsonResponse(200, { test_case_definition_id: "def_1" });
      }
      if (u.pathname === "/create-batch-test") {
        return jsonResponse(200, { test_case_batch_job_id: "batch_1", status: "in_progress" });
      }
      return jsonResponse(200, {
        items: [
          {
            test_case_job_id: "job_1",
            status: "error",
            test_case_definition_id: "def_1",
            result_explanation: "upstream simulation crashed",
          },
        ],
      });
    });

    const client = createRetellBatchSimulationClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(
      client.runScenarios("auto", RESPONSE_ENGINE_REF, [{ id: "case_1", personaPrompt: "hi" }]),
    ).rejects.toThrow(/errored during simulation/);
  });

  it("throws loudly rather than silently guessing when transcript_snapshot doesn't match any known shape", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url);
      if (u.pathname === "/create-test-case-definition") {
        return jsonResponse(200, { test_case_definition_id: "def_1" });
      }
      if (u.pathname === "/create-batch-test") {
        return jsonResponse(200, { test_case_batch_job_id: "batch_1", status: "complete" });
      }
      return jsonResponse(200, {
        items: [
          {
            test_case_job_id: "job_1",
            status: "pass",
            test_case_definition_id: "def_1",
            transcript_snapshot: { some_unrecognized_field: [] },
          },
        ],
      });
    });

    const client = createRetellBatchSimulationClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(
      client.runScenarios("auto", RESPONSE_ENGINE_REF, [{ id: "case_1", personaPrompt: "hi" }]),
    ).rejects.toThrow(/UNCONFIRMED against a live Retell account/);
  });

  it("rejects a responseEngineRef that isn't valid encodeResponseEngineRef output", async () => {
    const client = createRetellBatchSimulationClient({ apiKey: "k", fetchImpl: vi.fn() });
    await expect(
      client.runScenarios("auto", "not-json", [{ id: "case_1", personaPrompt: "hi" }]),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("times out (never hangs forever) when a case never leaves pending", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = new URL(url);
      if (u.pathname === "/create-test-case-definition") {
        return jsonResponse(200, { test_case_definition_id: "def_1" });
      }
      if (u.pathname === "/create-batch-test") {
        return jsonResponse(200, { test_case_batch_job_id: "batch_1", status: "in_progress" });
      }
      return jsonResponse(200, {
        items: [{ test_case_job_id: "job_1", status: "pending", test_case_definition_id: "def_1" }],
      });
    });

    const client = createRetellBatchSimulationClient({
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollTimeoutMs: 20,
      pollIntervalMs: 1,
      sleep: async () => {},
    });

    await expect(
      client.runScenarios("auto", RESPONSE_ENGINE_REF, [{ id: "case_1", personaPrompt: "hi" }]),
    ).rejects.toThrow(/did not settle within/);
  });
});
