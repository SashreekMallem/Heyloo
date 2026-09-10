import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { processPayPalEvent } from "./handler.ts";
import type { PayPalWebhookEvent } from "./schema.ts";

const logger = createLogger();

function payoutItemEvent(overrides: Partial<PayPalWebhookEvent> = {}): PayPalWebhookEvent {
  return {
    id: "WH-1",
    event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    resource_type: "payouts_item",
    resource: {
      payout_batch_id: "batch_1",
      transaction_status: "SUCCESS",
      payout_item: { sender_item_id: "partner_1" },
    },
    ...overrides,
  };
}

function makeSql(script: (call: number, values: unknown[]) => unknown[]): {
  sql: SqlClient;
  calls: unknown[][];
} {
  const calls: unknown[][] = [];
  let call = 0;
  const sql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    call += 1;
    calls.push(values);
    return Promise.resolve(script(call, values));
  }) as SqlClient;
  return { sql, calls };
}

describe("processPayPalEvent", () => {
  it("ignores an event whose resource isn't a recognizable payout item", async () => {
    const { sql, calls } = makeSql(() => []);
    const outcome = await processPayPalEvent(
      sql,
      payoutItemEvent({ event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS", resource: {} }),
      logger,
    );
    expect(outcome).toBe("ignored_not_payout_item");
    expect(calls).toHaveLength(0);
  });

  it("treats UNCLAIMED as still in-flight, writing nothing", async () => {
    const { sql, calls } = makeSql(() => []);
    const outcome = await processPayPalEvent(
      sql,
      payoutItemEvent({ event_type: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED" }),
      logger,
    );
    expect(outcome).toBe("in_flight");
    expect(calls).toHaveLength(0);
  });

  it("reports no_matching_payout when no referral_payouts row is in 'sent' status for this batch+partner", async () => {
    const { sql, calls } = makeSql(() => []); // update ... returning -> []
    const outcome = await processPayPalEvent(sql, payoutItemEvent(), logger);
    expect(outcome).toBe("no_matching_payout");
    expect(calls).toHaveLength(1);
  });

  it("on SUCCEEDED: completes the payout, pays commission_events, marks referrals paid, bumps ytd_payout_cents", async () => {
    const { sql, calls } = makeSql((call) => {
      if (call === 1) return [{ id: "rp1", total_cents: 5000 }]; // referral_payouts update
      if (call === 2) return [{ id: "ce1", referral_id: "ref1" }]; // commission_events update
      return []; // referrals update, referral_partners update
    });
    const outcome = await processPayPalEvent(sql, payoutItemEvent(), logger);
    expect(outcome).toBe("completed");
    expect(calls[0]).toContain("completed");
    expect(calls[0]).toContain("batch_1");
    expect(calls[0]).toContain("partner_1");
    expect(calls[2]).toContain("ref1"); // referrals update targets the right referral
    expect(calls[3]).toContain(5000); // ytd bump uses the payout's total_cents
    expect(calls[3]).toContain("partner_1");
  });

  it("on FAILED: marks the payout failed, reverts commission_events to accrued, and raises an alert", async () => {
    const { sql, calls } = makeSql((call) =>
      call === 1 ? [{ id: "rp1", total_cents: 5000 }] : [],
    );
    const outcome = await processPayPalEvent(
      sql,
      payoutItemEvent({
        event_type: "PAYMENT.PAYOUTS-ITEM.FAILED",
        resource: {
          payout_batch_id: "batch_1",
          transaction_status: "FAILED",
          payout_item: { sender_item_id: "partner_1" },
        },
      }),
      logger,
    );
    expect(outcome).toBe("failed");
    expect(calls[0]).toContain("failed");
    expect(calls[1]).toContain("partner_1"); // commission_events revert
    const alertPayload = calls[2]?.[0];
    expect(typeof alertPayload).toBe("string");
    expect(JSON.parse(alertPayload as string)).toMatchObject({
      referral_partner_id: "partner_1",
      terminal_status: "failed",
    });
  });

  it("on RETURNED: marks the payout returned and reverts commissions", async () => {
    const { sql, calls } = makeSql((call) =>
      call === 1 ? [{ id: "rp1", total_cents: 5000 }] : [],
    );
    const outcome = await processPayPalEvent(
      sql,
      payoutItemEvent({
        event_type: "PAYMENT.PAYOUTS-ITEM.RETURNED",
        resource: {
          payout_batch_id: "batch_1",
          transaction_status: "RETURNED",
          payout_item: { sender_item_id: "partner_1" },
        },
      }),
      logger,
    );
    expect(outcome).toBe("returned");
    expect(calls[0]).toContain("returned");
  });
});
