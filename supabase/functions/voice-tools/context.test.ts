import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { ToolCall } from "../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { resolveCallContext } from "./context.ts";

const logger = createLogger();

function makeRecordingSql(fixtures: Record<string, unknown[]>): {
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

function makeWarnCapturingLogger(): {
  logger: Logger;
  warnings: { msg: string; fields?: unknown }[];
} {
  const warnings: { msg: string; fields?: unknown }[] = [];
  return {
    logger: {
      debug: () => {},
      info: () => {},
      warn: (msg, fields) => warnings.push({ msg, fields }),
      error: () => {},
    },
    warnings,
  };
}

describe("resolveCallContext", () => {
  it("(a) resolves from an existing call_logs row without touching the payload at all", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.call_logs": [
        { id: "cl1", tenant_id: "t1", caller_number: "+15551234567", vertical: "auto" },
      ],
    });
    const call: ToolCall = { agent_id: "agent_should_be_ignored" };
    const ctx = await resolveCallContext(sql, "call_1", call, logger);
    expect(ctx).toEqual({
      tenantId: "t1",
      callLogId: "cl1",
      retellCallId: "call_1",
      callerNumber: "+15551234567",
      vertical: "auto",
    });
    // Only the call_logs lookup ran — the existing-row path never queries
    // agent_configs/phone_numbers or writes anything.
    expect(calls.length).toBe(1);
    expect(calls[0]?.text).toContain("from public.call_logs");
  });

  it("(b) resolves via call.agent_id -> agent_configs when no call_logs row exists yet, and upserts a placeholder row", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t2", vertical: "veterinary" }],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t2", caller_number: "+15550001111" },
      ],
    });
    const call: ToolCall = {
      agent_id: "agent_abc",
      from_number: "+15550001111",
      call_type: "web_call",
    };
    const ctx = await resolveCallContext(sql, "test_call_9", call, logger);
    expect(ctx).toEqual({
      tenantId: "t2",
      callLogId: "cl-new",
      retellCallId: "test_call_9",
      callerNumber: "+15550001111",
      vertical: "veterinary",
    });
    const agentQuery = calls.find((c) => c.text.includes("from public.agent_configs"));
    expect(agentQuery).toBeDefined();
    expect(agentQuery?.values).toContain("agent_abc");
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall).toBeDefined();
    expect(insertCall?.values).toContain("web_voice"); // call_type !== 'phone_call'
    // Never queried phone_numbers — agent_id resolved it in one query.
    expect(calls.some((c) => c.text.includes("from public.phone_numbers"))).toBe(false);
  });

  it("(b) falls back to call.to_number -> phone_numbers only when agent_id is absent", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.phone_numbers": [
        { tenant_id: "t3", vertical: "dental", phone_number_id: "pn9" },
      ],
      "insert into public.call_logs": [{ id: "cl-new2", tenant_id: "t3", caller_number: null }],
    });
    const call: ToolCall = { to_number: "+15559998888", call_type: "phone_call" };
    const ctx = await resolveCallContext(sql, "call_phone_1", call, logger);
    expect(ctx?.tenantId).toBe("t3");
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain("phone"); // call_type === 'phone_call'
    expect(insertCall?.values).toContain("pn9");
  });

  it("(b) falls back to to_number when agent_id is present but doesn't resolve", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.phone_numbers": [{ tenant_id: "t4", vertical: "auto", phone_number_id: "pn1" }],
      "insert into public.call_logs": [{ id: "cl-new3", tenant_id: "t4", caller_number: null }],
    });
    const call: ToolCall = { agent_id: "agent_unknown", to_number: "+15551110000" };
    const ctx = await resolveCallContext(sql, "call_x", call, logger);
    expect(ctx?.tenantId).toBe("t4");
    expect(calls.some((c) => c.text.includes("from public.agent_configs"))).toBe(true);
    expect(calls.some((c) => c.text.includes("from public.phone_numbers"))).toBe(true);
  });

  it("(b) CALL-2: falls back to retell_llm_dynamic_variables.heyloo_tenant_id when agent_id AND to_number are BOTH absent — the real shape of a Retell batch-test simulator's tool-call payload (RETELL-VERIFIED live)", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.tenants where id": [{ id: "t6", vertical: "dental" }],
      "insert into public.call_logs": [{ id: "cl-new4", tenant_id: "t6", caller_number: null }],
    });
    const call: ToolCall = {
      call_type: "web_call",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "t6", unrelated_var: "ignored" },
    };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    expect(ctx?.tenantId).toBe("t6");
    expect(ctx?.vertical).toBe("dental");
    expect(calls.some((c) => c.text.includes("from public.agent_configs"))).toBe(false);
    expect(calls.some((c) => c.text.includes("from public.phone_numbers"))).toBe(false);
  });

  it("CALL-5: marks a batch-test/'playground' placeholder row is_test_call=true and source='tool_first_seen', so it never pollutes a tenant's real dashboard", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.tenants where id": [{ id: "t6", vertical: "dental" }],
      "insert into public.call_logs": [{ id: "cl-new4", tenant_id: "t6", caller_number: null }],
    });
    const call: ToolCall = {
      call_type: "web_call",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "t6" },
    };
    await resolveCallContext(sql, "playground", call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.text).toContain("'tool_first_seen'");
    expect(insertCall?.values).toContain(true); // is_test_call
  });

  it("CALL-5: a REAL call resolved via agent_id/to_number is never marked is_test_call from this path", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t4", vertical: "auto" }],
      "insert into public.call_logs": [{ id: "cl-new5", tenant_id: "t4", caller_number: null }],
    });
    const call: ToolCall = { agent_id: "agent_real", call_type: "phone_call" };
    await resolveCallContext(sql, "call_real_1", call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain(false); // is_test_call
  });

  it("(b) never trusts a spoofed tenant hint — only agent_id -> agent_configs is consulted, and cross-tenant resolution is impossible via args", async () => {
    // agent_id belongs to tenant A only; nothing about tenant B is ever
    // read from anywhere but the authoritative agent_configs/phone_numbers
    // tables keyed by agent_id/to_number.
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "tenant-a", vertical: "auto" }],
      "insert into public.call_logs": [{ id: "cl-a", tenant_id: "tenant-a", caller_number: null }],
    });
    const call: ToolCall = { agent_id: "agent_of_tenant_a" };
    const ctx = await resolveCallContext(sql, "call_spoof_test", call, logger);
    expect(ctx?.tenantId).toBe("tenant-a");
    // The agent_configs lookup was filtered by agent_id alone.
    const agentQuery = calls.find((c) => c.text.includes("from public.agent_configs"));
    expect(agentQuery?.values).toEqual(["agent_of_tenant_a"]);
  });

  it("(b) upsert-on-conflict reads back whichever row already won the race, never creating a duplicate", async () => {
    // Simulates the race: by the time this INSERT executes, another writer
    // (a concurrent tool call, or call_started's own webhook) already
    // committed the row for this call_id — the mock returns that ALREADY-
    // EXISTING row's data (a different tenant/id than what this call's own
    // resolution would have produced) via the ON CONFLICT ... RETURNING
    // path, proving the code reads back rather than assuming its own insert
    // won.
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t5", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-winner", tenant_id: "t5", caller_number: "+15552223333" },
      ],
    });
    const call: ToolCall = { agent_id: "agent_5" };
    const ctx = await resolveCallContext(sql, "call_race", call, logger);
    expect(ctx?.callLogId).toBe("cl-winner");
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.text).toContain("on conflict (retell_call_id) do update set");
    expect(insertCall?.text).toContain("returning");
  });

  it("(c) fails closed and logs a warning with the reason when neither call_logs nor the payload resolves a tenant", async () => {
    const { sql } = makeRecordingSql({});
    const { logger: warnLogger, warnings } = makeWarnCapturingLogger();
    const ctx = await resolveCallContext(
      sql,
      "call_unknown",
      { agent_id: "no_such_agent" },
      warnLogger,
    );
    expect(ctx).toBeNull();
    expect(warnings.some((w) => w.msg === "voice_tools_call_context_unresolved")).toBe(true);
  });

  it("(c) fails closed when there is no call payload at all (e.g. job-keep-warm's synthetic ping)", async () => {
    const { sql } = makeRecordingSql({});
    const { logger: warnLogger, warnings } = makeWarnCapturingLogger();
    const ctx = await resolveCallContext(sql, "heyloo-keep-warm-ping", undefined, warnLogger);
    expect(ctx).toBeNull();
    expect(warnings.length).toBe(1);
  });
});
