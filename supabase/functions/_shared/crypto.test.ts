import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hmacSha1Base64,
  hmacSha256Hex,
  randomOpaqueToken,
  sha256Hex,
  timingSafeEqual,
  toHex,
} from "./crypto.ts";

// Exactly 32 raw bytes each, base64-encoded — fixed test keys only, never a
// real secret.
const TEST_KEY_B64 = btoa("abcdefghijklmnopqrstuvwxyz012345");
const OTHER_KEY_B64 = btoa("ZYXWVUTSRQPONMLKJIHGFEDCBA987654");

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

describe("encryptSecret / decryptSecret (DB-H2 adapter_connections token encryption)", () => {
  it("round-trips a plaintext token through encrypt then decrypt", async () => {
    const plaintext = "square_access_token_abc123";
    const ciphertext = await encryptSecret(plaintext, TEST_KEY_B64);
    expect(ciphertext).not.toBe(plaintext);
    expect(ciphertext.startsWith("v1:")).toBe(true);
    const decrypted = await decryptSecret(ciphertext, TEST_KEY_B64);
    expect(decrypted).toBe(plaintext);
  });

  it("produces a different ciphertext for the same plaintext each call (random IV)", async () => {
    const a = await encryptSecret("same-token", TEST_KEY_B64);
    const b = await encryptSecret("same-token", TEST_KEY_B64);
    expect(a).not.toBe(b);
  });

  it("tolerates a legacy plaintext value with no version prefix, returning it unchanged", async () => {
    const legacy = "pre-encryption-plaintext-token";
    expect(await decryptSecret(legacy, TEST_KEY_B64)).toBe(legacy);
  });

  it("fails closed (throws) when decrypting with the wrong key", async () => {
    const ciphertext = await encryptSecret("secret-value", TEST_KEY_B64);
    await expect(decryptSecret(ciphertext, OTHER_KEY_B64)).rejects.toThrow();
  });

  it("rejects an encryption key that isn't exactly 32 raw bytes", async () => {
    await expect(encryptSecret("value", btoa("too-short-key"))).rejects.toThrow(
      "adapter_token_encryption_key_invalid_length",
    );
  });

  it("throws on a malformed v1-prefixed value instead of silently returning garbage", async () => {
    await expect(decryptSecret("v1:no-separator-here", TEST_KEY_B64)).rejects.toThrow(
      "adapter_token_ciphertext_malformed",
    );
  });
});

describe("sha256Hex (api_tokens.token_hash / single-use intake tokens)", () => {
  it("matches the well-known SHA-256 test vector for the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic and sensitive to any input change", async () => {
    const a = await sha256Hex("token-abc");
    const b = await sha256Hex("token-abc");
    const c = await sha256Hex("token-abd");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("randomOpaqueToken", () => {
  it("returns a URL-safe string (no +, /, or = padding) with no two calls colliding", () => {
    const a = randomOpaqueToken();
    const b = randomOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(30);
  });

  it("respects a custom byte length", () => {
    const short = randomOpaqueToken(8);
    const long = randomOpaqueToken(64);
    expect(short.length).toBeLessThan(long.length);
  });
});
