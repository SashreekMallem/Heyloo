import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { findStaleCalls, reconcileOneCall } from "./handler.ts";

const logger = createLogger();

describe("findStaleCalls", () => {
  it("queries call_logs for null-classification rows older than the cutoff", async () => {
    const calls: unknown[][] = [];
    const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push(values);
      return Promise.resolve([{ id: "cl1", retell_call_id: "call_1", tenant_id: "t1" }]);
    }) as SqlClient;
    const rows = await findStaleCalls(sql, 15);
    expect(rows).toHaveLength(1);
    expect(calls[0]).toContain(15);
  });
});

describe("reconcileOneCall", () => {
  const row = { id: "cl1", retell_call_id: "call_1", tenant_id: "t1" };

  it("returns false when Retell's get-call errors", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await reconcileOneCall(sql, row, {
      retellFetch: (() => Promise.resolve(new Response("{}", { status: 500 }))) as never,
      retellApiKey: "key",
      logger,
    });
    expect(result).toBe(false);
  });

  it("backfills analysis fields and returns true on a valid response", async () => {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      calls.push(text);
      return Promise.resolve([{ id: "cl1", tenant_id: "t1", urgency_flag: false }]);
    }) as SqlClient;
    const result = await reconcileOneCall(sql, row, {
      retellFetch: (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ call_id: "call_1", call_analysis: { call_summary: "summary" } }),
            { status: 200 },
          ),
        )) as never,
      retellApiKey: "key",
      logger,
    });
    expect(result).toBe(true);
    expect(calls.some((c) => c.includes("update public.call_logs"))).toBe(true);
    // Reconciliation must never re-trigger the call_ended side effects
    // (cost_events/usage_events/recording-fetch enqueue).
    expect(calls.some((c) => c.includes("insert into public.cost_events"))).toBe(false);
    expect(calls.some((c) => c.includes("pgmq.send"))).toBe(false);
  });
});
