import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./crypto.js";
import { verifyRetellSignature } from "./retell-signature.js";

const SECRET = "test-retell-api-key";
const BODY = JSON.stringify({ event: "call_started", call: { call_id: "call_123" } });

async function buildHeader(body: string, secret: string, timestampMs: number): Promise<string> {
  const digest = await hmacSha256Hex(secret, body + String(timestampMs));
  return `v=${timestampMs},d=${digest}`;
}

describe("verifyRetellSignature", () => {
  it("accepts a validly-signed, fresh request", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const header = await buildHeader(BODY, SECRET, now.getTime());
    const result = await verifyRetellSignature({ rawBody: BODY, header, secret: SECRET, now });
    expect(result).toEqual({ valid: true });
  });

  it("rejects when the secret is missing (fail closed)", async () => {
    const now = new Date();
    const header = await buildHeader(BODY, SECRET, now.getTime());
    const result = await verifyRetellSignature({
      rawBody: BODY,
      header,
      secret: undefined,
      now,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects when the header is missing", async () => {
    const result = await verifyRetellSignature({
      rawBody: BODY,
      header: null,
      secret: SECRET,
      now: new Date(),
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("rejects a malformed header", async () => {
    const result = await verifyRetellSignature({
      rawBody: BODY,
      header: "not-a-valid-header",
      secret: SECRET,
      now: new Date(),
    });
    expect(result).toEqual({ valid: false, reason: "malformed_header" });
  });

  it("rejects a tampered body", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const header = await buildHeader(BODY, SECRET, now.getTime());
    const result = await verifyRetellSignature({
      rawBody: `${BODY}tampered`,
      header,
      secret: SECRET,
      now,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a signature signed with the wrong secret", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const header = await buildHeader(BODY, "wrong-secret", now.getTime());
    const result = await verifyRetellSignature({ rawBody: BODY, header, secret: SECRET, now });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp outside the tolerance window", async () => {
    const signedAt = new Date("2026-01-01T00:00:00.000Z");
    const header = await buildHeader(BODY, SECRET, signedAt.getTime());
    const now = new Date(signedAt.getTime() + 10 * 60 * 1000); // 10 minutes later
    const result = await verifyRetellSignature({
      rawBody: BODY,
      header,
      secret: SECRET,
      now,
      toleranceMs: 5 * 60 * 1000,
    });
    expect(result).toEqual({ valid: false, reason: "stale_timestamp" });
  });
});
