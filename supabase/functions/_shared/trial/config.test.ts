import { describe, expect, it } from "vitest";
import type { SqlClient } from "../types.ts";
import {
  FREE_TRIAL_DEFAULTS,
  hasHadFreeTrial,
  loadFreeTrialSettings,
  parseFreeTrialSettings,
  trialCancelScheduled,
} from "./config.ts";

function sqlReturning(rows: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    return Promise.resolve(rows);
  }) as SqlClient;
  return { sql, calls };
}

describe("parseFreeTrialSettings", () => {
  it("defaults to 7 days / 100 minutes, enabled", () => {
    expect(FREE_TRIAL_DEFAULTS).toEqual({ enabled: true, days: 7, minutes: 100 });
    expect(parseFreeTrialSettings(undefined)).toEqual({ enabled: true, days: 7, minutes: 100 });
    expect(parseFreeTrialSettings(null)).toEqual({ enabled: true, days: 7, minutes: 100 });
  });

  it("takes valid values from the setting", () => {
    expect(parseFreeTrialSettings({ enabled: false, days: 14, minutes: 250 })).toEqual({
      enabled: false,
      days: 14,
      minutes: 250,
    });
  });

  it("fills missing fields from the defaults", () => {
    expect(parseFreeTrialSettings({ days: 10 })).toEqual({ enabled: true, days: 10, minutes: 100 });
  });

  it.each([
    { days: 0 },
    { days: 731 },
    { days: 2.5 },
    { minutes: 0 },
    { minutes: "100" },
    { enabled: "yes" },
  ])("never trusts an out-of-range or mistyped setting %o (all defaults)", (value) => {
    expect(parseFreeTrialSettings(value)).toEqual({ enabled: true, days: 7, minutes: 100 });
  });
});

describe("loadFreeTrialSettings", () => {
  it("reads platform_settings.free_trial", async () => {
    const { sql, calls } = sqlReturning([{ value: { days: 5 } }]);
    expect(await loadFreeTrialSettings(sql)).toEqual({ enabled: true, days: 5, minutes: 100 });
    expect(calls[0]?.text).toContain("from public.platform_settings where key =");
    expect(calls[0]?.values).toEqual(["free_trial"]);
  });

  it("uses the defaults when the row is absent", async () => {
    const { sql } = sqlReturning([]);
    expect(await loadFreeTrialSettings(sql)).toEqual(FREE_TRIAL_DEFAULTS);
  });
});

describe("hasHadFreeTrial (one free trial per business)", () => {
  it("is true when the database finds a prior trial", async () => {
    const { sql } = sqlReturning([{ had_trial: true }]);
    expect(await hasHadFreeTrial(sql, { userId: "u1", email: "a@b.co" })).toBe(true);
  });

  it("is false otherwise", async () => {
    expect(
      await hasHadFreeTrial(sqlReturning([{ had_trial: false }]).sql, {
        userId: "u1",
        email: "a@b.co",
      }),
    ).toBe(false);
    expect(await hasHadFreeTrial(sqlReturning([]).sql, { userId: "u1", email: "a@b.co" })).toBe(
      false,
    );
  });

  it("matches by owner, case-insensitive email, and business phone", async () => {
    const { sql, calls } = sqlReturning([{ had_trial: false }]);
    await hasHadFreeTrial(sql, {
      userId: "u1",
      email: "Owner@Shop.com",
      businessPhone: "+15551234567",
    });
    const { text, values } = calls[0] as { text: string; values: unknown[] };
    expect(text).toContain("prior.trial_ends_at is not null");
    expect(text).toContain("m.role = 'owner'");
    expect(text).toContain("m.user_id =");
    expect(text).toContain("lower(u.email) = lower(");
    expect(text).toContain("prior.business_phone =");
    expect(values).toEqual(["u1", "Owner@Shop.com", "+15551234567", "+15551234567"]);
  });

  it("skips the phone match when no business phone was given", async () => {
    const { sql, calls } = sqlReturning([{ had_trial: false }]);
    await hasHadFreeTrial(sql, { userId: "u1", email: "a@b.co" });
    expect(calls[0]?.values).toEqual(["u1", "a@b.co", null, null]);
    expect(calls[0]?.text).toContain("::text is not null and exists");
  });
});

describe("trialCancelScheduled", () => {
  const trialEnd = 1_790_604_800;
  it("is true for cancel at period end (during a trial: the trial end)", () => {
    expect(trialCancelScheduled({ trialEnd, cancelAtPeriodEnd: true, cancelAt: null })).toBe(true);
  });

  it("is true for a cancel date at or before the trial end (60 s allowance)", () => {
    expect(trialCancelScheduled({ trialEnd, cancelAtPeriodEnd: false, cancelAt: trialEnd })).toBe(
      true,
    );
    expect(
      trialCancelScheduled({ trialEnd, cancelAtPeriodEnd: false, cancelAt: trialEnd + 60 }),
    ).toBe(true);
    expect(
      trialCancelScheduled({ trialEnd, cancelAtPeriodEnd: false, cancelAt: trialEnd - 86_400 }),
    ).toBe(true);
  });

  it("is false with no cancellation, or one after the trial (the owner means to pay until then)", () => {
    expect(trialCancelScheduled({ trialEnd, cancelAtPeriodEnd: false, cancelAt: null })).toBe(
      false,
    );
    expect(
      trialCancelScheduled({
        trialEnd,
        cancelAtPeriodEnd: false,
        cancelAt: trialEnd + 30 * 86_400,
      }),
    ).toBe(false);
  });
});
