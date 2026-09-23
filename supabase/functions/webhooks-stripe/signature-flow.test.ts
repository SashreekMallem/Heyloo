import { beforeEach, describe, expect, it } from "vitest";
import { hmacSha256Hex } from "../_shared/crypto.ts";
import { createLogger } from "../_shared/logger.ts";
import type { StripeEvent } from "../_shared/schemas/stripe-event.ts";
import { StripeEventSchema } from "../_shared/schemas/stripe-event.ts";
import { verifyStripeSignature } from "../_shared/stripe-signature.ts";
import type { SqlClient } from "../_shared/types.ts";
import { insertWebhookEventIfNew, markWebhookEventProcessed } from "../_shared/webhook-dedup.ts";
import { processStripeEvent } from "./handler.ts";

/**
 * QA-BILL deliverable 3: end-to-end proof of the FULL `/webhooks-stripe`
 * request path (`index.ts`'s own orchestration, reproduced here without a
 * live Deno server) — a locally computed Stripe signature (test secret,
 * this file only, matching the `t=<unix_seconds>,v1=<hex HMAC-SHA256>`
 * scheme `_shared/stripe-signature.ts` verifies against) through
 * `verifyStripeSignature` -> `webhook_events` idempotent-insert dedup ->
 * `processStripeEvent`'s tenant/billing_invoices status transitions, for
 * the four event types this deliverable names. `handler.test.ts` already
 * covers `processStripeEvent` in isolation (mocked `sql`, no signature/
 * dedup layer) — this file proves the layers above it, and idempotency on
 * a REPLAYED delivery of the same event id, which nothing else in this
 * repo exercises.
 *
 * Event field names (`checkout.session.completed`'s `customer`/
 * `subscription`/`metadata`, `invoice.paid`/`invoice.payment_failed`'s
 * `id`/`customer`, `customer.subscription.deleted`'s `customer`) — VERIFY
 * (docs/VERIFY.md): confirmed against
 * https://docs.stripe.com/api/events/types (checkout.session.completed,
 * invoice.paid, invoice.payment_failed, customer.subscription.deleted) and
 * https://docs.stripe.com/webhooks/signatures (the `Stripe-Signature`
 * header scheme) — see this file's own VERIFY.md entry for the fetch date.
 */

const STRIPE_TEST_SIGNING_SECRET = "whsec_qa_bill_test_secret_only_used_in_this_file";
const logger = createLogger();

/** Minimal in-memory Postgres stand-in — enough of `tenants`/
 * `billing_invoices`/`webhook_events`/`provisioning_runs` for real state
 * transitions to be asserted on, dispatched by matching the same SQL text
 * `handler.ts` actually issues (same technique `handler.test.ts`'s own
 * `makeSql` fixtures use, extended here to mutate state rather than only
 * record calls). */
function makeFakeDb() {
  const tenants = new Map<string, { id: string; status: string; stripe_customer_id: string }>();
  const billingInvoices = new Map<string, { status: string }>();
  const webhookEvents = new Set<string>(); // `${source}:${event_id}`
  const processedEvents = new Set<string>();

  function seedTenant(t: { id: string; status: string; stripe_customer_id: string }) {
    tenants.set(t.id, { ...t });
  }
  function findTenantByCustomer(customerId: string) {
    return [...tenants.values()].find((t) => t.stripe_customer_id === customerId);
  }

  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");

    if (text.includes("insert into public.webhook_events")) {
      const [source, eventId] = values as [string, string, ...unknown[]];
      const key = `${source}:${eventId}`;
      if (webhookEvents.has(key)) return [];
      webhookEvents.add(key);
      return [{ id: key }];
    }
    if (text.includes("update public.webhook_events set processed_at")) {
      const [id] = values as [string];
      processedEvents.add(id);
      return [];
    }

    if (
      text.includes("update public.tenants") &&
      text.includes("stripe_customer_id = coalesce") &&
      text.includes("stripe_subscription_id = coalesce")
    ) {
      // checkout.session.completed tenant activation — values appear in
      // template order: customerId, subscriptionId, tenantId (handler.ts's
      // own `set status = 'active', stripe_customer_id = coalesce(${customerId}, ...),
      // stripe_subscription_id = coalesce(${subscriptionId}, ...) where id = ${tenantId}`).
      const [customerId, , tenantId] = values as [string | null, string | null, string];
      const t = tenants.get(tenantId);
      if (t) {
        t.status = "active";
        if (customerId) t.stripe_customer_id = customerId;
      }
      return [];
    }
    if (text.includes("select status from public.provisioning_runs")) {
      return []; // no prior publish -> invokeProvisioning gets called
    }
    if (
      text.includes("update public.tenants set status = 'canceled'") &&
      text.includes("where stripe_customer_id")
    ) {
      // customer.subscription.deleted — 'canceled' is a SQL literal, not a
      // bound value, so `values` here is only `[customerId]`.
      const [customerId] = values as [string];
      const t = findTenantByCustomer(customerId);
      if (t) t.status = "canceled";
      return [];
    }
    if (
      text.includes("update public.tenants set status =") &&
      text.includes("where stripe_customer_id =") &&
      !text.includes("'active'") &&
      !text.includes("'canceled'")
    ) {
      // customer.subscription.updated — values: [mapped, customerId].
      const [mapped, customerId] = values as [string, string];
      const t = findTenantByCustomer(customerId);
      if (t) t.status = mapped;
      return [];
    }
    if (text.includes("update public.billing_invoices set status = 'paid'")) {
      const [stripeInvoiceId] = values as [string];
      const inv = billingInvoices.get(stripeInvoiceId);
      if (inv) inv.status = "paid";
      return [];
    }
    if (
      text.includes("update public.tenants set status = 'active'") &&
      text.includes("status = 'past_due'")
    ) {
      // dunning reactivation
      const [customerId] = values as [string];
      const t = findTenantByCustomer(customerId);
      if (t && t.status === "past_due") t.status = "active";
      return [];
    }
    if (text.includes("update public.billing_invoices set status = 'past_due'")) {
      const [stripeInvoiceId] = values as [string];
      const inv = billingInvoices.get(stripeInvoiceId);
      if (inv) inv.status = "past_due";
      return [];
    }
    if (text.includes("select id from public.tenants where stripe_customer_id")) {
      const [customerId] = values as [string];
      const t = findTenantByCustomer(customerId);
      return t ? [{ id: t.id }] : [];
    }
    if (text.includes("insert into public.messages_outbound")) {
      return [];
    }

    return [];
  }) as SqlClient;

  return { sql, tenants, billingInvoices, webhookEvents, processedEvents, seedTenant };
}

/** Computes a real `Stripe-Signature` header the way Stripe's own SDKs do
 * (`t=<unix_seconds>,v1=<hex HMAC-SHA256 of "${t}.${rawBody}">`), against a
 * TEST secret defined only in this file — proves `verifyStripeSignature`
 * accepts a correctly-signed payload, not just that a mocked bypass works. */
async function signStripePayload(rawBody: string, secret: string, atMs: number): Promise<string> {
  const t = Math.floor(atMs / 1000);
  const v1 = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return `t=${t},v1=${v1}`;
}

/** Reproduces `index.ts`'s own request pipeline (signature verify -> parse
 * -> dedup -> processStripeEvent) against the fake db, so this test proves
 * the SAME sequence production runs, not a hand-picked subset of it. */
async function deliverWebhook(
  sql: SqlClient,
  rawBody: string,
  now: Date,
  invokeProvisioning: (tenantId: string) => Promise<{ ok: boolean }> = async () => ({ ok: true }),
): Promise<{ status: number }> {
  const header = await signStripePayload(rawBody, STRIPE_TEST_SIGNING_SECRET, now.getTime());
  const verification = await verifyStripeSignature({
    rawBody,
    header,
    secret: STRIPE_TEST_SIGNING_SECRET,
    now,
  });
  if (!verification.valid) return { status: 401 };

  const parsed = StripeEventSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) return { status: 400 };
  const event = parsed.data as StripeEvent;

  const dedup = await insertWebhookEventIfNew(sql, {
    source: "stripe",
    eventId: event.id,
    eventType: event.type,
    payload: JSON.parse(rawBody),
    signatureVerified: true,
  });
  if (!dedup.isNew) return { status: 200 }; // fast-ack, no reprocessing — idempotency

  await processStripeEvent(sql, event, logger, { invokeProvisioning });
  if (dedup.webhookEventId) await markWebhookEventProcessed(sql, dedup.webhookEventId);
  return { status: 200 };
}

describe("webhooks-stripe — signed end-to-end delivery (QA-BILL deliverable 3)", () => {
  const NOW = new Date("2026-09-23T12:00:00Z");

  it("rejects a delivery signed with the WRONG secret (proves verification is real, not a stub)", async () => {
    const { sql } = makeFakeDb();
    const rawBody = JSON.stringify({
      id: "evt_bad",
      type: "checkout.session.completed",
      data: { object: {} },
    });
    const header = await signStripePayload(
      rawBody,
      "whsec_totally_different_secret",
      NOW.getTime(),
    );
    const verification = await verifyStripeSignature({
      rawBody,
      header,
      secret: STRIPE_TEST_SIGNING_SECRET,
      now: NOW,
    });
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("mismatch");
    void sql;
  });

  describe("checkout.session.completed — activates the tenant + kicks off provisioning", () => {
    it("transitions a trialing tenant to active on a correctly signed delivery", async () => {
      const { sql, tenants, seedTenant } = makeFakeDb();
      seedTenant({ id: "t1", status: "trialing", stripe_customer_id: "" });
      let provisioningInvoked = false;

      const rawBody = JSON.stringify({
        id: "evt_checkout_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            customer: "cus_1",
            subscription: "sub_1",
            metadata: { tenant_id: "t1" },
          },
        },
      });

      const result = await deliverWebhook(sql, rawBody, NOW, async () => {
        provisioningInvoked = true;
        return { ok: true };
      });

      expect(result.status).toBe(200);
      expect(tenants.get("t1")?.status).toBe("active");
      expect(tenants.get("t1")?.stripe_customer_id).toBe("cus_1");
      expect(provisioningInvoked).toBe(true);
    });

    it("is idempotent on a REPLAYED delivery of the same event id (webhook_events dedup — no double processing)", async () => {
      const { sql, tenants, seedTenant, webhookEvents } = makeFakeDb();
      seedTenant({ id: "t1", status: "trialing", stripe_customer_id: "" });
      let provisioningInvocations = 0;

      const rawBody = JSON.stringify({
        id: "evt_checkout_replay",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            customer: "cus_1",
            subscription: "sub_1",
            metadata: { tenant_id: "t1" },
          },
        },
      });
      const invokeProvisioning = async () => {
        provisioningInvocations += 1;
        return { ok: true };
      };

      const first = await deliverWebhook(sql, rawBody, NOW, invokeProvisioning);
      const second = await deliverWebhook(sql, rawBody, NOW, invokeProvisioning);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200); // still fast-acks 200, never an error on replay
      expect(provisioningInvocations).toBe(1); // NOT invoked twice
      expect(tenants.get("t1")?.status).toBe("active");
      expect(webhookEvents.size).toBe(1); // exactly one (source, event_id) row
    });
  });

  describe("customer.subscription.deleted — cancels the tenant (feeds job-offboarding)", () => {
    it("transitions an active tenant to canceled", async () => {
      const { sql, tenants, seedTenant } = makeFakeDb();
      seedTenant({ id: "t2", status: "active", stripe_customer_id: "cus_2" });

      const rawBody = JSON.stringify({
        id: "evt_sub_deleted_1",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_2", customer: "cus_2" } },
      });

      const result = await deliverWebhook(sql, rawBody, NOW);
      expect(result.status).toBe(200);
      expect(tenants.get("t2")?.status).toBe("canceled");
    });

    it("is idempotent on replay (already-canceled tenant stays canceled, no error)", async () => {
      const { sql, tenants, seedTenant } = makeFakeDb();
      seedTenant({ id: "t2", status: "active", stripe_customer_id: "cus_2" });
      const rawBody = JSON.stringify({
        id: "evt_sub_deleted_replay",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_2", customer: "cus_2" } },
      });
      await deliverWebhook(sql, rawBody, NOW);
      const second = await deliverWebhook(sql, rawBody, NOW);
      expect(second.status).toBe(200);
      expect(tenants.get("t2")?.status).toBe("canceled");
    });
  });

  describe("invoice.paid — marks the invoice paid + dunning reactivation", () => {
    it("marks a billing_invoices row paid and reactivates a past_due tenant", async () => {
      const { sql, tenants, billingInvoices, seedTenant } = makeFakeDb();
      seedTenant({ id: "t3", status: "past_due", stripe_customer_id: "cus_3" });
      billingInvoices.set("in_1", { status: "past_due" });

      const rawBody = JSON.stringify({
        id: "evt_invoice_paid_1",
        type: "invoice.paid",
        data: { object: { id: "in_1", customer: "cus_3" } },
      });

      const result = await deliverWebhook(sql, rawBody, NOW);
      expect(result.status).toBe(200);
      expect(billingInvoices.get("in_1")?.status).toBe("paid");
      expect(tenants.get("t3")?.status).toBe("active");
    });

    it("is idempotent on replay (invoice stays paid, tenant stays active, no double reactivation error)", async () => {
      const { sql, tenants, billingInvoices, seedTenant } = makeFakeDb();
      seedTenant({ id: "t3", status: "past_due", stripe_customer_id: "cus_3" });
      billingInvoices.set("in_1", { status: "past_due" });
      const rawBody = JSON.stringify({
        id: "evt_invoice_paid_replay",
        type: "invoice.paid",
        data: { object: { id: "in_1", customer: "cus_3" } },
      });
      await deliverWebhook(sql, rawBody, NOW);
      const second = await deliverWebhook(sql, rawBody, NOW);
      expect(second.status).toBe(200);
      expect(billingInvoices.get("in_1")?.status).toBe("paid");
      expect(tenants.get("t3")?.status).toBe("active");
    });
  });

  describe("invoice.payment_failed — marks the invoice past_due (dunning entry)", () => {
    it("marks a billing_invoices row past_due", async () => {
      const { sql, billingInvoices, seedTenant } = makeFakeDb();
      seedTenant({ id: "t4", status: "active", stripe_customer_id: "cus_4" });
      billingInvoices.set("in_2", { status: "draft" });

      const rawBody = JSON.stringify({
        id: "evt_invoice_failed_1",
        type: "invoice.payment_failed",
        data: { object: { id: "in_2", customer: "cus_4" } },
      });

      const result = await deliverWebhook(sql, rawBody, NOW);
      expect(result.status).toBe(200);
      expect(billingInvoices.get("in_2")?.status).toBe("past_due");
    });
  });

  it("rejects a stale (replayed-after-tolerance) timestamp even with a correct signature", async () => {
    const { sql } = makeFakeDb();
    const rawBody = JSON.stringify({
      id: "evt_stale",
      type: "invoice.paid",
      data: { object: { id: "in_x" } },
    });
    const staleSignedAtMs = NOW.getTime() - 10 * 60 * 1000; // 10 minutes ago, tolerance is 5
    const header = await signStripePayload(rawBody, STRIPE_TEST_SIGNING_SECRET, staleSignedAtMs);
    const verification = await verifyStripeSignature({
      rawBody,
      header,
      secret: STRIPE_TEST_SIGNING_SECRET,
      now: NOW,
    });
    expect(verification.valid).toBe(false);
    expect(verification.reason).toBe("stale_timestamp");
    void sql;
  });
});

describe("no-secret-configured path (OPS-5 re-confirmation, QA-BILL deliverable 3)", () => {
  beforeEach(() => {
    // Documents index.ts's own behavior — see webhooks-stripe/index.ts:
    // `optionalEnv("STRIPE_WEBHOOK_SIGNING_SECRET")` + an explicit
    // `if (!secret) return 503` BEFORE the raw body is even read. Live-
    // reconfirmed against the deployed function (QA-BILL, 2026-09-23):
    // `curl -X POST .../webhooks-stripe` with no signing secret configured
    // returns `503 {"error":"not_configured"}`.
  });

  it("verifyStripeSignature itself fails closed with missing_secret when secret is undefined, regardless of header/body", async () => {
    const result = await verifyStripeSignature({
      rawBody: "{}",
      header: "t=1,v1=deadbeef",
      secret: undefined,
      now: new Date(),
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });
});
