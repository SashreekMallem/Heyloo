import { describe, expect, it } from "vitest";
import { createLogger } from "../_shared/logger.ts";
import type { SqlClient } from "../_shared/types.ts";
import {
  currentPeriod,
  requiresW9Hold,
  runReferralPayouts,
  W9_THRESHOLD_CENTS,
} from "./handler.ts";

const logger = createLogger();

function makeDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
  return {
    paypalFetch: fetchImpl as never,
    paypalBaseUrl: "https://api.sandbox.paypal.com",
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
    expect(result).toEqual({
      ran: false,
      partnersPaid: 0,
      partnersSkippedNoEmail: 0,
      partnersHeldNoW9: 0,
    });
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
    expect(result).toEqual({
      ran: true,
      partnersPaid: 0,
      partnersSkippedNoEmail: 0,
      partnersHeldNoW9: 0,
    });
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
      partnersHeldNoW9: 0,
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
    expect(result).toEqual({
      ran: true,
      partnersPaid: 0,
      partnersSkippedNoEmail: 0,
      partnersHeldNoW9: 0,
    });
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
    expect(result).toEqual({
      ran: true,
      partnersPaid: 0,
      partnersSkippedNoEmail: 0,
      partnersHeldNoW9: 0,
    });
  });
});

describe("W-9 hold (PT-04)", () => {
  const base = { referral_partner_id: "p", paypal_email: "p@example.com", name: "P" };

  it("requiresW9Hold: only when YTD plus this batch reaches $600 and the W-9 is not verified", () => {
    expect(W9_THRESHOLD_CENTS).toBe(60000);
    expect(
      requiresW9Hold({
        ...base,
        total_cents: 10000,
        w9_status: "not_submitted",
        ytd_payout_cents: 0,
      }),
    ).toBe(false);
    expect(
      requiresW9Hold({
        ...base,
        total_cents: 10000,
        w9_status: "not_submitted",
        ytd_payout_cents: 50000,
      }),
    ).toBe(true);
    expect(
      requiresW9Hold({ ...base, total_cents: 60000, w9_status: "submitted", ytd_payout_cents: 0 }),
    ).toBe(true);
    expect(
      requiresW9Hold({
        ...base,
        total_cents: 59999,
        w9_status: "not_submitted",
        ytd_payout_cents: 0,
      }),
    ).toBe(false);
    expect(
      requiresW9Hold({
        ...base,
        total_cents: 90000,
        w9_status: "verified",
        ytd_payout_cents: 90000,
      }),
    ).toBe(false);
    // Missing columns behave like a brand-new partner: no hold below the threshold.
    expect(requiresW9Hold({ ...base, total_cents: 5000 })).toBe(false);
  });

  it("holds an unverified partner past the threshold, leaves their commissions accrued, and pays the others", async () => {
    const writes: string[] = [];
    let call = 0;
    const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      call += 1;
      if (call === 1) return Promise.resolve([]); // alreadyRan
      if (call === 2) {
        return Promise.resolve([
          {
            ...base,
            referral_partner_id: "held",
            total_cents: 20000,
            w9_status: "not_submitted",
            ytd_payout_cents: 55000,
          },
          {
            ...base,
            referral_partner_id: "verified",
            total_cents: 20000,
            w9_status: "verified",
            ytd_payout_cents: 55000,
          },
          {
            ...base,
            referral_partner_id: "small",
            total_cents: 5000,
            w9_status: "not_submitted",
            ytd_payout_cents: 0,
          },
        ]);
      }
      writes.push(`${strings.join("?")}|${String(values[0])}`);
      return Promise.resolve([]);
    }) as SqlClient;

    let batchBody = "";
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2/token")) {
        return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
      }
      batchBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ batch_header: { payout_batch_id: "batch_1" } }), {
        status: 201,
      });
    };

    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(fetchImpl),
    );
    expect(result).toEqual({
      ran: true,
      batchId: "batch_1",
      partnersPaid: 2,
      partnersSkippedNoEmail: 0,
      partnersHeldNoW9: 1,
    });
    expect(batchBody).not.toContain('"held"');
    expect(batchBody).toContain("verified");
    expect(batchBody).toContain("small");
    expect(writes.some((w) => w.endsWith("|held"))).toBe(false);
  });

  it("pays nothing and reports the hold when the only accrued partner is held", async () => {
    let call = 0;
    const sql = (() => {
      call += 1;
      if (call === 1) return Promise.resolve([]);
      return Promise.resolve([
        { ...base, total_cents: 70000, w9_status: "not_submitted", ytd_payout_cents: 0 },
      ]);
    }) as SqlClient;
    let fetched = false;
    const result = await runReferralPayouts(
      sql,
      new Date("2026-10-01T08:00:00Z"),
      makeDeps(async () => {
        fetched = true;
        return new Response("{}");
      }),
    );
    expect(result).toEqual({
      ran: true,
      partnersPaid: 0,
      partnersSkippedNoEmail: 0,
      partnersHeldNoW9: 1,
    });
    expect(fetched).toBe(false);
  });
});
