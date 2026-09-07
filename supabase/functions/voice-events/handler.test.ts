import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { RetellCallObject } from "../_shared/schemas/voice-events.js";
import type { SqlClient } from "../_shared/types.js";
import { handleCallAnalyzed, handleCallEnded, handleCallStarted } from "./handler.js";

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

describe("handleCallStarted", () => {
  it("resolves the tenant by to_number and inserts a call_logs row", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.phone_numbers": [
        { tenant_id: "t1", phone_number_id: "pn1", owner_test_phone: null },
      ],
    });
    const call: RetellCallObject = {
      call_id: "call_1",
      from_number: "+15551234567",
      to_number: "+15559998888",
      start_timestamp: 1_700_000_000_000,
    };
    await handleCallStarted(sql, call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall).toBeDefined();
    expect(insertCall?.values).toContain("t1");
    expect(insertCall?.values).toContain("call_1");
  });

  it("marks is_test_call true when the caller matches the tenant's owner_test_phone (G13)", async () => {
    const { sql, calls } = makeRecordingSql({
      "from public.phone_numbers": [
        { tenant_id: "t1", phone_number_id: "pn1", owner_test_phone: "+15551234567" },
      ],
    });
    const call: RetellCallObject = {
      call_id: "call_1",
      from_number: "+15551234567",
      to_number: "+15559998888",
    };
    await handleCallStarted(sql, call, logger);
    const insertCall = calls.find((c) => c.text.includes("insert into public.call_logs"));
    expect(insertCall?.values).toContain(true);
  });

  it("no-ops quietly when the tenant cannot be resolved", async () => {
    const { sql, calls } = makeRecordingSql({});
    await handleCallStarted(sql, { call_id: "call_1", to_number: "+19999999999" }, logger);
    expect(calls.some((c) => c.text.includes("insert into public.call_logs"))).toBe(false);
  });
});

describe("handleCallEnded", () => {
  it("updates the existing call_logs row, enqueues recording-fetch, and inserts cost/usage events", async () => {
    const { sql, calls } = makeRecordingSql({
      "update public.call_logs": [{ id: "cl1", tenant_id: "t1", is_test_call: false }],
    });
    const call: RetellCallObject = {
      call_id: "call_1",
      start_timestamp: 1_700_000_000_000,
      end_timestamp: 1_700_000_060_000, // 60s later
      disconnection_reason: "user_hangup",
      call_cost: { product_costs: [{ product: "voice_infra", cost: 12 }] },
    };
    await handleCallEnded(sql, call, logger);

    expect(calls.some((c) => c.text.includes("update public.call_logs"))).toBe(true);
    const enqueueCall = calls.find((c) => c.text.includes("pgmq.send"));
    expect(enqueueCall).toBeDefined();
    expect(JSON.stringify(enqueueCall?.values)).toContain("recording_fetch_queue");
    expect(calls.some((c) => c.text.includes("insert into public.cost_events"))).toBe(true);
    const usageCall = calls.find((c) => c.text.includes("insert into public.usage_events"));
    expect(usageCall?.values).toContain(1); // 60s / 60 = 1 minute
  });

  it("tolerates call_ended arriving before call_started (out-of-order delivery)", async () => {
    const { sql, calls } = makeRecordingSql({
      // First `update` returns no row (call not started yet); the fallback
      // insert path resolves the tenant and upserts a minimal row.
      "from public.phone_numbers": [
        { tenant_id: "t1", phone_number_id: "pn1", owner_test_phone: null },
      ],
      "insert into public.call_logs": [{ id: "cl1", tenant_id: "t1", is_test_call: false }],
    });
    const call: RetellCallObject = {
      call_id: "call_1",
      to_number: "+15559998888",
      end_timestamp: 1_700_000_060_000,
    };
    await handleCallEnded(sql, call, logger);
    expect(calls.some((c) => c.text.includes("insert into public.call_logs"))).toBe(true);
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(true);
  });

  it("does not insert usage_events for a call whose duration cannot be computed", async () => {
    const { sql, calls } = makeRecordingSql({
      "update public.call_logs": [{ id: "cl1", tenant_id: "t1", is_test_call: false }],
    });
    await handleCallEnded(sql, { call_id: "call_1" }, logger);
    expect(calls.some((c) => c.text.includes("insert into public.usage_events"))).toBe(false);
  });
});

describe("handleCallAnalyzed", () => {
  it("updates classification/sentiment/summary fields from call_analysis", async () => {
    const { sql, calls } = makeRecordingSql({
      "update public.call_logs": [{ id: "cl1", tenant_id: "t1", urgency_flag: false }],
    });
    const call: RetellCallObject = {
      call_id: "call_1",
      call_analysis: {
        call_summary: "Booked an oil change for Tuesday.",
        user_sentiment: "Positive",
        call_successful: true,
        custom_analysis_data: { classification: "new_booking", outcome: "booked" },
      },
    };
    await handleCallAnalyzed(sql, call, logger);
    const update = calls.find((c) => c.text.includes("update public.call_logs"));
    expect(update?.values).toContain("Booked an oil change for Tuesday.");
    expect(update?.values).toContain("positive");
    expect(update?.values).toContain("new_booking");
    expect(update?.values).toContain("booked");
  });

  it("fires a compliance alert (error log) when legal_advice_given is true", async () => {
    const errors: unknown[] = [];
    const alertLogger = {
      ...logger,
      error: (msg: string, fields?: Record<string, unknown>) => errors.push({ msg, fields }),
    };
    const { sql } = makeRecordingSql({
      "update public.call_logs": [{ id: "cl1", tenant_id: "t1", urgency_flag: false }],
    });
    await handleCallAnalyzed(
      sql,
      {
        call_id: "call_1",
        call_analysis: { custom_analysis_data: { legal_advice_given: true } },
      },
      alertLogger,
    );
    expect(errors).toHaveLength(1);
    expect(
      (errors[0] as { fields: { legal_advice_given: boolean } }).fields.legal_advice_given,
    ).toBe(true);
  });

  it("retroactively sets urgency_flag when analysis flags an emergency not caught in-call", async () => {
    const { sql, calls } = makeRecordingSql({
      "call_summary = coalesce(": [{ id: "cl1", tenant_id: "t1", urgency_flag: false }],
    });
    await handleCallAnalyzed(
      sql,
      { call_id: "call_1", call_analysis: { custom_analysis_data: { emergency_detected: true } } },
      logger,
    );
    const secondUpdate = calls.find((c) => c.text.includes("urgency_flag = urgency_flag or"));
    expect(secondUpdate).toBeDefined();
  });

  it("does not re-fire the alert path when already urgency-flagged and no legal-advice flag", async () => {
    const { sql, calls } = makeRecordingSql({
      "call_summary = coalesce(": [{ id: "cl1", tenant_id: "t1", urgency_flag: true }],
    });
    await handleCallAnalyzed(
      sql,
      { call_id: "call_1", call_analysis: { custom_analysis_data: { emergency_detected: true } } },
      logger,
    );
    const secondUpdate = calls.find((c) => c.text.includes("urgency_flag = urgency_flag or"));
    expect(secondUpdate).toBeUndefined();
  });

  it("no-ops when no matching call_logs row exists", async () => {
    const { sql } = makeRecordingSql({});
    await expect(
      handleCallAnalyzed(sql, { call_id: "call_missing" }, logger),
    ).resolves.toBeUndefined();
  });
});
