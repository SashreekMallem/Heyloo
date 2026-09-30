import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// BEHAVIOR-billing: the SQL itself was exercised against an in-process Postgres
// (PGlite) with a minimal copy of the schema: a 22:00 ET Sep 30 call lands on
// 2026-09-30 (not Oct 1), minutes round to 6 decimals, and the job's selection
// skips test, not-yet-existing and long-canceled tenants. This guards the
// properties that matter so a later CREATE OR REPLACE cannot silently drop them.
const sql = readFileSync(
  new URL("../../migrations/20260930250000_billing_behavior_fixes.sql", import.meta.url),
  "utf8",
);

describe("billing behavior migration", () => {
  it("buckets usage by the tenant's own time zone (BILL-7)", () => {
    expect(sql).toContain("select price_version, timezone into v_price_version, v_tz");
    expect(sql).toContain("(cl.started_at at time zone v_tz)::date = p_date");
    expect(sql).toContain("(ue.occurred_at at time zone v_tz)::date = p_date");
    expect(sql).not.toMatch(/cl\.started_at::date/);
    expect(sql).not.toMatch(/ue\.occurred_at::date/);
  });

  it("leaves the event-sourced text_messages_out counter alone", () => {
    const start = sql.indexOf("create or replace function public.fn_upsert_usage_daily");
    const end = sql.indexOf("create or replace function public.fn_cron_usage_rollup");
    expect(sql.slice(start, end)).not.toContain("text_messages_out");
  });

  it("re-rolls the last three local days every hour so the newest day is fresh (BILL-7)", () => {
    expect(sql).toContain("for d in 0..2 loop");
    expect(sql).toContain("'5 * * * *'");
    expect(sql).toContain("job-internal-usage-rollup");
  });

  it("rounds stored minutes to 6 decimals on write and backfills existing rows (BILL-12)", () => {
    expect(sql).toContain("new.minutes := round(new.minutes, 6)");
    expect(sql).toContain("before insert or update of minutes on public.usage_events");
    expect(sql).toMatch(/update public\.usage_events\s+set minutes = round\(minutes, 6\)/);
  });

  it("adds the columns the billing job and webhook need, additively (BILL-4/10)", () => {
    for (const col of [
      "canceled_at timestamptz",
      "text_overage_cents int not null default 0",
      "meter_reported_at timestamptz",
      "text_overage_item_id text",
      "stripe_report_pending boolean not null default false",
    ]) {
      expect(sql).toContain(col);
    }
    expect(sql).not.toMatch(/\bdrop (table|column)\b/i);
  });

  it("does not flip is_test on the test-* QA tenants (it would silence their owner alerts and billable usage)", () => {
    expect(sql).not.toMatch(/set is_test = true/);
  });

  it("re-stamps the default average ticket when an unpaid tenant's vertical changes (BILL-6)", () => {
    expect(sql).toContain("before update of vertical on public.tenants");
    expect(sql).toContain(
      "old.avg_transaction_value_cents = public.fn_vertical_default_avg_ticket(old.vertical)",
    );
  });

  it("bounds the per-day rollup to the calls that can fall on that day (hourly job)", () => {
    expect(sql).toContain("cl.started_at >= ((p_date - 1)::timestamp at time zone v_tz)");
    expect(sql).toContain("cl.started_at < ((p_date + 2)::timestamp at time zone v_tz)");
  });
});
