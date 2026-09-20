import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { joinWaitlist } from "./join_waitlist.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "restaurant",
  isTestCall: false,
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
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
  resource_type: "table",
  preferred_window_start: "2026-01-15T18:00:00.000Z",
  preferred_window_end: "2026-01-15T20:00:00.000Z",
};

const UNIQUE_VIOLATION = Object.assign(new Error("duplicate key"), { code: "23505" });

describe("joinWaitlist", () => {
  it("rejects an unparseable phone number without touching the DB", async () => {
    const { sql, callCount } = makeStepSql([]);
    const result = await joinWaitlist(sql, ctx, { ...args, customer: { phone: "12345" } });
    expect(result).toEqual({ joined: false, reason: "invalid_phone" });
    expect(callCount()).toBe(0);
  });

  it("rejects an offering_id that doesn't belong to (or isn't active for) the caller's tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]); // offering ownership check: no match
    const result = await joinWaitlist(sql, ctx, { ...args, offering_id: "off_other_tenant" });
    expect(result).toEqual({ joined: false, reason: "offering_not_found" });
  });

  it("returns the existing entry on an idempotent replay (same call_id + window)", async () => {
    const { sql } = makeStepSql([
      { rows: [{ id: "wl_1" }] }, // idempotency pre-check: existing match
    ]);
    const result = await joinWaitlist(sql, ctx, args);
    expect(result).toEqual({ joined: true, waitlist_entry_id: "wl_1" });
  });

  it("joins the waitlist end-to-end: customer upsert then insert", async () => {
    const { sql } = makeStepSql([
      { rows: [] }, // idempotency pre-check: none found
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "wl_1" }] }, // waitlist_entries insert
    ]);
    const result = await joinWaitlist(sql, ctx, args);
    expect(result).toEqual({ joined: true, waitlist_entry_id: "wl_1" });
  });

  it("a concurrent identical retry (unique-constraint race) returns the race winner, never a duplicate", async () => {
    const { sql } = makeStepSql([
      { rows: [] }, // idempotency pre-check: none found (race window)
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { throws: UNIQUE_VIOLATION }, // concurrent insert lost the race
      { rows: [{ id: "wl_1" }] }, // re-select finds the winner's row
    ]);
    const result = await joinWaitlist(sql, ctx, args);
    expect(result).toEqual({ joined: true, waitlist_entry_id: "wl_1" });
  });

  it("a different requested window computes a different idempotency key (not deduped against a differently-windowed prior insert)", async () => {
    const seenKeys: unknown[] = [];
    const capturingSql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      seenKeys.push(values[1]);
      return Promise.resolve([]);
    }) as SqlClient;
    await joinWaitlist(capturingSql, ctx, args).catch(() => undefined);
    const firstKey = seenKeys[0];
    seenKeys.length = 0;
    await joinWaitlist(capturingSql, ctx, {
      ...args,
      preferred_window_start: "2026-02-01T18:00:00.000Z",
      preferred_window_end: "2026-02-01T20:00:00.000Z",
    }).catch(() => undefined);
    expect(seenKeys[0]).not.toBe(firstKey);
  });

  it("rethrows a non-unique-violation DB error rather than swallowing it", async () => {
    const otherError = new Error("connection reset");
    const { sql } = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { throws: otherError },
    ]);
    await expect(joinWaitlist(sql, ctx, args)).rejects.toBe(otherError);
  });
});
