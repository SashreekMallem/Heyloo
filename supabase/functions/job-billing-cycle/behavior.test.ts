import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  billingJobTask,
  billOneTenant,
  computeInvoiceAmounts,
  findTenantsForBilling,
  meterEventTimestamp,
} from "./handler.ts";

// BEHAVIOR-billing regression tests (BILL-1, 2, 4, 7, 10, 12).

const logger = createLogger();

function recordingSql(insertResult: unknown[] = [{ id: "inv_1" }]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    return Promise.resolve(
      text.includes("insert into public.billing_invoices") ? insertResult : [],
    );
  }) as SqlClient;
  return { sql, calls };
}

function recordingStripe(status = 200, body: unknown = { id: "ii_1" }) {
  const requests: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = [];
  const stripeFetch = ((url: string, init?: RequestInit) => {
    requests.push({
      url,
      body: new URLSearchParams(String(init?.body ?? "")),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as never;
  return { requests, stripeFetch };
}

const deps = (stripeFetch: never) => ({
  stripeFetch,
  stripeSecretKey: "sk_test",
  billingMeterEventName: "voice_minutes",
  logger,
});

const auto = {
  tenant_id: "t1",
  stripe_customer_id: "cus_1",
  vertical: "auto",
  price_version: "v1",
  base_cents: 29900,
  included_minutes: 300,
  overage_cents_per_minute: 35,
  billable_minutes: 250.5,
};

describe("BILL-1/BILL-2/BILL-12: what is reported to the Stripe meter", () => {
  it("reports the OVERAGE minutes, not the total (250.5 total against 300 included reports nothing)", async () => {
    const { sql } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    await billOneTenant(sql, auto, "2026-09-01", "2026-10-01", deps(stripeFetch));
    expect(requests.filter((r) => r.url.endsWith("/billing/meter_events"))).toHaveLength(0);
  });

  it("sends billable minus included as a plain decimal Stripe accepts, stamped inside the period", async () => {
    const { sql } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    // Numeric strings with float drift, like the live September sum.
    await billOneTenant(
      sql,
      { ...auto, billable_minutes: "303.566666666666667" as unknown as number },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    const meter = requests.find((r) => r.url.endsWith("/billing/meter_events"));
    expect(meter?.body.get("payload[value]")).toBe("3.566667");
    expect(meter?.body.get("payload[stripe_customer_id]")).toBe("cus_1");
    expect(meter?.body.get("identifier")).toBe("t1:2026-09-01:2026-10-01");
    // last second of Sep 30 UTC
    expect(meter?.body.get("timestamp")).toBe(
      String(Date.parse("2026-10-01T00:00:00Z") / 1000 - 1),
    );
  });

  it("an exact 300-minute month that float-summed to 300.000000000000005 reports nothing", async () => {
    const { sql } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    await billOneTenant(
      sql,
      { ...auto, billable_minutes: "300.000000000000005" as unknown as number },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    expect(requests).toHaveLength(0);
  });

  it("invoice amounts tolerate numeric strings from Postgres", () => {
    const amounts = computeInvoiceAmounts({
      base_cents: 29900,
      included_minutes: "300" as unknown as number,
      overage_cents_per_minute: "35" as unknown as number,
      billable_minutes: "412.5" as unknown as number,
    });
    expect(amounts.overageMinutes).toBe(112.5);
    expect(amounts.overageCents).toBe(3938);
    expect(amounts.totalCents).toBe(29900 + 3938);
  });
});

describe("BILL-1: a failed meter report is not dropped", () => {
  it("keeps the invoice row pending, raises an alert, and does not mark the report done", async () => {
    const { sql, calls } = recordingSql();
    const { stripeFetch } = recordingStripe(400, {
      error: { message: "at most 12 decimal places" },
    });
    await billOneTenant(
      sql,
      { ...auto, billable_minutes: 412 },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    const insert = calls.find((c) => c.text.includes("insert into public.billing_invoices"));
    expect(insert?.text).toContain("stripe_report_pending");
    expect(insert?.values).toContain(true); // pending = true
    expect(calls.some((c) => c.text.includes("insert into public.alerts"))).toBe(true);
    expect(calls.some((c) => c.text.includes("stripe_report_pending = false"))).toBe(false);
    expect(calls.some((c) => c.text.includes("meter_reported_at = now()"))).toBe(false);
  });

  it("a successful report marks the meter reported and clears the pending flag", async () => {
    const { sql, calls } = recordingSql();
    const { stripeFetch } = recordingStripe();
    await billOneTenant(
      sql,
      { ...auto, billable_minutes: 412 },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    expect(calls.some((c) => c.text.includes("meter_reported_at = now()"))).toBe(true);
    expect(calls.some((c) => c.text.includes("stripe_report_pending = false"))).toBe(true);
  });

  it("a retry re-sends the stored overage against the existing row without inserting a second one", async () => {
    const { sql, calls } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    const ok = await billOneTenant(
      sql,
      {
        ...auto,
        billable_minutes: 999, // changed since; the stored figure wins
        pending_invoice_id: "inv_9",
        pending_meter_reported: false,
        pending_overage_minutes: "112.5",
        pending_text_overage_cents: 0,
      },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    expect(ok).toBe(true);
    expect(calls.some((c) => c.text.includes("insert into public.billing_invoices"))).toBe(false);
    expect(requests[0]?.body.get("payload[value]")).toBe("112.5");
  });

  it("does not report the meter again once it was reported", async () => {
    const { sql } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    await billOneTenant(
      sql,
      {
        ...auto,
        pending_invoice_id: "inv_9",
        pending_meter_reported: true,
        pending_overage_minutes: "112.5",
        pending_text_overage_cents: 0,
      },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    expect(requests).toHaveLength(0);
  });
});

describe("BILL-4: text-reply overage is billed", () => {
  const withText = {
    ...auto,
    billable_minutes: 100,
    text_messages_out: 260,
    included_text_conversations: 200,
    text_overage_cents_per_message: 5,
  };

  it("adds overage replies x rate to the computed total", () => {
    const amounts = computeInvoiceAmounts(withText);
    expect(amounts.textOverageCents).toBe(300);
    expect(amounts.totalCents).toBe(29900 + 300);
  });

  it("no text overage under the allowance", () => {
    expect(computeInvoiceAmounts({ ...withText, text_messages_out: 150 }).textOverageCents).toBe(0);
  });

  it("creates one Stripe invoice item with an idempotency key and records its id on the invoice", async () => {
    const { sql, calls } = recordingSql();
    const { requests, stripeFetch } = recordingStripe(200, { id: "ii_42" });
    await billOneTenant(sql, withText, "2026-09-01", "2026-10-01", deps(stripeFetch));
    const item = requests.find((r) => r.url.endsWith("/invoiceitems"));
    expect(item?.body.get("customer")).toBe("cus_1");
    expect(item?.body.get("amount")).toBe("300");
    expect(item?.body.get("currency")).toBe("usd");
    expect(item?.body.get("metadata[kind]")).toBe("text_overage");
    expect(item?.headers["Idempotency-Key"]).toBe("text-overage:t1:2026-09-01:2026-10-01");
    expect(requests.some((r) => r.url.endsWith("/billing/meter_events"))).toBe(false); // 100 < 300
    const insert = calls.find((c) => c.text.includes("insert into public.billing_invoices"));
    expect(insert?.values).toContain(300); // text_overage_cents stored
    expect(insert?.values).toContain(30200); // total includes it
    expect(calls.some((c) => c.text.includes("text_overage_item_id"))).toBe(true);
  });

  it("does not create a second invoice item on retry once one exists", async () => {
    const { sql } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    await billOneTenant(
      sql,
      {
        ...withText,
        pending_invoice_id: "inv_9",
        pending_meter_reported: true,
        pending_text_reported: true,
        pending_overage_minutes: "0",
        pending_text_overage_cents: 300,
      },
      "2026-09-01",
      "2026-10-01",
      deps(stripeFetch),
    );
    expect(requests).toHaveLength(0);
  });
});

describe("BILL-7 / BILL-10: which usage and which tenants the job selects", () => {
  async function selectionText(): Promise<string> {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      calls.push(strings.join(" "));
      return Promise.resolve([]);
    }) as SqlClient;
    await findTenantsForBilling(sql, "2026-09-01", "2026-10-01");
    return calls[0] ?? "";
  }

  it("sums billable usage_events over the tenant-local period, not usage_daily UTC dates", async () => {
    const text = await selectionText();
    expect(text).toContain("public.usage_events ue");
    expect(text).toContain("ue.is_billable");
    expect(text).toContain("at time zone t.timezone");
    expect(text).not.toContain("sum(ud.billable_minutes)");
  });

  it("skips test tenants and tenants created after the period, and includes a tenant canceled during it", async () => {
    const text = await selectionText();
    expect(text).toContain("coalesce(t.is_test, false) = false");
    expect(text).toContain("t.created_at <");
    // test-* QA tenants are not is_test: a tenant with no Stripe customer is never billed.
    expect(text).toContain("t.stripe_customer_id is not null");
    expect(text).toContain("t.status = 'canceled' and t.canceled_at >=");
  });
});

describe("TRIAL-1: free-trial usage is never billed", () => {
  async function selectionText(): Promise<string> {
    const calls: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      calls.push(strings.join(" "));
      return Promise.resolve([]);
    }) as SqlClient;
    await findTenantsForBilling(sql, "2026-10-01", "2026-11-01");
    return calls[0] ?? "";
  }

  it("leaves voice minutes before the trial's end out of the billable sum", async () => {
    const text = await selectionText();
    expect(text).toContain("and (t.trial_ends_at is null or ue.occurred_at >= t.trial_ends_at)");
  });

  it("counts text replies only from the day after the trial ended", async () => {
    const text = await selectionText();
    expect(text).toContain(
      "(t.trial_ends_at is null or ud.date > (t.trial_ends_at at time zone t.timezone)::date)",
    );
  });

  it("skips a tenant canceled during its trial, and one whose trial ran past the period end", async () => {
    const text = await selectionText();
    expect(text).toContain("t.trial_ended_reason is distinct from 'canceled'");
    expect(text).toContain("t.trial_ends_at < (");
  });
});

describe("TRIAL-1: the overage meter event is never stamped inside the trial", () => {
  const octEnd = Date.parse("2026-11-01T00:00:00Z") / 1000 - 1;

  it("keeps the period's last second without a trial, or when the trial ended earlier", () => {
    expect(meterEventTimestamp("2026-11-01", null)).toBe(octEnd);
    expect(meterEventTimestamp("2026-11-01", Date.parse("2026-10-05T14:00:00Z") / 1000)).toBe(
      octEnd,
    );
  });

  it("stamps one second after a trial that ended after the UTC period end (late on the local last day)", () => {
    // Oct 31, 8 pm in Los Angeles = Nov 1, 03:00 UTC (inside the local October)
    const trialEnded = Date.parse("2026-11-01T03:00:00Z") / 1000;
    expect(meterEventTimestamp("2026-11-01", String(trialEnded))).toBe(trialEnded + 1);
  });

  it("selects the trial end and sends that stamp to Stripe", async () => {
    const calls: string[] = [];
    const selectSql = ((strings: TemplateStringsArray) => {
      calls.push(strings.join(" "));
      return Promise.resolve([]);
    }) as SqlClient;
    await findTenantsForBilling(selectSql, "2026-10-01", "2026-11-01");
    expect(calls[0]).toContain("extract(epoch from t.trial_ends_at))::bigint as trial_ended_unix");

    const trialEnded = Date.parse("2026-11-01T03:00:00Z") / 1000;
    const { sql } = recordingSql();
    const { requests, stripeFetch } = recordingStripe();
    await billOneTenant(
      sql,
      { ...auto, billable_minutes: 350, trial_ended_unix: String(trialEnded) },
      "2026-10-01",
      "2026-11-01",
      deps(stripeFetch),
    );
    const meter = requests.find((r) => r.url.endsWith("/billing/meter_events"));
    expect(meter?.body.get("timestamp")).toBe(String(trialEnded + 1));
  });
});

describe("TRIAL-1: job task routing", () => {
  it.each([
    ["https://x.supabase.co/functions/v1/job-billing-cycle", "billing_cycle"],
    ["https://x.supabase.co/functions/v1/job-billing-cycle?task=trial_caps", "trial_caps"],
    ["https://x.supabase.co/functions/v1/job-billing-cycle?task=other", "billing_cycle"],
    ["not a url", "billing_cycle"],
  ])("%s -> %s", (url, task) => {
    expect(billingJobTask(url)).toBe(task);
  });
});
