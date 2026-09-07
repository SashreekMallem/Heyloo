import { VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { refreshEzyVetAuth, shouldRefreshEzyVetAuth } from "./auth.js";
import { EzyVetClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTIONS = { clientId: "c1", clientSecret: "s1", partnerId: "p1" };

describe("shouldRefreshEzyVetAuth", () => {
  it("says yes when there is no stored expiry at all", () => {
    expect(shouldRefreshEzyVetAuth({})).toBe(true);
  });

  it("says no with plenty of the 12h TTL left", () => {
    const now = () => Date.parse("2026-09-10T00:00:00Z");
    const expiresAt = "2026-09-10T10:00:00Z"; // 10h remaining
    expect(shouldRefreshEzyVetAuth({ expiresAt }, now)).toBe(false);
  });

  it("says yes proactively once inside the 2h refresh margin (BACKEND_SPEC §7.6 'refresh at 10h of 12h')", () => {
    const now = () => Date.parse("2026-09-10T00:00:00Z");
    const expiresAt = "2026-09-10T01:30:00Z"; // 1.5h remaining, inside the 2h margin
    expect(shouldRefreshEzyVetAuth({ expiresAt }, now)).toBe(true);
  });
});

describe("refreshEzyVetAuth", () => {
  it("mints a fresh token via the client-credentials grant", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () =>
        jsonResponse({ access_token: "new", expires_in: 43200 })) as unknown as typeof fetch,
    });
    const result = await refreshEzyVetAuth(client, OPTIONS, {});
    expect(result.revoked).toBe(false);
    expect(result.credentials.accessToken).toBe("new");
    expect(result.credentials.expiresAt).toBeTruthy();
  });

  it("reports revoked (never throws) when the practice revoked our partner authorization", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () =>
        jsonResponse({ error: "invalid_client" }, 401)) as unknown as typeof fetch,
    });
    const result = await refreshEzyVetAuth(client, OPTIONS, {});
    expect(result.revoked).toBe(true);
  });

  it("propagates a transient server error rather than misreporting it as revoked", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () =>
        jsonResponse({ error: "server_error" }, 500)) as unknown as typeof fetch,
      maxAttempts: 1,
    });
    await expect(refreshEzyVetAuth(client, OPTIONS, {})).rejects.toBeInstanceOf(VoiceProviderError);
  });
});
