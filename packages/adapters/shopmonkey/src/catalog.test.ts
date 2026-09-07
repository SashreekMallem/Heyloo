import { describe, expect, it } from "vitest";
import { syncShopmonkeyCatalog } from "./catalog.js";
import { ShopmonkeyClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("syncShopmonkeyCatalog", () => {
  it("maps labor rates into canonical catalog items, skipping deleted ones", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async () =>
        jsonResponse({
          data: [
            { id: "rate_1", name: "Standard Labor", amount: 12000 },
            { id: "rate_2", name: "Deleted rate", amount: 5000, deleted: true },
          ],
        })) as unknown as typeof fetch,
    });

    const result = await syncShopmonkeyCatalog(client, "key");
    expect(result.items).toEqual([
      {
        externalId: "rate_1",
        name: "Standard Labor",
        priceCents: 12000,
        active: true,
        raw: expect.any(Object),
      },
    ]);
  });

  it("returns an empty list on an unrecognized response shape", async () => {
    const client = new ShopmonkeyClient({
      fetchImpl: (async () => jsonResponse("bad shape")) as unknown as typeof fetch,
    });
    expect((await syncShopmonkeyCatalog(client, "key")).items).toEqual([]);
  });
});
