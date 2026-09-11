import { describe, expect, it } from "vitest";
import { TextAgentRateLimiter } from "./rate-limit.ts";

describe("TextAgentRateLimiter", () => {
  it("allows messages under the per-window budget", () => {
    const limiter = new TextAgentRateLimiter({ maxPerWindow: 3, windowMs: 60_000 });
    expect(limiter.allow("k1")).toBe(true);
    expect(limiter.allow("k1")).toBe(true);
    expect(limiter.allow("k1")).toBe(true);
  });

  it("denies once the budget is exceeded within the window", () => {
    const limiter = new TextAgentRateLimiter({ maxPerWindow: 2, windowMs: 60_000 });
    expect(limiter.allow("k1")).toBe(true);
    expect(limiter.allow("k1")).toBe(true);
    expect(limiter.allow("k1")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = new TextAgentRateLimiter({ maxPerWindow: 1, windowMs: 60_000 });
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("a")).toBe(false);
  });

  it("resets once hits age out of the window", () => {
    let now = 0;
    const limiter = new TextAgentRateLimiter({
      maxPerWindow: 1,
      windowMs: 1000,
      clock: () => new Date(now),
    });
    expect(limiter.allow("k1")).toBe(true);
    expect(limiter.allow("k1")).toBe(false);
    now = 1500;
    expect(limiter.allow("k1")).toBe(true);
  });

  it("still records a denied hit so a sustained flood can't reset itself early", () => {
    let now = 0;
    const limiter = new TextAgentRateLimiter({
      maxPerWindow: 1,
      windowMs: 1000,
      clock: () => new Date(now),
    });
    expect(limiter.allow("k1")).toBe(true);
    now = 500;
    expect(limiter.allow("k1")).toBe(false); // denied, but still recorded
    now = 900;
    expect(limiter.allow("k1")).toBe(false); // the denied hit at 500 keeps the window full until 1500
  });
});
