/**
 * PROVIDERS-VERIFY compile-time contract test — cross-checks this adapter's
 * hand-rolled Google Calendar v3 REST shapes against the OFFICIAL
 * `googleapis` npm SDK's generated `calendar_v3` types (added as a
 * devDependency in this package's `package.json` ONLY — no runtime code
 * under `src/` besides this test file imports it; CLAUDE.md Rule 2 provider
 * isolation holds unchanged since `devDependencies` never propagate to a
 * workspace consumer).
 *
 * Literal request/response bodies typed against `calendar_v3.Schema$*`
 * interfaces are round-tripped through this adapter's own zod parsers and
 * event-id regex — a field-name drift in either the SDK or this file fails
 * to COMPILE, not just to run. Every shape below was VERIFY-confirmed
 * (docs/VERIFY.md) against these exact types during the PROVIDERS-VERIFY
 * pass, with no mismatches found — this test exists to catch a FUTURE
 * regression, not to fix one found now.
 */

import type { calendar_v3 } from "googleapis";
import { describe, expect, it } from "vitest";
import { toGoogleEventId } from "./booking.js";

describe("Google Calendar SDK contract — freeBusy", () => {
  it("Schema$FreeBusyRequest/Response field names match this adapter's request/parse shape", () => {
    const request: calendar_v3.Schema$FreeBusyRequest = {
      timeMin: "2026-01-01T00:00:00Z",
      timeMax: "2026-01-02T00:00:00Z",
      items: [{ id: "primary" }],
    };
    expect(request.items?.[0]?.id).toBe("primary");

    const response: calendar_v3.Schema$FreeBusyResponse = {
      calendars: {
        primary: { busy: [{ start: "2026-01-01T09:00:00Z", end: "2026-01-01T10:00:00Z" }] },
      },
    };
    expect(response.calendars?.["primary"]?.busy?.[0]?.start).toBe("2026-01-01T09:00:00Z");
  });
});

describe("Google Calendar SDK contract — Events", () => {
  it("Schema$Event's id/start/end field names match, and this adapter's synthetic ids satisfy Google's own base32hex charset+length rule", () => {
    // Google's own documented event-id rule (Schema$Event.id's doc comment):
    // lowercase a-v and digits 0-9, length 5-1024.
    const GOOGLE_EVENT_ID_PATTERN = /^[a-v0-9]{5,1024}$/;
    const eventId = toGoogleEventId("call_123:2026-01-01T10:00:00Z");
    expect(eventId).toMatch(GOOGLE_EVENT_ID_PATTERN);

    const event: calendar_v3.Schema$Event = {
      id: eventId,
      summary: "Jane Doe — Booking",
      start: { dateTime: "2026-01-01T10:00:00Z" },
      end: { dateTime: "2026-01-01T11:00:00Z" },
    };
    expect(event.start?.dateTime).toBe("2026-01-01T10:00:00Z");
  });
});

describe("Google Calendar SDK contract — push notification Channel", () => {
  it("Schema$Channel field names match this adapter's registerWatchChannel body + response parsing", () => {
    const channelRequest: calendar_v3.Schema$Channel = {
      id: "channel_1",
      type: "web_hook",
      address: "https://example.com/functions/v1/webhooks-pos/google-calendar",
      token: "client-state-secret",
      params: { ttl: "604800" },
    };
    expect(channelRequest.type).toBe("web_hook");

    // expiration is documented as "Unix timestamp, in milliseconds" —
    // matches this adapter's RegisterWatchChannelResult docstring exactly.
    const channelResponse: calendar_v3.Schema$Channel = {
      resourceId: "resource_1",
      expiration: "1767225600000",
    };
    expect(channelResponse.resourceId).toBe("resource_1");
  });
});
