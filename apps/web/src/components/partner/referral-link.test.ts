import { describe, expect, it } from "vitest";
import { buildReferralLink, requestOrigin, summarizeEarnings } from "./referral-link";

const h = (entries: Record<string, string>) => ({
  get: (name: string) => entries[name.toLowerCase()] ?? null,
});

describe("buildReferralLink (PT-06)", () => {
  it("is an absolute signup URL carrying the code", () => {
    expect(buildReferralLink("https://heyloo.app", "ABCD2345")).toBe(
      "https://heyloo.app/signup?ref=ABCD2345",
    );
  });

  it("does not double the slash when the origin has a trailing one", () => {
    expect(buildReferralLink("https://heyloo.app/", "X1")).toBe("https://heyloo.app/signup?ref=X1");
  });
});

describe("requestOrigin", () => {
  it("prefers the forwarded host and proto", () => {
    expect(
      requestOrigin(
        h({ "x-forwarded-host": "heyloo.app", "x-forwarded-proto": "https", host: "internal:3000" }),
        "http://fallback",
      ),
    ).toBe("https://heyloo.app");
  });

  it("uses http for localhost and https for everything else when no proto header is set", () => {
    expect(requestOrigin(h({ host: "localhost:3000" }), "x")).toBe("http://localhost:3000");
    expect(requestOrigin(h({ host: "heyloo.app" }), "x")).toBe("https://heyloo.app");
  });

  it("falls back to the configured app URL with no host at all", () => {
    expect(requestOrigin(h({}), "https://configured.example")).toBe("https://configured.example");
  });
});

describe("summarizeEarnings (PT-06)", () => {
  it("splits paid from accrued/batched and ignores clawed-back commissions", () => {
    expect(
      summarizeEarnings([
        { amount_cents: 1500, status: "paid" },
        { amount_cents: 2500, status: "paid" },
        { amount_cents: 700, status: "accrued" },
        { amount_cents: 300, status: "batched" },
        { amount_cents: 9999, status: "clawed_back" },
      ]),
    ).toEqual({ paidCents: 4000, pendingCents: 1000 });
  });

  it("is zero with no rows", () => {
    expect(summarizeEarnings([])).toEqual({ paidCents: 0, pendingCents: 0 });
  });
});
