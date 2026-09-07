import { describe, expect, it } from "vitest";
import { ToolCircuitBreaker } from "./circuit-breaker.js";

function makeBreaker(
  startMs: number,
  overrides: Partial<ConstructorParameters<typeof ToolCircuitBreaker>[0]> = {},
) {
  let now = startMs;
  const breaker = new ToolCircuitBreaker({
    windowMs: 60_000,
    errorRateThreshold: 0.2,
    minSamples: 5,
    cooldownMs: 30_000,
    clock: () => new Date(now),
    ...overrides,
  });
  return {
    breaker,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("ToolCircuitBreaker", () => {
  it("stays closed below the minimum sample count regardless of error rate", () => {
    const { breaker } = makeBreaker(0);
    breaker.recordFailure("create_booking");
    breaker.recordFailure("create_booking");
    expect(breaker.isOpen("create_booking")).toBe(false);
  });

  it("opens once the error rate crosses the threshold with enough samples", () => {
    const { breaker } = makeBreaker(0);
    // 2/5 = 40% >= 20% threshold, and minSamples (5) reached.
    breaker.recordFailure("create_booking");
    breaker.recordSuccess("create_booking");
    breaker.recordFailure("create_booking");
    breaker.recordSuccess("create_booking");
    breaker.recordSuccess("create_booking");
    expect(breaker.isOpen("create_booking")).toBe(true);
  });

  it("stays closed when error rate is under threshold even with enough samples", () => {
    const { breaker } = makeBreaker(0);
    // 1/6 ~ 16.7% < 20%
    breaker.recordFailure("check_availability");
    for (let i = 0; i < 5; i++) breaker.recordSuccess("check_availability");
    expect(breaker.isOpen("check_availability")).toBe(false);
  });

  it("tracks each tool's state independently", () => {
    const { breaker } = makeBreaker(0);
    for (let i = 0; i < 5; i++) breaker.recordFailure("send_payment_link");
    expect(breaker.isOpen("send_payment_link")).toBe(true);
    expect(breaker.isOpen("check_availability")).toBe(false);
  });

  it("closes again (half-open) after the cooldown window elapses", () => {
    const { breaker, advance } = makeBreaker(0, { cooldownMs: 1_000 });
    for (let i = 0; i < 5; i++) breaker.recordFailure("cancel_booking");
    expect(breaker.isOpen("cancel_booking")).toBe(true);
    advance(1_001);
    expect(breaker.isOpen("cancel_booking")).toBe(false);
  });

  it("prunes events outside the rolling window so old failures don't linger forever", () => {
    // 3 failures alone don't cross minSamples (5), so the circuit never
    // opens from them — isolating this test to whether pruning itself
    // works, independent of the open/cooldown state machine covered above.
    const { breaker, advance } = makeBreaker(0, { windowMs: 10_000, minSamples: 5 });
    breaker.recordFailure("lookup_customer");
    breaker.recordFailure("lookup_customer");
    breaker.recordFailure("lookup_customer");
    advance(10_001); // outside the 10s window now
    breaker.recordSuccess("lookup_customer");
    breaker.recordSuccess("lookup_customer");
    // Only the 2 in-window successes should remain — the 3 stale failures
    // must have been pruned, not just ignored by the minSamples gate.
    const stats = breaker.getStats("lookup_customer");
    expect(stats.count).toBe(2);
    expect(stats.errors).toBe(0);
    expect(breaker.isOpen("lookup_customer")).toBe(false);
  });

  it("getStats reports count/errors/errorRate/open consistently", () => {
    const { breaker } = makeBreaker(0);
    breaker.recordFailure("take_message");
    breaker.recordSuccess("take_message");
    const stats = breaker.getStats("take_message");
    expect(stats.count).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.errorRate).toBeCloseTo(0.5);
    expect(stats.open).toBe(false);
  });
});
