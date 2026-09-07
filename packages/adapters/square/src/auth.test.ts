import { VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import type { AdapterConnectionCredentials } from "./adapter-types.js";
import { refreshSquareAuth } from "./auth.js";
import { SquareClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTIONS = { clientId: "client_1", clientSecret: "secret_1" };
const CONNECTION: AdapterConnectionCredentials = { accessToken: "old", refreshToken: "refresh_1" };

describe("refreshSquareAuth", () => {
  it("exchanges the refresh token for a new access token", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        access_token: "new_token",
        refresh_token: "refresh_1",
        expires_at: "2026-10-01T00:00:00Z",
      })) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });

    const result = await refreshSquareAuth(client, OPTIONS, CONNECTION);
    expect(result.revoked).toBe(false);
    expect(result.credentials.accessToken).toBe("new_token");
    expect(result.credentials.expiresAt).toBe("2026-10-01T00:00:00Z");
  });

  it("reports revoked (never throws) when Square rejects the refresh token as revoked", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ type: "invalid_grant", message: "revoked" }, 401)) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });

    const result = await refreshSquareAuth(client, OPTIONS, CONNECTION);
    expect(result).toEqual({ revoked: true, credentials: CONNECTION });
  });

  it("propagates a non-auth error (e.g. a transient 500) rather than misreporting it as revoked", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ type: "internal_error" }, 500)) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl, maxAttempts: 1 });

    await expect(refreshSquareAuth(client, OPTIONS, CONNECTION)).rejects.toBeInstanceOf(
      VoiceProviderError,
    );
  });

  it("throws (fails closed) when the connection has no refresh token to exchange", async () => {
    const client = new SquareClient({});
    await expect(refreshSquareAuth(client, OPTIONS, { accessToken: "x" })).rejects.toThrow(
      /refreshToken/,
    );
  });
});
