import { describe, expect, it } from "vitest";
import {
  businessAddressKey,
  checkDeliveryAddress,
  ensureBusinessLocation,
  findRecentDeliveryCheck,
  haversineMiles,
  loadDeliverySettings,
  normalizeStreet,
  resolveBusinessLocation,
} from "./delivery-distance.ts";
import { computeDeliveryFeeCents } from "./delivery-fee.ts";
import { createLogger } from "./logger.ts";
import type { CensusFetch } from "./providers/census-geocode.ts";
import type { SqlClient } from "./types.ts";

const logger = createLogger();
const TENANT = "11111111-1111-4111-8111-111111111111";

// 400 N Greenville Ave, Richardson TX (live Census answer 2026-10-01).
const BUSINESS = { lat: 32.953692217245, lng: -96.728621302589 };
const BUSINESS_KEY = "400 n greenville ave|richardson|tx|75081";

interface Call {
  text: string;
  values: unknown[];
}

function makeSql(handlers: Array<[string, unknown[] | (() => never)]>): {
  sql: SqlClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    for (const [needle, rows] of handlers) {
      if (text.includes(needle)) {
        if (typeof rows === "function") return Promise.reject(new Error("db down"));
        return Promise.resolve(rows);
      }
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function settingsRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    business_street: "400 N Greenville Ave",
    business_city: "Richardson",
    business_state: "TX",
    business_zip: "75081",
    business_lat: BUSINESS.lat,
    business_lng: BUSINESS.lng,
    business_location_matched: "400 N GREENVILLE AVE, RICHARDSON, TX, 75081",
    business_location_key: BUSINESS_KEY,
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

function census(matches: Record<string, { lat: number; lng: number } | null>): {
  fetchImpl: CensusFetch;
  requested: string[];
} {
  const requested: string[] = [];
  const fetchImpl: CensusFetch = async (url) => {
    const address = new URL(url).searchParams.get("address") ?? "";
    requested.push(address);
    const point = matches[address];
    return new Response(
      JSON.stringify({
        result: {
          addressMatches: point
            ? [
                {
                  matchedAddress: `${address.toUpperCase().split(",")[0]}, SOMEWHERE, TX, 75081`,
                  coordinates: { x: point.lng, y: point.lat },
                  addressComponents: { city: "SOMEWHERE", state: "TX", zip: "75081" },
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

const timeoutFetch: CensusFetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });

// ~3 miles north of the business, and ~20 miles away.
const NEAR = { lat: BUSINESS.lat + 0.0435, lng: BUSINESS.lng };
const FAR = { lat: BUSINESS.lat + 0.29, lng: BUSINESS.lng };

describe("haversineMiles / normalize helpers", () => {
  it("measures straight-line miles", () => {
    expect(haversineMiles(BUSINESS, NEAR)).toBeCloseTo(3.0, 1);
    expect(haversineMiles(BUSINESS, BUSINESS)).toBe(0);
  });

  it("businessAddressKey needs a street plus a ZIP or a city and state", () => {
    expect(
      businessAddressKey({
        street: " 400  N Greenville Ave",
        city: "Richardson",
        state: "TX",
        zip: "75081",
      }),
    ).toBe(BUSINESS_KEY);
    expect(businessAddressKey({ street: "1 Main", city: null, state: null, zip: "75081" })).toBe(
      "1 main|||75081",
    );
    expect(
      businessAddressKey({ street: "1 Main", city: "Dallas", state: null, zip: null }),
    ).toBeNull();
    expect(
      businessAddressKey({ street: null, city: "Dallas", state: "TX", zip: "75081" }),
    ).toBeNull();
  });

  it("normalizeStreet ignores case, punctuation and spacing", () => {
    expect(normalizeStreet(" 12 N. Main  St. ")).toBe(normalizeStreet("12 n main st"));
  });
});

describe("loadDeliverySettings", () => {
  it("parses numeric columns returned as strings", async () => {
    const { sql } = makeSql([["from public.tenants t", [settingsRow()]]]);
    const s = await loadDeliverySettings(sql, TENANT);
    expect(s?.radiusMiles).toBe(5);
    expect(s?.fee).toEqual({ baseCents: 300, perMileCents: 100, includedMiles: 2 });
    expect(s?.minOrderCents).toBe(1500);
    expect(s?.storedLocation).toMatchObject(BUSINESS);
  });

  it("falls back to the legacy overrides only where the columns are unset", async () => {
    const { sql } = makeSql([
      [
        "from public.tenants t",
        [
          settingsRow({
            delivery_radius_miles: null,
            delivery_fee_base_cents: null,
            delivery_fee_per_mile_cents: null,
            delivery_fee_included_miles: null,
            delivery_min_order_cents: null,
            legacy_radius_m: 8046.72,
            legacy_fee_cents: 399,
            legacy_min_order_cents: 2000,
          }),
        ],
      ],
    ]);
    const s = await loadDeliverySettings(sql, TENANT);
    expect(s?.radiusMiles).toBeCloseTo(5, 6);
    expect(s?.fee).toEqual({ baseCents: 399, perMileCents: null, includedMiles: null });
    expect(s?.minOrderCents).toBe(2000);
  });

  it("a set fee column wins over the legacy flat fee", async () => {
    const { sql } = makeSql([
      [
        "from public.tenants t",
        [
          settingsRow({
            delivery_fee_base_cents: null,
            delivery_fee_per_mile_cents: 150,
            delivery_fee_included_miles: null,
            legacy_fee_cents: 399,
          }),
        ],
      ],
    ]);
    expect((await loadDeliverySettings(sql, TENANT))?.fee).toEqual({
      baseCents: null,
      perMileCents: 150,
      includedMiles: null,
    });
  });

  it("returns null for an unknown tenant and scopes the read by tenant id", async () => {
    const { sql, calls } = makeSql([]);
    expect(await loadDeliverySettings(sql, TENANT)).toBeNull();
    expect(calls[0]?.values).toContain(TENANT);
  });
});

describe("resolveBusinessLocation / ensureBusinessLocation", () => {
  it("uses the cached location when it was computed from the current address (no geocode)", async () => {
    const { sql } = makeSql([["from public.tenants t", [settingsRow()]]]);
    const { fetchImpl, requested } = census({});
    expect(await ensureBusinessLocation(sql, TENANT, { fetchImpl, logger })).toMatchObject(
      BUSINESS,
    );
    expect(requested).toHaveLength(0);
  });

  it("re-geocodes and stores when the owner changed the address (stale key)", async () => {
    const { sql, calls } = makeSql([
      [
        "from public.tenants t",
        [settingsRow({ business_street: "500 Main St", business_location_key: BUSINESS_KEY })],
      ],
    ]);
    const { fetchImpl, requested } = census({
      "500 Main St, Richardson, TX 75081": { lat: 33, lng: -96.7 },
    });
    const loc = await ensureBusinessLocation(sql, TENANT, { fetchImpl, logger });
    expect(loc).toMatchObject({ lat: 33, lng: -96.7 });
    expect(requested).toEqual(["500 Main St, Richardson, TX 75081"]);
    const update = calls.find((c) => c.text.includes("update public.tenants"));
    expect(update?.values).toContain(33);
    expect(update?.values).toContain("500 main st|richardson|tx|75081");
    expect(update?.values).toContain(TENANT);
    // Guarded on the address it geocoded, so a concurrent edit is never overwritten.
    expect(update?.text).toContain("business_street is not distinct from");
  });

  it("geocodes when lat is null (never located)", async () => {
    const { sql } = makeSql([
      [
        "from public.tenants t",
        [settingsRow({ business_lat: null, business_lng: null, business_location_key: null })],
      ],
    ]);
    const { fetchImpl, requested } = census({
      "400 N Greenville Ave, Richardson, TX 75081": BUSINESS,
    });
    expect(await ensureBusinessLocation(sql, TENANT, { fetchImpl, logger })).toMatchObject(
      BUSINESS,
    );
    expect(requested).toHaveLength(1);
  });

  it("never returns a stale location when the new address cannot be geocoded right now", async () => {
    const { sql, calls } = makeSql([
      ["from public.tenants t", [settingsRow({ business_street: "500 Main St" })]],
    ]);
    const outcome = await resolveBusinessLocation(
      sql,
      (await loadDeliverySettings(sql, TENANT)) as never,
      { fetchImpl: timeoutFetch, timeoutMs: 10, logger },
    );
    expect(outcome).toEqual({ ok: false, reason: "lookup_unavailable" });
    expect(calls.some((c) => c.text.includes("update public.tenants"))).toBe(false);
  });

  it("stores a not-found address (lat null) and does not retry it for a day", async () => {
    const { sql, calls } = makeSql([
      ["from public.tenants t", [settingsRow({ business_street: "999 Nowhere" })]],
    ]);
    const { fetchImpl } = census({});
    const settings = await loadDeliverySettings(sql, TENANT);
    expect(await resolveBusinessLocation(sql, settings as never, { fetchImpl, logger })).toEqual({
      ok: false,
      reason: "not_found",
    });
    const update = calls.find((c) => c.text.includes("update public.tenants"));
    expect(update?.values.slice(0, 3)).toEqual([null, null, null]);

    const missed = {
      ...(settings as NonNullable<typeof settings>),
      storedLocation: null,
      locationKey: "999 nowhere|richardson|tx|75081",
      locatedAt: new Date("2026-10-01T10:00:00Z"),
    };
    const quiet = census({});
    const now = () => new Date("2026-10-01T12:00:00Z");
    expect(
      await resolveBusinessLocation(sql, missed, { fetchImpl: quiet.fetchImpl, logger, now }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(quiet.requested).toHaveLength(0);
    // ...but an explicit owner save forces a fresh look.
    await resolveBusinessLocation(sql, missed, {
      fetchImpl: quiet.fetchImpl,
      logger,
      now,
      force: true,
    });
    expect(quiet.requested).toHaveLength(1);
  });

  it("address_incomplete without a street + locality", async () => {
    const { sql } = makeSql([
      ["from public.tenants t", [settingsRow({ business_zip: null, business_state: null })]],
    ]);
    const settings = await loadDeliverySettings(sql, TENANT);
    expect(
      await resolveBusinessLocation(sql, settings as never, {
        fetchImpl: census({}).fetchImpl,
        logger,
      }),
    ).toEqual({ ok: false, reason: "address_incomplete" });
  });
});

describe("checkDeliveryAddress", () => {
  const ctx = { tenantId: TENANT, providerCallId: "call_abc" };

  it("in_range: matched address, distance, fee from the formula, and a recorded check", async () => {
    const { sql, calls } = makeSql([
      ["from public.tenants t", [settingsRow()]],
      ["insert into public.delivery_address_checks", [{ id: "chk_1" }]],
    ]);
    const { fetchImpl } = census({ "12 Elm St, Richardson, TX": NEAR });
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "12 Elm St", city: "Richardson", state: "TX" },
      { fetchImpl, logger },
    );
    expect(check.status).toBe("in_range");
    expect(check.matchedAddress).toBe("12 ELM ST, SOMEWHERE, TX, 75081");
    expect(check.street).toBe("12 ELM ST");
    expect(check.distanceMiles).toBeCloseTo(3.0, 1);
    expect(check.radiusMiles).toBe(5);
    // 300 + ceil(100 * (miles - 2)), the shared formula.
    expect(check.deliveryFeeCents).toBe(
      computeDeliveryFeeCents(
        { baseCents: 300, perMileCents: 100, includedMiles: 2 },
        check.distanceMiles,
      ),
    );
    expect(check.deliveryFeeCents).toBeGreaterThan(395);
    expect(check.minOrderCents).toBe(1500);
    expect(check.checkId).toBe("chk_1");
    const insert = calls.find((c) => c.text.includes("insert into public.delivery_address_checks"));
    expect(insert?.values.slice(0, 4)).toEqual([
      TENANT,
      "call_abc",
      "12 Elm St, Richardson, TX",
      "in_range",
    ]);
  });

  it("out_of_range beyond the radius", async () => {
    const { sql } = makeSql([["from public.tenants t", [settingsRow()]]]);
    const { fetchImpl } = census({ "9 Far Rd, Plano, TX": FAR });
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "9 Far Rd", city: "Plano", state: "TX" },
      {
        fetchImpl,
        logger,
      },
    );
    expect(check.status).toBe("out_of_range");
    expect(check.distanceMiles).toBeGreaterThan(19);
  });

  it("no_radius_set still returns the matched address and distance", async () => {
    const { sql } = makeSql([
      ["from public.tenants t", [settingsRow({ delivery_radius_miles: null })]],
    ]);
    const { fetchImpl } = census({ "9 Far Rd": FAR });
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "9 Far Rd" },
      { fetchImpl, logger },
    );
    expect(check.status).toBe("no_radius_set");
    expect(check.matchedAddress).not.toBeNull();
    expect(check.distanceMiles).toBeGreaterThan(19);
  });

  it("not_found when the Census has no match", async () => {
    const { sql } = makeSql([["from public.tenants t", [settingsRow()]]]);
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "1 Nowhere" },
      {
        fetchImpl: census({}).fetchImpl,
        logger,
      },
    );
    expect(check.status).toBe("not_found");
    expect(check.distanceMiles).toBeNull();
    expect(check.deliveryFeeCents).toBe(300);
  });

  it("no_business_location when the business has no address", async () => {
    const { sql } = makeSql([
      [
        "from public.tenants t",
        [settingsRow({ business_street: null, business_lat: null, business_lng: null })],
      ],
    ]);
    const { fetchImpl } = census({ "12 Elm St": NEAR });
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "12 Elm St" },
      { fetchImpl, logger },
    );
    expect(check.status).toBe("no_business_location");
    expect(check.matchedAddress).not.toBeNull();
  });

  it("lookup_unavailable on a geocoder timeout, within the timeout", async () => {
    const { sql, calls } = makeSql([["from public.tenants t", [settingsRow()]]]);
    const started = Date.now();
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "12 Elm St" },
      {
        fetchImpl: timeoutFetch,
        timeoutMs: 20,
        logger,
      },
    );
    expect(check.status).toBe("lookup_unavailable");
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(calls.some((c) => c.text.includes("insert into public.delivery_address_checks"))).toBe(
      true,
    );
  });

  it("a failed insert never fails the check", async () => {
    const { sql } = makeSql([
      ["from public.tenants t", [settingsRow()]],
      ["insert into public.delivery_address_checks", () => undefined as never],
    ]);
    const { fetchImpl } = census({ "12 Elm St": NEAR });
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "12 Elm St" },
      { fetchImpl, logger },
    );
    expect(check.status).toBe("in_range");
    expect(check.checkId).toBeNull();
  });

  it("geocodes the business and the caller in parallel when the business is not located yet", async () => {
    const { sql } = makeSql([
      [
        "from public.tenants t",
        [settingsRow({ business_lat: null, business_lng: null, business_location_key: null })],
      ],
    ]);
    let inFlight = 0;
    let maxInFlight = 0;
    const base = census({
      "12 Elm St": NEAR,
      "400 N Greenville Ave, Richardson, TX 75081": BUSINESS,
    });
    const fetchImpl: CensusFetch = async (url, init) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return base.fetchImpl(url, init);
    };
    const check = await checkDeliveryAddress(
      sql,
      ctx,
      { street: "12 Elm St" },
      { fetchImpl, logger },
    );
    expect(check.status).toBe("in_range");
    expect(maxInFlight).toBe(2);
  });
});

describe("findRecentDeliveryCheck", () => {
  const row = (overrides: Record<string, unknown>) => ({
    status: "in_range",
    input_address: "12 Elm St, Richardson, TX",
    matched_address: "12 ELM ST, RICHARDSON, TX, 75081",
    street: "12 ELM ST",
    lat: NEAR.lat,
    lng: NEAR.lng,
    distance_miles: "3.01",
    ...overrides,
  });

  it("matches on the checked street or the matched street, case/space-insensitively, scoped to tenant + call", async () => {
    const { sql, calls } = makeSql([
      [
        "from public.delivery_address_checks",
        [row({ input_address: "9 Oak Ave", street: "9 OAK AVE", status: "out_of_range" }), row({})],
      ],
    ]);
    const found = await findRecentDeliveryCheck(sql, TENANT, "call_abc", "12  elm st.");
    expect(found).toMatchObject({ status: "in_range", distanceMiles: 3.01, street: "12 ELM ST" });
    expect(calls[0]?.values).toEqual(expect.arrayContaining([TENANT, "call_abc"]));
    expect(calls[0]?.text).toContain("status <> 'lookup_unavailable'");

    const byMatched = await findRecentDeliveryCheck(sql, TENANT, "call_abc", "9 oak ave");
    expect(byMatched?.status).toBe("out_of_range");
    expect(await findRecentDeliveryCheck(sql, TENANT, "call_abc", "77 Pine")).toBeNull();
    // A unit appended on create_order still matches; a longer house number does not.
    expect(
      (await findRecentDeliveryCheck(sql, TENANT, "call_abc", "12 Elm St Apt 4"))?.status,
    ).toBe("in_range");
    expect(await findRecentDeliveryCheck(sql, TENANT, "call_abc", "12 Elmwood Dr")).toBeNull();
  });
});
