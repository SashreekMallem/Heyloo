import { describe, expect, it } from "vitest";
import { createLogger } from "../../_shared/logger.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { createOrder } from "./create_order.ts";

const logger = createLogger();
const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
};

type Step = { rows?: unknown[]; throws?: unknown };

function makeStepSql(steps: Step[]): SqlClient {
  let i = 0;
  return (() => {
    const step = steps[i];
    i += 1;
    if (!step) return Promise.resolve([]);
    if (step.throws) return Promise.reject(step.throws);
    return Promise.resolve(step.rows ?? []);
  }) as SqlClient;
}

const pickupArgs = {
  items: [{ offering_id: "off_1", name: "Burger", qty: 2 }],
  fulfillment_type: "pickup" as const,
  customer: { name: "Jordan Lee", phone: "555-123-4567" },
};

describe("createOrder", () => {
  it("rejects an unparseable phone number", async () => {
    const sql = makeStepSql([]);
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, customer: { phone: "bad" } },
      logger,
    );
    expect(result).toEqual({ confirmed: false, reason: "invalid_phone" });
  });

  it("returns the existing order on an idempotent replay", async () => {
    const sql = makeStepSql([{ rows: [{ id: "order_1", total_cents: 2400 }] }]);
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ order_id: "order_1", confirmed: true, total_cents: 2400 });
  });

  it("declines an item that doesn't resolve to a real offering (never trusts model-invented pricing)", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [] }, // offerings lookup — nothing matches offering_id
    ]);
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ confirmed: false, reason: "item_not_found", item_name: "Burger" });
  });

  it("creates a pickup order end-to-end with computed subtotal/tax/total", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: { tax_rate_bps: 800 } }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
      { rows: [{ id: "msg_1" }] }, // confirmation message insert
      { rows: [] }, // enqueue messages_outbound
      { rows: [] }, // enqueue adapter_push
    ]);
    // subtotal = 1000 * 2 = 2000; tax = 2000 * 800/10000 = 160; total = 2160
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ order_id: "order_1", confirmed: true, total_cents: 2160 });
  });

  it("declines a delivery order below the tenant's minimum, offering pickup", async () => {
    const sql = makeStepSql([
      { rows: [] },
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] },
      { rows: [{ dynamic_variable_overrides: { min_order_cents: 5000 } }] },
    ]);
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: { street: "1 Main St" } },
      logger,
    );
    expect(result).toEqual({
      confirmed: false,
      reason: "below_minimum_order",
      pickup_offered: true,
    });
  });

  it("declines an out-of-radius delivery order when the caller has a saved address geocode", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      {
        rows: [
          {
            dynamic_variable_overrides: {
              tenant_geocode: { lat: 40.7128, lng: -74.006 },
              delivery_radius_m: 5000,
            },
          },
        ],
      }, // agent_configs overrides
      { rows: [{ geocode: { x: -75.1652, y: 39.9526 } }] }, // customer_addresses lookup — far away (Philadelphia)
    ]);
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: { street: "far away" } },
      logger,
    );
    expect(result).toEqual({
      confirmed: false,
      reason: "out_of_delivery_radius",
      pickup_offered: true,
    });
  });

  it("proceeds (with a logged warning) when a radius policy exists but the caller has no saved address geocode yet", async () => {
    const warnings: unknown[] = [];
    const spyLogger = {
      ...logger,
      warn: (msg: string, fields?: unknown) => warnings.push({ msg, fields }),
    };
    const sql = makeStepSql([
      { rows: [] },
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] },
      {
        rows: [
          {
            dynamic_variable_overrides: {
              tenant_geocode: { lat: 40.7128, lng: -74.006 },
              delivery_radius_m: 5000,
            },
          },
        ],
      },
      { rows: [] }, // customer_addresses lookup — no saved address
      { rows: [{ id: "customer_1" }] },
      { rows: [{ id: "order_1" }] },
      { rows: [{ id: "msg_1" }] },
      { rows: [] },
      { rows: [] },
    ]);
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: { street: "1 Main St" } },
      spyLogger,
    );
    expect(warnings).toHaveLength(1);
    expect(result).toMatchObject({ confirmed: true });
  });

  it("returns confirmed:false/slot equivalent on a unique_violation race on the idempotency key, never throwing", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { throws: { code: "23505", message: "duplicate key" } }, // order insert races
      { rows: [{ id: "order_won", total_cents: 2000 }] }, // race-winner re-check
    ]);
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ order_id: "order_won", confirmed: true, total_cents: 2000 });
  });
});
