import { describe, expect, it } from "vitest";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { sendSmsConfirmation } from "./send_sms_confirmation.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
};

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

const args = { phone: "555-123-4567", template_key: "booking_confirmation" };

describe("sendSmsConfirmation", () => {
  it("rejects an unparseable phone number without touching the DB", async () => {
    const { sql, calls } = makeStepSql([]);
    const result = await sendSmsConfirmation(sql, ctx, { ...args, phone: "12345" });
    expect(result).toEqual({ queued: false, reason: "invalid_phone" });
    expect(calls).toHaveLength(0);
  });

  it("EDGE_AUDIT M1: rejects a booking_id that doesn't belong to (or doesn't exist for) the caller's tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]); // booking ownership check: no match
    const result = await sendSmsConfirmation(sql, ctx, {
      ...args,
      booking_id: "other_tenants_booking",
    });
    expect(result).toEqual({ queued: false, reason: "booking_not_found" });
  });

  it("EDGE_AUDIT M1: rejects an order_id that doesn't belong to the caller's tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]); // order ownership check: no match
    const result = await sendSmsConfirmation(sql, ctx, {
      ...args,
      order_id: "other_tenants_order",
    });
    expect(result).toEqual({ queued: false, reason: "order_not_found" });
  });

  it("returns the existing message on an idempotent replay (same booking_id + template_key)", async () => {
    const { sql } = makeStepSql([
      { rows: [{ id: "booking_1" }] }, // booking ownership check
      { rows: [{ id: "msg_1" }] }, // idempotency soft-check: already sent
    ]);
    const result = await sendSmsConfirmation(sql, ctx, { ...args, booking_id: "booking_1" });
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
  });

  it("queues immediately when the tenant's A2P status is verified", async () => {
    const { sql } = makeStepSql([
      { rows: [{ id: "booking_1" }] }, // booking ownership check
      { rows: [] }, // idempotency soft-check: nothing prior
      { rows: [{ a2p_status: "verified" }] }, // tenant lookup
      { rows: [{ id: "msg_1" }] }, // insert
      { rows: [] }, // enqueue messages_outbound
    ]);
    const result = await sendSmsConfirmation(sql, ctx, { ...args, booking_id: "booking_1" });
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
  });

  it("marks pending_verification (and does not enqueue) when A2P isn't verified yet", async () => {
    const { sql, calls } = makeStepSql([
      // no booking_id/order_id in `args` below, so neither ownership check
      // nor the idempotency soft-check fires — first real call is the
      // tenant a2p_status lookup.
      { rows: [{ a2p_status: "pending_verification" }] }, // tenant lookup
      { rows: [{ id: "msg_1" }] }, // insert
    ]);
    const result = await sendSmsConfirmation(sql, ctx, args);
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(false);
  });
});
