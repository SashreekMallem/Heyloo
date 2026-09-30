import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleBillingPortal } from "./handler.ts";

const logger = createLogger();
const TENANT = "11111111-1111-1111-1111-111111111111";
const OTHER_TENANT = "22222222-2222-2222-2222-222222222222";

function makeSql(rows: unknown[]): {
  sql: SqlClient;
  calls: { text: string; values: unknown[] }[];
} {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    return Promise.resolve(rows);
  }) as SqlClient;
  return { sql, calls };
}

function makeDeps(stripe?: () => Response) {
  const stripeFetch = vi.fn(
    async () =>
      stripe?.() ??
      new Response(JSON.stringify({ id: "bps_1", url: "https://billing.stripe.com/p/session/x" }), {
        status: 200,
      }),
  );
  return {
    stripeFetch: stripeFetch as never,
    calls: stripeFetch,
    deps: {
      stripeFetch: stripeFetch as never,
      stripeSecretKey: "sk_test",
      appBaseUrl: "https://app.example/",
      logger,
    },
  };
}

describe("handleBillingPortal", () => {
  it("returns the Stripe portal url for an owner, with a return url to the billing page", async () => {
    const { sql } = makeSql([{ tenant_id: TENANT, role: "owner", stripe_customer_id: "cus_1" }]);
    const { deps, calls } = makeDeps();
    const result = await handleBillingPortal(sql, "user_1", { tenant_id: TENANT }, deps);
    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { url: "https://billing.stripe.com/p/session/x" },
    });
    const [url, init] = calls.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/billing_portal/sessions");
    const form = new URLSearchParams(String(init.body));
    expect(form.get("customer")).toBe("cus_1");
    expect(form.get("return_url")).toBe("https://app.example/dashboard/billing");
  });

  it("refuses a caller with no owner/admin membership (a plain member) and never calls Stripe", async () => {
    const { sql, calls } = makeSql([]);
    const { deps, calls: stripeCalls } = makeDeps();
    const result = await handleBillingPortal(sql, "member_1", { tenant_id: TENANT }, deps);
    expect(result).toEqual({ ok: false, status: 403, error: "forbidden" });
    expect(stripeCalls).not.toHaveBeenCalled();
    // role gate is in the query itself
    expect(calls[0]?.text).toContain("m.role in ('owner', 'admin')");
  });

  it("scopes the lookup to the caller's own user id and never trusts the body for the customer", async () => {
    const { sql, calls } = makeSql([
      { tenant_id: TENANT, role: "admin", stripe_customer_id: "cus_1" },
    ]);
    const { deps } = makeDeps();
    await handleBillingPortal(
      sql,
      "user_1",
      { tenant_id: OTHER_TENANT, customer: "cus_evil" },
      deps,
    );
    expect(calls[0]?.values).toContain("user_1");
    expect(calls[0]?.text).toContain("m.user_id =");
    expect(calls[0]?.text).toContain("m.tenant_id =");
  });

  it("rejects a non-uuid tenant_id with 400 before any query", async () => {
    const { sql, calls } = makeSql([]);
    const { deps } = makeDeps();
    const result = await handleBillingPortal(sql, "user_1", { tenant_id: "nope" }, deps);
    expect(result).toEqual({ ok: false, status: 400, error: "invalid_request" });
    expect(calls).toHaveLength(0);
  });

  it("answers 409 when the tenant has no Stripe customer yet", async () => {
    const { sql } = makeSql([{ tenant_id: TENANT, role: "owner", stripe_customer_id: null }]);
    const { deps, calls } = makeDeps();
    const result = await handleBillingPortal(sql, "user_1", {}, deps);
    expect(result).toEqual({ ok: false, status: 409, error: "no_billing_account" });
    expect(calls).not.toHaveBeenCalled();
  });

  it("answers 502 when Stripe refuses the portal session", async () => {
    const { sql } = makeSql([{ tenant_id: TENANT, role: "owner", stripe_customer_id: "cus_1" }]);
    const { deps } = makeDeps(() => new Response(JSON.stringify({ error: {} }), { status: 400 }));
    const result = await handleBillingPortal(sql, "user_1", {}, deps);
    expect(result).toEqual({ ok: false, status: 502, error: "portal_unavailable" });
  });
});
