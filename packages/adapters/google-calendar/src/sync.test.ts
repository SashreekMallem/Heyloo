import { describe, expect, it } from "vitest";
import { GoogleCalendarClient } from "./client.js";
import { pullGoogleCalendarChanges } from "./sync.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pullGoogleCalendarChanges", () => {
  it("maps events.list results into canonical booking_changed events and returns a fresh cursor", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: unknown) => {
      capturedUrl = String(url);
      return jsonResponse({
        items: [
          { id: "evt_1", status: "confirmed", updated: "2026-09-10T14:05:00Z" },
          { id: "evt_2", status: "cancelled", updated: "2026-09-10T14:06:00Z" },
        ],
      });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    const result = await pullGoogleCalendarChanges(client, {
      connection: { accessToken: "token" },
      since: "2026-09-10T14:00:00Z",
    });

    expect(result.events).toEqual([
      { type: "booking_changed", externalId: "evt_1", changes: { status: "confirmed" } },
      { type: "booking_changed", externalId: "evt_2", changes: { status: "cancelled" } },
    ]);
    expect(result.cursor).toBeTruthy();
    expect(capturedUrl).toContain("updatedMin=2026-09-10T14%3A00%3A00Z");
    expect(capturedUrl).toContain("showDeleted=true");
  });

  it("omits updatedMin on the first-ever poll (no `since`)", async () => {
    let capturedUrl = "";
    const fetchImpl = (async (url: unknown) => {
      capturedUrl = String(url);
      return jsonResponse({ items: [] });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    await pullGoogleCalendarChanges(client, { connection: { accessToken: "token" } });
    expect(capturedUrl).not.toContain("updatedMin");
  });

  it("throws when the connection has no accessToken", async () => {
    const client = new GoogleCalendarClient({});
    await expect(pullGoogleCalendarChanges(client, { connection: {} })).rejects.toThrow(
      /accessToken/,
    );
  });
});
