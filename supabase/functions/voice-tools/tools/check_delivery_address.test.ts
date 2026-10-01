import { describe, expect, it } from "vitest";
import { createLogger } from "../../_shared/logger.ts";
import type { CensusFetch } from "../../_shared/providers/census-geocode.ts";
import type { SqlClient } from "../../_shared/types.ts";
import type { CallContext } from "../context.ts";
import {
  checkDeliveryAddressTool,
  dollars,
  NOT_FOUND_MESSAGE,
  UNVERIFIED_MESSAGE,
} from "./check_delivery_address.ts";

const logger = createLogger();
const ctx: CallContext = {
  tenantId: "tenant_1",
  callLogId: "cl_1",
  retellCallId: "call_1",
  callerNumber: "+15551234567",
  vertical: "restaurant",
  isTestCall: false,
};

const BUSINESS = { lat: 32.953692217245, lng: -96.728621302589 };
const NEAR = { lat: BUSINESS.lat + 0.0435, lng: BUSINESS.lng }; // ~3 mi
const FAR = { lat: BUSINESS.lat + 0.29, lng: BUSINESS.lng }; // ~20 mi

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
    delivery_min_order_cents: 1500,
    legacy_radius_m: null,
    legacy_fee_cents: null,
    legacy_min_order_cents: null,
    ...overrides,
  };
}

function makeSql(settings: Record<string, unknown> = settingsRow()): {
  sql: SqlClient;
  inserts: unknown[][];
} {
  const inserts: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from public.tenants t")) return Promise.resolve([settings]);
    if (text.includes("insert into public.delivery_address_checks")) {
      inserts.push(values);
      return Promise.resolve([{ id: "chk_1" }]);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, inserts };
}

function census(point: { lat: number; lng: number } | null): CensusFetch {
  return async () =>
    new Response(
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
}

const args = { street: "12 Elm St", city: "Richardson", state: "TX", unit: "Apt 4" };

describe("checkDeliveryAddressTool (DELIVERY-1)", () => {
  it("in_range: matched address, distance, radius, fee and minimum, and a read-back instruction naming the fee", async () => {
    const { sql, inserts } = makeSql();
    const result = await checkDeliveryAddressTool(sql, ctx, args, {
      logger,
      census: { fetchImpl: census(NEAR) },
    });
    expect(result).toMatchObject({
      status: "in_range",
      matched_address: "12 ELM ST, RICHARDSON, TX, 75081",
      unit: "Apt 4",
      radius_miles: 5,
      delivery_minimum_cents: 1500,
    });
    expect(result.distance_miles).toBeCloseTo(3, 0);
    expect(result.delivery_fee_cents).toBeGreaterThan(395);
    expect(result.message).toContain("Read the matched address back");
    expect(result.message).toContain(`Delivery is ${dollars(result.delivery_fee_cents ?? 0)}`);
    expect(result.message).toContain("$15.00");
    // Recorded against the verified call context (tenant + provider call id).
    expect(inserts[0]?.slice(0, 2)).toEqual(["tenant_1", "call_1"]);
    // The unit is passed through, never geocoded.
    expect(inserts[0]?.[2]).toBe("12 Elm St, Richardson, TX");
  });

  it("in_range with no fee says delivery is free", async () => {
    const { sql } = makeSql(
      settingsRow({
        delivery_fee_base_cents: null,
        delivery_fee_per_mile_cents: null,
        delivery_fee_included_miles: null,
        delivery_min_order_cents: null,
      }),
    );
    const result = await checkDeliveryAddressTool(sql, ctx, args, {
      logger,
      census: { fetchImpl: census(NEAR) },
    });
    expect(result.delivery_fee_cents).toBe(0);
    expect(result.message).toContain("Delivery is free.");
    expect(result).not.toHaveProperty("delivery_minimum_cents");
  });

  it("out_of_range: says how far and the limit, and to offer pickup; no fee", async () => {
    const { sql } = makeSql();
    const result = await checkDeliveryAddressTool(sql, ctx, args, {
      logger,
      census: { fetchImpl: census(FAR) },
    });
    expect(result.status).toBe("out_of_range");
    expect(result.message).toMatch(/^Too far for delivery \(20(\.\d)? mi, limit 5 mi\): /);
    expect(result.message).toContain("offer pickup");
    expect(result).not.toHaveProperty("delivery_fee_cents");
  });

  it("not_found: one retry, then take the order", async () => {
    const { sql } = makeSql();
    const result = await checkDeliveryAddressTool(sql, ctx, args, {
      logger,
      census: { fetchImpl: census(null) },
    });
    expect(result).toEqual({
      status: "not_found",
      unit: "Apt 4",
      delivery_minimum_cents: 1500,
      message: NOT_FOUND_MESSAGE,
    });
  });

  it("no_radius_set / no_business_location / lookup_unavailable: continue, the restaurant confirms", async () => {
    const noRadius = makeSql(settingsRow({ delivery_radius_miles: null }));
    expect(
      await checkDeliveryAddressTool(noRadius.sql, ctx, args, {
        logger,
        census: { fetchImpl: census(NEAR) },
      }),
    ).toMatchObject({
      status: "no_radius_set",
      matched_address: "12 ELM ST, RICHARDSON, TX, 75081",
      message: UNVERIFIED_MESSAGE,
    });

    const noBusiness = makeSql(settingsRow({ business_street: null }));
    expect(
      await checkDeliveryAddressTool(noBusiness.sql, ctx, args, {
        logger,
        census: { fetchImpl: census(NEAR) },
      }),
    ).toMatchObject({ status: "no_business_location", message: UNVERIFIED_MESSAGE });

    const down = makeSql();
    expect(
      await checkDeliveryAddressTool(down.sql, ctx, args, {
        logger,
        census: { fetchImpl: async () => new Response("busy", { status: 503 }) },
      }),
    ).toMatchObject({ status: "lookup_unavailable", message: UNVERIFIED_MESSAGE });
  });

  it("without a geocoder it answers lookup_unavailable and touches nothing", async () => {
    const { sql, inserts } = makeSql();
    expect(await checkDeliveryAddressTool(sql, ctx, args, { logger })).toEqual({
      status: "lookup_unavailable",
      unit: "Apt 4",
      message: UNVERIFIED_MESSAGE,
    });
    expect(inserts).toHaveLength(0);
  });

  it("dollars() formats integer cents", () => {
    expect(dollars(500)).toBe("$5.00");
    expect(dollars(1)).toBe("$0.01");
  });
});
