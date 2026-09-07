import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SquareProvider } from "./provider.js";

const NOTIFICATION_URL = "https://example.com/functions/v1/webhooks-pos/square";
const SIGNATURE_KEY = "signing-key";

function makeProvider(fetchImpl: typeof fetch) {
  return new SquareProvider({
    clientId: "client_1",
    clientSecret: "secret_1",
    webhookNotificationUrl: NOTIFICATION_URL,
    webhookSignatureKey: SIGNATURE_KEY,
    fetchImpl,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("SquareProvider", () => {
  it("declares its capabilities (catalog/booking/order/availability, webhook-driven two-way sync)", () => {
    const provider = makeProvider((async () => jsonResponse({})) as unknown as typeof fetch);
    expect(provider.capabilities).toMatchObject({
      supportsCatalogSync: true,
      supportsBookingPush: true,
      supportsOrderPush: true,
      supportsAvailabilityCheck: true,
      supportsChangeWebhooks: true,
    });
  });

  it("verifies a real Square webhook end to end and normalizes an auth_revoked event", async () => {
    const provider = makeProvider((async () => jsonResponse({})) as unknown as typeof fetch);
    const rawBody = JSON.stringify({
      type: "oauth.authorization.revoked",
      data: { id: "merchant_1", object: {} },
    });
    const signature = createHmac("sha256", SIGNATURE_KEY)
      .update(NOTIFICATION_URL + rawBody, "utf8")
      .digest("base64");

    const result = await provider.handleWebhook({
      rawBody,
      headers: { "x-square-hmacsha256-signature": signature },
      connection: {},
    });

    expect(result).toEqual({
      valid: true,
      event: { type: "auth_revoked", externalId: "merchant_1", changes: {} },
    });
  });

  it("rejects a webhook with an invalid signature (fail closed)", async () => {
    const provider = makeProvider((async () => jsonResponse({})) as unknown as typeof fetch);
    const result = await provider.handleWebhook({
      rawBody: "{}",
      headers: { "x-square-hmacsha256-signature": "bogus" },
      connection: {},
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("delegates syncCatalog/pushBooking/pushOrder/checkAvailability/refreshAuth to their modules", async () => {
    const provider = makeProvider((async (url: unknown) => {
      const path = String(url);
      if (path.endsWith("/catalog/search")) return jsonResponse({ objects: [] });
      if (path.endsWith("/bookings/availability/search"))
        return jsonResponse({ availabilities: [] });
      if (path.endsWith("/v2/bookings"))
        return jsonResponse({ booking: { id: "b1", status: "ACCEPTED" } });
      if (path.endsWith("/v2/orders")) return jsonResponse({ order: { id: "o1" } });
      if (path.endsWith("/oauth2/token"))
        return jsonResponse({ access_token: "new", refresh_token: "r1" });
      return jsonResponse({});
    }) as unknown as typeof fetch);

    const connection = {
      accessToken: "t",
      refreshToken: "r",
      metadata: { locationId: "loc_1", defaultTeamMemberId: "team_1" },
    };

    await expect(provider.syncCatalog(connection)).resolves.toEqual({ items: [] });
    await expect(
      provider.checkAvailability(connection, { startAt: "a", endAt: "b" }),
    ).resolves.toEqual({ slots: [] });
    await expect(
      provider.pushBooking(connection, {
        idempotencyKey: "k",
        startAt: "a",
        endAt: "b",
        customerName: "Jane",
        customerPhoneE164: "+15551234567",
        serviceExternalId: "svc_1",
      }),
    ).resolves.toMatchObject({ externalId: "b1" });
    await expect(
      provider.pushOrder(connection, {
        idempotencyKey: "k2",
        items: [{ name: "Item", qty: 1, unitPriceCents: 100 }],
        fulfillmentType: "dine_in",
        totalCents: 100,
      }),
    ).resolves.toMatchObject({ externalId: "o1" });
    await expect(provider.refreshAuth(connection)).resolves.toMatchObject({
      revoked: false,
      credentials: { accessToken: "new" },
    });
  });
});
