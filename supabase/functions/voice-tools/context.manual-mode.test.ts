import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { resolveCallContext } from "./context.ts";

const logger = createLogger();
const REAL_CALL_ID = "call_0123456789abcdef01234567";

function makeRecordingSql(fixtures: Record<string, unknown[]>) {
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

describe("VOICE-ALERTS-1: manual mode rides on the tenants join the context already runs", () => {
  it("(a) an existing call_logs row for a tenant in manual mode resolves with manualMode: true, in the same single query", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.call_logs": [
        {
          id: "cl1",
          tenant_id: "t1",
          caller_number: "+15551234567",
          vertical: "auto",
          is_test_call: false,
          manual_mode: true,
        },
      ],
    });
    const ctx = await resolveCallContext(sql, REAL_CALL_ID, undefined, logger);
    expect(ctx?.manualMode).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("t.manual_mode");
  });

  it("(b) the agent_id tier reads it in the same statement; the key is absent (not false) when off", async () => {
    const answers = (manual: boolean) => ({
      "from public.agent_configs ac": [
        { tenant_id: "t2", vertical: "dental", manual_mode: manual },
      ],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t2", caller_number: null, is_test_call: true },
      ],
    });
    const on = makeRecordingSql(answers(true));
    const ctxOn = await resolveCallContext(on.sql, "playground", { agent_id: "agent_1" }, logger);
    expect(ctxOn?.manualMode).toBe(true);
    expect(on.calls.find((c) => c.text.includes("from public.agent_configs ac"))?.text).toContain(
      "t.manual_mode",
    );

    const off = makeRecordingSql(answers(false));
    const ctxOff = await resolveCallContext(off.sql, "playground", { agent_id: "agent_1" }, logger);
    expect(ctxOff).not.toBeNull();
    expect(ctxOff && "manualMode" in ctxOff).toBe(false);
  });

  it("(b) the to_number tier reads it from the phone_numbers join", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.phone_numbers pn": [
        { tenant_id: "t3", vertical: "legal", manual_mode: true, phone_number_id: "pn1" },
      ],
      "insert into public.call_logs": [
        { id: "cl-new", tenant_id: "t3", caller_number: null, is_test_call: false },
      ],
    });
    const ctx = await resolveCallContext(
      sql,
      REAL_CALL_ID,
      { to_number: "+15557654321", from_number: "+15551234567", call_type: "phone_call" },
      logger,
    );
    expect(ctx?.manualMode).toBe(true);
    expect(calls.find((c) => c.text.includes("from public.phone_numbers pn"))?.text).toContain(
      "t.manual_mode",
    );
  });

  it("(b) the batch-test tier reads it from the tenants row it already selects", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.tenants where id": [
        {
          id: "t4",
          vertical: "auto",
          manual_mode: true,
          key_row_id: "cl-existing",
          key_row_tenant_id: "t4",
          key_row_caller_number: null,
          key_row_is_test_call: true,
        },
      ],
    });
    const ctx = await resolveCallContext(
      sql,
      "playground",
      { retell_llm_dynamic_variables: { heyloo_tenant_id: "t4" } },
      logger,
    );
    expect(ctx?.manualMode).toBe(true);
    expect(calls[0]?.text).toContain("manual_mode");
  });
});
