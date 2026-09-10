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

const RESOURCE_FOUND: Step = { rows: [{ id: "res_1" }] };
const NO_ADAPTER_CONNECTIONS: Step = { rows: [] };

describe("createBooking", () => {
  it("rejects an unparseable phone number without touching the DB for the insert", async () => {
    const { sql } = makeStepSql([]);
    const result = await createBooking(sql, ctx, { ...args, customer: { phone: "12345" } });
    expect(result).toEqual({ confirmed: false, reason: "invalid_phone" });
  });

  it("EDGE_AUDIT B1: rejects a resource_id that doesn't belong to (or isn't active for) the caller's tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]); // resource ownership check: no match
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({ confirmed: false, reason: "resource_not_found" });
  });

  it("EDGE_AUDIT B1: rejects an offering_id that doesn't belong to the caller's tenant", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
      { rows: [] }, // offering ownership check: no match
    ]);
    const result = await createBooking(sql, ctx, { ...args, offering_id: "off_other_tenant" });
    expect(result).toEqual({ confirmed: false, reason: "offering_not_found" });
  });

  it("returns the existing booking on an idempotent replay (same call_id + start)", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
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
      RESOURCE_FOUND,
      { rows: [] }, // idempotency pre-check: none found
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
      NO_ADAPTER_CONNECTIONS, // adapter-push producer: no connected adapter
    ]);
    const result = await createBooking(sql, ctx, args);
    expect(result).toEqual({
      booking_id: "booking_1",
      confirmed: true,
      start: args.start,
      end: args.end,
    });
  });

  it("EDGE_AUDIT B4: enqueues an adapter_push_queue booking entry per connected adapter", async () => {
    const enqueueCalls: unknown[] = [];
    let i = 0;
    const steps: Step[] = [
      RESOURCE_FOUND,
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "booking_1", start_at: args.start, end_at: args.end }] }, // booking insert
      { rows: [{ provider: "shopmonkey" }] }, // adapter-push producer: one connected adapter
    ];
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

    const result = await createBooking(sql, ctx, args);
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(enqueueCalls).toHaveLength(1);
  });

  it("returns confirmed:false/slot_taken on an exclusion-constraint violation (23P01), never throwing", async () => {
    const { sql } = makeStepSql([
      RESOURCE_FOUND,
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
      RESOURCE_FOUND,
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
      RESOURCE_FOUND,
      { rows: [] },
      { rows: [{ id: "customer_1" }] },
      { throws: new Error("connection reset") },
    ]);
    await expect(createBooking(sql, ctx, args)).rejects.toThrow("connection reset");
  });
});
