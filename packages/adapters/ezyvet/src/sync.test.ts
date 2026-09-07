import { describe, expect, it } from "vitest";
import { EzyVetClient } from "./client.js";
import { pullEzyVetChanges } from "./sync.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pullEzyVetChanges", () => {
  it("maps modified appointments into canonical booking_changed events", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () =>
        jsonResponse({
          items: [
            { id: 1, active: 1 },
            { id: 2, active: 0 },
          ],
        })) as unknown as typeof fetch,
    });

    const result = await pullEzyVetChanges(client, {
      connection: { accessToken: "token" },
      since: "2026-09-10T00:00:00Z",
    });

    expect(result.events).toEqual([
      { type: "booking_changed", externalId: "1", changes: { active: true } },
      { type: "booking_changed", externalId: "2", changes: { active: false } },
    ]);
    expect(result.cursor).toBeTruthy();
  });

  it("throws when the connection has no accessToken", async () => {
    const client = new EzyVetClient({ baseUrl: "https://clinic.ezyvet.com/api/v1" });
    await expect(pullEzyVetChanges(client, { connection: {} })).rejects.toThrow(/accessToken/);
  });
});
