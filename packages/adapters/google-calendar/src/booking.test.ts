import { describe, expect, it } from "vitest";
import { pushGoogleCalendarBooking, toGoogleEventId } from "./booking.js";
import { GoogleCalendarClient } from "./client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("toGoogleEventId", () => {
  it("produces a deterministic, Google-legal (lowercase base32hex-ish) id for the same key", () => {
    const a = toGoogleEventId("call_1:2026-09-10T14:00:00Z");
    const b = toGoogleEventId("call_1:2026-09-10T14:00:00Z");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-v0-9]+$/);
  });

  it("produces different ids for different keys", () => {
    expect(toGoogleEventId("call_1:slot_a")).not.toBe(toGoogleEventId("call_2:slot_b"));
  });
});

describe("pushGoogleCalendarBooking", () => {
  const params = {
    idempotencyKey: "call_1:2026-09-10T14:00:00Z",
    startAt: "2026-09-10T14:00:00Z",
    endAt: "2026-09-10T14:30:00Z",
    customerName: "Jane Doe",
    customerPhoneE164: "+15551234567",
  };

  it("creates a new event with a deterministic id derived from the idempotency key", async () => {
    let capturedBody: any;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return jsonResponse({ id: capturedBody.id, status: "confirmed" });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl });

    const result = await pushGoogleCalendarBooking(client, { accessToken: "token" }, params);
    expect(result.deduped).toBe(false);
    expect(result.externalId).toBe(toGoogleEventId(params.idempotencyKey));
    expect(capturedBody.start).toEqual({ dateTime: params.startAt });
  });

  it("treats a 409 (event id already exists) as a dedup, fetching the existing event instead of erroring", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return jsonResponse({ error: "already exists" }, 409);
      return jsonResponse({ id: toGoogleEventId(params.idempotencyKey), status: "confirmed" });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient({ fetchImpl, maxAttempts: 1 });

    const result = await pushGoogleCalendarBooking(client, { accessToken: "token" }, params);
    expect(result.deduped).toBe(true);
    expect(call).toBe(2);
  });

  it("throws when the connection has no accessToken", async () => {
    const client = new GoogleCalendarClient({});
    await expect(pushGoogleCalendarBooking(client, {}, params)).rejects.toThrow(/accessToken/);
  });
});
