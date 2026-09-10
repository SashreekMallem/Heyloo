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
  vertical: "generic",
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

  it("EDGE_AUDIT/E2E B4: addresses the adapter_push_queue entry to the tenant's real connected provider, never the old broken 'pos' literal", async () => {
    const enqueueCalls: unknown[] = [];
    const steps: Step[] = [
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
      { rows: [{ id: "msg_1" }] }, // confirmation message insert
      // messages_outbound's own enqueue() call is a `pgmq.send` and is
      // intercepted below, never consuming a step here — the next
      // non-pgmq.send call is the adapter-push producer's connections list.
      { rows: [{ provider: "square" }] }, // adapter-push producer: connected Square
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("pgmq.send")) {
        enqueueCalls.push(values);
        return Promise.resolve([]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toMatchObject({ confirmed: true, order_id: "order_1" });
    // one messages_outbound enqueue + one adapter push
    expect(enqueueCalls).toHaveLength(2);
    const adapterPushCall = enqueueCalls[1] as [string, string];
    const pushMessage = JSON.parse(adapterPushCall[1]) as { adapter: string; entity_type: string };
    expect(pushMessage.adapter).toBe("square");
    expect(pushMessage.entity_type).toBe("order");
  });

  it("computes and returns delivery_fee_cents for a delivery order (GAP_REGISTER.md §4 Cluster D)", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: { delivery_fee_cents: 399 } }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
      { rows: [{ id: "msg_1" }] }, // confirmation message insert
      { rows: [] }, // enqueue messages_outbound
      { rows: [] }, // enqueue adapter_push
    ]);
    // subtotal = 2000; tax = 0; delivery fee = 399; total = 2399
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: { street: "1 Main St" } },
      logger,
    );
    expect(result).toEqual({
      order_id: "order_1",
      confirmed: true,
      total_cents: 2399,
      delivery_fee_cents: 399,
    });
  });

  it("never applies a delivery_fee_cents to a pickup/dine_in order", async () => {
    const sql = makeStepSql([
      { rows: [] },
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] },
      { rows: [{ dynamic_variable_overrides: { delivery_fee_cents: 399 } }] },
      { rows: [{ id: "customer_1" }] },
      { rows: [{ id: "order_1" }] },
      { rows: [{ id: "msg_1" }] },
      { rows: [] },
      { rows: [] },
    ]);
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ order_id: "order_1", confirmed: true, total_cents: 2000 });
  });

  it("persists consent onto customers.consent (GAP_REGISTER.md §1.10)", async () => {
    let consentUpdatePayload: unknown;
    const steps: Step[] = [
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("update public.customers") && text.includes("consent")) {
        consentUpdatePayload = values[0];
        return Promise.resolve([]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    await createOrder(sql, ctx, { ...pickupArgs, consent: { sms: true, call: false } }, logger);
    expect(JSON.parse(consentUpdatePayload as string)).toMatchObject({ sms: true, call: false });
  });

  it("persists allergies and special_instructions onto the orders row (GAP_REGISTER.md §2 Restaurant item 2)", async () => {
    let insertedAllergies: unknown;
    let insertedInstructions: unknown;
    const steps: Step[] = [
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.orders")) {
        insertedAllergies = values.at(-2);
        insertedInstructions = values.at(-1);
        return Promise.resolve([{ id: "order_1" }]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    await createOrder(
      sql,
      ctx,
      { ...pickupArgs, allergies: ["peanuts"], special_instructions: "no onions" },
      logger,
    );
    expect(insertedAllergies).toEqual(["peanuts"]);
    expect(insertedInstructions).toBe("no onions");
  });

  it("writes call_logs.structured_booking_payload when allergies/special_instructions were captured", async () => {
    let wrote = false;
    const steps: Step[] = [
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("update public.call_logs") && text.includes("structured_booking_payload")) {
        wrote = true;
        return Promise.resolve([]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    await createOrder(sql, ctx, { ...pickupArgs, allergies: ["peanuts"] }, logger);
    expect(wrote).toBe(true);
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

  it("restaurant.md Finding B4: best-effort geocodes and upserts a new customer_addresses row after a confirmed delivery order", async () => {
    let insertedAddress: unknown;
    let unsetDefaultCalled = false;
    const steps: Step[] = [
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides (no radius policy)
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("lower(trim(street))")) {
        return Promise.resolve([]); // no existing saved address for this customer/street
      }
      if (text.includes("set is_default = false")) {
        unsetDefaultCalled = true;
        return Promise.resolve([]);
      }
      if (text.includes("insert into public.customer_addresses")) {
        insertedAddress = values;
        return Promise.resolve([]);
      }
      if (text.includes("pgmq.send")) return Promise.resolve([]);
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    const fetchImpl = (async () =>
      new Response(JSON.stringify({ results: [{ location: { lat: 30.2672, lng: -97.7431 } }] }), {
        status: 200,
      })) as unknown as (input: string, init?: RequestInit) => Promise<Response>;

    const result = await createOrder(
      sql,
      ctx,
      {
        ...pickupArgs,
        fulfillment_type: "delivery",
        delivery_address: { street: "123 Main St", city: "Austin", state: "TX", zip: "78701" },
      },
      logger,
      { geocode: { fetchImpl, apiKey: "test_key" } },
    );

    expect(result).toMatchObject({ confirmed: true, order_id: "order_1" });
    expect(unsetDefaultCalled).toBe(true);
    expect(insertedAddress).toContain("customer_1");
    expect(insertedAddress).toContain("123 Main St");
  });

  it("never attempts a geocode/address save when no geocode dep is wired (GEOCODE_API_KEY unset)", async () => {
    let addressTableTouched = false;
    const steps: Step[] = [
      { rows: [] },
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] },
      { rows: [{ dynamic_variable_overrides: {} }] },
      { rows: [{ id: "customer_1" }] },
      { rows: [{ id: "order_1" }] },
      { rows: [{ id: "msg_1" }] },
      { rows: [] },
      { rows: [] },
    ];
    let i = 0;
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join(" ");
      if (text.includes("customer_addresses")) addressTableTouched = true;
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: { street: "1 Main St" } },
      logger,
    );
    expect(result).toMatchObject({ confirmed: true });
    expect(addressTableTouched).toBe(false);
  });

  it("restaurant.md Finding B4: full write -> read -> radius-check loop — a repeat caller's address saved on order 1 lets order 2's radius check actually evaluate instead of always skipping", async () => {
    const addresses: {
      id: string;
      customer_id: string;
      street: string;
      geocode: { x: number; y: number };
      is_default: boolean;
    }[] = [];
    let nextAddressId = 1;
    const warnings: unknown[] = [];
    const spyLogger = {
      ...logger,
      warn: (msg: string, fields?: unknown) => warnings.push({ msg, fields }),
    };

    function makeLoopSql(orderSteps: Step[]): SqlClient {
      let i = 0;
      return ((strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join(" ");
        if (text.includes("ca.geocode")) {
          // create_order's own delivery-radius-check read.
          const match = addresses.find((a) => a.customer_id === "customer_1");
          return Promise.resolve(match ? [{ geocode: match.geocode }] : []);
        }
        if (text.includes("lower(trim(street))")) {
          const match = addresses.find(
            (a) =>
              a.customer_id === values[1] &&
              a.street.toLowerCase() === String(values[2]).toLowerCase(),
          );
          return Promise.resolve(match ? [{ id: match.id }] : []);
        }
        if (text.includes("set is_default = false")) {
          for (const a of addresses) a.is_default = false;
          return Promise.resolve([]);
        }
        if (text.includes("insert into public.customer_addresses")) {
          const id = `addr_${nextAddressId}`;
          nextAddressId += 1;
          addresses.push({
            id,
            customer_id: values[1] as string,
            street: values[2] as string,
            geocode: { x: -97.7431, y: 30.2672 },
            is_default: true,
          });
          return Promise.resolve([]);
        }
        if (text.includes("pgmq.send")) return Promise.resolve([]);
        const step = orderSteps[i];
        i += 1;
        return Promise.resolve(step?.rows ?? []);
      }) as SqlClient;
    }

    const fetchImpl = (async () =>
      new Response(JSON.stringify({ results: [{ location: { lat: 30.2672, lng: -97.7431 } }] }), {
        status: 200,
      })) as unknown as (input: string, init?: RequestInit) => Promise<Response>;
    const geocodeDeps = { geocode: { fetchImpl, apiKey: "test_key" } };
    const deliveryAddress = { street: "123 Main St", city: "Austin", state: "TX", zip: "78701" };
    const overridesWithRadius = {
      dynamic_variable_overrides: {
        tenant_geocode: { lat: 30.2672, lng: -97.7431 }, // same point -> well within any radius
        delivery_radius_m: 5000,
      },
    };

    // Order 1: first-time caller, no saved address yet — radius check skips
    // with a logged warning (pre-existing behavior), then the new address
    // write path saves the spoken address for next time.
    const sql1 = makeLoopSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings
      { rows: [overridesWithRadius] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
    ]);
    const ctx1: CallContext = { ...ctx, retellCallId: "call_1" };
    const result1 = await createOrder(
      sql1,
      ctx1,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: deliveryAddress },
      spyLogger,
      geocodeDeps,
    );
    expect(result1).toMatchObject({ confirmed: true });
    expect(warnings).toHaveLength(1);
    expect((warnings[0] as { msg: string }).msg).toBe(
      "create_order_radius_check_skipped_no_caller_geocode",
    );
    expect(addresses).toHaveLength(1);

    // Order 2: same caller, now HAS a saved geocode from order 1 — the
    // radius check finds it and actually evaluates (no second skip
    // warning), and since it's the same point, the order is confirmed.
    const sql2 = makeLoopSql([
      { rows: [] },
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] },
      { rows: [overridesWithRadius] },
      { rows: [{ id: "customer_1" }] },
      { rows: [{ id: "order_2" }] },
    ]);
    const ctx2: CallContext = { ...ctx, retellCallId: "call_2" };
    const result2 = await createOrder(
      sql2,
      ctx2,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: deliveryAddress },
      spyLogger,
      geocodeDeps,
    );
    expect(result2).toMatchObject({ confirmed: true, order_id: "order_2" });
    // still exactly one warning total — order 2 never hit the
    // "skipped_no_caller_geocode" branch this time.
    expect(warnings).toHaveLength(1);
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
