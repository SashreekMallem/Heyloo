import { describe, expect, it, vi } from "vitest";
import { createFetchBalanceTransaction } from "./balance-transaction.ts";
import { invoicePeriod, parseInvoice } from "./billing.ts";
import { invoiceObject, SUBSCRIPTION_ID, T0, T1, TENANT_ID, isoDay } from "./stripe-fixtures.ts";

describe("parseInvoice", () => {
  it("reads the current (basil) shape: parent.subscription_details.{subscription,metadata}, lines period, cents", () => {
    const facts = parseInvoice(invoiceObject({ discountCents: 500, total: 29_400 }));
    expect(facts).toMatchObject({
      invoiceId: "in_1TestSignup1",
      customerId: "cus_TestSignup1",
      subscriptionId: SUBSCRIPTION_ID,
      metadataTenantIds: [TENANT_ID],
      periodStart: isoDay(T0),
      periodEnd: isoDay(T1),
      amountPaidCents: 29_400,
      totalCents: 29_400,
      discountCents: 500,
      currency: "usd",
    });
  });

  it("also reads the pre-basil shape (top-level subscription + subscription_details.metadata)", () => {
    const legacy = invoiceObject();
    legacy["parent"] = null;
    legacy["subscription"] = "sub_legacy";
    legacy["subscription_details"] = { metadata: { tenant_id: TENANT_ID } };
    const facts = parseInvoice(legacy);
    expect(facts?.subscriptionId).toBe("sub_legacy");
    expect(facts?.metadataTenantIds).toContain(TENANT_ID);
  });

  it("ignores a tenant_id that is not a uuid (never reaches a ::uuid cast)", () => {
    const bad = invoiceObject({ tenantId: null });
    (bad["metadata"] as Record<string, string>)["tenant_id"] = "not-a-uuid'; drop table";
    expect(parseInvoice(bad)?.metadataTenantIds).toEqual([]);
  });

  it("falls back to the invoice-level period when there are no lines", () => {
    const inv = invoiceObject();
    inv["lines"] = { object: "list", data: [] };
    expect(invoicePeriod(inv)).toEqual({ start: isoDay(T0), end: isoDay(T1) });
  });

  it("returns null when the payload has no id or no period (not a usable invoice)", () => {
    expect(parseInvoice({ id: "in_x" })).toBeNull();
    expect(parseInvoice({ customer: "cus_1" })).toBeNull();
  });
});

describe("createFetchBalanceTransaction", () => {
  it("is undefined without a Stripe secret key (caller defers instead of guessing a fee)", () => {
    expect(createFetchBalanceTransaction({ secretKey: undefined })).toBeUndefined();
  });

  it("GETs /v1/balance_transactions/{id} and returns integer fee/net", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "txn_1", fee: 897, net: 29_003, currency: "usd" }), { status: 200 }),
    );
    const fetchFee = createFetchBalanceTransaction({ secretKey: "sk_test_x", fetchImpl });
    await expect(fetchFee?.("txn_1")).resolves.toEqual({ feeCents: 897, netCents: 29_003, currency: "usd" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/balance_transactions/txn_1");
    expect(init.method).toBe("GET");
  });

  it("returns null on a Stripe error, a non-integer fee, or a network failure", async () => {
    const make = (impl: () => Promise<Response>) =>
      createFetchBalanceTransaction({ secretKey: "sk_test_x", fetchImpl: impl as never });
    await expect(make(async () => new Response("{}", { status: 404 }))?.("txn_1")).resolves.toBeNull();
    await expect(
      make(async () => new Response(JSON.stringify({ fee: 8.97, net: 1 }), { status: 200 }))?.("txn_1"),
    ).resolves.toBeNull();
    await expect(
      make(async () => {
        throw new Error("network");
      })?.("txn_1"),
    ).resolves.toBeNull();
  });
});
