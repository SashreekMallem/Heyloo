import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { updateBooking } from "./update_booking.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
  isTestCall: false,
};

const args = {
  booking_id: "booking_1",
  new_start: "2026-01-16T14:00:00.000Z",
  new_end: "2026-01-16T14:30:00.000Z",
};

type Step = { rows?: unknown[]; throws?: unknown };

function makeStepSql(steps: Step[]): SqlClient {
  let i = 0;
  return (() => {
    const step = steps[i];
    i += 1;
    if (!step) return Promise.resolve([]);
    if (step.throws) return Promise.reject(step.throws);
    return Promise.resolve(step.rows ?? []);
  }) as SqlClient;
}

const bookingRow = {
  id: "booking_1",
  start_at: "2026-01-15T14:00:00.000Z",
  customer_phone: "+15551234567",
  customer_name: "Jordan Lee",
  // F-AUTO-RESCHED-1: what the preflight statement decided about the new window.
  tz: null,
  start_in_past: false,
  too_soon: false,
  slots_cover: true,
};

describe("updateBooking", () => {
  it("returns not_found when no confirmed booking matches", async () => {
    const sql = makeStepSql([{ rows: [] }]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "not_found" });
  });

  it("proceeds without extra verification when the caller number matches the booking's customer (phone_match)", async () => {
    const sql = makeStepSql([
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", start_at: args.new_start, end_at: args.new_end }] },
      { rows: [] }, // adapter-push producer: no connected adapter
    ]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: true, start: args.new_start, end: args.new_end });
  });

  it("EDGE_AUDIT B4: enqueues an adapter_push_queue booking entry (reschedule) per connected adapter", async () => {
    const enqueueCalls: unknown[] = [];
    const steps: Step[] = [
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", start_at: args.new_start, end_at: args.new_end }] },
      { rows: [{ provider: "square" }] }, // adapter-push producer: one connected adapter
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
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: true, start: args.new_start, end: args.new_end });
    expect(enqueueCalls).toHaveLength(1);
  });

  it("rejects when the caller number differs and no verification claim was offered", async () => {
    const sql = makeStepSql([{ rows: [bookingRow] }]);
    const result = await updateBooking(sql, { ...ctx, callerNumber: "+15559998888" }, args);
    expect(result).toEqual({ confirmed: false, reason: "identity_verification_failed" });
  });

  it("proceeds via the knowledge fallback when name + exact appointment time both match", async () => {
    const sql = makeStepSql([
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", start_at: args.new_start, end_at: args.new_end }] },
      { rows: [] }, // adapter-push producer: no connected adapter
    ]);
    const result = await updateBooking(
      sql,
      { ...ctx, callerNumber: "+15559998888" },
      {
        ...args,
        verify: { full_name: "Jordan Lee", appointment_time: bookingRow.start_at },
      },
    );
    expect(result).toEqual({ confirmed: true, start: args.new_start, end: args.new_end });
  });

  it("rejects the knowledge fallback when the claimed name is wrong", async () => {
    const sql = makeStepSql([{ rows: [bookingRow] }]);
    const result = await updateBooking(
      sql,
      { ...ctx, callerNumber: "+15559998888" },
      {
        ...args,
        verify: { full_name: "Someone Else", appointment_time: bookingRow.start_at },
      },
    );
    expect(result).toEqual({ confirmed: false, reason: "identity_verification_failed" });
  });

  it("returns slot_taken on an exclusion-constraint violation during the update", async () => {
    const sql = makeStepSql([{ rows: [bookingRow] }, { throws: { code: "23P01" } }]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "slot_taken" });
  });
});

describe("updateBooking - Manual Mode (VOICE-ALERTS-1 review)", () => {
  it("refuses before any SQL so a booking is never moved while the owner has paused automatic booking", async () => {
    let queries = 0;
    const sql = (() => {
      queries += 1;
      return Promise.resolve([bookingRow]);
    }) as unknown as SqlClient;
    const result = await updateBooking(sql, { ...ctx, manualMode: true }, args);
    expect(result).toMatchObject({ confirmed: false, reason: "manual_mode" });
    expect(queries).toBe(0);
  });
});

describe("updateBooking - F-AUTO-RESCHED-1: hours, availability and duration are validated", () => {
  function recordingSql(steps: Step[]): {
    sql: SqlClient;
    calls: { text: string; values: unknown[] }[];
  } {
    const calls: { text: string; values: unknown[] }[] = [];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.send")) return Promise.resolve([]);
      calls.push({ text, values });
      const step = steps[i];
      i += 1;
      if (step?.throws) return Promise.reject(step.throws);
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;
    return { sql, calls };
  }

  it("refuses a time outside the resource's availability slots and changes nothing", async () => {
    const { sql, calls } = recordingSql([{ rows: [{ ...bookingRow, slots_cover: false }] }]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toMatchObject({ confirmed: false, reason: "not_available" });
    expect(JSON.stringify(result)).toContain("NOT changed");
    expect(calls).toHaveLength(1); // never reached the UPDATE
  });

  it("refuses a time in the past and one inside the owner's minimum notice", async () => {
    const past = recordingSql([{ rows: [{ ...bookingRow, start_in_past: true }] }]);
    expect(await updateBooking(past.sql, ctx, args)).toMatchObject({
      confirmed: false,
      reason: "start_in_past",
    });
    const soon = recordingSql([{ rows: [{ ...bookingRow, too_soon: true }] }]);
    expect(await updateBooking(soon.sql, ctx, args)).toMatchObject({
      confirmed: false,
      reason: "too_soon",
    });
  });

  it("does not treat a missing slots_cover (an older row shape) as open", async () => {
    const { sql } = recordingSql([{ rows: [{ ...bookingRow, slots_cover: undefined }] }]);
    expect(await updateBooking(sql, ctx, args)).toMatchObject({
      confirmed: false,
      reason: "not_available",
    });
  });

  it("keeps the booking's own length: the UPDATE derives the end in SQL and never binds the model's new_end", async () => {
    const { sql, calls } = recordingSql([
      { rows: [bookingRow] },
      { rows: [{ id: "booking_1", start_at: args.new_start, end_at: "2026-01-16T14:30:00.000Z" }] },
    ]);
    // The model asked for a 60-minute booking; the original was 30 minutes.
    await updateBooking(sql, ctx, { ...args, new_end: "2026-01-16T15:00:00.000Z" });
    const update = calls.find((c) => c.text.includes("update public.bookings"));
    expect(update?.text).toContain("end_at = ");
    expect(update?.text).toContain("+ (end_at - start_at)");
    expect(update?.values).not.toContain("2026-01-16T15:00:00.000Z");
    expect(update?.values).toContain("2026-01-16T14:00:00.000Z");
  });

  it("the preflight statement checks the past, the minimum notice and slot coverage for the booking's own resource, scoped to the tenant", async () => {
    const { sql, calls } = recordingSql([{ rows: [] }]);
    await updateBooking(sql, ctx, args);
    const text = calls[0]?.text ?? "";
    expect(text).toContain("booking_min_notice_minutes");
    expect(text).toContain("as start_in_past");
    expect(text).toContain("as too_soon");
    expect(text).toContain("range_agg(s.slot_range)");
    expect(text).toContain("s.resource_id = b.resource_id");
    expect(text).toContain("s.slot_range && b.during");
    expect(calls[0]?.values).toContain("tenant_1");
  });

  it("reads an unparseable new_start as invalid_time before any SQL", async () => {
    const { sql, calls } = recordingSql([]);
    const result = await updateBooking(sql, ctx, { ...args, new_start: "tomorrow at nine" });
    expect(result).toMatchObject({ confirmed: false, reason: "invalid_time" });
    expect(calls).toHaveLength(0);
  });

  it("returns the new times in the business's own timezone with an offset", async () => {
    const { sql } = recordingSql([
      { rows: [{ ...bookingRow, tz: "America/Denver" }] },
      {
        rows: [
          {
            id: "booking_1",
            start_at: new Date("2026-01-16T16:00:00.000Z"),
            end_at: new Date("2026-01-16T16:30:00.000Z"),
          },
        ],
      },
    ]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({
      confirmed: true,
      start: "2026-01-16T09:00:00-07:00",
      end: "2026-01-16T09:30:00-07:00",
    });
  });
});
