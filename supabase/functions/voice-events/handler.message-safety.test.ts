import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { RetellCallObject } from "../_shared/schemas/voice-events.ts";
import type { SqlClient } from "../_shared/types.ts";
import { claimsMessageTaken, handleCallAnalyzed } from "./handler.ts";

/**
 * F-CLASS-1 / F11 / F3(d) (BEHAVIOR-voice-agent): post-call analysis is
 * reconciled with what the call actually wrote, and a call whose summary says a
 * message was taken but which stored none is flagged instead of silently lost.
 */

function makeSql(rows: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (text.includes("update public.call_logs") && text.includes("classification = case")) {
      return Promise.resolve(rows);
    }
    if (text.includes("from public.tenant_notification") || text.includes("owner_alert")) {
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const ROW = {
  id: "cl1",
  tenant_id: "t1",
  urgency_flag: false,
  is_test_call: false,
  caller_number: "+15551234567",
  message_text: null,
  has_write: false,
  classification: "question_faq",
};

function analyzed(over: Partial<RetellCallObject> = {}, data: Record<string, unknown> = {}) {
  return {
    call_id: "call_1",
    call_analysis: {
      call_summary: "Caller asked about hours.",
      custom_analysis_data: { classification: "new_booking", outcome: "answered", ...data },
    },
    ...over,
  } as RetellCallObject;
}

describe("F-CLASS-1 / F11: the stored classification follows what the call wrote", () => {
  it("reconciles the model's class in SQL: a recorded message with no booking/order is after_hours_message, new_booking needs a write", async () => {
    const { sql, calls } = makeSql([ROW]);
    await handleCallAnalyzed(sql, analyzed(), createLogger());
    const update = calls.find((c) => c.text.includes("classification = case"));
    const text = update?.text ?? "";
    expect(text).toContain("message_text is not null");
    expect(text).toContain("then 'after_hours_message'");
    expect(text).toContain("from public.bookings wb where wb.source_call_id = call_logs.id");
    expect(text).toContain("from public.orders wo where wo.source_call_id = call_logs.id");
    expect(text).toMatch(/= 'new_booking'[\s\S]*then 'question_faq'/);
    expect(update?.values).toContain("new_booking");
  });

  it("does not turn a connected transfer into a message: it passes the transfer flag", async () => {
    const transferred = makeSql([ROW]);
    await handleCallAnalyzed(
      transferred.sql,
      analyzed({ disconnection_reason: "transfer_bridged" }),
      createLogger(),
    );
    const t = transferred.calls.find((c) => c.text.includes("classification = case"));
    expect(t?.values).toContain(true);
    const plain = makeSql([ROW]);
    await handleCallAnalyzed(
      plain.sql,
      analyzed({ disconnection_reason: "user_hangup" }),
      createLogger(),
    );
    const p = plain.calls.find((c) => c.text.includes("classification = case"));
    expect(p?.values).not.toContain(true);
  });

  it("an emergency is never reclassified as a message", async () => {
    const { sql, calls } = makeSql([ROW]);
    await handleCallAnalyzed(sql, analyzed({}, { emergency_detected: true }), createLogger());
    const update = calls.find((c) => c.text.includes("classification = case"));
    expect(update?.text).toContain("not ");
    expect(update?.values).toContain(true);
  });
});

describe("F3(d): a message claimed in the summary but never stored is flagged", () => {
  const claim = { outcome: "Took a message for the office manager about X-rays" };

  it("recognises message and callback claims, and ignores an FAQ call that merely mentions calling", () => {
    expect(claimsMessageTaken("Took a message for Dr. Patel")).toBe(true);
    expect(claimsMessageTaken(null, "The message was passed along to the office.")).toBe(true);
    expect(claimsMessageTaken("Caller requested a callback tomorrow afternoon")).toBe(true);
    expect(claimsMessageTaken("Answered a question about opening hours")).toBe(false);
    expect(claimsMessageTaken("Booked an oil change", "Caller will call in tomorrow")).toBe(false);
    expect(claimsMessageTaken(null, undefined)).toBe(false);
  });

  it("sets follow_up_needed, logs, and alerts the owner when nothing was stored", async () => {
    const { sql, calls } = makeSql([ROW]);
    const errors: string[] = [];
    const logger = { ...createLogger(), error: (m: string) => errors.push(m) };
    await handleCallAnalyzed(sql, analyzed({}, claim), logger);
    expect(errors).toContain("voice_events_message_claimed_not_recorded");
    expect(calls.some((c) => c.text.includes("set follow_up_needed = true"))).toBe(true);
    // The owner-alert producer ran (it starts by loading the owner's contact preferences).
    expect(
      calls.some((c) => c.text.includes("messages_outbound") || c.text.includes("tenants")),
    ).toBe(true);
  });

  it("does nothing when a message was stored, when the call wrote a booking, or for a solicitor", async () => {
    for (const row of [
      { ...ROW, message_text: "Call me back" },
      { ...ROW, has_write: true },
      { ...ROW, classification: "solicitor" },
    ]) {
      const { sql, calls } = makeSql([row]);
      const errors: string[] = [];
      await handleCallAnalyzed(sql, analyzed({}, claim), {
        ...createLogger(),
        error: (m: string) => errors.push(m),
      });
      expect(errors).not.toContain("voice_events_message_claimed_not_recorded");
      expect(calls.some((c) => c.text.includes("set follow_up_needed = true"))).toBe(false);
    }
  });

  it("flags a test call but never pages the owner for it", async () => {
    const { sql, calls } = makeSql([{ ...ROW, is_test_call: true }]);
    await handleCallAnalyzed(sql, analyzed({}, claim), createLogger());
    expect(calls.some((c) => c.text.includes("set follow_up_needed = true"))).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });
});
