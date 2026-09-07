import { describe, expect, it } from "vitest";
import type { SqlClient } from "../_shared/types.js";
import { scheduleOneReminder } from "./handler.js";

const BASE_ROW = {
  booking_id: "b1",
  tenant_id: "t1",
  start_at: "2026-01-16T14:00:00.000Z",
  timezone: "America/New_York",
  consent_sms: true,
  consent_call: false,
  customer_phone: "+15551234567",
  reminder_window_hours: 24,
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
});
