import { describe, expect, it } from "vitest";
import { hmacSha256Hex } from "./crypto.ts";
import { verifyWidgetToken } from "./widget-token.ts";

const SECRET = "shared-widget-token-secret";

async function makeToken(
  payload: { tenant_id: string; widget_public_key: string; origin: string },
  opts: { expiresInSeconds?: number } = {},
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (opts.expiresInSeconds ?? 900);
  const payloadB64 = btoa(JSON.stringify({ ...payload, iat, exp }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const signature = await hmacSha256Hex(SECRET, payloadB64);
  return `${payloadB64}.${signature}`;
}

describe("verifyWidgetToken (Deno/edge-function side)", () => {
  it("verifies a well-formed, correctly-signed, unexpired token", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
    });
    const result = await verifyWidgetToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tenant_id).toBe("t1");
      expect(result.payload.widget_public_key).toBe("pk");
      expect(result.payload.origin).toBe("https://x.example");
    }
  });

  it("rejects a missing token", async () => {
    expect(await verifyWidgetToken(undefined, SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyWidgetToken(null, SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyWidgetToken("", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a token with no '.' separator", async () => {
    expect(await verifyWidgetToken("nodothere", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a token signed under a different secret", async () => {
    const token = await makeToken({
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
    });
    const result = await verifyWidgetToken(token, "a-different-secret");
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired token even with a valid signature", async () => {
    const token = await makeToken(
      { tenant_id: "t1", widget_public_key: "pk", origin: "https://x.example" },
      { expiresInSeconds: -1 },
    );
    const result = await verifyWidgetToken(token, SECRET);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a signature that decodes but isn't valid JSON", async () => {
    const payloadB64 = btoa("not json").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const signature = await hmacSha256Hex(SECRET, payloadB64);
    const result = await verifyWidgetToken(`${payloadB64}.${signature}`, SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("is exactly interoperable with the Node-side construction (apps/web/src/lib/widget/session-token.ts)", async () => {
    // Same construction, computed with Node's createHmac instead of Web
    // Crypto — this is the cross-runtime compatibility this whole file
    // exists for; if this test ever fails, a real widget_token minted by
    // Next.js would be rejected by every Deno edge function that needs it.
    const { createHmac } = await import("node:crypto");
    const payload = {
      tenant_id: "t1",
      widget_public_key: "pk",
      origin: "https://x.example",
      iat: 0,
      exp: 9_999_999_999,
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(payloadB64).digest("hex");
    const token = `${payloadB64}.${signature}`;

    const result = await verifyWidgetToken(token, SECRET);
    expect(result).toEqual({ ok: true, payload });
  });
});
