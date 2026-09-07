import { describe, expect, it } from "vitest";
import { syncEzyVetCatalog } from "./catalog.js";
import { EzyVetClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("syncEzyVetCatalog", () => {
  it("maps appointment types into canonical catalog items", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () =>
        jsonResponse({
          items: [
            { id: 1, name: "Wellness Exam", duration: 30, active: 1 },
            { id: 2, name: "Surgery Consult", duration: 45, active: 0 },
          ],
        })) as unknown as typeof fetch,
    });

    const result = await syncEzyVetCatalog(client, "token");
    expect(result.items).toEqual([
      {
        externalId: "1",
        name: "Wellness Exam",
        durationMinutes: 30,
        active: true,
        raw: expect.any(Object),
      },
      {
        externalId: "2",
        name: "Surgery Consult",
        durationMinutes: 45,
        active: false,
        raw: expect.any(Object),
      },
    ]);
  });

  it("returns an empty list (never throws) on an unrecognized response shape", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () => jsonResponse("not an object")) as unknown as typeof fetch,
    });
    const result = await syncEzyVetCatalog(client, "token");
    expect(result.items).toEqual([]);
  });
});
