import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleCheckout } from "./handler.ts";

const logger = createLogger();

function makeDeps(overrides: Partial<Parameters<typeof handleCheckout>[3]> = {}) {
  return {
    stripeFetch: (async () =>
      new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }), {
        status: 200,
      })) as never,
    stripeSecretKey: "sk_test",
    successUrl: "https://heyloo.app/success",
    cancelUrl: "https://heyloo.app/cancel",
    randomSuffix: () => "abcd1234",
    logger,
    ...overrides,
  };
}

const VALID_BODY = {
  vertical: "auto",
  business_name: "Joe's Auto",
  email: "joe@example.com",
};

const PRICE_CARD = {
  base_cents: 29900,
  included_minutes: 300,
  overage_cents: 35,
  stripe_base_price_id: "price_base",
  stripe_meter_price_id: "price_meter",
};

/**
 * Dispatches on query text first; for the one query shape that repeats
 * verbatim with only its bound `key` parameter differing
 * (`select value from public.platform_settings where key = $1`, used for
 * both `price_card_<vertical>` and `fees_<vertical>`), a fixture key of
 * `"platform_settings:<exact key value>"` matches against `values[0]`
 * instead of the (identical) query text.
 */
function makeSql(fixtures: Record<string, unknown[]> = {}): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    if (text.includes("from public.platform_settings where key")) {
      const fixtureKey = `platform_settings:${values[0]}`;
      return Promise.resolve(fixtures[fixtureKey] ?? []);
    }
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

describe("handleCheckout", () => {
  it("rejects an invalid request body", async () => {
    const sql = (() => Promise.resolve([])) as SqlClient;
    const result = await handleCheckout(sql, "user-1", { vertical: "not_a_vertical" }, makeDeps());
    expect(result).toEqual({ ok: false, status: 422, error: "invalid_request" });
  });

  it("returns stripe_not_configured when the price card has no Stripe price ids yet", async () => {
    const { sql } = makeSql({
      "platform_settings:price_card_auto": [{ value: { base_cents: 29900 } }],
    });
    const result = await handleCheckout(sql, "user-1", VALID_BODY, makeDeps());
    expect(result).toEqual({ ok: false, status: 500, error: "stripe_not_configured" });
  });

  it("creates a new trialing tenant + owner membership, then a checkout session", async () => {
    const { sql, calls } = makeSql({
      "platform_settings:price_card_auto": [{ value: PRICE_CARD }],
      "from public.tenants t": [],
      "insert into public.tenants": [{ id: "tenant-1" }],
    });

    const result = await handleCheckout(sql, "user-1", VALID_BODY, makeDeps());
    expect(result).toEqual({
      ok: true,
      tenant_id: "tenant-1",
      checkout_url: "https://checkout.stripe.com/cs_1",
    });
    const tenantInsert = calls.find((c) => c.text.includes("insert into public.tenants"));
    expect(tenantInsert?.values).toContain("joe-s-auto-abcd1234");
    expect(calls.some((c) => c.text.includes("insert into public.memberships"))).toBe(true);
  });

  it("reuses an existing not-yet-paid trialing tenant instead of creating a second one", async () => {
    const { sql, calls } = makeSql({
      "platform_settings:price_card_auto": [{ value: PRICE_CARD }],
      "from public.tenants t": [{ id: "existing-tenant" }],
    });

    const result = await handleCheckout(sql, "user-1", VALID_BODY, makeDeps());
    expect(result).toEqual({
      ok: true,
      tenant_id: "existing-tenant",
      checkout_url: "https://checkout.stripe.com/cs_1",
    });
    expect(calls.some((c) => c.text.includes("insert into public.tenants"))).toBe(false);
    expect(calls.some((c) => c.text.includes("insert into public.memberships"))).toBe(false);
  });

  it("surfaces a checkout_session_create_failed error when Stripe rejects the session", async () => {
    const { sql } = makeSql({
      "platform_settings:price_card_auto": [{ value: PRICE_CARD }],
      "from public.tenants t": [{ id: "existing-tenant" }],
    });

    const result = await handleCheckout(
      sql,
      "user-1",
      VALID_BODY,
      makeDeps({
        stripeFetch: (async () => new Response("{}", { status: 402 })) as never,
      }),
    );
    expect(result).toEqual({ ok: false, status: 502, error: "checkout_session_create_failed" });
  });

  describe("setup fee / white-glove one-time line items (GAP_REGISTER Cluster G item 5)", () => {
    // Stripe's REST API is application/x-www-form-urlencoded with
    // PHP-style bracket nesting (_shared/providers/stripe.ts's own header
    // comment), not JSON — parse the captured body back into the
    // unit_amount values across every line_items[N][price_data][unit_amount]
    // key rather than JSON.parse-ing it.
    function capturedUnitAmounts(body: string): number[] {
      const params = new URLSearchParams(body);
      const amounts: number[] = [];
      for (const [key, value] of params.entries()) {
        if (key.endsWith("[price_data][unit_amount]")) amounts.push(Number(value));
      }
      return amounts;
    }

    function lineItemCount(body: string): number {
      const params = new URLSearchParams(body);
      const indices = new Set<string>();
      for (const key of params.keys()) {
        const match = key.match(/^line_items\[(\d+)\]/);
        if (match) indices.add(match[1] as string);
      }
      return indices.size;
    }

    async function runCheckout(
      fees: Record<string, unknown> | undefined,
      body: Record<string, unknown> = VALID_BODY,
    ) {
      let capturedBody = "";
      const { sql } = makeSql({
        "platform_settings:price_card_auto": [{ value: PRICE_CARD }],
        "platform_settings:fees_auto": fees ? [{ value: fees }] : [],
        "from public.tenants t": [],
        "insert into public.tenants": [{ id: "tenant-1" }],
      });
      await handleCheckout(
        sql,
        "user-1",
        body,
        makeDeps({
          stripeFetch: (async (_url: string, init?: RequestInit) => {
            capturedBody = (init?.body as string) ?? "";
            return new Response(
              JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/cs_1" }),
              { status: 200 },
            );
          }) as never,
        }),
      );
      return capturedBody;
    }

    it("adds a mandatory setup-fee one-time line item whenever fees_<vertical>.setup_fee_enabled is true", async () => {
      const body = await runCheckout({ setup_fee_enabled: true, setup_fee_cents: 15000 });
      expect(capturedUnitAmounts(body)).toContain(15000);
    });

    it("never adds a setup-fee line item when setup_fee_enabled is false, even with a nonzero amount configured", async () => {
      const body = await runCheckout({ setup_fee_enabled: false, setup_fee_cents: 15000 });
      expect(lineItemCount(body)).toBe(2); // base + metered only
      expect(capturedUnitAmounts(body)).not.toContain(15000);
    });

    it("never adds a white-glove line item when not requested, even if enabled and configured", async () => {
      const body = await runCheckout({ white_glove_enabled: true, white_glove_fee_cents: 50000 });
      expect(lineItemCount(body)).toBe(2); // base + metered only
      expect(capturedUnitAmounts(body)).not.toContain(50000);
    });

    it("never adds a white-glove line item when requested but white_glove_enabled is false", async () => {
      const body = await runCheckout(
        { white_glove_enabled: false, white_glove_fee_cents: 50000 },
        { ...VALID_BODY, white_glove: true },
      );
      expect(capturedUnitAmounts(body)).not.toContain(50000);
    });

    it("adds both line items when both are enabled/configured and white_glove is requested", async () => {
      const body = await runCheckout(
        {
          setup_fee_enabled: true,
          setup_fee_cents: 15000,
          white_glove_enabled: true,
          white_glove_fee_cents: 50000,
        },
        { ...VALID_BODY, white_glove: true },
      );
      expect(lineItemCount(body)).toBe(4); // base + metered + setup fee + white glove
      const amounts = capturedUnitAmounts(body);
      expect(amounts).toContain(15000);
      expect(amounts).toContain(50000);
    });

    it("omits oneTimeLineItems entirely when no fees_<vertical> row exists at all", async () => {
      const body = await runCheckout(undefined);
      expect(lineItemCount(body)).toBe(2);
    });
  });
});
