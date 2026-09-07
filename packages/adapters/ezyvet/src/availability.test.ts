import { describe, expect, it } from "vitest";
import { checkEzyVetAvailability } from "./availability.js";
import { EzyVetClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("checkEzyVetAvailability", () => {
  it("inverts booked appointments into free canonical slots", async () => {
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async () =>
        jsonResponse({
          items: [{ start_time: "2026-09-10T15:00:00.000Z", end_time: "2026-09-10T15:30:00.000Z" }],
        })) as unknown as typeof fetch,
    });

    const result = await checkEzyVetAvailability(
      client,
      { accessToken: "token" },
      {
        startAt: "2026-09-10T14:00:00.000Z",
        endAt: "2026-09-10T16:00:00.000Z",
        resourceExternalId: "bay_1",
      },
    );

    expect(result.slots).toEqual([
      {
        startAt: "2026-09-10T14:00:00.000Z",
        endAt: "2026-09-10T15:00:00.000Z",
        resourceExternalId: "bay_1",
      },
      {
        startAt: "2026-09-10T15:30:00.000Z",
        endAt: "2026-09-10T16:00:00.000Z",
        resourceExternalId: "bay_1",
      },
    ]);
  });

  it("throws when the connection has no accessToken", async () => {
    const client = new EzyVetClient({ baseUrl: "https://clinic.ezyvet.com/api/v1" });
    await expect(checkEzyVetAvailability(client, {}, { startAt: "a", endAt: "b" })).rejects.toThrow(
      /accessToken/,
    );
  });
});
