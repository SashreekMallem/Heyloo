import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintWidgetToken, verifyWidgetToken } from "./session-token";

describe("widget session token", () => {
  beforeEach(() => {
    vi.stubEnv("WIDGET_TOKEN_SECRET", "test-secret-at-least-32-bytes-long-ok");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mints a token that verifies back to the same payload", () => {
    const { token } = mintWidgetToken({
      tenantId: "tenant-1",
      widgetPublicKey: "pk_abc",
      origin: "https://tenant-site.example",
    });
    const result = verifyWidgetToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tenant_id).toBe("tenant-1");
      expect(result.payload.widget_public_key).toBe("pk_abc");
      expect(result.payload.origin).toBe("https://tenant-site.example");
    }
  });

  it("rejects an expired token", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { token } = mintWidgetToken(
      { tenantId: "t1", widgetPublicKey: "pk", origin: "https://x.example" },
      { ttlSeconds: 60, now: () => now },
    );
    const later = () => new Date(now.getTime() + 61_000);
    const result = verifyWidgetToken(token, { now: later });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const { token } = mintWidgetToken({
      tenantId: "t1",
      widgetPublicKey: "pk",
      origin: "https://x.example",
    });
    const [payloadB64, signature] = token.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        tenant_id: "attacker-tenant",
        widget_public_key: "pk",
        origin: "https://x.example",
        iat: 0,
        exp: 9_999_999_999,
      }),
    ).toString("base64url");
    const tampered = `${tamperedPayload}.${signature}`;
    expect(payloadB64).not.toBe(tamperedPayload);
    const result = verifyWidgetToken(tampered);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a malformed token", () => {
    expect(verifyWidgetToken(undefined)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWidgetToken("")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWidgetToken("no-dot-here")).toEqual({ ok: false, reason: "malformed" });
    expect(verifyWidgetToken("not-base64.not-hex")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature computed under a different secret", () => {
    const { token } = mintWidgetToken({
      tenantId: "t1",
      widgetPublicKey: "pk",
      origin: "https://x.example",
    });
    vi.stubEnv("WIDGET_TOKEN_SECRET", "a-completely-different-secret-value");
    const result = verifyWidgetToken(token);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("throws a clear error when WIDGET_TOKEN_SECRET is missing", () => {
    vi.stubEnv("WIDGET_TOKEN_SECRET", undefined);
    expect(() =>
      mintWidgetToken({ tenantId: "t1", widgetPublicKey: "pk", origin: "https://x.example" }),
    ).toThrow("Missing required env var: WIDGET_TOKEN_SECRET");
  });
});
