import { describe, expect, it } from "vitest";
import { pushEzyVetBooking } from "./booking.js";
import { EzyVetClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const PARAMS = {
  idempotencyKey: "call_1:slot_1",
  startAt: "2026-09-10T14:00:00Z",
  endAt: "2026-09-10T14:30:00Z",
  customerName: "Jane Doe",
  customerPhoneE164: "+15551234567",
  serviceExternalId: "apt_type_1",
  resourceExternalId: "bay_1",
};

describe("pushEzyVetBooking", () => {
  it("reuses an existing contact found by phone rather than creating a duplicate", async () => {
    const calls: string[] = [];
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async (url: unknown) => {
        const path = String(url);
        calls.push(path);
        if (path.includes("/contact?")) return jsonResponse({ items: [{ id: 42 }] });
        return jsonResponse({ id: 99, status: "confirmed" });
      }) as unknown as typeof fetch,
    });

    const result = await pushEzyVetBooking(client, { accessToken: "token" }, PARAMS);
    expect(result.externalId).toBe("99");
    expect(calls.some((c) => c.endsWith("/contact"))).toBe(false); // no POST /contact create call
  });

  it("creates a new contact when no existing one matches the phone", async () => {
    let createdContactBody: any;
    const client = new EzyVetClient({
      baseUrl: "https://clinic.ezyvet.com/api/v1",
      fetchImpl: (async (url: unknown, init: any) => {
        const path = String(url);
        if (path.includes("/contact?")) return jsonResponse({ items: [] });
        if (path.endsWith("/contact")) {
          createdContactBody = JSON.parse(init.body);
          return jsonResponse({ id: 7 });
        }
        return jsonResponse({ id: 100, status: "confirmed" });
      }) as unknown as typeof fetch,
    });

    const result = await pushEzyVetBooking(client, { accessToken: "token" }, PARAMS);
    expect(result.externalId).toBe("100");
    expect(createdContactBody).toMatchObject({
      first_name: "Jane",
      last_name: "Doe",
      mobile: "+15551234567",
    });
  });

  it("throws when the connection has no accessToken", async () => {
    const client = new EzyVetClient({ baseUrl: "https://clinic.ezyvet.com/api/v1" });
    await expect(pushEzyVetBooking(client, {}, PARAMS)).rejects.toThrow(/accessToken/);
  });
});
