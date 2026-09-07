import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { StripeEvent } from "../_shared/schemas/stripe-event.js";
import type { SqlClient } from "../_shared/types.js";
import { processStripeEvent } from "./handler.js";

const logger = createLogger();

function makeSql(): { sql: SqlClient; calls: { text: string; values: unknown[] }[] } {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
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
});
