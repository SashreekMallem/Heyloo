import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  renderMenuFromOfferings,
  resolveAutoTokens,
  resolveCancellationPolicyText,
  resolveLegalTokens,
  resolveMenuText,
  resolveMotelTokens,
  resolveRestaurantSpokenTerms,
  resolveVerticalDynamicVariables,
  resolveVetTokens,
} from "./dynamic-variables.ts";

const logger = createLogger();

describe("resolveCancellationPolicyText", () => {
  it("uses the configured text", () => {
    expect(resolveCancellationPolicyText({ cancellation_policy: { text: "24h notice" } })).toBe(
      "24h notice",
    );
  });

  it("falls back to a safe default when unconfigured (never a blank/missing token)", () => {
    expect(resolveCancellationPolicyText({})).toMatch(/let us know/);
  });
});

describe("resolveLegalTokens", () => {
  it("renders practice_areas as an Oxford-comma list and formats the consult fee", () => {
    const tokens = resolveLegalTokens({
      practice_areas: ["family law", "personal injury", "estate planning"],
      consult_fee_cents: 25000,
    });
    expect(tokens["practice_areas"]).toBe("family law, personal injury, and estate planning");
    expect(tokens["consult_fee_text"]).toBe("$250.00 for an initial consultation");
  });

  it("never invents a fee — safe default when consult_fee_cents is unset", () => {
    const tokens = resolveLegalTokens({});
    expect(tokens["consult_fee_text"]).not.toMatch(/\$/);
    expect(tokens["practice_areas"]).toBe("a broad range of legal matters");
  });
});

describe("resolveAutoTokens", () => {
  it("resolves tow partner + vehicle makes from overrides", () => {
    const tokens = resolveAutoTokens({
      tow_partner: { name: "Ace Towing", phone: "+15555551234" },
      vehicle_makes_serviced: ["Toyota", "Honda"],
    });
    expect(tokens["tow_partner_name"]).toBe("Ace Towing");
    expect(tokens["tow_partner_phone"]).toBe("+15555551234");
    expect(tokens["vehicle_makes_serviced"]).toBe("Toyota and Honda");
  });

  it("falls back to safe non-fabricated defaults when unconfigured", () => {
    const tokens = resolveAutoTokens({});
    expect(tokens["tow_partner_name"]).toBeTruthy();
    expect(tokens["tow_partner_phone"]).toBeTruthy();
    expect(tokens["tow_partner_phone"]).not.toMatch(/^\+?\d+$/);
  });
});

describe("resolveVetTokens", () => {
  it("resolves species + emergency referral from overrides", () => {
    const tokens = resolveVetTokens({
      species_treated: ["dogs", "cats", "birds"],
      emergency_referral: { name: "Metro Animal ER", phone: "+15555559999" },
    });
    expect(tokens["species_treated"]).toBe("dogs, cats, and birds");
    expect(tokens["emergency_referral_name"]).toBe("Metro Animal ER");
    expect(tokens["emergency_referral_phone"]).toBe("+15555559999");
  });
});

describe("resolveMotelTokens", () => {
  it("renders the rate table in dollars/night and the deposit policy text", () => {
    const tokens = resolveMotelTokens({
      rate_table: [
        { room_type: "Standard", nightly_rate_cents: 8900 },
        { room_type: "Suite", nightly_rate_cents: 12900 },
      ],
      deposit_policy: { required: true, text: "A $50 deposit is required to hold your room." },
    });
    expect(tokens["rate_table"]).toBe("Standard: $89.00/night; Suite: $129.00/night");
    expect(tokens["deposit_policy_text"]).toBe("A $50 deposit is required to hold your room.");
  });

  it("never invents a rate — an empty table renders as an explicit 'no rates on file' guard", () => {
    const tokens = resolveMotelTokens({});
    expect(tokens["rate_table"]).toMatch(/no rates on file/);
    expect(tokens["deposit_policy_text"]).toMatch(/no deposit/);
  });

  it("defaults deposit_policy_text to a 'deposit required' line when required=true but no text set", () => {
    const tokens = resolveMotelTokens({ deposit_policy: { required: true } });
    expect(tokens["deposit_policy_text"]).toMatch(/deposit is required/);
  });
});

describe("resolveRestaurantSpokenTerms", () => {
  it("formats a configured prep time and delivery fee/minimum", () => {
    const tokens = resolveRestaurantSpokenTerms({
      prep_time_minutes: 20,
      delivery_fee_cents: 399,
      min_order_cents: 1500,
    });
    expect(tokens["prep_time_text"]).toBe("about 20 minutes");
    expect(tokens["delivery_terms_text"]).toBe(
      "a $3.99 delivery fee applies and the minimum order for delivery is $15.00",
    );
  });

  it("says delivery is free when delivery_fee_cents is 0", () => {
    const tokens = resolveRestaurantSpokenTerms({ delivery_fee_cents: 0 });
    expect(tokens["delivery_terms_text"]).toBe("delivery is free");
  });

  it("falls back to safe non-numeric defaults when unset", () => {
    const tokens = resolveRestaurantSpokenTerms({});
    expect(tokens["prep_time_text"]).toMatch(/confirm/);
    expect(tokens["delivery_terms_text"]).toMatch(/confirm/);
  });
});

describe("renderMenuFromOfferings", () => {
  it("renders name + price per item", () => {
    expect(
      renderMenuFromOfferings([
        { name: "Cheeseburger", price_cents: 999 },
        { name: "Fries", price_cents: 350 },
      ]),
    ).toBe("Cheeseburger ($9.99); Fries ($3.50)");
  });

  it("falls back to a safe 'no menu on file' string rather than an empty placeholder", () => {
    expect(renderMenuFromOfferings([])).toMatch(/no menu items/);
  });

  it("caps total rendered length so the compiled prompt never blows its word budget", () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      name: `Item ${i} with a long descriptive name to pad length`,
      price_cents: 999,
    }));
    const rendered = renderMenuFromOfferings(rows);
    expect(rendered.length).toBeLessThan(1600);
  });
});

function makeSql(rows: unknown[]): SqlClient {
  return (() => Promise.resolve(rows)) as SqlClient;
}

describe("resolveMenuText", () => {
  it("uses the tenant's menu_text override without querying offerings", async () => {
    const sql = makeSql([{ name: "should not be used", price_cents: 100 }]);
    const text = await resolveMenuText({
      sql,
      tenantId: "t1",
      overrides: { menu_text: "Ask your server for today's specials." },
    });
    expect(text).toBe("Ask your server for today's specials.");
  });

  it("renders from active offerings when no override is set", async () => {
    const sql = makeSql([
      { name: "Cheeseburger", price_cents: 999 },
      { name: "Fries", price_cents: 350 },
    ]);
    const text = await resolveMenuText({ sql, tenantId: "t1", overrides: {} });
    expect(text).toBe("Cheeseburger ($9.99); Fries ($3.50)");
  });
});

describe("resolveVerticalDynamicVariables", () => {
  it("scopes tokens to the tenant's own vertical — a dental tenant gets no auto/legal tokens", async () => {
    const sql = makeSql([]);
    const tokens = await resolveVerticalDynamicVariables({
      sql,
      tenantId: "t1",
      vertical: "dental",
      overrides: {},
      logger,
    });
    expect(tokens).toEqual({ cancellation_policy_text: expect.any(String) });
  });

  it("falls back to a safe menu default and logs rather than throwing if the offerings query fails", async () => {
    const sql: SqlClient = (() => Promise.reject(new Error("db down"))) as SqlClient;
    const tokens = await resolveVerticalDynamicVariables({
      sql,
      tenantId: "t1",
      vertical: "restaurant",
      overrides: {},
      logger,
    });
    expect(tokens["menu_text"]).toMatch(/no menu items/);
  });
});
