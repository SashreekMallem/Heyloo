import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import {
  OUTSIDE_HOURS_MESSAGE,
  START_IN_PAST_MESSAGE,
  TOO_SOON_MESSAGE,
} from "./create_booking.ts";
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

describe("updateBooking - time rules and local rendering (QA-1 BE-07 / BE-08)", () => {
  const okUpdate = { rows: [{ id: "booking_1", start_at: args.new_start, end_at: args.new_end }] };

  function recordingSql(steps: Step[]): { sql: SqlClient; texts: string[] } {
    const texts: string[] = [];
    let i = 0;
    const sql = ((strings: TemplateStringsArray) => {
      texts.push(strings.join(" "));
      const step = steps[i];
      i += 1;
      if (step?.throws) return Promise.reject(step.throws);
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;
    return { sql, texts };
  }

  it("refuses a reschedule into the past and never runs the UPDATE", async () => {
    const { sql, texts } = recordingSql([
      { rows: [{ ...bookingRow, start_in_past: true }] },
      okUpdate,
    ]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({
      confirmed: false,
      reason: "start_in_past",
      message: START_IN_PAST_MESSAGE,
    });
    expect(texts.some((t) => t.includes("update public.bookings"))).toBe(false);
  });

  it("refuses a time inside the owner's minimum notice", async () => {
    const { sql, texts } = recordingSql([{ rows: [{ ...bookingRow, too_soon: true }] }, okUpdate]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "too_soon", message: TOO_SOON_MESSAGE });
    expect(texts.some((t) => t.includes("update public.bookings"))).toBe(false);
  });

  it("refuses a time outside the booking's availability slots (closed day, off hours, beyond the horizon)", async () => {
    const { sql, texts } = recordingSql([{ rows: [{ ...bookingRow, in_hours: false }] }, okUpdate]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({
      confirmed: false,
      reason: "outside_hours",
      message: OUTSIDE_HOURS_MESSAGE,
    });
    expect(texts.some((t) => t.includes("update public.bookings"))).toBe(false);
  });

  it("does not leak time-rule outcomes to an unverified caller (identity is checked first)", async () => {
    const { sql } = recordingSql([
      { rows: [{ ...bookingRow, in_hours: false, start_in_past: true }] },
    ]);
    const result = await updateBooking(sql, { ...ctx, callerNumber: "+15559998888" }, args);
    expect(result).toEqual({ confirmed: false, reason: "identity_verification_failed" });
  });

  it("answers invalid_time for an unparseable or backwards range before any SQL", async () => {
    const { sql, texts } = recordingSql([{ rows: [bookingRow] }]);
    const bad = await updateBooking(sql, ctx, { ...args, new_start: "not a time" });
    expect(bad).toMatchObject({ confirmed: false, reason: "invalid_time" });
    const backwards = await updateBooking(sql, ctx, {
      ...args,
      new_start: args.new_end,
      new_end: args.new_start,
    });
    expect(backwards).toMatchObject({ confirmed: false, reason: "invalid_time" });
    expect(texts).toHaveLength(0);
  });

  it("maps a Postgres datetime error from the lookup to invalid_time", async () => {
    const { sql } = recordingSql([{ throws: { code: "22008" } }]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toMatchObject({ confirmed: false, reason: "invalid_time" });
  });

  it("evaluates the rules in the lookup statement itself (past, notice, slots of the booking's resource)", async () => {
    const { sql, texts } = recordingSql([{ rows: [] }]);
    await updateBooking(sql, ctx, args);
    const text = texts[0] ?? "";
    expect(text).toContain("< now()");
    expect(text).toContain("to_jsonb(t) ->> 'booking_min_notice_minutes'");
    expect(text).toContain("s.resource_id = b.resource_id");
    expect(text).toContain("s.slot_range @>");
  });

  it("returns the confirmed times in the tenant's timezone, not raw UTC", async () => {
    const { sql } = recordingSql([
      { rows: [{ ...bookingRow, tz: "America/New_York" }] },
      {
        rows: [
          {
            id: "booking_1",
            start_at: "2026-10-02T17:00:00.000Z",
            end_at: "2026-10-02T17:30:00.000Z",
          },
        ],
      },
      { rows: [] },
    ]);
    const result = await updateBooking(sql, ctx, {
      ...args,
      new_start: "2026-10-02T13:00:00-04:00",
      new_end: "2026-10-02T13:30:00-04:00",
    });
    expect(result).toEqual({
      confirmed: true,
      start: "2026-10-02T13:00:00-04:00",
      end: "2026-10-02T13:30:00-04:00",
    });
  });
});
