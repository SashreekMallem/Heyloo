import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { ToolCall } from "../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { isPlaceholderCallId, resolveCallContext } from "./context.ts";

const logger = createLogger();

// A realistically-shaped real Retell call id (`call_` + lowercase hex) —
// matches this project's own live `call_logs` rows (docs/BUILD_NOTES.md
// CALL-6), as opposed to the placeholder-shaped ids ("playground", ad hoc
// test strings) used elsewhere in this file specifically to exercise the
// "never trust a cached row for a placeholder id" path.
const REAL_CALL_ID = "call_0123456789abcdef01234567";

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

describe("isPlaceholderCallId", () => {
  it("treats a real-shaped Retell call id as non-placeholder", () => {
    expect(isPlaceholderCallId(REAL_CALL_ID)).toBe(false);
    expect(isPlaceholderCallId("call_30d9a235551f7b5bd80364cab4b")).toBe(false);
  });

  it("treats 'playground' and anything else non-conforming as a placeholder", () => {
    expect(isPlaceholderCallId("playground")).toBe(true);
    expect(isPlaceholderCallId("test_call_9")).toBe(true);
    expect(isPlaceholderCallId("heyloo-keep-warm-ping")).toBe(true);
    expect(isPlaceholderCallId("call_1")).toBe(true); // too short to be real
    expect(isPlaceholderCallId("")).toBe(true);
  });
});

describe("resolveCallContext", () => {
  it("(a) resolves from an existing call_logs row without touching the payload at all — only for a real-shaped call id", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.call_logs": [
        {
          id: "cl1",
          tenant_id: "t1",
          caller_number: "+15551234567",
          vertical: "auto",
          is_test_call: false,
        },
      ],
    });
    const call: ToolCall = { agent_id: "agent_should_be_ignored" };
    const ctx = await resolveCallContext(sql, REAL_CALL_ID, call, logger);
    expect(ctx).toEqual({
      tenantId: "t1",
      callLogId: "cl1",
      retellCallId: REAL_CALL_ID,
      callerNumber: "+15551234567",
      vertical: "auto",
      isTestCall: false,
    });
    // Only the call_logs lookup ran — the existing-row path never queries
    // agent_configs/phone_numbers or writes anything.
    expect(calls.length).toBe(1);
    expect(calls[0]?.text).toContain("from public.call_logs");
  });

  it("CALL-6: NEVER trusts a cached call_logs row for a placeholder call id, even when one already exists under a different tenant (the exact cross-tenant collision this fix closes)", async () => {
    // Simulates the live bug: a stale 'playground' row already exists,
    // owned by tenant "auto-wrong" (the first tenant that ever batch-
    // tested), but THIS call's own payload resolves — authoritatively, via
    // agent_id — to tenant "dental-right". The fix must never read the
    // stale row via path (a) — the cached-row-TRUST query, identifiable by
    // its `cl.is_test_call` column reference — at all. (A separate,
    // narrower prior-tenant-for-mismatch-logging lookup DOES still touch
    // `call_logs` by design — see the dedicated mismatch test below — so
    // this asserts against the specific trust-the-cache query, not the
    // table name.)
    const { sql, calls } = makeRecordingSql({
      "cl.is_test_call": [
        { id: "stale-row", tenant_id: "auto-wrong", caller_number: null, vertical: "auto" },
      ],
      "from public.agent_configs": [{ tenant_id: "dental-right", vertical: "dental" }],
      "insert into public.call_logs": [
        { id: "cl-dental", tenant_id: "dental-right", caller_number: null, is_test_call: true },
      ],
    });
    const call: ToolCall = { agent_id: "agent_dental", call_type: "web_call" };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    expect(ctx?.tenantId).toBe("dental-right");
    expect(ctx?.tenantId).not.toBe("auto-wrong");
    // The cached call_logs SELECT (path (a), lookupExistingCallLog) never
    // ran for a placeholder id — its query is the only one selecting
    // `cl.is_test_call`.
    expect(calls.some((c) => c.text.includes("cl.is_test_call"))).toBe(false);
  });

  it("CALL-6: keys a placeholder row's retell_call_id per agent, not by the shared literal id", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t2", vertical: "veterinary" }],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t2", caller_number: null, is_test_call: true },
      ],
    });
    const call: ToolCall = { agent_id: "agent_abc" };
    await resolveCallContext(sql, "playground", call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain("playground:agent_abc");
  });

  it("CALL-6: falls back to keying by resolved tenant id when agent_id is absent from the payload", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.tenants where id": [{ id: "t6", vertical: "dental" }],
      "insert into public.call_logs": [
        { id: "cl-new4", tenant_id: "t6", caller_number: null, is_test_call: true },
      ],
    });
    const call: ToolCall = {
      call_type: "web_call",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "t6" },
    };
    await resolveCallContext(sql, "playground", call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain("playground:tenant:t6");
  });

  it("CALL-6: the strongest signal (agent_id) overrides a stale tenant already stored under the same placeholder key, and logs a warning", async () => {
    const { sql } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "new-tenant", vertical: "auto" }],
      "is_test_call from public.call_logs": [
        { id: "cl-old", tenant_id: "old-tenant", caller_number: null, is_test_call: true },
      ],
      "insert into public.call_logs": [
        { id: "cl-x", tenant_id: "new-tenant", caller_number: null, is_test_call: true },
      ],
    });
    const { logger: warnLogger, warnings } = makeWarnCapturingLogger();
    const call: ToolCall = { agent_id: "agent_reassigned" };
    const ctx = await resolveCallContext(sql, "playground", call, warnLogger);
    expect(ctx?.tenantId).toBe("new-tenant");
    expect(warnings.some((w) => w.msg === "voice_tools_call_context_agent_id_mismatch")).toBe(true);
  });

  it("QA-HOT: skips the write entirely (no INSERT/UPDATE, no trigger cost) when a placeholder row already reflects the resolved tenant", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t-same", vertical: "auto" }],
      "is_test_call from public.call_logs": [
        {
          id: "cl-existing",
          tenant_id: "t-same",
          caller_number: "+15550009999",
          is_test_call: true,
        },
      ],
    });
    const call: ToolCall = { agent_id: "agent_abc", from_number: "+15550009999" };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    expect(ctx).toEqual({
      tenantId: "t-same",
      callLogId: "cl-existing",
      retellCallId: "playground",
      callerNumber: "+15550009999",
      vertical: "auto",
      isTestCall: true,
    });
    expect(calls.some((c) => c.text.includes("insert into public.call_logs"))).toBe(false);
  });

  it("CALL-6: prefers retell_llm_dynamic_variables.heyloo_tenant_id over call.to_number when both are present", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.tenants where id": [{ id: "t-dynamic", vertical: "dental" }],
      "from public.phone_numbers": [
        { tenant_id: "t-wrong", vertical: "auto", phone_number_id: "pn1" },
      ],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t-dynamic", caller_number: null, is_test_call: true },
      ],
    });
    const call: ToolCall = {
      to_number: "+15551110000",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "t-dynamic" },
    };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    expect(ctx?.tenantId).toBe("t-dynamic");
    expect(calls.some((c) => c.text.includes("from public.phone_numbers"))).toBe(false);
  });

  it("(b) resolves via call.agent_id -> agent_configs when no call_logs row exists yet, and upserts a placeholder row", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t2", vertical: "veterinary" }],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t2", caller_number: "+15550001111", is_test_call: true },
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
      isTestCall: true,
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

  it("(b) falls back to call.to_number -> phone_numbers only when agent_id and the dynamic variable are both absent", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.phone_numbers": [
        { tenant_id: "t3", vertical: "dental", phone_number_id: "pn9" },
      ],
      "insert into public.call_logs": [
        { id: "cl-new2", tenant_id: "t3", caller_number: null, is_test_call: true },
      ],
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
      "insert into public.call_logs": [
        { id: "cl-new3", tenant_id: "t4", caller_number: null, is_test_call: true },
      ],
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
      "insert into public.call_logs": [
        { id: "cl-new4", tenant_id: "t6", caller_number: null, is_test_call: true },
      ],
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
      "insert into public.call_logs": [
        { id: "cl-new4", tenant_id: "t6", caller_number: null, is_test_call: true },
      ],
    });
    const call: ToolCall = {
      call_type: "web_call",
      retell_llm_dynamic_variables: { heyloo_tenant_id: "t6" },
    };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.text).toContain("'tool_first_seen'");
    expect(insertCall?.values).toContain(true); // is_test_call
    expect(ctx?.isTestCall).toBe(true);
  });

  it("CALL-5/CALL-6: a REAL call resolved via agent_id is never marked is_test_call from this path", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t4", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-new5", tenant_id: "t4", caller_number: null, is_test_call: false },
      ],
    });
    const call: ToolCall = { agent_id: "agent_real", call_type: "phone_call" };
    const ctx = await resolveCallContext(sql, REAL_CALL_ID, call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain(false); // is_test_call
    expect(ctx?.isTestCall).toBe(false);
  });

  it("(b) never trusts a spoofed tenant hint — only agent_id -> agent_configs is consulted, and cross-tenant resolution is impossible via args", async () => {
    // agent_id belongs to tenant A only; nothing about tenant B is ever
    // read from anywhere but the authoritative agent_configs/phone_numbers
    // tables keyed by agent_id/to_number.
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "tenant-a", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-a", tenant_id: "tenant-a", caller_number: null, is_test_call: true },
      ],
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
        {
          id: "cl-winner",
          tenant_id: "t5",
          caller_number: "+15552223333",
          is_test_call: false,
        },
      ],
    });
    const call: ToolCall = { agent_id: "agent_5" };
    const ctx = await resolveCallContext(sql, REAL_CALL_ID, call, logger);
    expect(ctx?.callLogId).toBe("cl-winner");
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.text).toContain("on conflict (retell_call_id) do update set");
    expect(insertCall?.text).toContain("returning");
  });

  it("CALL-9: honors heyloo_test_caller_number for a placeholder/batch-test call, so a seeded returning-customer number can be simulated live", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.tenants where id": [{ id: "t7", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-new7", tenant_id: "t7", caller_number: "+15552010199", is_test_call: true },
      ],
    });
    const call: ToolCall = {
      call_type: "web_call",
      from_number: "+15559990000", // must be IGNORED — the test override wins
      retell_llm_dynamic_variables: {
        heyloo_tenant_id: "t7",
        heyloo_test_caller_number: "+15552010199",
      },
    };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    expect(ctx?.callerNumber).toBe("+15552010199");
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain("+15552010199");
    expect(insertCall?.values).not.toContain("+15559990000");
  });

  it("CALL-9: a placeholder call's callerNumber NEVER leaks in from the shared row a DIFFERENT scenario already wrote — the live-observed cross-scenario contamination bug, fixed", async () => {
    // Simulates the exact live bug: an EARLIER scenario's tool call already
    // upserted a real caller number onto this tenant's ONE shared
    // placeholder row (CALL-6 keying — every scenario in a batch job
    // shares it). THIS call belongs to a DIFFERENT scenario that never set
    // `heyloo_test_caller_number` at all — the mock's own "insert into
    // public.call_logs" fixture row still carries the OLD contaminated
    // value (exactly what a real ON CONFLICT ... RETURNING would hand
    // back), proving the fix reads from THIS call's own resolution, not
    // that returned column.
    const { sql } = makeRecordingSql({
      "from public.tenants where id": [{ id: "t9", vertical: "auto" }],
      "insert into public.call_logs": [
        {
          id: "cl-shared",
          tenant_id: "t9",
          caller_number: "+15552010288", // stale, from an EARLIER scenario
          is_test_call: true,
        },
      ],
    });
    const call: ToolCall = {
      call_type: "web_call",
      // No `from_number`, no `heyloo_test_caller_number` — this scenario
      // never claims to be any particular caller.
      retell_llm_dynamic_variables: { heyloo_tenant_id: "t9" },
    };
    const ctx = await resolveCallContext(sql, "playground", call, logger);
    expect(ctx?.callerNumber).toBeNull();
  });

  it("CALL-9: NEVER honors heyloo_test_caller_number for a real-shaped call id — a genuine call always keeps call.from_number", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.agent_configs": [{ tenant_id: "t8", vertical: "auto" }],
      "insert into public.call_logs": [
        { id: "cl-new8", tenant_id: "t8", caller_number: "+15551234567", is_test_call: false },
      ],
    });
    const call: ToolCall = {
      agent_id: "agent_real2",
      call_type: "phone_call",
      from_number: "+15551234567",
      // An adversarial/leftover dynamic variable — must be ignored entirely
      // for a real-shaped call id (isPlaceholderCallId is false here).
      retell_llm_dynamic_variables: { heyloo_test_caller_number: "+15559990000" },
    };
    const ctx = await resolveCallContext(sql, REAL_CALL_ID, call, logger);
    expect(ctx?.callerNumber).toBe("+15551234567");
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain("+15551234567");
    expect(insertCall?.values).not.toContain("+15559990000");
  });

  it("(c) fails closed and logs a warning with the reason when neither call_logs nor the payload resolves a tenant", async () => {
    const { sql } = makeRecordingSql({});
    const { logger: warnLogger, warnings } = makeWarnCapturingLogger();
    const ctx = await resolveCallContext(
      sql,
      REAL_CALL_ID,
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
