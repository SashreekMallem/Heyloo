import { VoiceProviderError } from "@heyloo/canonical-types";
import { describe, expect, it } from "vitest";
import { refreshShopmonkeyAuth } from "./auth.js";
import { ShopmonkeyClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("refreshShopmonkeyAuth", () => {
  it("reports not-revoked when the pasted key still validates", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async () => jsonResponse({ id: "user_1" })) as unknown as typeof fetch,
    });
    const connection = { accessToken: "key_1" };
    const result = await refreshShopmonkeyAuth(client, connection);
    expect(result).toEqual({ revoked: false, credentials: connection });
  });

  it("reports revoked (never throws) once the tenant revokes/regenerates the key in Shopmonkey", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async () =>
        jsonResponse({ error: "unauthorized" }, 401)) as unknown as typeof fetch,
    });
    const result = await refreshShopmonkeyAuth(client, { accessToken: "key_1" });
    expect(result.revoked).toBe(true);
  });

  it("propagates a transient server error rather than misreporting it as revoked", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async () =>
        jsonResponse({ error: "server_error" }, 500)) as unknown as typeof fetch,
      maxAttempts: 1,
    });
    await expect(refreshShopmonkeyAuth(client, { accessToken: "key_1" })).rejects.toBeInstanceOf(
      VoiceProviderError,
    );
  });

  it("throws when there is no pasted key stored at all", async () => {
    const client = new ShopmonkeyClient({});
    await expect(refreshShopmonkeyAuth(client, {})).rejects.toThrow(/accessToken/);
  });
});
