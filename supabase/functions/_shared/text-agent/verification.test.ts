import { describe, expect, it } from "vitest";
import {
  checkVerificationCode,
  createPendingVerification,
  generateVerificationCode,
  looksLikeVerificationCode,
  normalizeCandidateCode,
} from "./verification.ts";

describe("generateVerificationCode", () => {
  it("produces a 6-digit zero-padded code", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateVerificationCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe("checkVerificationCode", () => {
  it("matches the correct code before expiry", async () => {
    const pending = await createPendingVerification("123456", 60_000);
    const ok = await checkVerificationCode({
      candidate: "123456",
      codeHash: pending.codeHash,
      expiresAtIso: pending.expiresAtIso,
    });
    expect(ok).toBe(true);
  });

  it("rejects a wrong code", async () => {
    const pending = await createPendingVerification("123456", 60_000);
    const ok = await checkVerificationCode({
      candidate: "999999",
      codeHash: pending.codeHash,
      expiresAtIso: pending.expiresAtIso,
    });
    expect(ok).toBe(false);
  });

  it("rejects an expired code even if correct", async () => {
    const pending = await createPendingVerification("123456", -1000);
    const ok = await checkVerificationCode({
      candidate: "123456",
      codeHash: pending.codeHash,
      expiresAtIso: pending.expiresAtIso,
    });
    expect(ok).toBe(false);
  });
});

describe("looksLikeVerificationCode", () => {
  it("recognizes plain digit strings", () => {
    expect(looksLikeVerificationCode("123456")).toBe(true);
  });

  it("recognizes spaced/dashed digit groups", () => {
    expect(looksLikeVerificationCode("123 456")).toBe(true);
    expect(looksLikeVerificationCode("123-456")).toBe(true);
  });

  it("rejects ordinary conversational text", () => {
    expect(looksLikeVerificationCode("what time do you open")).toBe(false);
    expect(looksLikeVerificationCode("call me at 5551234567")).toBe(false);
  });
});

describe("normalizeCandidateCode", () => {
  it("strips spaces and dashes", () => {
    expect(normalizeCandidateCode("123 - 456")).toBe("123456");
  });
});
