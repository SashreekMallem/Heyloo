import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./crypto.js";
import { verifyStripeSignature } from "./stripe-signature.js";

const SECRET = "whsec_test_secret";
const BODY = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });

async function buildHeader(
  body: string,
  secret: string,
  timestampSec: number,
  extra?: string,
): Promise<string> {
  const digest = await hmacSha256Hex(secret, `${timestampSec}.${body}`);
  return `t=${timestampSec},v1=${digest}${extra ? `,${extra}` : ""}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a validly-signed, fresh event", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const header = await buildHeader(BODY, SECRET, Math.floor(now.getTime() / 1000));
    const result = await verifyStripeSignature({ rawBody: BODY, header, secret: SECRET, now });
    expect(result).toEqual({ valid: true });
  });

  it("accepts when a rotated secret's v1 matches among multiple signatures", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const t = Math.floor(now.getTime() / 1000);
    const validDigest = await hmacSha256Hex(SECRET, `${t}.${BODY}`);
    const header = `t=${t},v1=deadbeef,v1=${validDigest}`;
    const result = await verifyStripeSignature({ rawBody: BODY, header, secret: SECRET, now });
    expect(result).toEqual({ valid: true });
  });

  it("rejects when the secret is missing (fail closed)", async () => {
    const now = new Date();
    const header = await buildHeader(BODY, SECRET, Math.floor(now.getTime() / 1000));
    const result = await verifyStripeSignature({ rawBody: BODY, header, secret: undefined, now });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });

  it("rejects a missing header", async () => {
    const result = await verifyStripeSignature({
      rawBody: BODY,
      header: null,
      secret: SECRET,
      now: new Date(),
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("rejects a malformed header", async () => {
    const result = await verifyStripeSignature({
      rawBody: BODY,
      header: "garbage",
      secret: SECRET,
      now: new Date(),
    });
    expect(result).toEqual({ valid: false, reason: "malformed_header" });
  });

  it("rejects a tampered body", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const header = await buildHeader(BODY, SECRET, Math.floor(now.getTime() / 1000));
    const result = await verifyStripeSignature({
      rawBody: `${BODY}tampered`,
      header,
      secret: SECRET,
      now,
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a stale timestamp beyond the tolerance window", async () => {
    const signedAt = Math.floor(new Date("2026-01-01T00:00:00.000Z").getTime() / 1000);
    const header = await buildHeader(BODY, SECRET, signedAt);
    const now = new Date((signedAt + 10 * 60) * 1000);
    const result = await verifyStripeSignature({
      rawBody: BODY,
      header,
      secret: SECRET,
      now,
      toleranceMs: 5 * 60 * 1000,
    });
    expect(result).toEqual({ valid: false, reason: "stale_timestamp" });
  });
});
