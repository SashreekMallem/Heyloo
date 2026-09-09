import { describe, expect, it } from "vitest";
import { hmacSha1Base64, hmacSha256Hex, timingSafeEqual, toHex } from "./crypto.ts";

describe("hmacSha256Hex", () => {
  it("matches the well-known HMAC-SHA256 test vector (RFC 4231 #2)", async () => {
    // key = "Jefe", data = "what do ya want for nothing?"
    const digest = await hmacSha256Hex("Jefe", "what do ya want for nothing?");
    expect(digest).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
  });

  it("is deterministic and sensitive to any input change", async () => {
    const a = await hmacSha256Hex("secret", "message");
    const b = await hmacSha256Hex("secret", "message");
    const c = await hmacSha256Hex("secret", "message!");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("hmacSha1Base64", () => {
  it("matches the well-known HMAC-SHA1 test vector (RFC 2202 #2)", async () => {
    const digest = await hmacSha1Base64("Jefe", "what do ya want for nothing?");
    // RFC 2202 test case 2 hex digest is effcdf6ae5eb2fa2d27416d5f184df9c259a7c79;
    // base64 of those bytes, precomputed, is asserted directly below.
    expect(digest).toBe("7/zfauXrL6LSdBbV8YTfnCWafHk=");
  });
});

describe("toHex", () => {
  it("renders bytes as zero-padded lowercase hex", () => {
    const buf = new Uint8Array([0, 15, 255]).buffer;
    expect(toHex(buf)).toBe("000fff");
  });
});

describe("timingSafeEqual", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for a single differing character", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("returns false for different-length strings without throwing", () => {
    expect(timingSafeEqual("short", "much-longer-string")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
