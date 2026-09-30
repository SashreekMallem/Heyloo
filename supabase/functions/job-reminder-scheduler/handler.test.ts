import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import { findReminderCandidates, scheduleOneReminder } from "./handler.ts";

const BASE_ROW = {
  booking_id: "b1",
  tenant_id: "t1",
  start_at: "2026-01-16T14:00:00.000Z",
  timezone: "America/New_York",
  consent_sms: true,
  consent_call: false,
  customer_phone: "+15551234567",
  quiet_hours: {},
};

function makeSql(rows: unknown[] = [{ id: "msg_1" }]): { sql: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push([strings.join(" "), ...values]);
    return Promise.resolve(rows);
  }) as SqlClient;
  return { sql, calls };
}

describe("scheduleOneReminder", () => {
  it("skips when neither sms nor call consent was captured", async () => {
    const { sql } = makeSql();
    const outcome = await scheduleOneReminder(
      sql,
      { ...BASE_ROW, consent_sms: false, consent_call: false },
      new Date(),
    );
    expect(outcome).toBe("no_consent");
  });

  it("skips when there is no customer phone on file", async () => {
    const { sql } = makeSql();
    const outcome = await scheduleOneReminder(
      sql,
      { ...BASE_ROW, customer_phone: null },
      new Date(),
    );
    expect(outcome).toBe("no_phone");
  });

  it("defers during tenant-local quiet hours (9pm-9am) rather than sending", async () => {
    const { sql, calls } = makeSql();
    // 2026-01-16T02:00:00Z = 21:00 EST local (quiet hours start).
    const outcome = await scheduleOneReminder(sql, BASE_ROW, new Date("2026-01-16T02:00:00.000Z"));
    expect(outcome).toBe("deferred_quiet_hours");
    expect(calls).toHaveLength(0);
  });

  it("enqueues an SMS reminder outside quiet hours when consent is present", async () => {
    const { sql, calls } = makeSql();
    // 2026-01-16T14:00:00Z = 09:00 EST local (just outside quiet hours).
    const outcome = await scheduleOneReminder(sql, BASE_ROW, new Date("2026-01-16T14:00:00.000Z"));
    expect(outcome).toBe("sent");
    expect(
      calls.some((c) => (c[0] as string).includes("insert into public.messages_outbound")),
    ).toBe(true);
    expect(calls.some((c) => (c[0] as string).includes("pgmq.send"))).toBe(true);
  });

  // CHANNELS-2 item 8: a booking reminder is a proactive/unsolicited send,
  // so — unlike a text-agent reply to a customer-initiated conversation —
  // it must respect the tenant's own `quiet_hours` configuration, not just
  // the hardcoded 9pm-9am default.
  describe("tenants.quiet_hours (BACKEND_SPEC.md §13.2)", () => {
    it("respects a tenant's custom, narrower quiet window instead of the 9pm-9am default", async () => {
      const { sql, calls } = makeSql();
      const row = { ...BASE_ROW, quiet_hours: { start: "13:00", end: "14:00", enabled: true } };
      // 2026-01-16T18:30:00Z = 13:30 EST local — inside the tenant's custom
      // 1-2pm quiet window, but well outside the platform default.
      const outcome = await scheduleOneReminder(sql, row, new Date("2026-01-16T18:30:00.000Z"));
      expect(outcome).toBe("deferred_quiet_hours");
      expect(calls).toHaveLength(0);
    });

    it("sends during the platform-default quiet window when the tenant has opted out (enabled: false)", async () => {
      const { sql, calls } = makeSql();
      const row = { ...BASE_ROW, quiet_hours: { enabled: false } };
      // 2026-01-16T02:00:00Z = 21:00 EST local — inside the DEFAULT quiet
      // window, but this tenant has explicitly disabled quiet-hours gating.
      const outcome = await scheduleOneReminder(sql, row, new Date("2026-01-16T02:00:00.000Z"));
      expect(outcome).toBe("sent");
      expect(
        calls.some((c) => (c[0] as string).includes("insert into public.messages_outbound")),
      ).toBe(true);
    });

    it("falls back to the platform default (9pm-9am, enabled) for an unconfigured tenant ({})", async () => {
      const { sql, calls } = makeSql();
      const outcome = await scheduleOneReminder(
        sql,
        { ...BASE_ROW, quiet_hours: {} },
        new Date("2026-01-16T02:00:00.000Z"),
      );
      expect(outcome).toBe("deferred_quiet_hours");
      expect(calls).toHaveLength(0);
    });
  });
});

describe("reminder coverage across the day (QA-1 BE-12)", () => {
  /** Runs the real query + scheduler for every hourly tick before an
   * appointment, with a fake database that applies the query's bound window. */
  async function simulate(startAtIso: string): Promise<{ sentAt: string | null }> {
    const start = new Date(startAtIso);
    let sentAt: string | null = null;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.messages_outbound")) {
        return Promise.resolve([{ id: "msg_1" }]);
      }
      if (text.includes("pgmq.send")) return Promise.resolve([]);
      // findReminderCandidates: values[0]/[1] are the bound window.
      const from = new Date(String(values[0])).getTime();
      const to = new Date(String(values[1])).getTime();
      const inWindow = start.getTime() > from && start.getTime() <= to;
      const alreadySent = sentAt !== null;
      return Promise.resolve(
        inWindow && !alreadySent ? [{ ...BASE_ROW, start_at: startAtIso }] : [],
      );
    }) as SqlClient;

    // Hourly ticks from 30 h before the start until the start itself.
    for (let h = 30; h >= 0; h -= 1) {
      const now = new Date(start.getTime() - h * 3_600_000);
      const candidates = await findReminderCandidates(sql, now);
      for (const row of candidates) {
        const outcome = await scheduleOneReminder(sql, row, now);
        if (outcome === "sent") sentAt = now.toISOString();
      }
    }
    return { sentAt };
  }

  // 2026-10-06 is EDT (UTC-4): local 05:00 = 09:00Z.
  const localToUtc = (hh: number, mm = 0) =>
    new Date(Date.UTC(2026, 9, 6, hh + 4, mm)).toISOString();

  it.each([
    [5, 0],
    [6, 0],
    [7, 0],
    [7, 30],
    [8, 0],
    [12, 0],
    [20, 0],
    [21, 0],
    [21, 30],
    [22, 0],
    [23, 0],
  ])("sends exactly one reminder for a %i:%i local appointment, outside quiet hours", async (hh, mm) => {
    const { sentAt } = await simulate(localToUtc(hh, mm));
    expect(sentAt).not.toBeNull();
    const sent = new Date(sentAt as string);
    // Never in tenant-local quiet hours (21:00-09:00) and never after the start.
    const localHour = Number(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        hour12: false,
      }).format(sent),
    );
    expect(localHour).toBeGreaterThanOrEqual(9);
    expect(localHour).toBeLessThan(21);
    expect(sent.getTime()).toBeLessThan(new Date(localToUtc(hh, mm)).getTime());
  });

  it("only selects bookings made at least 23 hours ahead, so a same-day booking is not newly reminded", async () => {
    const { sql, calls } = makeSql([]);
    await findReminderCandidates(sql, new Date("2026-10-05T14:00:00.000Z"));
    expect(String(calls[0]?.[0])).toContain("b.created_at <= b.start_at - interval '23 hours'");
  });

  it("binds a window from 1 h to 25 h ahead", async () => {
    const { sql, calls } = makeSql([]);
    const now = new Date("2026-10-05T14:00:00.000Z");
    await findReminderCandidates(sql, now);
    expect(calls[0]?.[1]).toBe("2026-10-05T15:00:00.000Z");
    expect(calls[0]?.[2]).toBe("2026-10-06T15:00:00.000Z");
  });
});

describe("findReminderCandidates (SEC-2 review)", () => {
  it("never casts tenant-writable JSON, which would abort the query for every tenant", async () => {
    const { sql, calls } = makeSql([]);
    await findReminderCandidates(sql, new Date("2026-01-15T14:00:00.000Z"));
    const text = String(calls[0]?.[0]);
    // dynamic_variable_overrides / consent are owner- or member-writable jsonb:
    // a `::int` / `::boolean` on them raises 22P02 on the first bad value.
    expect(text).not.toMatch(/dynamic_variable_overrides/);
    expect(text).not.toMatch(/consent[^,\n]*::/);
  });
});
