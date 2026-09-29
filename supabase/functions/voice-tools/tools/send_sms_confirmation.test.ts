import { findTextPromises } from "@heyloo/templates";
import { describe, expect, it, vi } from "vitest";
import { SMS_UNAVAILABLE_CONFIRMATION_MESSAGE } from "../../_shared/sms-availability.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { sendSmsConfirmation } from "./send_sms_confirmation.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
  isTestCall: false,
};

type Step = { rows?: unknown[]; throws?: unknown };

function makeStepSql(steps: Step[]): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  let i = 0;
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    const step = steps[i];
    i += 1;
    if (!step) return Promise.resolve([]);
    if (step.throws) return Promise.reject(step.throws);
    return Promise.resolve(step.rows ?? []);
  }) as SqlClient;
  return { sql, calls };
}

const args = { phone: "555-123-4567", template_key: "booking_confirmation" };

/** Texting available (a verified sender with a configured provider). */
const TEXTING_ON = { smsAvailable: async () => true };
/** No usable SMS sender: the launch state (owner decision, MSG-3). */
const TEXTING_OFF = { smsAvailable: async () => false };

describe("sendSmsConfirmation", () => {
  it("rejects an unparseable phone number without touching the DB", async () => {
    const { sql, calls } = makeStepSql([]);
    const result = await sendSmsConfirmation(sql, ctx, { ...args, phone: "12345" }, TEXTING_ON);
    expect(result).toEqual({ queued: false, reason: "invalid_phone" });
    expect(calls).toHaveLength(0);
  });

  it("EDGE_AUDIT M1: rejects a booking_id that doesn't belong to (or doesn't exist for) the caller's tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]); // booking ownership check: no match
    const result = await sendSmsConfirmation(
      sql,
      ctx,
      { ...args, booking_id: "other_tenants_booking" },
      TEXTING_ON,
    );
    expect(result).toEqual({ queued: false, reason: "booking_not_found" });
  });

  it("EDGE_AUDIT M1: rejects an order_id that doesn't belong to the caller's tenant", async () => {
    const { sql } = makeStepSql([{ rows: [] }]); // order ownership check: no match
    const result = await sendSmsConfirmation(
      sql,
      ctx,
      { ...args, order_id: "other_tenants_order" },
      TEXTING_ON,
    );
    expect(result).toEqual({ queued: false, reason: "order_not_found" });
  });

  it("returns the existing message on an idempotent replay (same booking_id + template_key)", async () => {
    const { sql } = makeStepSql([
      { rows: [{ id: "booking_1" }] }, // booking ownership check
      { rows: [{ id: "msg_1" }] }, // idempotency soft-check: already sent
    ]);
    const result = await sendSmsConfirmation(
      sql,
      ctx,
      { ...args, booking_id: "booking_1" },
      TEXTING_ON,
    );
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
  });

  it("always inserts a queued row and enqueues it (VOICE-ALERTS-1: no more pending_verification rows that nothing ever sends)", async () => {
    const { sql, calls } = makeStepSql([
      { rows: [{ id: "booking_1" }] }, // booking ownership check
      { rows: [] }, // idempotency soft-check: nothing prior
      { rows: [{ id: "msg_1" }] }, // insert
      { rows: [] }, // enqueue messages_outbound
    ]);
    const result = await sendSmsConfirmation(
      sql,
      ctx,
      { ...args, booking_id: "booking_1" },
      TEXTING_ON,
    );
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.text).toContain("'queued'");
    expect(insert?.values).not.toContain("pending_verification");
    expect(calls.filter((c) => c.text.includes("pgmq.send"))).toHaveLength(1);
    expect(calls.filter((c) => c.text.includes("pgmq.send"))[0]?.values).toEqual([
      "messages_outbound_queue",
      { message_id: "msg_1" },
    ]);
  });

  it("reads no tenant state itself: availability arrives injected, so a text-capable tenant costs no extra statement", async () => {
    const { sql, calls } = makeStepSql([
      { rows: [{ id: "msg_1" }] }, // insert (no booking_id/order_id: no ownership/idempotency reads)
      { rows: [] }, // enqueue
    ]);
    const result = await sendSmsConfirmation(sql, ctx, args, TEXTING_ON);
    expect(result).toEqual({ queued: true, message_id: "msg_1" });
    expect(calls.some((c) => c.text.includes("a2p_status"))).toBe(false);
    expect(calls.some((c) => c.text.includes("pending_verification"))).toBe(false);
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(true);
    expect(calls).toHaveLength(2);
  });

  describe("MSG-3: no promise of a text when the business cannot text", () => {
    it("queues nothing and tells the model texting is unavailable (no DB write at all)", async () => {
      const { sql, calls } = makeStepSql([]);
      const result = await sendSmsConfirmation(
        sql,
        ctx,
        { ...args, booking_id: "booking_1" },
        TEXTING_OFF,
      );
      expect(result).toEqual({
        queued: false,
        reason: "sms_unavailable",
        texting_available: false,
        message: SMS_UNAVAILABLE_CONFIRMATION_MESSAGE,
      });
      expect(calls).toHaveLength(0); // no ownership check, no insert, no enqueue
    });

    it("the answer never leads the model to claim a text was sent", () => {
      const message = SMS_UNAVAILABLE_CONFIRMATION_MESSAGE;
      expect(message).toMatch(/NO text was sent/);
      expect(message).toMatch(/Do not say or imply that you are texting/);
      expect(message).toMatch(/confirmed/);
      // Promises, in English and Spanish, must not appear anywhere.
      expect(findTextPromises(message)).toEqual([]);
    });

    it("still validates first: a bad phone or template is reported as such, not as unavailable", async () => {
      const { sql } = makeStepSql([]);
      expect(await sendSmsConfirmation(sql, ctx, { ...args, phone: "12345" }, TEXTING_OFF)).toEqual(
        {
          queued: false,
          reason: "invalid_phone",
        },
      );
      expect(
        await sendSmsConfirmation(
          sql,
          ctx,
          { ...args, template_key: "owner_urgent_call" },
          TEXTING_OFF,
        ),
      ).toEqual({ queued: false, reason: "invalid_template" });
    });

    it("asks availability exactly once per call", async () => {
      const smsAvailable = vi.fn(async () => true);
      const { sql } = makeStepSql([{ rows: [{ id: "msg_1" }] }, { rows: [] }]);
      await sendSmsConfirmation(sql, ctx, args, { smsAvailable });
      expect(smsAvailable).toHaveBeenCalledTimes(1);
    });
  });
});
