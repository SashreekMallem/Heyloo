import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { StripeEvent } from "../_shared/schemas/stripe-event.ts";
import type { SqlClient } from "../_shared/types.ts";
import { type StripeEventDeps, StripeEventDeferred, processStripeEvent } from "./handler.ts";
import {
  BALANCE_TXN,
  BALANCE_TXN_ID,
  CHARGE_ID,
  CUSTOMER_ID,
  SUBSCRIPTION_ID,
  T0,
  T1,
  TENANT_ID,
  chargeSucceeded,
  checkoutSessionCompleted,
  invoicePaid,
  invoicePaymentFailed,
  isoDay,
} from "./stripe-fixtures.ts";

const logger = createLogger();

interface TenantRow {
  id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}
interface InvoiceRow {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  stripe_invoice_id: string | null;
  base_fee_cents: number;
  total_cents: number;
  discount_cents: number;
  status: string;
}
interface FeeRow {
  tenant_id: string;
  stripe_charge_id: string;
  stripe_balance_transaction_id: string | null;
  method: string;
  fee_cents: number;
  net_cents: number;
}
interface WebhookRow {
  id: string;
  event_type: string;
  payload: { data: { object: Record<string, unknown> } };
  processing_error: string | null;
}

/** Stateful stand-in for the handful of tables `processStripeEvent` touches,
 * dispatched on the SQL text the handler really issues. Enforces the same
 * uniqueness the migration adds (stripe_invoice_id, stripe_charge_id, and the
 * draft-only period index) so an ordering bug surfaces as a wrong row count. */
function makeDb() {
  const tenants = new Map<string, TenantRow>();
  const invoices: InvoiceRow[] = [];
  const fees: FeeRow[] = [];
  const webhookEvents = new Map<string, WebhookRow>();
  let seq = 0;

  tenants.set(TENANT_ID, {
    id: TENANT_ID,
    status: "trialing",
    stripe_customer_id: null,
    stripe_subscription_id: null,
  });

  const sql = (async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join(" ").replace(/\s+/g, " ");

    if (text.includes("select id from public.tenants where stripe_customer_id")) {
      return [...tenants.values()].filter((t) => t.stripe_customer_id === v[0]).map((t) => ({ id: t.id }));
    }
    if (text.includes("select id from public.tenants where id =")) {
      return tenants.has(v[0] as string) ? [{ id: v[0] as string }] : [];
    }
    if (text.includes("select id from public.tenants where stripe_subscription_id")) {
      return [...tenants.values()].filter((t) => t.stripe_subscription_id === v[0]).map((t) => ({ id: t.id }));
    }
    if (text.includes("update public.tenants set status = 'active', stripe_customer_id")) {
      // checkout.session.completed activation: [customer, subscription, tenantId]
      const t = tenants.get(v[2] as string);
      if (t) {
        t.status = "active";
        t.stripe_customer_id = (v[0] as string | null) ?? t.stripe_customer_id;
        t.stripe_subscription_id = (v[1] as string | null) ?? t.stripe_subscription_id;
      }
      return [];
    }
    if (text.includes("update public.tenants set stripe_customer_id = coalesce")) {
      // link by fallback: [customer, subscription, tenantId]
      const t = tenants.get(v[2] as string);
      if (t) {
        t.stripe_customer_id = t.stripe_customer_id ?? (v[0] as string | null);
        t.stripe_subscription_id = t.stripe_subscription_id ?? (v[1] as string | null);
      }
      return [];
    }
    if (text.includes("select status from public.provisioning_runs")) return [];

    // --- billing_invoices ---------------------------------------------------
    if (text.includes("update public.billing_invoices set stripe_invoice_id")) {
      // attach: [invoiceId, status, total, discount, tenantId, ps, pe]
      const [invoiceId, status, total, discount, tenantId, ps, pe] = v as [string, string, number, number, string, string, string];
      const row = invoices.find(
        (r) =>
          r.tenant_id === tenantId &&
          r.period_start === ps &&
          r.period_end === pe &&
          r.stripe_invoice_id === null &&
          r.status === "draft",
      );
      if (!row) return [];
      row.stripe_invoice_id = invoiceId;
      row.status = status;
      row.total_cents = total;
      row.discount_cents = discount;
      return [{ id: row.id }];
    }
    if (text.includes("update public.billing_invoices set status = 'void'")) {
      const [tenantId, periodEnd, periodStart] = v as [string, string, string];
      for (const r of invoices) {
        if (
          r.tenant_id === tenantId &&
          r.stripe_invoice_id === null &&
          r.status === "draft" &&
          r.period_start < periodEnd &&
          r.period_end > periodStart
        ) {
          r.status = "void";
        }
      }
      return [];
    }
    if (text.includes("insert into public.billing_invoices")) {
      const [tenantId, ps, pe, invoiceId, base, discount, total, status] = v as [string, string, string, string, number, number, number, string];
      const existing = invoices.find((r) => r.stripe_invoice_id === invoiceId);
      if (existing) {
        if (!(existing.status === "paid" && status !== "paid")) {
          existing.status = status;
          existing.total_cents = total;
        }
        existing.discount_cents = discount;
        existing.base_fee_cents = base;
        return [];
      }
      invoices.push({
        id: `bi_${++seq}`,
        tenant_id: tenantId,
        period_start: ps,
        period_end: pe,
        stripe_invoice_id: invoiceId,
        base_fee_cents: base,
        total_cents: total,
        discount_cents: discount,
        status,
      });
      return [];
    }
    if (text.includes("update public.billing_invoices set status =")) {
      const [status, invoiceId] = v as [string, string];
      const row = invoices.find((r) => r.stripe_invoice_id === invoiceId);
      if (row && !(row.status === "paid" && status !== "paid")) row.status = status;
      return [];
    }
    if (text.includes("update public.tenants set status = 'active'") && text.includes("'past_due'")) return [];
    if (text.includes("insert into public.messages_outbound")) return [];

    // --- payment_processing_events -----------------------------------------
    if (text.includes("insert into public.payment_processing_events")) {
      const [tenantId, chargeId, btId, method, fee, net] = v as [string, string, string | null, string, number, number];
      const existing = fees.find((f) => f.stripe_charge_id === chargeId);
      if (existing) {
        existing.fee_cents = fee;
        existing.net_cents = net;
        return [];
      }
      fees.push({ tenant_id: tenantId, stripe_charge_id: chargeId, stripe_balance_transaction_id: btId, method, fee_cents: fee, net_cents: net });
      return [];
    }

    // --- webhook_events (deferred replay) -----------------------------------
    if (text.includes("from public.webhook_events") && text.includes("processing_error like 'deferred:%'")) {
      return [...webhookEvents.values()]
        .filter(
          (w) =>
            w.event_type === "charge.succeeded" &&
            w.processing_error?.startsWith("deferred:") &&
            w.payload.data.object["customer"] === v[0],
        )
        .map((w) => ({ id: w.id, payload: w.payload }));
    }
    if (text.includes("update public.webhook_events set processing_error = null")) {
      const w = webhookEvents.get(v[0] as string);
      if (w) w.processing_error = null;
      return [];
    }
    throw new Error(`unexpected SQL in fake db: ${text}`);
  }) as SqlClient;

  /** What `index.ts` does around `processStripeEvent`: dedup insert, run, mark. */
  async function deliver(event: StripeEvent, deps: StripeEventDeps): Promise<void> {
    if (webhookEvents.has(event.id)) return; // duplicate delivery -> fast ack, no work
    const row: WebhookRow = {
      id: event.id,
      event_type: event.type,
      payload: event as unknown as WebhookRow["payload"],
      processing_error: null,
    };
    webhookEvents.set(event.id, row);
    try {
      await processStripeEvent(sql, event, logger, deps);
    } catch (err) {
      if (err instanceof StripeEventDeferred) {
        row.processing_error = err.message;
        return;
      }
      throw err;
    }
  }

  return { sql, tenants, invoices, fees, webhookEvents, deliver };
}

function makeDeps(overrides: Partial<StripeEventDeps> = {}): StripeEventDeps {
  return {
    invokeProvisioning: vi.fn(async () => ({ ok: true })),
    fetchBalanceTransaction: vi.fn(async (id: string) => (id === BALANCE_TXN_ID ? BALANCE_TXN : null)),
    ...overrides,
  };
}

describe("E: first payment's processing fee (charge.succeeded ordering)", () => {
  it("charge.succeeded BEFORE checkout.session.completed is deferred, then recorded with the REAL fee once the tenant is linked", async () => {
    const db = makeDb();
    const deps = makeDeps();

    await db.deliver(chargeSucceeded(), deps);
    // Tenant has no stripe_customer_id yet: nothing recorded, no 0-fee placeholder.
    expect(db.fees).toHaveLength(0);
    expect(db.webhookEvents.get("evt_3ChargeSucceeded")?.processing_error).toBe("deferred:tenant_unresolved");

    await db.deliver(checkoutSessionCompleted(), deps);

    expect(db.tenants.get(TENANT_ID)?.stripe_customer_id).toBe(CUSTOMER_ID);
    expect(db.fees).toEqual([
      {
        tenant_id: TENANT_ID,
        stripe_charge_id: CHARGE_ID,
        stripe_balance_transaction_id: BALANCE_TXN_ID,
        method: "card",
        fee_cents: 897,
        net_cents: 29_900 - 897,
      },
    ]);
    // The deferred event is settled so it is never replayed again.
    expect(db.webhookEvents.get("evt_3ChargeSucceeded")?.processing_error).toBeNull();
    expect(deps.fetchBalanceTransaction).toHaveBeenCalledWith(BALANCE_TXN_ID);
  });

  it("charge.succeeded AFTER checkout.session.completed records the real fee immediately", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(checkoutSessionCompleted(), deps);
    await db.deliver(chargeSucceeded(), deps);
    expect(db.fees).toHaveLength(1);
    expect(db.fees[0]?.fee_cents).toBe(897);
    expect(db.fees[0]?.net_cents).toBe(29_003);
  });

  it("charge.succeeded before invoice.paid: the invoice links the tenant (metadata) and releases the deferred charge", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(chargeSucceeded(), deps);
    expect(db.fees).toHaveLength(0);
    // invoice.paid arrives before checkout.session.completed: tenant found via
    // the subscription metadata snapshot, linked, and the fee replayed.
    await db.deliver(invoicePaid(), deps);
    expect(db.tenants.get(TENANT_ID)?.stripe_customer_id).toBe(CUSTOMER_ID);
    expect(db.tenants.get(TENANT_ID)?.stripe_subscription_id).toBe(SUBSCRIPTION_ID);
    expect(db.fees).toHaveLength(1);
    expect(db.fees[0]?.fee_cents).toBe(897);
  });

  it("never writes a 0-fee placeholder when the fee cannot be fetched: defers as fee_unavailable, then records once it can", async () => {
    const db = makeDb();
    await db.deliver(checkoutSessionCompleted(), makeDeps());
    const failing = makeDeps({ fetchBalanceTransaction: vi.fn(async () => null) });
    await db.deliver(chargeSucceeded(), failing);
    expect(db.fees).toHaveLength(0);
    expect(db.webhookEvents.get("evt_3ChargeSucceeded")?.processing_error).toBe("deferred:fee_unavailable");

    // The next invoice.paid for the customer replays it (Stripe reachable again).
    await db.deliver(invoicePaid({ eventId: "evt_next" }), makeDeps());
    expect(db.fees).toHaveLength(1);
    expect(db.fees[0]?.fee_cents).toBe(897);
    expect(db.webhookEvents.get("evt_3ChargeSucceeded")?.processing_error).toBeNull();
  });

  it("defers (does not record) when Stripe is not configured at all", async () => {
    const db = makeDb();
    await db.deliver(checkoutSessionCompleted(), makeDeps());
    const noStripe: StripeEventDeps = { invokeProvisioning: async () => ({ ok: true }) };
    await db.deliver(chargeSucceeded(), noStripe);
    expect(db.fees).toHaveLength(0);
    expect(db.webhookEvents.get("evt_3ChargeSucceeded")?.processing_error).toBe("deferred:fee_unavailable");
  });

  it("is idempotent: a re-delivered charge event and a second replay never double-count the fee", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(chargeSucceeded(), deps);
    await db.deliver(checkoutSessionCompleted(), deps);
    await db.deliver(chargeSucceeded(), deps); // same Stripe event id: fast-ack
    await db.deliver(checkoutSessionCompleted({ id: "evt_1CheckoutCompleted_again" }), deps);
    expect(db.fees).toHaveLength(1);
  });

  it("ignores guest charges with no Customer (phone-payment Checkout), never deferring them", async () => {
    const db = makeDb();
    await db.deliver(chargeSucceeded({ customer: null }), makeDeps());
    expect(db.fees).toHaveLength(0);
    expect(db.webhookEvents.get("evt_3ChargeSucceeded")?.processing_error).toBeNull();
  });
});

describe("D: paid invoices reach billing_invoices (invoice.paid ordering)", () => {
  it("invoice.paid AFTER checkout.session.completed inserts a paid row from the payload (cents, period from lines.data)", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(checkoutSessionCompleted(), deps);
    await db.deliver(invoicePaid(), deps);
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0]).toMatchObject({
      tenant_id: TENANT_ID,
      stripe_invoice_id: "in_1TestSignup1",
      status: "paid",
      total_cents: 29_900,
      period_start: isoDay(T0),
      period_end: isoDay(T1),
    });
  });

  it("invoice.paid BEFORE checkout.session.completed still lands: tenant resolved via the subscription metadata, then linked; the later checkout event adds no second row", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(invoicePaid(), deps);
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0]?.status).toBe("paid");
    expect(db.tenants.get(TENANT_ID)?.stripe_customer_id).toBe(CUSTOMER_ID);

    await db.deliver(checkoutSessionCompleted(), deps);
    await db.deliver(invoicePaid({ eventId: "evt_dup_delivery_of_same_invoice" }), deps);
    expect(db.invoices).toHaveLength(1);
  });

  it("takes the service period from the subscription line, not the zero-length one-time setup-fee line listed first", async () => {
    const db = makeDb();
    await db.deliver(invoicePaid({ withSetupFee: true, total: 39_900 }), makeDeps());
    expect(db.invoices[0]).toMatchObject({
      period_start: isoDay(T0),
      period_end: isoDay(T1),
      total_cents: 39_900,
    });
  });

  it("records discount cents from total_discount_amounts and amount_paid (not the pre-discount subtotal) as the total", async () => {
    const db = makeDb();
    await db.deliver(invoicePaid({ total: 24_900, discountCents: 5_000 }), makeDeps());
    expect(db.invoices[0]).toMatchObject({
      total_cents: 24_900,
      discount_cents: 5_000,
      base_fee_cents: 29_900,
    });
  });

  it("invoice.payment_failed inserts a past_due row from amount_due; a later invoice.paid flips it to paid (same row)", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(checkoutSessionCompleted(), deps);
    await db.deliver(invoicePaymentFailed(), deps);
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0]).toMatchObject({ status: "past_due", total_cents: 29_900 });
    await db.deliver(invoicePaid(), deps);
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0]?.status).toBe("paid");
  });

  it("a late invoice.payment_failed never downgrades an already-paid invoice", async () => {
    const db = makeDb();
    const deps = makeDeps();
    await db.deliver(checkoutSessionCompleted(), deps);
    await db.deliver(invoicePaid(), deps);
    await db.deliver(invoicePaymentFailed(), deps);
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0]?.status).toBe("paid");
  });

  it("attaches to the billing-cycle draft for the exact same period instead of adding a second row", async () => {
    const db = makeDb();
    db.invoices.push({
      id: "bi_draft",
      tenant_id: TENANT_ID,
      period_start: isoDay(T0),
      period_end: isoDay(T1),
      stripe_invoice_id: null,
      base_fee_cents: 29_900,
      total_cents: 31_000,
      discount_cents: 0,
      status: "draft",
    });
    await db.deliver(checkoutSessionCompleted(), makeDeps());
    await db.deliver(invoicePaid(), makeDeps());
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0]).toMatchObject({
      id: "bi_draft",
      stripe_invoice_id: "in_1TestSignup1",
      status: "paid",
      total_cents: 29_900,
    });
  });

  it("supersedes (voids) an overlapping calendar-month draft so revenue is never counted twice", async () => {
    const db = makeDb();
    db.invoices.push({
      id: "bi_calendar_draft",
      tenant_id: TENANT_ID,
      period_start: "2026-09-01",
      period_end: "2026-10-01",
      stripe_invoice_id: null,
      base_fee_cents: 29_900,
      total_cents: 29_900,
      discount_cents: 0,
      status: "draft",
    });
    await db.deliver(checkoutSessionCompleted(), makeDeps());
    await db.deliver(invoicePaid(), makeDeps());
    expect(db.invoices.find((r) => r.id === "bi_calendar_draft")?.status).toBe("void");
    const paid = db.invoices.filter((r) => r.status === "paid");
    expect(paid).toHaveLength(1);
  });

  it("two Stripe invoices with the same service period are two rows (no period collision)", async () => {
    const db = makeDb();
    await db.deliver(checkoutSessionCompleted(), makeDeps());
    await db.deliver(invoicePaid({ id: "in_A", eventId: "evt_A" }), makeDeps());
    await db.deliver(invoicePaid({ id: "in_B", eventId: "evt_B" }), makeDeps());
    expect(db.invoices.map((r) => r.stripe_invoice_id)).toEqual(["in_A", "in_B"]);
  });

  it("an invoice for a customer/subscription that is not a tenant is left alone (no row, no throw)", async () => {
    const db = makeDb();
    await db.deliver(invoicePaid({ customer: "cus_stranger", subscription: "sub_stranger", tenantId: null }), makeDeps());
    expect(db.invoices).toHaveLength(0);
  });
});
