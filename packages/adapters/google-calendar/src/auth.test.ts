import { VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { refreshGoogleCalendarAuth } from "./auth.js";
import { GoogleCalendarClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTIONS = { clientId: "client_1", clientSecret: "secret_1" };

describe("refreshGoogleCalendarAuth", () => {
  it("refreshes the access token and carries the same refresh token forward", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ access_token: "new", expires_in: 3600 })) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    const result = await refreshGoogleCalendarAuth(client, OPTIONS, {
      accessToken: "old",
      refreshToken: "refresh_1",
    });
    expect(result.revoked).toBe(false);
    expect(result.credentials.accessToken).toBe("new");
    expect(result.credentials.refreshToken).toBe("refresh_1");
    expect(result.credentials.expiresAt).toBeTruthy();
  });

  it("reports revoked (never throws) on invalid_grant", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    const result = await refreshGoogleCalendarAuth(client, OPTIONS, {
      accessToken: "old",
      refreshToken: "refresh_1",
    });
    expect(result.revoked).toBe(true);
  });

  it("propagates a non-auth failure rather than misreporting it as revoked", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: "server_error" }, 500)) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl, maxAttempts: 1 });

    await expect(
      refreshGoogleCalendarAuth(client, OPTIONS, { accessToken: "old", refreshToken: "refresh_1" }),
    ).rejects.toBeInstanceOf(VoiceProviderError);
  });

  it("throws when there is no refresh token to exchange", async () => {
    const client = new GoogleCalendarClient({});
    await expect(
      refreshGoogleCalendarAuth(client, OPTIONS, { accessToken: "old" }),
    ).rejects.toThrow(/refreshToken/);
  });
});
