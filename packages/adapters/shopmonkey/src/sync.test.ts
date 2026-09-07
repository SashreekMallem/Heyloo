import { describe, expect, it } from "vitest";
import { ShopmonkeyClient } from "./client.js";
import { pullShopmonkeyChanges } from "./sync.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pullShopmonkeyChanges", () => {
  it("maps changed appointments into canonical events", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async () =>
        jsonResponse({ data: [{ id: "apt_1", status: "cancelled" }] })) as unknown as typeof fetch,
    });
    const result = await pullShopmonkeyChanges(client, {
      connection: { accessToken: "key" },
      since: "2026-09-10T00:00:00Z",
    });
    expect(result.events).toEqual([
      { type: "booking_changed", externalId: "apt_1", changes: { status: "cancelled" } },
    ]);
    expect(result.cursor).toBeTruthy();
  });

  it("throws when the connection has no pasted key", async () => {
    const client = new ShopmonkeyClient({});
    await expect(pullShopmonkeyChanges(client, { connection: {} })).rejects.toThrow(/accessToken/);
  });
});
