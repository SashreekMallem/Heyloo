import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { createTenantBillingPortalSession } from "./handler.ts";

const logger = createLogger();

function makeSql(fixtures: Record<string, unknown[]>): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    for (const [key, rows] of Object.entries(fixtures)) {
      if (text.includes(key)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  }) as SqlClient;
  return { sql, calls };
}

function deps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return {
    fetchImpl: fetchImpl as never,
    stripeSecretKey: "sk_test_123",
    returnUrl: "https://heyloo.app/dashboard/billing",
    logger,
  };
}

const ownerRow = { "from public.memberships": [{ role: "owner" }] };

describe("createTenantBillingPortalSession (QA-1 F-12)", () => {
  it("403s for a caller who is not the tenant owner, without touching Stripe", async () => {
    const { sql } = makeSql({ "from public.memberships": [{ role: "member" }] });
    const fetchImpl = vi.fn();
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 403, error: "not_tenant_owner" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("403s when the caller has no membership row in this tenant", async () => {
    const { sql } = makeSql({});
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(vi.fn()));
    expect(result).toEqual({ ok: false, status: 403, error: "not_tenant_owner" });
  });

  it("404s when the tenant row is missing", async () => {
    const { sql } = makeSql({ ...ownerRow });
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(vi.fn()));
    expect(result).toEqual({ ok: false, status: 404, error: "not_found" });
  });

  it("409s with no_billing_account before checkout (no stripe_customer_id)", async () => {
    const { sql } = makeSql({
      ...ownerRow,
      "from public.tenants": [{ stripe_customer_id: null }],
    });
    const fetchImpl = vi.fn();
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 409, error: "no_billing_account" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a Stripe billing-portal session for THIS tenant's customer and returns its url", async () => {
    const { sql, calls } = makeSql({
      ...ownerRow,
      "from public.tenants": [{ stripe_customer_id: "cus_123" }],
    });
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "bps_1",
            object: "billing_portal.session",
            url: "https://billing.stripe.com/p/session/abc",
          }),
          { status: 200 },
        ),
    );
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(fetchImpl));
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { url: "https://billing.stripe.com/p/session/abc" },
    });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("customer")).toBe("cus_123");
    expect(form.get("return_url")).toBe("https://heyloo.app/dashboard/billing");
    // both lookups are pinned to the verified tenant / caller
    expect(calls[0]?.values).toEqual(["t1", "u1"]);
    expect(calls[1]?.values).toEqual(["t1"]);
  });

  it("502s (portal_unavailable) when Stripe rejects the request, e.g. no portal configuration saved", async () => {
    const { sql } = makeSql({
      ...ownerRow,
      "from public.tenants": [{ stripe_customer_id: "cus_123" }],
    });
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({ error: { code: "invalid_request_error", message: "config" } }),
        {
          status: 400,
        },
      );
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 502, error: "portal_unavailable" });
  });

  it("502s when Stripe answers 200 without a usable url (boundary validation)", async () => {
    const { sql } = makeSql({
      ...ownerRow,
      "from public.tenants": [{ stripe_customer_id: "cus_123" }],
    });
    const fetchImpl = async () => new Response(JSON.stringify({ id: "bps_1" }), { status: 200 });
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 502, error: "portal_unavailable" });
  });

  it("502s when the Stripe request itself throws", async () => {
    const { sql } = makeSql({
      ...ownerRow,
      "from public.tenants": [{ stripe_customer_id: "cus_123" }],
    });
    const fetchImpl = async () => {
      throw new Error("network");
    };
    const result = await createTenantBillingPortalSession(sql, "t1", "u1", deps(fetchImpl));
    expect(result).toEqual({ ok: false, status: 502, error: "portal_unavailable" });
  });
});
