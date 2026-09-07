import { describe, expect, it } from "vitest";
import {
  normalizeGoogleCalendarNotification,
  verifyGoogleCalendarNotification,
} from "./webhook.js";

describe("verifyGoogleCalendarNotification", () => {
  it("accepts a notification whose channel token matches the stored clientState", () => {
    const result = verifyGoogleCalendarNotification({
      headers: {
        "X-Goog-Channel-ID": "chan_1",
        "X-Goog-Channel-Token": "secret-123",
        "X-Goog-Resource-ID": "res_1",
        "X-Goog-Resource-State": "exists",
      },
      expectedChannelToken: "secret-123",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a notification with the wrong channel token (fail closed)", () => {
    const result = verifyGoogleCalendarNotification({
      headers: { "X-Goog-Channel-Token": "wrong" },
      expectedChannelToken: "secret-123",
    });
    expect(result).toEqual({ valid: false, reason: "mismatch" });
  });

  it("rejects a notification with no channel token header at all", () => {
    const result = verifyGoogleCalendarNotification({
      headers: {},
      expectedChannelToken: "secret-123",
    });
    expect(result).toEqual({ valid: false, reason: "missing_header" });
  });

  it("fails closed when we have no stored clientState to compare against", () => {
    const result = verifyGoogleCalendarNotification({
      headers: { "X-Goog-Channel-Token": "anything" },
      expectedChannelToken: undefined,
    });
    expect(result).toEqual({ valid: false, reason: "missing_secret" });
  });
});

describe("normalizeGoogleCalendarNotification", () => {
  it("treats the initial 'sync' ping as no real change", () => {
    const event = normalizeGoogleCalendarNotification({
      channelId: "chan_1",
      channelToken: "t",
      resourceId: null,
      resourceState: "sync",
    });
    expect(event.type).toBe("unknown");
  });

  it("treats 'exists'/'not_exists' as a generic booking_changed signal (no diffable content in the notification itself)", () => {
    const event = normalizeGoogleCalendarNotification({
      channelId: "chan_1",
      channelToken: "t",
      resourceId: "res_1",
      resourceState: "exists",
    });
    expect(event).toEqual({
      type: "booking_changed",
      externalId: "res_1",
      changes: { resourceState: "exists" },
    });
  });
});
