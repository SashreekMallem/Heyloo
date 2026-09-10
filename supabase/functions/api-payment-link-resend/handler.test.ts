import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import { resendPaymentLink } from "./handler.ts";

const logger = createLogger();

function makeDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return {
    fetchImpl: fetchImpl as never,
    stripeSecretKey: "sk_test_123",
    successUrl: "https://heyloo.app/pay/success",
    cancelUrl: "https://heyloo.app/pay/cancelled",
    logger,
  };
}

function sqlSequence(results: unknown[][]): SqlClient {
  let call = 0;
  return (() => {
    const result = results[call] ?? [];
    call += 1;
    return Promise.resolve(result);
  }) as SqlClient;
}

describe("resendPaymentLink", () => {
  it("returns 404 when the payment link doesn't belong to this tenant", async () => {
    const sql = sqlSequence([[]]);
    const result = await resendPaymentLink(
      sql,
      "t1",
      "pl1",
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 404, error: "not_found" });
  });

  it("returns 409 when the link is already paid", async () => {
    const sql = sqlSequence([
      [
        {
          id: "pl1",
          order_id: "o1",
          booking_id: null,
          amount_cents: 5000,
          purpose: "order",
          status: "paid",
          recipient_phone: "+15551234567",
        },
      ],
    ]);
    const result = await resendPaymentLink(
      sql,
      "t1",
      "pl1",
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 409, error: "already_paid" });
  });

  it("returns 422 when no linked customer phone can be resolved", async () => {
    const sql = sqlSequence([
      [
        {
          id: "pl1",
          order_id: "o1",
          booking_id: null,
          amount_cents: 5000,
          purpose: "order",
          status: "pending",
          recipient_phone: null,
        },
      ],
    ]);
    const result = await resendPaymentLink(
      sql,
      "t1",
      "pl1",
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ok: false, status: 422, error: "no_recipient_phone" });
  });

  it("returns 502 on a Stripe error and never writes a message", async () => {
    const sql = sqlSequence([
      [
        {
          id: "pl1",
          order_id: "o1",
          booking_id: null,
          amount_cents: 5000,
          purpose: "order",
          status: "pending",
          recipient_phone: "+15551234567",
        },
      ],
    ]);
    const result = await resendPaymentLink(
      sql,
      "t1",
      "pl1",
      makeDeps(async () => new Response("{}", { status: 500 })),
    );
    expect(result).toEqual({ ok: false, status: 502, error: "stripe_error" });
  });

  it("mints a fresh Checkout Session, updates the link, and enqueues the SMS", async () => {
    const sql = sqlSequence([
      [
        {
          id: "pl1",
          order_id: "o1",
          booking_id: null,
          amount_cents: 5000,
          purpose: "order",
          status: "pending",
          recipient_phone: "+15551234567",
        },
      ],
      [], // update payment_links
      [{ id: "msg1" }], // insert messages_outbound
      [], // pgmq.send
    ]);
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          id: "cs_new_123",
          url: "https://checkout.stripe.com/pay/cs_new_123",
          expires_at: 1893456000,
        }),
        { status: 200 },
      );
    const result = await resendPaymentLink(sql, "t1", "pl1", makeDeps(fetchImpl));
    expect(result).toEqual({ ok: true, status: 200, body: { resent: true } });
  });
});
