import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IntegrationAdapter } from "./adapter-types.js";
import { ShopmonkeyProvider } from "./provider.js";

const SECRET = "signing-secret";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ShopmonkeyProvider", () => {
  it("declares capabilities: no confirmed availability read, api_key auth mode", () => {
    const provider = new ShopmonkeyProvider({ webhookSigningSecret: SECRET });
    expect(provider.capabilities).toMatchObject({
      supportsAvailabilityCheck: false,
      supportsOrderPush: false,
      authMode: "api_key",
    });
    expect((provider as IntegrationAdapter).checkAvailability).toBeUndefined();
  });

  it("verifies a real webhook end to end", async () => {
    const provider = new ShopmonkeyProvider({
      webhookSigningSecret: SECRET,
      fetchImpl: (async () => jsonResponse({})) as unknown as typeof fetch,
    });
    const rawBody = JSON.stringify({ event: "appointment.updated", data: { id: "apt_1" } });
    const signature = createHmac("sha256", SECRET).update(rawBody, "utf8").digest("hex");

    const result = await provider.handleWebhook({
      rawBody,
      headers: { "x-shopmonkey-signature": signature },
      connection: {},
    });
    expect(result).toEqual({
      valid: true,
      event: { type: "booking_changed", externalId: "apt_1", changes: { id: "apt_1" } },
    });
  });

  it("rejects a webhook with a bad signature", async () => {
    const provider = new ShopmonkeyProvider({ webhookSigningSecret: SECRET });
    const result = await provider.handleWebhook({
      rawBody: "{}",
      headers: { "x-shopmonkey-signature": "bogus" },
      connection: {},
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });
});
