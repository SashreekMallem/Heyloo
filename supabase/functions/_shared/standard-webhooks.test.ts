import { describe, expect, it } from "vitest";
import { parseWebhookSecrets, verifyStandardWebhook } from "./standard-webhooks.ts";

// The published Standard Webhooks / Svix example vector.
const VECTOR = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestamp: "1614265330",
  payload: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};
const AT = new Date(1614265330 * 1000);

const headers = (overrides: Record<string, string | null> = {}) => {
  const base: Record<string, string | null> = {
    "webhook-id": VECTOR.id,
    "webhook-timestamp": VECTOR.timestamp,
    "webhook-signature": VECTOR.signature,
    ...overrides,
  };
  return (name: string) => base[name] ?? null;
};

const verify = (over: Partial<Parameters<typeof verifyStandardWebhook>[0]> = {}) =>
  verifyStandardWebhook({
    rawBody: VECTOR.payload,
    header: headers(),
    secret: VECTOR.secret,
    now: AT,
    ...over,
  });

describe("verifyStandardWebhook", () => {
  it("accepts the published test vector", async () => {
    expect(await verify()).toEqual({ valid: true });
  });

  it("accepts the Supabase secret format v1,whsec_<base64>", async () => {
    expect(await verify({ secret: `v1,${VECTOR.secret}` })).toEqual({ valid: true });
  });

  it("accepts any one of several rotated secrets and any one of several signatures", async () => {
    expect(await verify({ secret: `v1,whsec_AAAAAAAAAAAAAAAA|v1,${VECTOR.secret}` })).toEqual({
      valid: true,
    });
    expect(
      await verify({
        header: headers({ "webhook-signature": `v1,AAAA v2,zzzz ${VECTOR.signature}` }),
      }),
    ).toEqual({ valid: true });
  });

  it("rejects a tampered body", async () => {
    expect(await verify({ rawBody: '{"test": 2432232315}' })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a tampered id or timestamp header", async () => {
    expect(await verify({ header: headers({ "webhook-id": "msg_other" }) })).toMatchObject({
      valid: false,
      reason: "mismatch",
    });
    // Same signature, later timestamp, still inside the tolerance window.
    expect(await verify({ header: headers({ "webhook-timestamp": "1614265331" }) })).toMatchObject({
      valid: false,
      reason: "mismatch",
    });
  });

  it("rejects a signature made with a different secret", async () => {
    expect(await verify({ secret: "whsec_c29tZS1vdGhlci1zZWNyZXQ=" })).toEqual({
      valid: false,
      reason: "mismatch",
    });
  });

  it("fails closed with no secret (unset, empty, blank or unusable)", async () => {
    for (const secret of [undefined, null, "", "   ", "|", "!!!not base64!!!"]) {
      expect(await verify({ secret })).toEqual({ valid: false, reason: "missing_secret" });
    }
  });

  it("rejects missing headers", async () => {
    for (const name of ["webhook-id", "webhook-timestamp", "webhook-signature"]) {
      expect(await verify({ header: headers({ [name]: null }) })).toEqual({
        valid: false,
        reason: "missing_header",
      });
    }
  });

  it("rejects a stale or future timestamp", async () => {
    expect(await verify({ now: new Date(AT.getTime() + 6 * 60 * 1000) })).toEqual({
      valid: false,
      reason: "stale_timestamp",
    });
    expect(await verify({ now: new Date(AT.getTime() - 6 * 60 * 1000) })).toEqual({
      valid: false,
      reason: "stale_timestamp",
    });
    expect(await verify({ now: new Date(AT.getTime() + 4 * 60 * 1000) })).toEqual({ valid: true });
  });

  it("rejects malformed timestamps and signature headers", async () => {
    expect(await verify({ header: headers({ "webhook-timestamp": "abc" }) })).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(await verify({ header: headers({ "webhook-signature": "garbage" }) })).toEqual({
      valid: false,
      reason: "malformed",
    });
    expect(await verify({ header: headers({ "webhook-signature": "v2,abcd" }) })).toEqual({
      valid: false,
      reason: "malformed",
    });
  });
});

describe("parseWebhookSecrets", () => {
  it("strips the v1, and whsec_ prefixes and splits on |", () => {
    expect(parseWebhookSecrets("v1,whsec_QUJD|whsec_REVG")).toEqual([
      new TextEncoder().encode("ABC"),
      new TextEncoder().encode("DEF"),
    ]);
    expect(parseWebhookSecrets(undefined)).toEqual([]);
  });
});
