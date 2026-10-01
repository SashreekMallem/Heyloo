import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { CensusFetch } from "../_shared/providers/census-geocode.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleBusinessLocation } from "./handler.ts";

const logger = createLogger();
const TENANT = "11111111-1111-4111-8111-111111111111";

function settingsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    business_street: "400 N Greenville Ave",
    business_city: "Richardson",
    business_state: "TX",
    business_zip: "75081",
    business_lat: 32.95,
    business_lng: -96.73,
    business_location_matched: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
    business_location_key: "400 n greenville ave|richardson|tx|75081",
    business_located_at: "2026-10-01T00:00:00Z",
    delivery_radius_miles: null,
    delivery_fee_base_cents: null,
    delivery_fee_per_mile_cents: null,
    delivery_fee_included_miles: null,
    delivery_min_order_cents: null,
    legacy_radius_m: null,
    legacy_fee_cents: null,
    legacy_min_order_cents: null,
    ...overrides,
  };
}

function makeSql(row: Record<string, unknown> | null): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    if (text.includes("from public.tenants t")) return Promise.resolve(row ? [row] : []);
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function census(match: { lat: number; lng: number } | null): {
  fetchImpl: CensusFetch;
  requested: string[];
} {
  const requested: string[] = [];
  const fetchImpl: CensusFetch = async (url) => {
    requested.push(new URL(url).searchParams.get("address") ?? "");
    return new Response(
      JSON.stringify({
        result: {
          addressMatches: match
            ? [
                {
                  matchedAddress: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
                  coordinates: { x: match.lng, y: match.lat },
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

describe("handleBusinessLocation (DELIVERY-1)", () => {
  it("geocodes the tenant's current address even when cached (owner just saved), stores it scoped to the tenant, returns the match", async () => {
    const { sql, calls } = makeSql(settingsRow());
    const geo = census({ lat: 32.9537, lng: -96.7286 });
    const result = await handleBusinessLocation(sql, TENANT, { fetchImpl: geo.fetchImpl, logger });
    expect(result).toEqual({
      status: 200,
      body: {
        matched_address: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
        lat: 32.9537,
        lng: -96.7286,
      },
    });
    expect(geo.requested).toEqual(["400 N Greenville Ave, Richardson, TX 75081"]);
    expect(calls[0]?.values).toContain(TENANT);
    const update = calls.find((c) => c.text.includes("update public.tenants"));
    expect(update?.values).toContain(TENANT);
    expect(update?.values).toContain(32.9537);
  });

  it("not_found when the Census has no match", async () => {
    const { sql } = makeSql(settingsRow());
    expect(
      await handleBusinessLocation(sql, TENANT, { fetchImpl: census(null).fetchImpl, logger }),
    ).toEqual({ status: 200, body: { error: "not_found" } });
  });

  it("lookup_unavailable when the geocoder is down", async () => {
    const { sql } = makeSql(settingsRow());
    const down: CensusFetch = async () => new Response("no", { status: 502 });
    expect(await handleBusinessLocation(sql, TENANT, { fetchImpl: down, logger })).toEqual({
      status: 200,
      body: { error: "lookup_unavailable" },
    });
  });

  it("address_incomplete without a street + locality, never calling the geocoder", async () => {
    const { sql } = makeSql(settingsRow({ business_street: null }));
    const geo = census({ lat: 1, lng: 1 });
    expect(await handleBusinessLocation(sql, TENANT, { fetchImpl: geo.fetchImpl, logger })).toEqual(
      {
        status: 200,
        body: { error: "address_incomplete" },
      },
    );
    expect(geo.requested).toHaveLength(0);
  });

  it("404 for an unknown tenant", async () => {
    const { sql } = makeSql(null);
    expect(
      await handleBusinessLocation(sql, TENANT, { fetchImpl: census(null).fetchImpl, logger }),
    ).toEqual({ status: 404, body: { error: "tenant_not_found" } });
  });
});
