import { describe, expect, it } from "vitest";
import { checkGoogleCalendarAvailability } from "./availability.js";
import { GoogleCalendarClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("checkGoogleCalendarAvailability", () => {
  it("inverts freeBusy's busy ranges into free canonical slots", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        calendars: {
          primary: { busy: [{ start: "2026-09-10T15:00:00Z", end: "2026-09-10T16:00:00Z" }] },
        },
      })) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    const result = await checkGoogleCalendarAvailability(
      client,
      { accessToken: "token" },
      { startAt: "2026-09-10T14:00:00Z", endAt: "2026-09-10T17:00:00Z" },
    );

    expect(result.slots).toEqual([
      {
        startAt: "2026-09-10T14:00:00Z",
        endAt: "2026-09-10T15:00:00Z",
        resourceExternalId: "primary",
      },
      {
        startAt: "2026-09-10T16:00:00Z",
        endAt: "2026-09-10T17:00:00Z",
        resourceExternalId: "primary",
      },
    ]);
  });

  it("returns the whole window as free when there is no busy time at all", async () => {
    const fetchImpl = (async () =>
      jsonResponse({ calendars: { primary: { busy: [] } } })) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    const result = await checkGoogleCalendarAvailability(
      client,
      { accessToken: "token" },
      { startAt: "2026-09-10T14:00:00Z", endAt: "2026-09-10T15:00:00Z" },
    );
    expect(result.slots).toEqual([
      {
        startAt: "2026-09-10T14:00:00Z",
        endAt: "2026-09-10T15:00:00Z",
        resourceExternalId: "primary",
      },
    ]);
  });

  it("throws when the connection has no accessToken", async () => {
    const client = new GoogleCalendarClient({});
    await expect(
      checkGoogleCalendarAvailability(client, {}, { startAt: "a", endAt: "b" }),
    ).rejects.toThrow(/accessToken/);
  });
});
