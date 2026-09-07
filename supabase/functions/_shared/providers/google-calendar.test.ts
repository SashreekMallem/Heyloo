import { describe, expect, it } from "vitest";
import {
  freeBusyQuery,
  insertCalendarEvent,
  normalizeGoogleCalendarNotification,
  registerWatchChannel,
  toGoogleEventId,
  verifyGoogleCalendarNotification,
} from "./google-calendar.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyGoogleCalendarNotification", () => {
  it("accepts a notification whose channel token matches", () => {
    const result = verifyGoogleCalendarNotification({
      headers: { "X-Goog-Channel-Token": "secret-1", "X-Goog-Resource-State": "exists" },
      expectedChannelToken: "secret-1",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a mismatched channel token (fail closed)", () => {
    const result = verifyGoogleCalendarNotification({
      headers: { "X-Goog-Channel-Token": "wrong" },
      expectedChannelToken: "secret-1",
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("fails closed with no stored clientState", () => {
    const result = verifyGoogleCalendarNotification({
      headers: { "X-Goog-Channel-Token": "anything" },
      expectedChannelToken: undefined,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });
});

describe("normalizeGoogleCalendarNotification", () => {
  it("treats the initial sync ping as no real change", () => {
    expect(
      normalizeGoogleCalendarNotification({
        channelId: "chan_1",
        channelToken: "t",
        resourceId: null,
        resourceState: "sync",
      }).type,
    ).toBe("unknown");
  });

  it("treats exists/not_exists as a generic booking_changed signal", () => {
    expect(
      normalizeGoogleCalendarNotification({
        channelId: "chan_1",
        channelToken: "t",
        resourceId: "res_1",
        resourceState: "exists",
      }),
    ).toEqual({
      type: "booking_changed",
      external_id: "res_1",
      changes: { resourceState: "exists" },
    });
  });
});

describe("toGoogleEventId", () => {
  it("is deterministic and Google-legal", () => {
    const a = toGoogleEventId("call_1:slot_1");
    expect(a).toBe(toGoogleEventId("call_1:slot_1"));
    expect(a).toMatch(/^[a-v0-9]+$/);
  });
});

describe("Google Calendar REST calls", () => {
  it("freeBusyQuery posts the documented timeMin/timeMax/items shape", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ calendars: { primary: { busy: [] } } });
    }) as any;
    await freeBusyQuery(fetchImpl, "token", {
      calendarId: "primary",
      timeMin: "2026-09-10T00:00:00Z",
      timeMax: "2026-09-11T00:00:00Z",
    });
    expect(captured.items).toEqual([{ id: "primary" }]);
  });

  it("insertCalendarEvent uses the deterministic event id for idempotency", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ id: captured.id });
    }) as any;
    const result = await insertCalendarEvent(fetchImpl, "token", {
      calendarId: "primary",
      idempotencyKey: "call_1:slot_1",
      summary: "Jane Doe",
      description: "desc",
      startAt: "2026-09-10T14:00:00Z",
      endAt: "2026-09-10T14:30:00Z",
    });
    expect(result.ok).toBe(true);
    expect(captured.id).toBe(toGoogleEventId("call_1:slot_1"));
  });

  it("registerWatchChannel posts the web_hook channel shape with our clientState as the token", async () => {
    let captured: any;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return jsonResponse({ resourceId: "res_1", expiration: "123" });
    }) as any;
    await registerWatchChannel(fetchImpl, "token", {
      calendarId: "primary",
      channelId: "chan_1",
      webhookUrl: "https://example.com/webhooks-pos/google_calendar",
      clientState: "secret-1",
    });
    expect(captured).toMatchObject({ id: "chan_1", type: "web_hook", token: "secret-1" });
  });
});
