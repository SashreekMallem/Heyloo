import { describe, expect, it } from "vitest";
import { syncSquareCatalog } from "./catalog.js";
import { SquareClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("syncSquareCatalog", () => {
  it("maps a catalog search page into canonical items, reading price at variations[0].item_variation_data.price_money.amount", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        objects: [
          {
            type: "ITEM",
            id: "item_1",
            item_data: {
              name: "Oil Change",
              category_id: "cat_maintenance",
              variations: [
                {
                  id: "var_1",
                  item_variation_data: {
                    name: "Standard",
                    price_money: { amount: 4999, currency: "USD" },
                  },
                },
              ],
            },
          },
        ],
      })) as unknown as typeof fetch;

    const client = new SquareClient({ fetchImpl });
    const result = await syncSquareCatalog(client, "token", {});

    expect(result.items).toEqual([
      {
        externalId: "item_1",
        name: "Oil Change",
        category: "cat_maintenance",
        priceCents: 4999,
        active: true,
        raw: expect.objectContaining({ id: "item_1" }),
      },
    ]);
  });

  it("paginates via cursor until exhausted", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          objects: [{ type: "ITEM", id: "item_1", item_data: { name: "A" } }],
          cursor: "page2",
        });
      }
      return jsonResponse({ objects: [{ type: "ITEM", id: "item_2", item_data: { name: "B" } }] });
    }) as unknown as typeof fetch;

    const client = new SquareClient({ fetchImpl });
    const result = await syncSquareCatalog(client, "token");

    expect(result.items.map((i) => i.externalId)).toEqual(["item_1", "item_2"]);
    expect(call).toBe(2);
  });

  it("skips deleted objects and non-ITEM objects", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        objects: [
          { type: "ITEM", id: "item_1", is_deleted: true, item_data: { name: "Deleted" } },
          { type: "CATEGORY", id: "cat_1" },
        ],
      })) as unknown as typeof fetch;

    const client = new SquareClient({ fetchImpl });
    const result = await syncSquareCatalog(client, "token");
    expect(result.items).toEqual([]);
  });
});
