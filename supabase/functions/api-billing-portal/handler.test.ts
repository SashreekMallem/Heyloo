import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { handleBillingPortal } from "./handler.ts";

const logger = createLogger();

function makeSql(rows: unknown[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join(" "), values });
    return Promise.resolve(rows);
  }) as SqlClient;
  return { sql, calls };
}

function makeDeps(status = 200, body: unknown = { url: "https://billing.stripe.com/p/session_1" }) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  return {
    requests,
    deps: {
      stripeFetch: ((url: string, init?: RequestInit) => {
        requests.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
        return Promise.resolve(new Response(JSON.stringify(body), { status }));
      }) as never,
      stripeSecretKey: "sk_test",
      returnUrl: "https://heyloo.app/dashboard/billing",
      logger,
    },
  };
}

describe("handleBillingPortal (BILL-9)", () => {
  it("returns a portal URL for the tenant's own Stripe customer", async () => {
    const { sql, calls } = makeSql([{ stripe_customer_id: "cus_1" }]);
    const { deps, requests } = makeDeps();
    const result = await handleBillingPortal(sql, "user-1", "tenant-1", deps);
    expect(result).toEqual({ ok: true, url: "https://billing.stripe.com/p/session_1" });
    expect(requests[0]?.url).toContain("/billing_portal/sessions");
    expect(requests[0]?.body.get("customer")).toBe("cus_1");
    expect(requests[0]?.body.get("return_url")).toBe("https://heyloo.app/dashboard/billing");
    // scoped by the verified tenant AND an owner/admin membership of the caller
    expect(calls[0]?.values).toEqual(["tenant-1", "user-1"]);
    expect(calls[0]?.text).toContain("m.role in ('owner', 'admin')");
  });

  it("refuses a caller that is not an owner/admin of the tenant, without calling Stripe", async () => {
    const { sql } = makeSql([]);
    const { deps, requests } = makeDeps();
    expect(await handleBillingPortal(sql, "user-1", "tenant-1", deps)).toEqual({
      ok: false,
      status: 403,
      error: "forbidden",
    });
    expect(requests).toHaveLength(0);
  });

  it("409 when the tenant has no Stripe customer yet", async () => {
    const { sql } = makeSql([{ stripe_customer_id: null }]);
    const { deps, requests } = makeDeps();
    expect(await handleBillingPortal(sql, "user-1", "tenant-1", deps)).toEqual({
      ok: false,
      status: 409,
      error: "no_billing_account",
    });
    expect(requests).toHaveLength(0);
  });

  it("502 portal_unavailable when Stripe rejects the session (e.g. no portal configuration saved)", async () => {
    const { sql } = makeSql([{ stripe_customer_id: "cus_1" }]);
    const { deps } = makeDeps(400, { error: { message: "no configuration" } });
    expect(await handleBillingPortal(sql, "user-1", "tenant-1", deps)).toEqual({
      ok: false,
      status: 502,
      error: "portal_unavailable",
    });
  });
});
