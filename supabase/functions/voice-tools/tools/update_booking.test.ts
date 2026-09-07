import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.js";
import type { CallContext } from "../context.js";
import { updateBooking } from "./update_booking.js";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
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
    ]);
    const result = await updateBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: true, start: args.new_start, end: args.new_end });
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
