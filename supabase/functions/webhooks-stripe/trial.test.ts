import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { StripeEvent } from "../_shared/schemas/stripe-event.ts";
import type { SqlClient } from "../_shared/types.ts";
import { processStripeEvent } from "./handler.ts";
import {
  CUSTOMER_ID,
  SUBSCRIPTION_ID,
  subscriptionEvent,
  T0,
  TENANT_ID,
} from "./stripe-fixtures.ts";
import { parseSubscriptionFacts } from "./trial.ts";

const logger = createLogger();
const TRIAL_END = T0 + 7 * 86_400;
/** During the trial (day 4). */
const DURING = new Date((T0 + 4 * 86_400) * 1000);
/** After the trial's scheduled end. */
const AFTER = new Date((TRIAL_END + 3600) * 1000);

type Call = { text: string; values: unknown[] };

function makeSql(fixtures: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
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

function deps(now: Date, billingPageUrl?: string) {
  return {
    invokeProvisioning: async () => ({ ok: true }),
    now: () => now,
    ...(billingPageUrl ? { billingPageUrl } : {}),
  };
}

const tenantUpdates = (calls: Call[]) =>
  calls.filter((c) => c.text.includes("update public.tenants"));

describe("parseSubscriptionFacts", () => {
  it("reads id, customer, status, trial_end and the checkout metadata", () => {
    const event = subscriptionEvent("customer.subscription.created");
    expect(parseSubscriptionFacts(event.data.object)).toEqual({
      subscriptionId: SUBSCRIPTION_ID,
      customerId: CUSTOMER_ID,
      status: "trialing",
      trialEnd: TRIAL_END,
      endedAt: null,
      cancelScheduled: false,
      metadataTenantId: TENANT_ID,
      trialMinutes: 100,
    });
  });

  it("reads a cancellation the owner scheduled for the trial end (portal: cancel at period end)", () => {
    const atPeriodEnd = subscriptionEvent("customer.subscription.updated", {
      cancelAtPeriodEnd: true,
    });
    expect(parseSubscriptionFacts(atPeriodEnd.data.object)?.cancelScheduled).toBe(true);
    const atTrialEnd = subscriptionEvent("customer.subscription.updated", { cancelAt: TRIAL_END });
    expect(parseSubscriptionFacts(atTrialEnd.data.object)?.cancelScheduled).toBe(true);
    const muchLater = subscriptionEvent("customer.subscription.updated", {
      cancelAt: TRIAL_END + 60 * 86_400,
    });
    expect(parseSubscriptionFacts(muchLater.data.object)?.cancelScheduled).toBe(false);
  });

  it("accepts an expanded customer object", () => {
    const obj = { ...subscriptionEvent("customer.subscription.updated").data.object };
    obj["customer"] = { id: "cus_expanded", object: "customer" };
    expect(parseSubscriptionFacts(obj)?.customerId).toBe("cus_expanded");
  });

  it("ignores a non-UUID tenant_id and an unusable trial_minutes (falls back to 100)", () => {
    const event = subscriptionEvent("customer.subscription.created", {
      tenantId: "not-a-uuid",
      trialMinutes: "lots",
    });
    const facts = parseSubscriptionFacts(event.data.object);
    expect(facts?.metadataTenantId).toBeNull();
    expect(facts?.trialMinutes).toBe(100);
  });

  it("rejects a payload whose trial_end is not a timestamp", () => {
    expect(
      parseSubscriptionFacts({ id: "sub_1", status: "trialing", trial_end: "soon" }),
    ).toBeNull();
  });
});

describe("customer.subscription.created / updated while trialing (TRIAL-1)", () => {
  it("keeps a trialing tenant usable (active), stores the trial end and the minutes cap, links Stripe", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.created"),
      logger,
      deps(DURING),
    );
    const updates = tenantUpdates(calls);
    expect(updates).toHaveLength(1);
    const update = updates[0] as Call;
    expect(update.text).toContain(
      "status = case when status = 'trialing' then 'active' else status end",
    );
    expect(update.text).toContain("to_timestamp(");
    expect(update.text).toContain("trial_minutes_cap = coalesce(trial_minutes_cap,");
    expect(update.text).toContain("stripe_customer_id = coalesce(stripe_customer_id,");
    expect(update.text).toContain("trial_cancel_scheduled =");
    expect(update.values).toEqual(
      expect.arrayContaining([TRIAL_END, 100, false, CUSTOMER_ID, SUBSCRIPTION_ID, TENANT_ID]),
    );
  });

  it("records that the owner canceled during the trial (banner and billing copy say no charge)", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated", { cancelAtPeriodEnd: true }),
      logger,
      deps(DURING),
    );
    const update = tenantUpdates(calls)[0] as Call;
    expect(update.text).toContain("trial_cancel_scheduled =");
    expect(update.values).toContain(true);
  });

  it("finds the tenant by metadata.tenant_id (event before checkout.session.completed) or by customer", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.created"),
      logger,
      deps(DURING),
    );
    const update = tenantUpdates(calls)[0] as Call;
    expect(update.text).toContain("id = ");
    expect(update.text).toContain("stripe_customer_id is null or stripe_customer_id =");
    expect(update.text).toContain("or stripe_customer_id =");
  });

  it("never reopens a trial that already ended locally (a delayed trialing event)", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated"),
      logger,
      deps(DURING),
    );
    const update = tenantUpdates(calls)[0] as Call;
    expect(update.text).toContain("when trial_ended_reason is null then to_timestamp(");
    expect(update.text).toContain("else trial_ends_at");
  });

  it("uses the cap from the subscription metadata", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.created", { trialMinutes: "50" }),
      logger,
      deps(DURING),
    );
    expect(tenantUpdates(calls)[0]?.values).toContain(50);
  });

  it("does not run the status mapping for a trialing subscription (no 'trialing' status ever written)", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated"),
      logger,
      deps(DURING),
    );
    expect(calls.some((c) => c.values.includes("trialing"))).toBe(false);
  });
});

describe("the trial ends (TRIAL-1)", () => {
  it("trial ran its days: subscription active -> status active, actual end recorded, reason 'time'", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated", { status: "active" }),
      logger,
      deps(AFTER),
    );
    const updates = tenantUpdates(calls);
    expect(updates[0]?.values).toContain("active"); // the existing status mapping first
    const outcome = updates[1] as Call;
    expect(outcome.text).toContain("else 'time'");
    expect(outcome.text).toContain(
      "when trial_ended_reason is null or trial_ended_reason = 'minutes'",
    );
    expect(outcome.values).toContain(TRIAL_END);
    // nothing came back as 'minutes', so no email
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("a trial the minutes cap ended in Stripe but did not record yet is recorded as 'minutes', and the owner is emailed", async () => {
    // The cap claimed the trial (trial_cap_claimed_at) and Stripe ended it
    // before the scheduled end; the cap's own write was lost (crash).
    const { sql, calls } = makeSql({
      "returning id, trial_ended_reason, trial_minutes_cap": [
        { id: TENANT_ID, trial_ended_reason: "minutes", trial_minutes_cap: 100 },
      ],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    const capEnd = T0 + 3 * 86_400;
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated", { status: "active", trialEnd: capEnd }),
      logger,
      deps(DURING, "https://heyloo.app/en/dashboard/billing"),
    );
    const outcome = tenantUpdates(calls)[1] as Call;
    expect(outcome.text).toContain("when trial_cap_claimed_at is not null");
    expect(outcome.text).toContain("then 'minutes'");
    expect(outcome.values).toContain(capEnd);
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toContain("trial_minutes_used");
    expect(insert?.values).toContainEqual({
      minutes: 100,
      billing_url: "https://heyloo.app/en/dashboard/billing",
    });
  });

  it("an active subscription whose trial_end is still ahead (clock skew) records nothing yet", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated", { status: "active" }),
      logger,
      deps(DURING),
    );
    expect(tenantUpdates(calls)).toHaveLength(1); // status mapping only
  });

  it("a subscription that never had a trial only gets the status mapping", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated", { status: "past_due", trialEnd: null }),
      logger,
      deps(AFTER),
    );
    expect(tenantUpdates(calls)).toHaveLength(1);
    expect(tenantUpdates(calls)[0]?.values).toContain("past_due");
  });

  it("canceled during the trial (subscription.deleted): reason 'canceled', end = now, never billed", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.deleted", { status: "canceled" }),
      logger,
      deps(DURING),
    );
    const updates = tenantUpdates(calls);
    expect(updates[0]?.text).toContain("status = 'canceled'");
    const canceled = updates.find((u) => u.text.includes("trial_ended_reason = 'canceled'"));
    expect(canceled?.text).toContain("trial_ended_reason is null or trial_ended_reason = 'time'");
    expect(canceled?.text).toContain("least(");
    // ended now (no ended_at yet), before the trial's end
    expect(canceled?.values).toContain(Math.floor(DURING.getTime() / 1000));
    // trial_end is still ahead, so it is not stamped as having run its days
    expect(updates.some((u) => u.text.includes("else 'time'"))).toBe(false);
  });

  it("set to cancel when the trial ends (ended_at = trial_end): canceled, never 'time'", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.deleted", {
        status: "canceled",
        endedAt: TRIAL_END + 2,
      }),
      logger,
      deps(AFTER),
    );
    const updates = tenantUpdates(calls);
    const canceledIdx = updates.findIndex((u) =>
      u.text.includes("trial_ended_reason = 'canceled'"),
    );
    const timeIdx = updates.findIndex((u) => u.text.includes("else 'time'"));
    expect(canceledIdx).toBeGreaterThan(-1);
    // the 'time' stamp runs after and only fills a still-empty reason
    expect(timeIdx).toBeGreaterThan(canceledIdx);
    expect(updates[timeIdx]?.text).toContain("trial_ended_reason is null");
  });

  it("canceled long after a trial that ran its days: the trial outcome is left alone", async () => {
    const { sql, calls } = makeSql();
    const later = new Date((TRIAL_END + 40 * 86_400) * 1000);
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.deleted", {
        status: "canceled",
        endedAt: TRIAL_END + 40 * 86_400,
      }),
      logger,
      deps(later),
    );
    expect(
      tenantUpdates(calls).some((u) => u.text.includes("trial_ended_reason = 'canceled'")),
    ).toBe(false);
  });

  it("canceled via subscription.updated status=canceled is recorded the same way", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.updated", { status: "canceled" }),
      logger,
      deps(DURING),
    );
    expect(
      tenantUpdates(calls).some((u) => u.text.includes("trial_ended_reason = 'canceled'")),
    ).toBe(true);
  });

  it("paused / resumed events use the same mapping", async () => {
    const paused = makeSql();
    await processStripeEvent(
      paused.sql,
      subscriptionEvent("customer.subscription.paused", { status: "paused", trialEnd: null }),
      logger,
      deps(AFTER),
    );
    expect(tenantUpdates(paused.calls)[0]?.values).toContain("paused");
    const resumed = makeSql();
    await processStripeEvent(
      resumed.sql,
      subscriptionEvent("customer.subscription.resumed", { status: "active", trialEnd: null }),
      logger,
      deps(AFTER),
    );
    expect(tenantUpdates(resumed.calls)[0]?.values).toContain("active");
  });
});

describe("customer.subscription.trial_will_end (TRIAL-1)", () => {
  const tenantRow = { id: TENANT_ID, timezone: "America/Chicago", trial_ended_reason: null };

  it("queues one owner email with the end day in the tenant's time zone and the billing link", async () => {
    const { sql, calls } = makeSql({
      "select id, timezone, trial_ended_reason from public.tenants": [
        { ...tenantRow, timezone: "Pacific/Auckland" },
      ],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.trial_will_end"),
      logger,
      deps(DURING, "https://heyloo.app/en/dashboard/billing"),
    );
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toContain("trial_will_end");
    expect(insert?.text).toContain("mo.template_key =");
    const payload = insert?.values.find(
      (v): v is Record<string, unknown> => typeof v === "object" && v !== null && "ends_on" in v,
    );
    // T0 + 7 days = 2026-09-28T14:13:20Z, already Tuesday 03:13 in Auckland
    expect(payload).toEqual({
      ends_on: "Tuesday, September 29",
      trial_ends_at: new Date(TRIAL_END * 1000).toISOString(),
      billing_url: "https://heyloo.app/en/dashboard/billing",
    });
    expect(calls.some((c) => c.text.includes("pgmq.send"))).toBe(true);
  });

  it("sends nothing when Stripe fires it because the trial was ended early (status active)", async () => {
    const { sql, calls } = makeSql({
      "select id, timezone, trial_ended_reason from public.tenants": [tenantRow],
    });
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.trial_will_end", { status: "active" }),
      logger,
      deps(DURING),
    );
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("sends nothing when the trial end is already past", async () => {
    const { sql, calls } = makeSql({
      "select id, timezone, trial_ended_reason from public.tenants": [tenantRow],
    });
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.trial_will_end"),
      logger,
      deps(AFTER),
    );
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("sends nothing when the owner already canceled (the subscription ends with the trial, unpaid)", async () => {
    const { sql, calls } = makeSql({
      "select id, timezone, trial_ended_reason from public.tenants": [tenantRow],
    });
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.trial_will_end", { cancelAtPeriodEnd: true }),
      logger,
      deps(DURING),
    );
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("sends nothing once the trial ended locally (minutes cap)", async () => {
    const { sql, calls } = makeSql({
      "select id, timezone, trial_ended_reason from public.tenants": [
        { ...tenantRow, trial_ended_reason: "minutes" },
      ],
    });
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.trial_will_end"),
      logger,
      deps(DURING),
    );
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("falls back to UTC for an unknown tenant time zone", async () => {
    const { sql, calls } = makeSql({
      "select id, timezone, trial_ended_reason from public.tenants": [
        { ...tenantRow, timezone: "Mars/Olympus" },
      ],
      "insert into public.messages_outbound": [{ id: "msg_1" }],
    });
    await processStripeEvent(
      sql,
      subscriptionEvent("customer.subscription.trial_will_end"),
      logger,
      deps(DURING),
    );
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toContainEqual(
      expect.objectContaining({ ends_on: "Monday, September 28" }),
    );
  });
});

describe("checkout.session.completed for a trial Checkout (TRIAL-1)", () => {
  function trialCheckout(metadata: Record<string, string>, created?: number): StripeEvent {
    return {
      id: "evt_trial_checkout",
      type: "checkout.session.completed",
      ...(created ? { created } : {}),
      data: {
        object: {
          id: "cs_trial",
          customer: CUSTOMER_ID,
          subscription: SUBSCRIPTION_ID,
          metadata: { tenant_id: TENANT_ID, vertical: "auto", ...metadata },
        },
      },
    };
  }

  it("stores the cap and a provisional end, so the trial is known even if subscription.created is late", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(
      sql,
      trialCheckout({ trial_minutes: "100", trial_days: "7" }, T0),
      logger,
      deps(DURING),
    );
    const trial = tenantUpdates(calls).find((u) =>
      u.text.includes("trial_minutes_cap = coalesce(trial_minutes_cap,"),
    );
    // never overwrites an end subscription.created already stored
    expect(trial?.text).toContain("trial_ends_at = coalesce(");
    expect(trial?.values).toEqual([100, T0, 7, TENANT_ID]);
  });

  it("falls back to now and 7 days when the event time or the days are missing", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(sql, trialCheckout({ trial_minutes: "50" }), logger, deps(DURING));
    const trial = tenantUpdates(calls).find((u) =>
      u.text.includes("trial_minutes_cap = coalesce(trial_minutes_cap,"),
    );
    expect(trial?.values).toEqual([50, Math.floor(DURING.getTime() / 1000), 7, TENANT_ID]);
  });

  it("records nothing for a Checkout without a trial", async () => {
    const { sql, calls } = makeSql();
    await processStripeEvent(sql, trialCheckout({}), logger, deps(DURING));
    expect(tenantUpdates(calls).some((u) => u.text.includes("trial_minutes_cap = coalesce("))).toBe(
      false,
    );
  });
});
