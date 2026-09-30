import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { cancelBooking } from "./cancel_booking.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
  isTestCall: false,
};

const args = { booking_id: "booking_1" };

type Step = { rows?: unknown[]; throws?: unknown };

function makeStepSql(steps: Step[]): { sql: SqlClient; calls: { text: string }[] } {
  const calls: { text: string }[] = [];
  let i = 0;
  const sql = ((strings: TemplateStringsArray) => {
    calls.push({ text: strings.join(" ") });
    const step = steps[i];
    i += 1;
    if (!step) return Promise.resolve([]);
    if (step.throws) return Promise.reject(step.throws);
    return Promise.resolve(step.rows ?? []);
  }) as SqlClient;
  return { sql, calls };
}

const bookingRow = {
  id: "booking_1",
  status: "confirmed",
  start_at: "2026-01-15T14:00:00.000Z",
  customer_id: "customer_1",
  customer_phone: "+15551234567",
  customer_name: "Jordan Lee",
};

describe("cancelBooking", () => {
  it("returns not_found when the booking doesn't exist for this tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]);
    const result = await cancelBooking(sql, ctx, args);
    expect(result).toEqual({ cancelled: false, reason: "not_found" });
  });

  it("is an idempotent no-op (no identity check) when already cancelled", async () => {
    const { sql, calls } = makeStepSql([{ rows: [{ ...bookingRow, status: "cancelled" }] }]);
    const result = await cancelBooking(sql, { ...ctx, callerNumber: "+15559998888" }, args);
    expect(result).toEqual({ cancelled: true });
    expect(calls).toHaveLength(1); // only the initial lookup — no update, no identity gate needed
  });

  it("cancels and enqueues a confirmation SMS when the caller number matches (phone_match)", async () => {
    const { sql } = makeStepSql([
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", customer_id: "customer_1" }] },
      { rows: [{ id: "msg_1" }] },
      { rows: [] }, // messages_outbound enqueue
      { rows: [] }, // adapter-push producer: no connected adapter
    ]);
    const result = await cancelBooking(sql, ctx, args);
    expect(result).toEqual({ cancelled: true });
  });

  it("EDGE_AUDIT B4: enqueues an adapter_push_queue booking entry (cancellation) per connected adapter", async () => {
    const enqueueCalls: unknown[] = [];
    const steps: Step[] = [
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", customer_id: "customer_1" }] },
      { rows: [{ id: "msg_1" }] },
      // messages_outbound's own enqueue() call is a `pgmq.send` and is
      // intercepted below, never consuming a step here — the next
      // non-pgmq.send call is the adapter-push producer's connections list.
      { rows: [{ provider: "shopmonkey" }, { provider: "google_calendar" }] },
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.send")) {
        enqueueCalls.push(values);
        return Promise.resolve([]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;
    const result = await cancelBooking(sql, ctx, args);
    expect(result).toEqual({ cancelled: true });
    // one messages_outbound enqueue + two adapter pushes (shopmonkey, google_calendar)
    expect(enqueueCalls).toHaveLength(3);
  });

  it("rejects when the caller number differs and no verification claim was offered", async () => {
    const { sql, calls } = makeStepSql([{ rows: [bookingRow] }]);
    const result = await cancelBooking(sql, { ...ctx, callerNumber: "+15559998888" }, args);
    expect(result).toEqual({ cancelled: false, reason: "identity_verification_failed" });
    expect(calls).toHaveLength(1); // never reaches the UPDATE
  });

  it("proceeds via the knowledge fallback when name + exact appointment time both match", async () => {
    const { sql } = makeStepSql([
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", customer_id: "customer_1" }] },
      { rows: [{ id: "msg_1" }] },
      { rows: [] },
    ]);
    const result = await cancelBooking(
      sql,
      { ...ctx, callerNumber: "+15559998888" },
      {
        ...args,
        verify: { full_name: "Jordan Lee", appointment_time: bookingRow.start_at },
      },
    );
    expect(result).toEqual({ cancelled: true });
  });
});

describe("cancelBooking - Manual Mode (VOICE-ALERTS-1 review)", () => {
  it("refuses before any SQL so a booking is never cancelled while the owner has paused automatic booking", async () => {
    const { sql, calls } = makeStepSql([{ rows: [bookingRow] }]);
    const result = await cancelBooking(sql, { ...ctx, manualMode: true }, args);
    expect(result).toMatchObject({ cancelled: false, reason: "manual_mode" });
    expect(calls).toHaveLength(0);
  });
});

describe("cancelBooking - VCC-9: the cancellation text follows the texting gate", () => {
  const steps = (): Step[] => [
    { rows: [bookingRow] },
    { rows: [{ id: "booking_1", customer_id: "customer_1" }] },
    { rows: [{ id: "msg_1" }] },
    { rows: [] },
    { rows: [] },
  ];

  it("queues no messages_outbound row and enqueues nothing when texting is unavailable", async () => {
    const { sql, calls } = makeStepSql(steps());
    const result = await cancelBooking(sql, ctx, args, { smsAvailable: async () => false });
    expect(result).toEqual({ cancelled: true });
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(false);
    // The cancellation itself still happened.
    expect(calls.some((c) => c.text.includes("set status = 'cancelled'"))).toBe(true);
  });

  it("still queues the text (linked to the call) when texting is available", async () => {
    const { sql, calls } = makeStepSql(steps());
    const result = await cancelBooking(sql, ctx, args, { smsAvailable: async () => true });
    expect(result).toEqual({ cancelled: true });
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.text).toContain("related_call_id");
  });

  it("asks availability only after the booking was really cancelled", async () => {
    let asked = 0;
    const { sql } = makeStepSql([{ rows: [{ ...bookingRow, status: "cancelled" }] }]);
    await cancelBooking(sql, ctx, args, {
      smsAvailable: async () => {
        asked += 1;
        return true;
      },
    });
    expect(asked).toBe(0);
  });
});
