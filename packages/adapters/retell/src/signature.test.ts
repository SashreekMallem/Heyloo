import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNATURE_TOLERANCE_MS, verifyRetellWebhookSignature } from "./signature.js";

const API_KEY = "test-api-key-abc123";

function sign(rawBody: string, apiKey: string, timestampMs: number): string {
  const digest = createHmac("sha256", apiKey)
    .update(rawBody + String(timestampMs), "utf8")
    .digest("hex");
  return `v=${timestampMs},d=${digest}`;
}

describe("verifyRetellWebhookSignature", () => {
  it("accepts a correctly-signed, fresh request", () => {
    const rawBody = JSON.stringify({ call_id: "call_1" });
    const header = sign(rawBody, API_KEY, Date.now());
    expect(
      verifyRetellWebhookSignature({ rawBody, signatureHeader: header, apiKey: API_KEY }),
    ).toEqual({
      valid: true,
    });
  });

  it("rejects a missing header (fail closed)", () => {
    const result = verifyRetellWebhookSignature({
      rawBody: "{}",
      signatureHeader: null,
      apiKey: API_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("rejects a malformed header", () => {
    const result = verifyRetellWebhookSignature({
      rawBody: "{}",
      signatureHeader: "not-a-valid-header",
      apiKey: API_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "malformed_header" });
  });

  it("rejects a header with a non-hex or wrong-length digest", () => {
    const result = verifyRetellWebhookSignature({
      rawBody: "{}",
      signatureHeader: "v=1700000000000,d=deadbeef",
      apiKey: API_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "malformed_header" });
  });

  it("rejects a stale timestamp outside the replay window", () => {
    const rawBody = "{}";
    const staleTimestamp = Date.now() - (DEFAULT_SIGNATURE_TOLERANCE_MS + 60_000);
    const header = sign(rawBody, API_KEY, staleTimestamp);
    const result = verifyRetellWebhookSignature({
      rawBody,
      signatureHeader: header,
      apiKey: API_KEY,
    });
    expect(result).toEqual({ valid: false, reason: "stale_timestamp" });
  });

  it("accepts a custom tolerance window", () => {
    const rawBody = "{}";
    const timestamp = Date.now() - 10 * 60 * 1000; // 10 minutes old
    const header = sign(rawBody, API_KEY, timestamp);
    expect(
      verifyRetellWebhookSignature({
        rawBody,
        signatureHeader: header,
        apiKey: API_KEY,
        toleranceMs: 15 * 60 * 1000,
      }),
    ).toEqual({ valid: true });
  });

  it("rejects a digest signed with the wrong key", () => {
    const rawBody = "{}";
    const header = sign(rawBody, "wrong-key", Date.now());
    expect(
      verifyRetellWebhookSignature({ rawBody, signatureHeader: header, apiKey: API_KEY }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });

  it("rejects when the raw body has been tampered with after signing", () => {
    const original = JSON.stringify({ amount: 100 });
    const header = sign(original, API_KEY, Date.now());
    const tampered = JSON.stringify({ amount: 100000 });
    expect(
      verifyRetellWebhookSignature({ rawBody: tampered, signatureHeader: header, apiKey: API_KEY }),
    ).toEqual({ valid: false, reason: "signature_mismatch" });
  });
});
