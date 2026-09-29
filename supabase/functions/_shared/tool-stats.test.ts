import { beforeEach, describe, expect, it } from "vitest";
import type { ToolCall } from "./schemas/voice-tools.ts";
import {
  recordToolStat,
  resetToolStatMemoForTests,
  resolveTelemetryTenantId,
  roundMs,
  serverTimingHeader,
  type ToolStageTimings,
} from "./tool-stats.ts";
import type { SqlClient } from "./types.ts";

/**
 * OPS-5 (docs/BUILD_NOTES.md): unit coverage for the `tool_health`
 * attribution fix — dental showed zero rows because every Retell
 * batch-test call shares the literal `call_id` "playground", so
 * `voice-tools/context.ts`'s cached `call_logs` lookup permanently
 * returns whichever tenant happened to run the first-ever batch test
 * against that id, not the tenant actually under test. See
 * `resolveTelemetryTenantId`'s own docstring in tool-stats.ts for the
 * full root-cause writeup.
 */
describe("resolveTelemetryTenantId", () => {
  it("prefers the per-call heyloo_tenant_id dynamic variable when present (batch-test path)", () => {
    const call: ToolCall = {
      call_id: "playground",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "dental_tenant" },
    };
    // The resolved ctx.tenantId is a DIFFERENT (stale/collided) tenant —
    // the dynamic variable must win.
    expect(resolveTelemetryTenantId("auto_tenant", call)).toBe("dental_tenant");
  });

  it("falls back to the resolved tenantId when no dynamic variable is set (real-call path, unchanged)", () => {
    const call: ToolCall = { call_id: "call_real_1" };
    expect(resolveTelemetryTenantId("real_tenant", call)).toBe("real_tenant");
  });

  it("falls back to the resolved tenantId when call is undefined", () => {
    expect(resolveTelemetryTenantId("real_tenant", undefined)).toBe("real_tenant");
  });

  it("falls back to the resolved tenantId when the dynamic variable is present but not a string", () => {
    const call: ToolCall = {
      call_id: "playground",
      retell_llm_dynamic_variables: { heyloo_tenant_id: 12345 },
    };
    expect(resolveTelemetryTenantId("auto_tenant", call)).toBe("auto_tenant");
  });

  it("returns null when neither source has a tenant (unresolved call, unchanged behavior)", () => {
    expect(resolveTelemetryTenantId(null, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// HOTPATH (docs/BUILD_NOTES.md): per-stage timings on tool_health + the
// Server-Timing header.
// ---------------------------------------------------------------------------

const STAGES: ToolStageTimings = {
  v: 1,
  region: "us-west-2",
  isolate_seq: 1,
  isolate_age_ms: 3.2,
  db_warm: false,
  body_ms: 0.4,
  verify_ms: 1.26,
  parse_ms: 0.3,
  context_ms: 412.04,
  tool_ms: 388.1,
  total_ms: 802.5,
  budget_ms: 1500,
  outcome: "ok",
  prev_telemetry_ms: null,
};

describe("roundMs", () => {
  it("rounds to 0.1 ms and never goes negative", () => {
    expect(roundMs(1.26)).toBe(1.3);
    expect(roundMs(412.04)).toBe(412);
    expect(roundMs(-0.2)).toBe(0);
  });
});

describe("serverTimingHeader", () => {
  it("emits one W3C Server-Timing entry per measured stage, plus DB warmth and region", () => {
    expect(serverTimingHeader(STAGES)).toBe(
      'body;dur=0.4, verify;dur=1.3, parse;dur=0.3, context;dur=412, tool;dur=388.1, total;dur=802.5, db;desc="cold", region;desc="us-west-2"',
    );
  });

  it("omits stages that never ran (context unresolved) and a missing region", () => {
    const header = serverTimingHeader({
      ...STAGES,
      context_ms: null,
      tool_ms: null,
      region: null,
      db_warm: true,
    });
    expect(header).not.toContain("context;");
    expect(header).not.toContain("tool;");
    expect(header).not.toContain("region;");
    expect(header).toContain('db;desc="warm"');
  });
});

describe("recordToolStat", () => {
  beforeEach(() => resetToolStatMemoForTests());

  function recordingSql(fail?: (text: string) => unknown): {
    sql: SqlClient;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      calls.push({ text, values });
      const err = fail?.(text);
      return err ? Promise.reject(err) : Promise.resolve([]);
    }) as SqlClient;
    return { sql, calls };
  }

  const sample = {
    tenantId: "t1",
    toolName: "check_availability",
    callId: "call_1",
    latencyMs: 800,
    success: true,
    stages: STAGES,
  };

  it("writes the stage timings into tool_health.stages as a raw object (never pre-stringified)", async () => {
    const { sql, calls } = recordingSql();
    await recordToolStat(sql, sample);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("stages");
    expect(calls[0]?.values.at(-1)).toEqual(STAGES);
    expect(typeof calls[0]?.values.at(-1)).toBe("object");
  });

  it("falls back to the pre-HOTPATH column list when the stages column does not exist yet (42703), and remembers that", async () => {
    const { sql, calls } = recordingSql((text) =>
      text.includes("stages")
        ? { code: "42703", message: 'column "stages" does not exist' }
        : undefined,
    );
    await recordToolStat(sql, sample);
    expect(calls.map((c) => c.text.includes("stages"))).toEqual([true, false]);
    await recordToolStat(sql, sample);
    // Second call goes straight to the working column list.
    expect(calls.map((c) => c.text.includes("stages"))).toEqual([true, false, false]);
  });

  it("never throws, whatever the database does", async () => {
    const { sql } = recordingSql(() => new Error("db down"));
    await expect(recordToolStat(sql, sample)).resolves.toBeUndefined();
  });

  it("without stages, writes exactly the pre-HOTPATH row", async () => {
    const { sql, calls } = recordingSql();
    const { stages: _omit, ...withoutStages } = sample;
    await recordToolStat(sql, withoutStages);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).not.toContain("stages");
  });
});
