import { describe, expect, it } from "vitest";
import type { IntegrationAdapter } from "./adapter-types.js";
import { GoogleCalendarProvider } from "./provider.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeProvider(fetchImpl: typeof fetch) {
  return new GoogleCalendarProvider({
    clientId: "client_1",
    clientSecret: "secret_1",
    fetchImpl,
    resolveChannelToken: () => "secret-123",
  });
}

describe("GoogleCalendarProvider", () => {
  it("declares capabilities matching G10's fallback-mode role (no order push; webhook-driven two-way sync)", () => {
    const provider = makeProvider((async () => jsonResponse({})) as unknown as typeof fetch);
    expect(provider.capabilities).toMatchObject({
      supportsCatalogSync: true,
      supportsBookingPush: true,
      supportsOrderPush: false,
      supportsChangeWebhooks: true,
    });
    expect((provider as IntegrationAdapter).pushOrder).toBeUndefined();
  });

  it("verifies a real notification end to end", async () => {
    const provider = makeProvider((async () => jsonResponse({})) as unknown as typeof fetch);
    const result = await provider.handleWebhook({
      rawBody: "",
      headers: {
        "X-Goog-Channel-Token": "secret-123",
        "X-Goog-Resource-State": "exists",
        "X-Goog-Resource-ID": "res_1",
      },
      connection: {},
    });
    expect(result).toEqual({
      valid: true,
      event: { type: "booking_changed", externalId: "res_1", changes: { resourceState: "exists" } },
    });
  });

  it("rejects a notification with the wrong channel token", async () => {
    const provider = makeProvider((async () => jsonResponse({})) as unknown as typeof fetch);
    const result = await provider.handleWebhook({
      rawBody: "",
      headers: { "X-Goog-Channel-Token": "wrong" },
      connection: {},
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("delegates syncCatalog/checkAvailability/pushBooking/pullChanges/refreshAuth", async () => {
    const provider = makeProvider((async (url: unknown) => {
      const path = String(url);
      if (path.includes("/calendarList")) return jsonResponse({ items: [] });
      if (path.includes("/freeBusy")) return jsonResponse({ calendars: { primary: { busy: [] } } });
      if (path.includes("/events?")) return jsonResponse({ items: [] });
      if (path.includes("/events")) return jsonResponse({ id: "evt_1", status: "confirmed" });
      if (path.includes("oauth2.googleapis.com"))
        return jsonResponse({ access_token: "new", expires_in: 3600 });
      return jsonResponse({});
    }) as unknown as typeof fetch);

    const connection = { accessToken: "t", refreshToken: "r" };
    await expect(provider.syncCatalog(connection)).resolves.toEqual({ items: [] });
    await expect(
      provider.checkAvailability(connection, {
        startAt: "2026-09-10T14:00:00Z",
        endAt: "2026-09-10T15:00:00Z",
      }),
    ).resolves.toEqual({
      slots: [
        {
          startAt: "2026-09-10T14:00:00Z",
          endAt: "2026-09-10T15:00:00Z",
          resourceExternalId: "primary",
        },
      ],
    });
    await expect(
      provider.pushBooking(connection, {
        idempotencyKey: "k",
        startAt: "2026-09-10T14:00:00Z",
        endAt: "2026-09-10T14:30:00Z",
        customerName: "Jane",
        customerPhoneE164: "+15551234567",
      }),
    ).resolves.toMatchObject({ externalId: "evt_1" });
    await expect(provider.pullChanges({ connection })).resolves.toMatchObject({ events: [] });
    await expect(provider.refreshAuth(connection)).resolves.toMatchObject({ revoked: false });
  });
});
