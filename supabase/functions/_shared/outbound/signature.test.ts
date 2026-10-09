import { describe, expect, it } from "vitest";
import { fromBase64 } from "../crypto.ts";
import { signStandardWebhook, verifyStandardWebhook } from "../standard-webhooks.ts";
import { generateSigningSecret, SIGNING_SECRET_BYTES } from "./secret.ts";

/**
 * OUTBOUND-1 signer. The known vector is the Standard Webhooks reference
 * libraries' own `test_sign_function` (github.com/standard-webhooks/
 * standard-webhooks, libraries/python/tests/test_webhooks.py, fetched
 * 2026-10-09): secret `whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw`, id
 * `msg_p5jXN8AQM9LWM0D4loKWxJek`, timestamp 1614265330, payload
 * `{"test": 2432232314}` -> `v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`.
 */
const VECTOR = {
  secret: "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw",
  id: "msg_p5jXN8AQM9LWM0D4loKWxJek",
  timestampSeconds: 1614265330,
  body: '{"test": 2432232314}',
  signature: "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=",
};

describe("signStandardWebhook", () => {
  it("matches the Standard Webhooks reference vector", async () => {
    expect(await signStandardWebhook(VECTOR)).toBe(VECTOR.signature);
  });

  it("signs the same with or without the whsec_ prefix", async () => {
    expect(
      await signStandardWebhook({ ...VECTOR, secret: VECTOR.secret.replace(/^whsec_/, "") }),
    ).toBe(VECTOR.signature);
  });

  it("changes when any signed part changes (id, timestamp, body)", async () => {
    const other = await Promise.all([
      signStandardWebhook({ ...VECTOR, id: "msg_other" }),
      signStandardWebhook({ ...VECTOR, timestampSeconds: VECTOR.timestampSeconds + 1 }),
      signStandardWebhook({ ...VECTOR, body: '{"test":2432232314}' }),
    ]);
    for (const sig of other) expect(sig).not.toBe(VECTOR.signature);
  });

  it("round-trips through the repo's own fail-closed verifier", async () => {
    const secret = generateSigningSecret();
    const body = JSON.stringify({ type: "test.ping", data: { message: "hi" } });
    const ts = 1_760_000_000;
    const signature = await signStandardWebhook({
      secret,
      id: "evt_abc",
      timestampSeconds: ts,
      body,
    });
    const headers: Record<string, string> = {
      "webhook-id": "evt_abc",
      "webhook-timestamp": String(ts),
      "webhook-signature": signature,
    };
    const result = await verifyStandardWebhook({
      rawBody: body,
      header: (name) => headers[name] ?? null,
      secret,
      now: new Date(ts * 1000),
    });
    expect(result).toEqual({ valid: true });
    const tampered = await verifyStandardWebhook({
      rawBody: `${body} `,
      header: (name) => headers[name] ?? null,
      secret,
      now: new Date(ts * 1000),
    });
    expect(tampered).toEqual({ valid: false, reason: "mismatch" });
  });

  it("refuses to sign with no usable secret or a bad timestamp (never sends unsigned)", async () => {
    await expect(signStandardWebhook({ ...VECTOR, secret: "" })).rejects.toThrow(
      "standard_webhook_bad_secret",
    );
    await expect(signStandardWebhook({ ...VECTOR, secret: "whsec_!!!" })).rejects.toThrow(
      "standard_webhook_bad_secret",
    );
    await expect(
      signStandardWebhook({ ...VECTOR, secret: `${VECTOR.secret}|${VECTOR.secret}` }),
    ).rejects.toThrow("standard_webhook_bad_secret");
    await expect(signStandardWebhook({ ...VECTOR, timestampSeconds: 1.5 })).rejects.toThrow(
      "standard_webhook_bad_timestamp",
    );
  });
});

describe("generateSigningSecret", () => {
  it("is whsec_ + standard base64 of 32 random bytes (Standard Webhooks: 24-64 bytes)", () => {
    const secret = generateSigningSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(fromBase64(secret.slice("whsec_".length)).byteLength).toBe(SIGNING_SECRET_BYTES);
  });

  it("matches the Vault helper's format check and never repeats", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const secret = generateSigningSecret();
      // Same pattern as fn_outbound_secret_create / fn_outbound_secret_rotate.
      expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{32,}={0,2}$/);
      seen.add(secret);
    }
    expect(seen.size).toBe(50);
  });
});
