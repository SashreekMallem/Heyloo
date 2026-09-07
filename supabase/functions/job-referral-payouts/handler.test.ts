import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.js";
import type { SqlClient } from "../_shared/types.js";
import { currentPeriod, runReferralPayouts } from "./handler.js";

const logger = createLogger();

function makeDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return {
    paypalFetch: fetchImpl as never,
    paypalBaseUrl: "https://api-m.sandbox.paypal.com",
    paypalClientId: "cid",
    paypalClientSecret: "secret",
    logger,
  };
}

describe("currentPeriod", () => {
  it("formats the first of the current UTC month", () => {
    expect(currentPeriod(new Date("2026-10-01T08:00:00Z"))).toBe("2026-10-01");
  });
});

describe("runReferralPayouts", () => {
  it("skips entirely when a non-failed payout already exists for this period", async () => {
    const sql = (() => Promise.resolve([{ id: "existing" }])) as SqlClient;
    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ran: false, partnersPaid: 0, partnersSkippedNoEmail: 0 });
  });

  it("does nothing (but still ran) when there is nothing accrued", async () => {
    let call = 0;
    const sql = (() => {
      call += 1;
      return Promise.resolve(call === 1 ? [] : []); // alreadyRan=false, findAccrued=[]
    }) as SqlClient;
    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(async () => new Response("{}")),
    );
    expect(result).toEqual({ ran: true, partnersPaid: 0, partnersSkippedNoEmail: 0 });
  });

  it("skips a partner missing paypal_email and pays the rest in one batch", async () => {
    const inserts: unknown[][] = [];
    let call = 0;
    const sql = ((_s: TemplateStringsArray, ...values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([]); // alreadyRan check
      if (call === 2) {
        return Promise.resolve([
          {
            referral_partner_id: "p1",
            paypal_email: "p1@example.com",
            name: "Partner 1",
            total_cents: 10000,
          },
          { referral_partner_id: "p2", paypal_email: null, name: "Partner 2", total_cents: 5000 },
        ]);
      }
      inserts.push(values);
      return Promise.resolve([]);
    }) as SqlClient;

    const fetchImpl = async (url: string) => {
      if (url.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      if (url.includes("payouts")) {
        return new Response(JSON.stringify({ batch_header: { payout_batch_id: "batch_1" } }), {
          status: 201,
        });
      }
      return new Response("{}", { status: 200 });
    };

    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(fetchImpl),
    );
    expect(result).toEqual({
      ran: true,
      batchId: "batch_1",
      partnersPaid: 1,
      partnersSkippedNoEmail: 1,
    });
    // one insert into referral_payouts + one update to commission_events for p1 only
    expect(inserts).toHaveLength(2);
  });

  it("leaves commission_events accrued (never lost) when the PayPal batch call fails", async () => {
    let call = 0;
    const sql = ((_s: TemplateStringsArray) => {
      call += 1;
      if (call === 1) return Promise.resolve([]);
      if (call === 2) {
        return Promise.resolve([
          {
            referral_partner_id: "p1",
            paypal_email: "p1@example.com",
            name: "Partner 1",
            total_cents: 10000,
          },
        ]);
      }
      return Promise.resolve([]);
    }) as SqlClient;

    const fetchImpl = async (url: string) => {
      if (url.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      return new Response("{}", { status: 500 });
    };

    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(fetchImpl),
    );
    expect(result).toEqual({ ran: true, partnersPaid: 0, partnersSkippedNoEmail: 0 });
  });

  it("does nothing when the OAuth token request fails", async () => {
    let call = 0;
    const sql = (() => {
      call += 1;
      if (call === 1) return Promise.resolve([]);
      return Promise.resolve([
        {
          referral_partner_id: "p1",
          paypal_email: "p1@example.com",
          name: "Partner 1",
          total_cents: 10000,
        },
      ]);
    }) as SqlClient;
    const fetchImpl = async () => new Response("{}", { status: 401 });
    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(fetchImpl),
    );
    expect(result).toEqual({ ran: true, partnersPaid: 0, partnersSkippedNoEmail: 0 });
  });
});
