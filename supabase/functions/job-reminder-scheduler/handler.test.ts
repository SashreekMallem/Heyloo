import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.ts";
import { scheduleOneReminder } from "./handler.ts";

const BASE_ROW = {
  booking_id: "b1",
  tenant_id: "t1",
  start_at: "2026-01-16T14:00:00.000Z",
  timezone: "America/New_York",
  consent_sms: true,
  consent_call: false,
  customer_phone: "+15551234567",
  reminder_window_hours: 24,
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
