import { describe, expect, it } from "vitest";
import { SafeFetchError } from "../safe-fetch.ts";
import {
  backoffSeconds,
  classifyError,
  classifyResponse,
  nextRetryDelaySeconds,
  parseRetryAfter,
  WEBHOOK_BACKOFF_SECONDS,
  WEBHOOK_MAX_ATTEMPTS,
} from "./policy.ts";

const NOW = new Date("2026-10-09T18:00:00.000Z");
const headers = (h: Record<string, string> = {}) => new Headers(h);
const mid = () => 0.5; // jitter factor exactly 1
const low = () => 0; // -10%
const high = () => 0.999999; // ~+10%

describe("backoff schedule", () => {
  it("is 1m, 5m, 30m, 2h, 5h, 10h, 24h after attempts 1-7, and gives up after attempt 8", () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffSeconds(n, mid))).toEqual([
      60, 300, 1800, 7200, 18000, 36000, 86400,
    ]);
    expect(backoffSeconds(8, mid)).toBeNull();
    expect(backoffSeconds(9, mid)).toBeNull();
    expect(backoffSeconds(0, mid)).toBeNull();
    expect(backoffSeconds(1.5, mid)).toBeNull();
  });

  it("adds at most +/-10% jitter", () => {
    WEBHOOK_BACKOFF_SECONDS.forEach((base, i) => {
      const lo = backoffSeconds(i + 1, low) as number;
      const hi = backoffSeconds(i + 1, high) as number;
      expect(lo).toBe(Math.round(base * 0.9));
      expect(hi).toBeLessThanOrEqual(Math.round(base * 1.1));
      expect(hi).toBeGreaterThan(base);
    });
  });

  it("adds up to about 42 hours before the final attempt", () => {
    const total = WEBHOOK_BACKOFF_SECONDS.reduce((a, b) => a + b, 0);
    expect(total / 3600).toBeCloseTo(41.6, 1);
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120);
    expect(parseRetryAfter(" 0 ", NOW)).toBe(0);
  });

  it("reads an HTTP-date relative to now, past dates as 0", () => {
    expect(parseRetryAfter("Fri, 09 Oct 2026 18:10:00 GMT", NOW)).toBe(600);
    expect(parseRetryAfter("Fri, 09 Oct 2026 17:00:00 GMT", NOW)).toBe(0);
  });

  it("caps at 24 hours", () => {
    expect(parseRetryAfter("999999", NOW)).toBe(86400);
    expect(parseRetryAfter("Sat, 31 Oct 2026 00:00:00 GMT", NOW)).toBe(86400);
  });

  it("ignores absent or malformed values", () => {
    expect(parseRetryAfter(null, NOW)).toBeNull();
    expect(parseRetryAfter("", NOW)).toBeNull();
    expect(parseRetryAfter("-5", NOW)).toBeNull();
    expect(parseRetryAfter("1.5", NOW)).toBeNull();
    expect(parseRetryAfter("soon", NOW)).toBeNull();
  });
});

describe("nextRetryDelaySeconds", () => {
  it("uses the schedule when there is no Retry-After", () => {
    expect(nextRetryDelaySeconds(1, null, mid)).toBe(60);
    expect(nextRetryDelaySeconds(3, null, mid)).toBe(1800);
  });

  it("honors a longer Retry-After but never retries sooner than the schedule", () => {
    expect(nextRetryDelaySeconds(1, 600, mid)).toBe(600);
    expect(nextRetryDelaySeconds(3, 5, mid)).toBe(1800);
    expect(nextRetryDelaySeconds(1, 0, mid)).toBe(60);
  });

  it("caps at 24 hours and returns null when the attempts are used up", () => {
    expect(nextRetryDelaySeconds(7, 86400, high)).toBe(86400);
    expect(nextRetryDelaySeconds(8, 60, mid)).toBeNull();
  });
});

describe("classifyResponse", () => {
  it("treats every 2xx as delivered", () => {
    for (const status of [200, 201, 202, 204, 299]) {
      expect(classifyResponse(status, headers(), NOW)).toEqual({
        kind: "delivered",
        statusCode: status,
      });
    }
  });

  it("treats 410 Gone as gone (disable the destination)", () => {
    expect(classifyResponse(410, headers(), NOW)).toEqual({
      kind: "gone",
      statusCode: 410,
      error: "HTTP 410: the receiving app said this address is gone",
    });
  });

  it("retries 3xx, 4xx and 5xx with short owner-safe text", () => {
    expect(classifyResponse(500, headers(), NOW)).toEqual({
      kind: "retry",
      statusCode: 500,
      error: "HTTP 500",
      retryAfterSeconds: null,
    });
    expect(classifyResponse(404, headers(), NOW)).toMatchObject({
      kind: "retry",
      error: "HTTP 404",
    });
    expect(classifyResponse(304, headers(), NOW)).toMatchObject({
      kind: "retry",
      error: "HTTP 304: the address redirects (use the final URL instead)",
    });
  });

  it("carries Retry-After on 429/503", () => {
    expect(classifyResponse(429, headers({ "retry-after": "30" }), NOW)).toEqual({
      kind: "retry",
      statusCode: 429,
      error: "HTTP 429: the receiving app is rate limiting",
      retryAfterSeconds: 30,
    });
    expect(
      classifyResponse(503, headers({ "retry-after": "Fri, 09 Oct 2026 19:00:00 GMT" }), NOW),
    ).toMatchObject({ kind: "retry", retryAfterSeconds: 3600 });
  });
});

describe("classifyError", () => {
  it.each([
    ["timeout", "Timed out after 5s"],
    ["network_error", "Could not connect"],
    ["dns_failed", "Could not find that web address"],
    ["too_many_redirects", "The address redirects (use the final URL instead)"],
    ["bad_redirect", "The address redirects (use the final URL instead)"],
    ["blocked_address", "This address isn't allowed (it must be a public https:// address)"],
    ["blocked_hostname", "This address isn't allowed (it must be a public https:// address)"],
    ["port_not_allowed", "This address isn't allowed (it must be a public https:// address)"],
    ["content_type_not_allowed", "Unexpected response from the receiving app"],
  ] as const)("%s -> %s", (code, error) => {
    expect(classifyError(new SafeFetchError(code, "internal detail"))).toEqual({
      kind: "retry",
      statusCode: null,
      error,
      retryAfterSeconds: null,
    });
  });

  it("never leaks a raw exception message", () => {
    const outcome = classifyError(new Error("ECONNREFUSED 10.0.0.5:443 secret-ish detail"));
    expect(outcome).toEqual({
      kind: "retry",
      statusCode: null,
      error: "Could not connect",
      retryAfterSeconds: null,
    });
  });

  it("names the configured timeout", () => {
    expect(classifyError(new SafeFetchError("timeout"), 8000)).toMatchObject({
      error: "Timed out after 8s",
    });
  });
});
