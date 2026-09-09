import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { createBooking } from "./create_booking.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
};

type Step = { rows?: unknown[]; throws?: unknown };

function makeStepSql(steps: Step[]): { sql: SqlClient; callCount: () => number } {
  let i = 0;
  const sql = (() => {
    const step = steps[i];
    i += 1;
    if (!step) return Promise.resolve([]);
    if (step.throws) return Promise.reject(step.throws);
    return Promise.resolve(step.rows ?? []);
  }) as SqlClient;
  return { sql, callCount: () => i };
}

const args = {
  resource_id: "res_1",
  start: "2026-01-15T14:00:00.000Z",
  end: "2026-01-15T14:30:00.000Z",
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
};

describe("createBooking", () => {
  it("rejects an unparseable phone number without touching the DB for the insert", async () => {
    const { sql } = makeStepSql([]);
    const result = await createBooking(sql, ctx, { ...args, customer: { phone: "12345" } });
    expect(result).toEqual({ confirmed: false, reason: "invalid_phone" });
  });

  it("returns the existing booking on an idempotent replay (same call_id + start)", async () => {
    const { sql } = makeStepSql([
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // idempotency pre-check
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("creates a new booking end-to-end: customer upsert then insert", async () => {
    const { sql } = makeStepSql([
      { rows: [] }, // idempotency pre-check: none found
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("returns confirmed:false/slot_taken on an exclusion-constraint violation (23P01), never throwing", async () => {
    const { sql } = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { throws: { code: "23P01", message: "conflicting key value" } }, // booking insert races
      { rows: [] }, // race-winner re-check: nobody with this idempotency key
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "slot_taken" });
  });

  it("returns the race winner's booking when the concurrent insert was actually the same idempotency key", async () => {
    const { sql } = makeStepSql([
      { rows: [] },
      { rows: [{ id: "customer_1" }] },
      { throws: { code: "23505", message: "duplicate key" } },
      { rows: [{ id: "booking_won", start_at: args.start, end_at: args.end }] },
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_won",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("re-throws an unrelated DB error rather than masking it as slot_taken", async () => {
    const { sql } = makeStepSql([
      { rows: [] },
      { rows: [{ id: "customer_1" }] },
      { throws: new Error("connection reset") },
    ]);
    await expect(createBooking(sql, ctx, args)).rejects.toThrow("connection reset");
  });
});
