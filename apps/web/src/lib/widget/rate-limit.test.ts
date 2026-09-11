import { describe, expect, it } from "vitest";
import { clientIpFromRequest, SlidingWindowRateLimiter } from "./rate-limit";

describe("SlidingWindowRateLimiter", () => {
  it("allows up to the configured max within a window, then denies", () => {
    const now = 0;
    const limiter = new SlidingWindowRateLimiter(1_000, 3, () => now);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
  });

  it("recovers once the window slides past the earlier hits", () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter(1_000, 2, () => now);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
    now = 1_001;
    expect(limiter.allow("k")).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const now = 0;
    const limiter = new SlidingWindowRateLimiter(1_000, 1, () => now);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });
});

describe("clientIpFromRequest", () => {
  it("prefers the first x-forwarded-for entry", () => {
    const req = new Request("https://x.example", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientIpFromRequest(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(
      clientIpFromRequest(
        new Request("https://x.example", { headers: { "x-real-ip": "9.9.9.9" } }),
      ),
    ).toBe("9.9.9.9");
    expect(clientIpFromRequest(new Request("https://x.example"))).toBe("unknown");
  });
});
