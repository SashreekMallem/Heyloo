import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { StripeEvent } from "../_shared/schemas/stripe-event.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { StripeEventDeps } from "./handler.ts";
import { processStripeEvent } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("processStripeEvent", () => {
  it("activates the tenant on checkout.session.completed with a tenant_id in metadata", async () => {
    const { sql, calls } = makeSql();
    const event: StripeEvent = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { tenant_id: "t1" },
        },
      },
    };
    await processStripeEvent(sql, event, logger);
    const update = calls.find((c) => c.text.includes("update public.tenants"));
    expect(update?.values).toContain("t1");
    expect(update?.values).toContain("cus_1");
  });

  it("marks a payment_link paid and confirms the order on a phone-payment checkout", async () => {
    const { sql, calls } = makeSql();
    const event: StripeEvent = {
      id: "evt_2",
      type: "checkout.session.completed",
      data: { object: { id: "cs_2", metadata: { order_id: "order_1" } } },
    };
    await processStripeEvent(sql, event, logger);
    expect(calls.some((c) => c.text.includes("update public.payment_links"))).toBe(true);
    expect(calls.some((c) => c.text.includes("update public.orders"))).toBe(true);
  });

  it("maps customer.subscription.updated status to the tenants.status enum", async () => {
    const { sql, calls } = makeSql();
    const event: StripeEvent = {
      id: "evt_3",
      type: "customer.subscription.updated",
      data: { object: { customer: "cus_1", status: "past_due" } },
    };
    await processStripeEvent(sql, event, logger);
    const update = calls.find((c) => c.text.includes("update public.tenants"));
    expect(update?.values).toContain("past_due");
  });

  it("marks the billing_invoice paid on invoice.paid", async () => {
    const { sql, calls } = makeSql();
    const event: StripeEvent = {
      id: "evt_4",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    };
    await processStripeEvent(sql, event, logger);
    expect(calls.some((c) => c.text.includes("update public.billing_invoices"))).toBe(true);
  });

  it("reactivates a past_due tenant on invoice.paid when a customer id is present (dunning reactivation)", async () => {
    const { sql, calls } = makeSql();
    const event: StripeEvent = {
      id: "evt_4b",
      type: "invoice.paid",
      data: { object: { id: "in_1", customer: "cus_1" } },
    };
    await processStripeEvent(sql, event, logger);
    const reactivate = calls.find(
      (c) =>
        c.text.includes("update public.tenants") &&
        c.text.includes("status = 'active'") &&
        c.text.includes("status = 'past_due'"),
    );
    expect(reactivate?.values).toContain("cus_1");
  });

  it("marks the invoice past_due and enqueues a dunning email on invoice.payment_failed", async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join(" "), values });
      if (strings.join(" ").includes("select id from public.tenants")) {
        return Promise.resolve([{ id: "t1" }]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    const event: StripeEvent = {
      id: "evt_4c",
      type: "invoice.payment_failed",
      data: { object: { id: "in_2", customer: "cus_1" } },
    };
    await processStripeEvent(sql, event, logger);
    expect(calls.some((c) => c.text.includes("update public.billing_invoices"))).toBe(true);
    const insertMessage = calls.find(
      (c) =>
        c.text.includes("insert into public.messages_outbound") &&
        c.text.includes("dunning_payment_failed"),
    );
    expect(insertMessage?.values).toContain("t1");
  });

  it("does nothing (no throw) for an unhandled event type", async () => {
    const { sql } = makeSql();
    const event: StripeEvent = { id: "evt_5", type: "some.unhandled.type", data: { object: {} } };
    await expect(processStripeEvent(sql, event, logger)).resolves.toBeUndefined();
  });

  describe("provisioning saga invocation (E2E_FLOWS_AUDIT H3)", () => {
    function checkoutEvent(tenantId = "t1"): StripeEvent {
      return {
        id: "evt_prov",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            customer: "cus_1",
            subscription: "sub_1",
            metadata: { tenant_id: tenantId },
          },
        },
      };
    }

    it("invokes provisioning after activating the tenant", async () => {
      const { sql } = makeSql();
      const invokeProvisioning = vi.fn(async () => ({ ok: true }));
      await processStripeEvent(sql, checkoutEvent(), logger, { invokeProvisioning });
      expect(invokeProvisioning).toHaveBeenCalledWith("t1");
    });

    it("skips invoking provisioning when the tenant already has a published agent", async () => {
      const { sql } = makeSql({
        "from public.provisioning_runs": [{ status: "succeeded" }],
      });
      const invokeProvisioning = vi.fn(async () => ({ ok: true }));
      await processStripeEvent(sql, checkoutEvent(), logger, { invokeProvisioning });
      expect(invokeProvisioning).not.toHaveBeenCalled();
    });

    it("records a failed provisioning_runs row and a critical alert when the invocation itself fails", async () => {
      const { sql, calls } = makeSql();
      const invokeProvisioning: StripeEventDeps["invokeProvisioning"] = async () => ({
        ok: false,
        status: 500,
        error: "boom",
      });
      await processStripeEvent(sql, checkoutEvent(), logger, { invokeProvisioning });

      const failedRun = calls.find(
        (c) =>
          c.text.includes("insert into public.provisioning_runs") &&
          c.text.includes("'tenant_finalize'"),
      );
      expect(failedRun?.values).toContain("t1");
      expect(failedRun?.values.some((v) => typeof v === "string" && v.includes("boom"))).toBe(true);

      const alert = calls.find((c) => c.text.includes("insert into public.alerts"));
      expect(alert?.text).toContain("provisioning_invoke_failed");
      expect(alert?.values).toContain("t1");
    });
  });

  describe("referral clawback on refund/dispute (E2E_FLOWS_AUDIT H1)", () => {
    it("claws back a qualified referral and its accrued commission on charge.refunded", async () => {
      const { sql, calls } = makeSql({
        "from public.tenants where stripe_customer_id": [{ id: "t1" }],
        "from public.referrals": [{ id: "r1", referral_partner_id: "p1", status: "qualified" }],
        "from public.commission_events": [{ id: "ce1", amount_cents: 10000, status: "accrued" }],
      });
      const event: StripeEvent = {
        id: "evt_refund",
        type: "charge.refunded",
        data: { object: { id: "ch_1", customer: "cus_1" } },
      };
      await processStripeEvent(sql, event, logger);

      expect(
        calls.some(
          (c) =>
            c.text.includes("update public.referrals set status = 'clawed_back'") &&
            c.values.includes("r1"),
        ),
      ).toBe(true);
      expect(
        calls.some(
          (c) =>
            c.text.includes("update public.commission_events set status = 'clawed_back'") &&
            c.values.includes("ce1"),
        ),
      ).toBe(true);
      // Not previously paid, so no ytd_payout_cents reversal.
      expect(calls.some((c) => c.text.includes("update public.referral_partners"))).toBe(false);
    });

    it("reverses ytd_payout_cents when the clawed-back commission had already been paid", async () => {
      const { sql, calls } = makeSql({
        "from public.tenants where stripe_customer_id": [{ id: "t1" }],
        "from public.referrals": [{ id: "r1", referral_partner_id: "p1", status: "paid" }],
        "from public.commission_events": [{ id: "ce1", amount_cents: 10000, status: "paid" }],
      });
      const event: StripeEvent = {
        id: "evt_refund2",
        type: "charge.refunded",
        data: { object: { id: "ch_1", customer: "cus_1" } },
      };
      await processStripeEvent(sql, event, logger);

      const partnerUpdate = calls.find((c) => c.text.includes("update public.referral_partners"));
      expect(partnerUpdate?.values).toContain("p1");
      expect(partnerUpdate?.values).toContain(10000);
    });

    it("resolves the tenant via payment_processing_events on charge.dispute.created (no customer field on Dispute)", async () => {
      const { sql, calls } = makeSql({
        "from public.payment_processing_events": [{ tenant_id: "t1" }],
        "from public.referrals": [{ id: "r1", referral_partner_id: "p1", status: "qualified" }],
      });
      const event: StripeEvent = {
        id: "evt_dispute",
        type: "charge.dispute.created",
        data: { object: { id: "dp_1", charge: "ch_1" } },
      };
      await processStripeEvent(sql, event, logger);

      expect(
        calls.some(
          (c) =>
            c.text.includes("update public.referrals set status = 'clawed_back'") &&
            c.values.includes("r1"),
        ),
      ).toBe(true);
    });

    it("is a no-op when the referral was already clawed back or disqualified", async () => {
      const { sql, calls } = makeSql({
        "from public.tenants where stripe_customer_id": [{ id: "t1" }],
        "from public.referrals": [{ id: "r1", referral_partner_id: "p1", status: "disqualified" }],
      });
      const event: StripeEvent = {
        id: "evt_refund3",
        type: "charge.refunded",
        data: { object: { id: "ch_1", customer: "cus_1" } },
      };
      await processStripeEvent(sql, event, logger);
      expect(calls.some((c) => c.text.includes("update public.referrals"))).toBe(false);
    });

    it("is a no-op when the refunded customer has no referral at all", async () => {
      const { sql, calls } = makeSql({
        "from public.tenants where stripe_customer_id": [{ id: "t1" }],
      });
      const event: StripeEvent = {
        id: "evt_refund4",
        type: "charge.refunded",
        data: { object: { id: "ch_1", customer: "cus_1" } },
      };
      await processStripeEvent(sql, event, logger);
      expect(calls.some((c) => c.text.includes("update public.referrals"))).toBe(false);
    });

    it("scopes a per-invoice refund to only that period's commission_events, leaving the referral itself active", async () => {
      const { sql, calls } = makeSql({
        "from public.tenants where stripe_customer_id": [{ id: "t1" }],
        "from public.billing_invoices": [{ period_start: "2026-08-01" }],
        "from public.referrals": [{ id: "r1", referral_partner_id: "p1", status: "qualified" }],
        "from public.commission_events": [{ id: "ce_aug", amount_cents: 5000, status: "accrued" }],
      });
      const event: StripeEvent = {
        id: "evt_refund_invoice",
        type: "charge.refunded",
        data: { object: { id: "ch_1", customer: "cus_1", invoice: "in_aug" } },
      };
      await processStripeEvent(sql, event, logger);

      // Referral relationship itself is NOT clawed back — only the one period.
      expect(calls.some((c) => c.text.includes("update public.referrals set status"))).toBe(false);
      const commissionUpdate = calls.find((c) =>
        c.text.includes("update public.commission_events set status = 'clawed_back'"),
      );
      expect(commissionUpdate?.values).toContain("ce_aug");
      const commissionSelect = calls.find(
        (c) =>
          c.text.includes("select id, amount_cents, status from public.commission_events") &&
          c.text.includes("period ="),
      );
      expect(commissionSelect?.values).toContain("2026-08-01");
    });

    it("falls back to a full clawback when the refunded charge's invoice has no matching billing_invoices row", async () => {
      const { sql, calls } = makeSql({
        "from public.tenants where stripe_customer_id": [{ id: "t1" }],
        "from public.billing_invoices": [], // unresolvable invoice -> null period
        "from public.referrals": [{ id: "r1", referral_partner_id: "p1", status: "qualified" }],
        "from public.commission_events": [{ id: "ce1", amount_cents: 5000, status: "accrued" }],
      });
      const event: StripeEvent = {
        id: "evt_refund_unknown_invoice",
        type: "charge.refunded",
        data: { object: { id: "ch_1", customer: "cus_1", invoice: "in_unknown" } },
      };
      await processStripeEvent(sql, event, logger);

      expect(
        calls.some(
          (c) =>
            c.text.includes("update public.referrals set status = 'clawed_back'") &&
            c.values.includes("r1"),
        ),
      ).toBe(true);
    });
  });
});
