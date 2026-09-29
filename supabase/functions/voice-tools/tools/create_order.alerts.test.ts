import { describe, expect, it } from "vitest";
import type { Logger, SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { MANUAL_MODE_ORDER_MESSAGE } from "../manual-mode.ts";
import { createOrder } from "./create_order.ts";

const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "restaurant",
  isTestCall: false,
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

const args = {
  items: [{ offering_id: "off_1", name: "Burger", qty: 2 }],
  fulfillment_type: "pickup" as const,
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
};

function makeSql(overrides: Record<string, unknown[] | Error> = {}) {
  const calls: { text: string; values: unknown[] }[] = [];
  const routes: Record<string, unknown[] | Error> = {
    "from public.offerings": [{ id: "off_1", name: "Burger", price_cents: 1200 }],
    "select dynamic_variable_overrides from public.agent_configs": [
      { dynamic_variable_overrides: {} },
    ],
    "insert into public.customers": [{ id: "customer_1" }],
    "insert into public.orders": [{ id: "order_1" }],
    "public.agent_configs ac": [
      { transfer_number: null, delivery: { sms_enabled: false }, owner_email: "o@example.com" },
    ],
    "insert into public.messages_outbound": [{ id: "msg_1" }],
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

const ownerAlertInserts = (calls: { text: string; values: unknown[] }[]) =>
  calls.filter(
    (c) =>
      c.text.includes("insert into public.messages_outbound") &&
      c.values.includes("owner_new_order"),
  );

describe("createOrder - Manual Mode (VOICE-ALERTS-1)", () => {
  it("does not create an order, and issues no statement at all, when the tenant is in manual mode", async () => {
    const { sql, calls } = makeSql();
    const result = await createOrder(sql, { ...ctx, manualMode: true }, args, logger);
    expect(result).toEqual({
      confirmed: false,
      reason: "manual_mode",
      message: MANUAL_MODE_ORDER_MESSAGE,
    });
    expect(calls).toHaveLength(0);
    expect(MANUAL_MODE_ORDER_MESSAGE).toContain("take_message");
  });
});

describe("createOrder - owner alert (VOICE-ALERTS-1)", () => {
  it("enqueues an owner_new_order alert (per order, by email for a tenant with texting off) after the order commits", async () => {
    const { sql, calls } = makeSql();
    const result = await createOrder(sql, ctx, args, logger);
    expect(result).toMatchObject({ confirmed: true, order_id: "order_1", total_cents: 2400 });
    const alerts = ownerAlertInserts(calls);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.values).toEqual(
      expect.arrayContaining(["tenant_1", "email", "o@example.com", "cl_1", "order_1"]),
    );
    expect(alerts[0]?.values[4]).toEqual({
      caller_name: "Jordan Lee",
      caller_phone: "+15551234567",
      fulfillment_type: "pickup",
      items_summary: "2x Burger",
      total_cents: 2400,
    });
    // The alert's queue message follows its own insert.
    expect(calls.filter((c) => c.text.includes("pgmq.send")).length).toBeGreaterThanOrEqual(2);
  });

  it("runs the alert after the response when the hot path gives it a defer hook", async () => {
    const { sql, calls } = makeSql();
    const deferred: { label: string; task: () => Promise<void> }[] = [];
    await createOrder(sql, ctx, args, logger, {
      defer: (label, task) => deferred.push({ label, task }),
    });
    expect(ownerAlertInserts(calls)).toHaveLength(0);
    expect(deferred.map((d) => d.label)).toEqual(["create_order_owner_alert"]);
    await deferred[0]?.task();
    expect(ownerAlertInserts(calls)).toHaveLength(1);
  });

  it("never alerts for a test call, and an alert failure never fails the order", async () => {
    const test = makeSql();
    await createOrder(test.sql, { ...ctx, isTestCall: true }, args, logger);
    expect(ownerAlertInserts(test.calls)).toHaveLength(0);

    errors.length = 0;
    const broken = makeSql({ "public.agent_configs ac": new Error("db down") });
    const result = await createOrder(broken.sql, ctx, args, logger);
    expect(result).toMatchObject({ confirmed: true, order_id: "order_1" });
    expect(errors.some((e) => e[0] === "owner_alert_enqueue_failed")).toBe(true);
  });

  it("does not alert on an idempotent replay", async () => {
    const { sql, calls } = makeSql({
      "select id, total_cents, delivery_fee_cents from public.orders": [
        { id: "order_1", total_cents: 2400 },
      ],
    });
    const result = await createOrder(sql, ctx, args, logger);
    expect(result).toMatchObject({ confirmed: true, order_id: "order_1" });
    expect(ownerAlertInserts(calls)).toHaveLength(0);
  });
});
