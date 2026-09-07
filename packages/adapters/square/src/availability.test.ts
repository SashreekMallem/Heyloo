import { describe, expect, it } from "vitest";
import { checkSquareAvailability } from "./availability.js";
import { SquareClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("checkSquareAvailability", () => {
  it("maps availability search results into canonical slots", async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({
        availabilities: [
          {
            start_at: "2026-09-10T14:00:00Z",
            appointment_segments: [{ team_member_id: "team_1" }],
          },
        ],
      });
    }) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });

    const result = await checkSquareAvailability(
      client,
      { accessToken: "token", metadata: { locationId: "loc_1" } },
      { startAt: "2026-09-10T00:00:00Z", endAt: "2026-09-11T00:00:00Z" },
    );

    expect(result.slots).toEqual([
      {
        startAt: "2026-09-10T14:00:00Z",
        endAt: "2026-09-10T14:00:00Z",
        resourceExternalId: "team_1",
      },
    ]);
    expect(capturedBody.query.filter.location_id).toBe("loc_1");
  });

  it("throws when the connection is missing accessToken or metadata.locationId", async () => {
    const client = new SquareClient({});
    await expect(checkSquareAvailability(client, {}, { startAt: "a", endAt: "b" })).rejects.toThrow(
      /locationId/,
    );
  });

  it("returns an empty slot list (never throws) on an unrecognized response shape", async () => {
    const fetchImpl = (async () => jsonResponse({ unexpected: true })) as unknown as typeof fetch;
    const client = new SquareClient({ fetchImpl });
    const result = await checkSquareAvailability(
      client,
      { accessToken: "token", metadata: { locationId: "loc_1" } },
      { startAt: "a", endAt: "b" },
    );
    expect(result.slots).toEqual([]);
  });
});
