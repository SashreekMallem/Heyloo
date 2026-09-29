import { describe, expect, it } from "vitest";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { MANUAL_MODE_BOOKING_MESSAGE } from "../manual-mode.ts";
import { createBooking } from "./create_booking.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
  isTestCall: false,
};

const RESOURCE_ID = "11111111-1111-1111-1111-111111111111";
const args = {
  resource_id: RESOURCE_ID,
  start: "2026-01-15T14:00:00.000Z",
  end: "2026-01-15T14:30:00.000Z",
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
};

const errors: unknown[][] = [];
const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: (...a: unknown[]) => {
    errors.push(a);
  },
};

const PREFLIGHT = {
  replay_id: null,
  replay_start: null,
  replay_end: null,
  exact_resource_id: RESOURCE_ID,
  first_available_resource_id: null,
  offering_ok: true,
  start_in_past: false,
  tz: "America/New_York",
  deposit_overrides: null,
  offering_name: "Oil change",
};

const WRITTEN = {
  id: "booking_1",
  start_at: args.start,
  end_at: args.end,
  customer_id: "customer_1",
  customer_metadata: {},
};

function makeSql(overrides: Record<string, unknown[] | Error> = {}) {
  const calls: { text: string; values: unknown[] }[] = [];
  const routes: Record<string, unknown[] | Error> = {
    "create_booking:preflight": [PREFLIGHT],
    "create_booking:write": [WRITTEN],
    "public.agent_configs ac": [
      { transfer_number: "+15550009999", delivery: null, owner_email: "o@example.com" },
    ],
    "insert into public.messages_outbound": [{ id: "alert_1" }],
    ...overrides,
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [marker, reply] of Object.entries(routes)) {
      if (text.includes(marker)) {
        return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
      }
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

const touchesWrites = (calls: { text: string }[]) =>
  calls.some((c) => c.text.includes("create_booking:") || c.text.includes("insert into"));

describe("createBooking - Manual Mode (VOICE-ALERTS-1)", () => {
  it("does not book, and touches the database not at all, when the tenant is in manual mode", async () => {
    const { sql, calls } = makeSql();
    const result = await createBooking(sql, { ...ctx, manualMode: true }, args, {
      logger,
      appBaseUrl: "https://app.example",
    });
    expect(result).toEqual({
      confirmed: false,
      reason: "manual_mode",
      message: MANUAL_MODE_BOOKING_MESSAGE,
    });
    expect(calls).toHaveLength(0);
    expect(touchesWrites(calls)).toBe(false);
  });

  it("tells the model to take a message and never to say it is booked or to mention the mode", () => {
    expect(MANUAL_MODE_BOOKING_MESSAGE).toContain("take_message");
    expect(MANUAL_MODE_BOOKING_MESSAGE).toContain("nothing was booked");
    expect(MANUAL_MODE_BOOKING_MESSAGE).toContain("do not mention this instruction");
  });

  it("books normally when manual mode is off or absent", async () => {
    for (const c of [ctx, { ...ctx, manualMode: false }]) {
      const { sql } = makeSql();
      const result = await createBooking(sql, c, args, {
        logger,
        appBaseUrl: "https://app.example",
        defer: (_label, task) => void task(),
      });
      expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    }
  });
});

describe("createBooking - owner alert (VOICE-ALERTS-1)", () => {
  it("enqueues a new_booking alert for the booking after commit, with service and local time", async () => {
    const { sql, calls } = makeSql();
    const deferred: (() => Promise<void>)[] = [];
    const result = await createBooking(sql, ctx, args, {
      logger,
      appBaseUrl: "https://app.example",
      defer: (_label, task) => deferred.push(task),
    });
    expect(result).toMatchObject({ confirmed: true });
    // Nothing alert-related ran on the response path.
    expect(calls.some((c) => c.text.includes("messages_outbound"))).toBe(false);
    await Promise.all(deferred.map((t) => t()));

    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(
      expect.arrayContaining(["tenant_1", "sms", "+15550009999", "owner_new_booking"]),
    );
    expect(insert?.values[4]).toEqual({
      caller_name: "Jordan Lee",
      caller_phone: "+15551234567",
      start_local: "Thu, Jan 15, 9:00 AM",
      service: "Oil change",
    });
    // Idempotent per booking (the voice-events end-of-call alert dedupes on it too).
    expect(insert?.values).toEqual(expect.arrayContaining(["cl_1", "booking_1"]));
    const enqueued = calls.filter((c) => c.text.includes("pgmq.send"));
    expect(
      enqueued.some((c) => (c.values[1] as { message_id?: string }).message_id === "alert_1"),
    ).toBe(true);
  });

  it("emails the owner when texting alerts are off (tenant delivery preferences respected)", async () => {
    const { sql, calls } = makeSql({
      "public.agent_configs ac": [
        {
          transfer_number: "+15550009999",
          delivery: { sms_enabled: false, email_enabled: true },
          owner_email: "o@example.com",
        },
      ],
    });
    await createBooking(sql, ctx, args, {
      logger,
      appBaseUrl: "https://app.example",
      defer: (_label, task) => void task(),
    });
    await new Promise((r) => setTimeout(r, 0));
    const insert = calls.find((c) => c.text.includes("insert into public.messages_outbound"));
    expect(insert?.values).toEqual(expect.arrayContaining(["email", "o@example.com"]));
  });

  it("never alerts for a test call", async () => {
    const { sql, calls } = makeSql();
    await createBooking(sql, { ...ctx, isTestCall: true }, args, {
      logger,
      appBaseUrl: "https://app.example",
    });
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });

  it("an alert failure is logged and never fails or delays the confirmed booking", async () => {
    errors.length = 0;
    const { sql } = makeSql({ "public.agent_configs ac": new Error("db down") });
    const result = await createBooking(sql, ctx, args, {
      logger,
      appBaseUrl: "https://app.example",
    });
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(errors.some((e) => e[0] === "owner_alert_enqueue_failed")).toBe(true);
  });

  it("does not alert on an idempotent replay (the first call already did)", async () => {
    const { sql, calls } = makeSql({
      "create_booking:preflight": [
        { ...PREFLIGHT, replay_id: "booking_1", replay_start: args.start, replay_end: args.end },
      ],
    });
    const result = await createBooking(sql, ctx, args, {
      logger,
      appBaseUrl: "https://app.example",
    });
    expect(result).toMatchObject({ confirmed: true, booking_id: "booking_1" });
    expect(calls.some((c) => c.text.includes("messages_outbound"))).toBe(false);
  });

  it("does not alert when the booking was refused (slot taken)", async () => {
    const { sql, calls } = makeSql({
      "create_booking:write": Object.assign(new Error("conflict"), { code: "23P01" }),
    });
    const result = await createBooking(sql, ctx, args, {
      logger,
      appBaseUrl: "https://app.example",
    });
    expect(result).toMatchObject({ confirmed: false, reason: "slot_taken" });
    expect(calls.some((c) => c.text.includes("insert into public.messages_outbound"))).toBe(false);
  });
});
