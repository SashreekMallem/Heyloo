import { describe, expect, it } from "vitest";
import { createLogger } from "../../_shared/logger.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import { ADDRESS_UNVERIFIED_MESSAGE, createOrder } from "./create_order.ts";

const logger = createLogger();
const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "generic",
  isTestCall: false,
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

  it("declines an item that doesn't resolve to a real offering by id OR name (never trusts model-invented pricing)", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [] }, // offerings lookup — the tenant has no active offerings at all
    ]);
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ confirmed: false, reason: "item_not_found", item_name: "Burger" });
  });

  it("CALL-7 (docs/BUILD_NOTES.md — live-confirmed: restaurant's template never grants list_offerings, so the model has no way to learn a real offering_id and every create_order call arrived with it entirely absent) resolves an item by NAME (case-insensitively) when offering_id is missing, mirroring OPS-5's create_booking.resource_id fallback", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Margherita Pizza", price_cents: 1600 }] }, // offerings lookup (whole active catalog)
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
      { rows: [{ id: "order_1" }] }, // order insert
      { rows: [{ id: "msg_1" }] }, // confirmation message insert
      { rows: [] }, // enqueue messages_outbound
      { rows: [] }, // enqueue adapter_push
    ]);
    const result = await createOrder(
      sql,
      ctx,
      {
        ...pickupArgs,
        // No offering_id at all, and the caller's spoken casing differs
        // from the catalog's own ("margherita pizza" vs "Margherita Pizza").
        items: [{ name: "margherita pizza", qty: 1 }],
      },
      logger,
    );
    expect(result).toEqual({ order_id: "order_1", confirmed: true, total_cents: 1600 });
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
    // Regression (CALL-3 jsonb double-encoding fix): the message bound to
    // the ::jsonb parameter (pgmq.send) must be the raw object, never a
    // caller-pre-stringified JSON string.
    const adapterPushCall = enqueueCalls[1] as [string, { adapter: string; entity_type: string }];
    const pushMessage = adapterPushCall[1];
    expect(typeof pushMessage).not.toBe("string");
    expect(pushMessage.adapter).toBe("square");
    expect(pushMessage.entity_type).toBe("order");
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
    // Regression (CALL-3 jsonb double-encoding fix): the consent value
    // bound to the ::jsonb parameter must be the raw object, never a
    // caller-pre-stringified JSON string.
    expect(typeof consentUpdatePayload).not.toBe("string");
    expect(consentUpdatePayload).toMatchObject({ sms: true, call: false });
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
        // PUBLISH-1 / DELIVERY-1: `is_test` then `address_verification`
        // are the last two bound values.
        insertedAllergies = values.at(-4);
        insertedInstructions = values.at(-3);
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

  it("PUBLISH-1: writes orders.is_test from ctx.isTestCall — true for a resolved test/placeholder call, mirroring create_booking.ts (CALL-6)", async () => {
    const steps: Step[] = [
      { rows: [] }, // idempotency pre-check
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] }, // offerings lookup
      { rows: [{ dynamic_variable_overrides: {} }] }, // agent_configs overrides
      { rows: [{ id: "customer_1" }] }, // customer upsert
    ];
    let i = 0;
    let insertValues: unknown[] | undefined;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.orders")) {
        insertValues = values;
        return Promise.resolve([{ id: "order_1" }]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    await createOrder(sql, { ...ctx, isTestCall: true }, pickupArgs, logger);
    expect(insertValues).toContain(true);
  });

  it("PUBLISH-1: writes orders.is_test=false for a real (non-test) call", async () => {
    const steps: Step[] = [
      { rows: [] },
      { rows: [{ id: "off_1", name: "Burger", price_cents: 1000 }] },
      { rows: [{ dynamic_variable_overrides: {} }] },
      { rows: [{ id: "customer_1" }] },
    ];
    let i = 0;
    let insertValues: unknown[] | undefined;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("insert into public.orders")) {
        insertValues = values;
        return Promise.resolve([{ id: "order_1" }]);
      }
      const step = steps[i];
      i += 1;
      return Promise.resolve(step?.rows ?? []);
    }) as SqlClient;

    await createOrder(sql, { ...ctx, isTestCall: false }, pickupArgs, logger);
    expect(insertValues).toContain(false);
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

describe("item_not_found hands the agent the real menu names", () => {
  it("declines a name that is not exactly on the menu and lists the menu's items (exact names only, never a guess)", async () => {
    const sql = makeStepSql([
      { rows: [] }, // idempotency pre-check
      {
        rows: [
          { id: "off_1", name: "Hyderabadi Chicken Dum Biryani", price_cents: 1500 },
          { id: "off_2", name: "Mutton Haleem", price_cents: 1300 },
          { id: "off_3", name: "Seasonal Special", price_cents: null }, // unpriced: never offered
        ],
      },
    ]);
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, items: [{ name: "Chicken Biryani", qty: 1 }] },
      logger,
    );
    expect(result).toEqual({
      confirmed: false,
      reason: "item_not_found",
      item_name: "Chicken Biryani",
      menu_items: ["Hyderabadi Chicken Dum Biryani", "Mutton Haleem"],
    });
  });
});

describe("createOrder delivery (DELIVERY-1)", () => {
  // 400 N Greenville Ave, Richardson TX; NEAR is ~3 mi north, FAR ~20 mi.
  const BUSINESS = { lat: 32.953692217245, lng: -96.728621302589 };
  const NEAR = { lat: BUSINESS.lat + 0.0435, lng: BUSINESS.lng };
  const FAR = { lat: BUSINESS.lat + 0.29, lng: BUSINESS.lng };

  function settingsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      business_street: "400 N Greenville Ave",
      business_city: "Richardson",
      business_state: "TX",
      business_zip: "75081",
      business_lat: BUSINESS.lat,
      business_lng: BUSINESS.lng,
      business_location_matched: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
      business_location_key: "400 n greenville ave|richardson|tx|75081",
      business_located_at: "2026-10-01T00:00:00Z",
      delivery_radius_miles: "5.00",
      delivery_fee_base_cents: 300,
      delivery_fee_per_mile_cents: 100,
      delivery_fee_included_miles: "2.00",
      delivery_min_order_cents: null,
      legacy_radius_m: null,
      legacy_fee_cents: null,
      legacy_min_order_cents: null,
      ...overrides,
    };
  }

  interface World {
    settings?: Record<string, unknown>;
    overrides?: Record<string, unknown>;
    checks?: Record<string, unknown>[];
    savedAddress?: Record<string, unknown> | null;
    existingDefault?: boolean;
  }

  function makeWorld(world: World = {}) {
    const calls: { text: string; values: unknown[] }[] = [];
    const captured: {
      orderInsert?: unknown[];
      checkInsert?: unknown[];
      addressInsert?: unknown[];
      checkLookup?: unknown[];
    } = {};
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join("?");
      calls.push({ text, values });
      if (text.includes("insert into public.orders")) {
        captured.orderInsert = values;
        return Promise.resolve([{ id: "order_1" }]);
      }
      if (text.includes("from public.orders")) return Promise.resolve([]);
      if (text.includes("from public.offerings")) {
        return Promise.resolve([{ id: "off_1", name: "Burger", price_cents: 1000 }]);
      }
      if (text.includes("select dynamic_variable_overrides from public.agent_configs")) {
        return Promise.resolve([{ dynamic_variable_overrides: world.overrides ?? {} }]);
      }
      if (text.includes("delivery_radius_miles")) {
        return Promise.resolve(world.settings === undefined ? [settingsRow()] : [world.settings]);
      }
      if (text.includes("insert into public.delivery_address_checks")) {
        captured.checkInsert = values;
        return Promise.resolve([{ id: "chk_new" }]);
      }
      if (text.includes("from public.delivery_address_checks")) {
        captured.checkLookup = values;
        return Promise.resolve(world.checks ?? []);
      }
      if (text.includes("ca.id =")) {
        return Promise.resolve(world.savedAddress ? [world.savedAddress] : []);
      }
      if (text.includes("insert into public.customers")) {
        return Promise.resolve([{ id: "customer_1" }]);
      }
      if (text.includes("lower(trim(street))")) return Promise.resolve([]);
      if (
        text.includes("select id from public.customer_addresses") &&
        text.includes("is_default")
      ) {
        return Promise.resolve(world.existingDefault ? [{ id: "addr_default" }] : []);
      }
      if (text.includes("insert into public.customer_addresses")) {
        captured.addressInsert = values;
        return Promise.resolve([]);
      }
      if (text.includes("insert into public.messages_outbound")) {
        return Promise.resolve([{ id: "msg_1" }]);
      }
      return Promise.resolve([]);
    }) as SqlClient;
    return { sql, calls, captured };
  }

  function censusAnswering(point: { lat: number; lng: number } | null) {
    const requested: string[] = [];
    const fetchImpl = async (url: string) => {
      requested.push(new URL(url).searchParams.get("address") ?? "");
      return new Response(
        JSON.stringify({
          result: {
            addressMatches: point
              ? [
                  {
                    matchedAddress: "12 ELM ST, RICHARDSON, TX, 75081",
                    coordinates: { x: point.lng, y: point.lat },
                    addressComponents: { city: "RICHARDSON", state: "TX", zip: "75081" },
                  },
                ]
              : [],
          },
        }),
        { status: 200 },
      );
    };
    return { fetchImpl, requested };
  }

  const deliveryArgs = {
    ...pickupArgs,
    fulfillment_type: "delivery" as const,
    delivery_address: { street: "12 Elm St", city: "Richardson", state: "TX", zip: "75081" },
  };

  function checkRow(
    status: string,
    point: { lat: number; lng: number } | null,
    miles: string | null,
  ) {
    return {
      status,
      input_address: "12 Elm St, Richardson, TX 75081",
      matched_address: point ? "12 ELM ST, RICHARDSON, TX, 75081" : null,
      street: point ? "12 ELM ST" : null,
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      distance_miles: miles,
    };
  }

  it("reuses this call's in_range check: distance-based fee, verified, located address saved, no geocode", async () => {
    const { sql, captured } = makeWorld({ checks: [checkRow("in_range", NEAR, "3.01")] });
    const census = censusAnswering(NEAR);
    const result = await createOrder(sql, ctx, deliveryArgs, logger, { census });
    // subtotal 2000; fee 300 + ceil(100 * 1.01) = 401
    expect(result).toEqual({
      order_id: "order_1",
      confirmed: true,
      total_cents: 2401,
      delivery_fee_cents: 401,
    });
    expect(census.requested).toHaveLength(0);
    expect(captured.checkLookup).toEqual(expect.arrayContaining(["tenant_1", "call_1"]));
    expect(captured.orderInsert).toContain(401);
    expect(captured.orderInsert?.at(-1)).toBe("in_range");
    expect(captured.addressInsert).toContain("12 Elm St");
    expect(captured.addressInsert).toContain(NEAR.lng);
    expect(captured.addressInsert).toContain(NEAR.lat);
  });

  it("declines with a pickup offer when this call's check was out_of_range, writing nothing", async () => {
    const { sql, captured } = makeWorld({ checks: [checkRow("out_of_range", FAR, "20.04")] });
    const result = await createOrder(sql, ctx, deliveryArgs, logger, {
      census: censusAnswering(FAR),
    });
    expect(result).toEqual({
      confirmed: false,
      reason: "out_of_delivery_radius",
      pickup_offered: true,
    });
    expect(captured.orderInsert).toBeUndefined();
  });

  it("checks inline (and records the check) when the agent skipped check_delivery_address", async () => {
    const { sql, captured } = makeWorld();
    const census = censusAnswering(NEAR);
    const result = await createOrder(sql, ctx, deliveryArgs, logger, { census });
    expect(census.requested).toEqual(["12 Elm St, Richardson, TX 75081"]);
    expect(captured.checkInsert?.slice(0, 4)).toEqual([
      "tenant_1",
      "call_1",
      "12 Elm St, Richardson, TX 75081",
      "in_range",
    ]);
    expect(result).toMatchObject({ confirmed: true, delivery_fee_cents: 401 });
    expect(result).not.toHaveProperty("address_verified");
  });

  it("an inline out-of-range answer declines the order", async () => {
    const { sql, captured } = makeWorld();
    const result = await createOrder(sql, ctx, deliveryArgs, logger, {
      census: censusAnswering(FAR),
    });
    expect(result).toMatchObject({ confirmed: false, reason: "out_of_delivery_radius" });
    expect(captured.orderInsert).toBeUndefined();
  });

  it("not_found: the order is still placed, marked unverified, base fee only, address not saved", async () => {
    const { sql, captured } = makeWorld();
    const result = await createOrder(sql, ctx, deliveryArgs, logger, {
      census: censusAnswering(null),
    });
    expect(result).toEqual({
      order_id: "order_1",
      confirmed: true,
      total_cents: 2300,
      delivery_fee_cents: 300,
      address_verified: false,
      message: ADDRESS_UNVERIFIED_MESSAGE,
    });
    expect(captured.orderInsert?.at(-1)).toBe("not_found");
    expect(captured.addressInsert).toBeUndefined();
  });

  it("a geocoder timeout never blocks the order (lookup_unavailable, within the timeout)", async () => {
    const { sql, captured } = makeWorld();
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const started = Date.now();
    const result = await createOrder(sql, ctx, deliveryArgs, logger, {
      census: { fetchImpl: hanging, timeoutMs: 20 },
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({ confirmed: true, address_verified: false });
    expect(captured.orderInsert?.at(-1)).toBe("lookup_unavailable");
  });

  it("without a geocoder and no prior check: unverified (lookup_unavailable), never geocoded", async () => {
    const { sql, captured } = makeWorld();
    const result = await createOrder(sql, ctx, deliveryArgs, logger);
    expect(result).toMatchObject({ confirmed: true, address_verified: false });
    expect(captured.orderInsert?.at(-1)).toBe("lookup_unavailable");
    expect(captured.checkInsert).toBeUndefined();
  });

  it("no_radius_set: placed, unverified, fee still priced by the known distance", async () => {
    const { sql, captured } = makeWorld({
      settings: settingsRow({ delivery_radius_miles: null }),
      checks: [checkRow("no_radius_set", FAR, "20.04")],
    });
    const result = await createOrder(sql, ctx, deliveryArgs, logger);
    // 300 + ceil(100 * 18.04)
    expect(result).toMatchObject({
      confirmed: true,
      delivery_fee_cents: 2104,
      address_verified: false,
    });
    expect(captured.orderInsert?.at(-1)).toBe("no_radius_set");
  });

  it("declines below the delivery minimum with the amounts and a pickup offer", async () => {
    const { sql, captured } = makeWorld({
      settings: settingsRow({ delivery_min_order_cents: 2500 }),
      checks: [checkRow("in_range", NEAR, "3.01")],
    });
    const result = await createOrder(sql, ctx, deliveryArgs, logger);
    expect(result).toMatchObject({
      confirmed: false,
      reason: "below_delivery_minimum",
      delivery_minimum_cents: 2500,
      subtotal_cents: 2000,
      pickup_offered: true,
    });
    expect((result as { message: string }).message).toContain("$25.00");
    expect(captured.orderInsert).toBeUndefined();
  });

  it("a pickup order never reads delivery settings or applies the delivery minimum", async () => {
    const { sql, calls } = makeWorld({
      settings: settingsRow({ delivery_min_order_cents: 99_999 }),
    });
    const result = await createOrder(sql, ctx, pickupArgs, logger);
    expect(result).toEqual({ order_id: "order_1", confirmed: true, total_cents: 2000 });
    expect(calls.some((c) => c.text.includes("delivery_radius_miles"))).toBe(false);
  });

  it("falls back to the legacy overrides (flat fee, minimum) when the new columns are unset", async () => {
    const legacy = settingsRow({
      delivery_fee_base_cents: null,
      delivery_fee_per_mile_cents: null,
      delivery_fee_included_miles: null,
      legacy_fee_cents: 399,
      legacy_min_order_cents: 5000,
    });
    const below = makeWorld({ settings: legacy, checks: [checkRow("in_range", NEAR, "3.01")] });
    expect(await createOrder(below.sql, ctx, deliveryArgs, logger)).toMatchObject({
      reason: "below_delivery_minimum",
      delivery_minimum_cents: 5000,
    });

    const ok = makeWorld({
      settings: { ...legacy, legacy_min_order_cents: null },
      checks: [checkRow("in_range", NEAR, "3.01")],
    });
    expect(await createOrder(ok.sql, ctx, deliveryArgs, logger)).toMatchObject({
      confirmed: true,
      delivery_fee_cents: 399,
      total_cents: 2399,
    });
  });

  it("CHANNELS-2 item 10: a saved address_id is checked by ITS geocode against the business location + radius", async () => {
    const { sql, captured } = makeWorld({
      savedAddress: {
        street: "99 Far Ave",
        city: "Plano",
        state: "TX",
        zip: "75023",
        geocode: { x: FAR.lng, y: FAR.lat },
      },
    });
    const census = censusAnswering(NEAR);
    const result = await createOrder(
      sql,
      ctx,
      { ...pickupArgs, fulfillment_type: "delivery", delivery_address: { address_id: "addr_far" } },
      logger,
      { census },
    );
    expect(result).toEqual({
      confirmed: false,
      reason: "out_of_delivery_radius",
      pickup_offered: true,
    });
    // The saved geocode was used; neither address was geocoded.
    expect(census.requested).toHaveLength(0);
    expect(captured.orderInsert).toBeUndefined();
  });

  it("a nearby saved address is in range and priced by its distance", async () => {
    const { sql, captured } = makeWorld({
      savedAddress: {
        street: "12 Elm St",
        city: "Richardson",
        state: "TX",
        zip: "75081",
        geocode: { x: NEAR.lng, y: NEAR.lat },
      },
    });
    const result = await createOrder(
      sql,
      ctx,
      {
        ...pickupArgs,
        fulfillment_type: "delivery",
        delivery_address: { address_id: "addr_near" },
      },
      logger,
    );
    expect(result).toMatchObject({ confirmed: true, delivery_fee_cents: 401 });
    expect(captured.orderInsert?.at(-1)).toBe("in_range");
  });

  it("restaurant.md Finding B4: a first located address becomes the customer's default", async () => {
    const { sql, captured } = makeWorld({ checks: [checkRow("in_range", NEAR, "3.01")] });
    await createOrder(sql, ctx, deliveryArgs, logger);
    expect(captured.addressInsert).toContain("customer_1");
    expect(captured.addressInsert?.at(-1)).toBe(true);
  });

  it("CHANNELS-2 item 10(d): a second address does NOT steal the caller's existing default", async () => {
    const { sql, calls, captured } = makeWorld({
      checks: [checkRow("in_range", NEAR, "3.01")],
      existingDefault: true,
    });
    await createOrder(sql, ctx, deliveryArgs, logger);
    expect(calls.some((c) => c.text.includes("set is_default = false"))).toBe(false);
    expect(captured.addressInsert?.at(-1)).toBe(false);
  });
});
