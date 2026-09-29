import { describe, expect, it } from "vitest";
import {
  zCanonicalDeliveryStatus,
  zCanonicalInboundSms,
  zEmailSendRequest,
  zSendResult,
  zSmsSendRequest,
} from "./messaging.js";
import { deliveryPreferencesSchema } from "./schemas/delivery-preferences.js";
import { messagingBusinessProfileSchema } from "./schemas/messaging-business-profile.js";

describe("messaging canonical types", () => {
  it("SMS send requests must be E.164 on both ends", () => {
    const base = { to: "+15551234567", from: "+18885550100", body: "hi", idempotencyKey: "m1" };
    expect(zSmsSendRequest.safeParse(base).success).toBe(true);
    expect(zSmsSendRequest.safeParse({ ...base, to: "555-123-4567" }).success).toBe(false);
    expect(zSmsSendRequest.safeParse({ ...base, body: "" }).success).toBe(false);
  });

  it("email send requests need a valid recipient and a text alternative", () => {
    const base = {
      to: "o@example.com",
      from: "Heyloo <a@heyloo.app>",
      subject: "s",
      html: "<p>x</p>",
      text: "x",
      idempotencyKey: "m1",
    };
    expect(zEmailSendRequest.safeParse(base).success).toBe(true);
    expect(zEmailSendRequest.safeParse({ ...base, to: "nope" }).success).toBe(false);
  });

  it("send results are ok with an id, or a classified failure", () => {
    expect(zSendResult.safeParse({ ok: true, providerMessageId: "x" }).success).toBe(true);
    expect(
      zSendResult.safeParse({
        ok: false,
        failure: "deferred",
        httpStatus: 429,
        errorCode: "daily_quota_exceeded",
        detail: "d",
        retryAfterSeconds: 3600,
      }).success,
    ).toBe(true);
    expect(
      zSendResult.safeParse({
        ok: false,
        failure: "maybe",
        httpStatus: 1,
        errorCode: null,
        detail: "",
      }).success,
    ).toBe(false);
  });

  it("inbound + status events are provider-tagged and E.164", () => {
    expect(
      zCanonicalInboundSms.safeParse({
        provider: "telnyx",
        eventId: "e",
        providerMessageId: "m",
        fromE164: "+15551234567",
        toE164: "+18885550100",
        body: "",
        providerHandledKeyword: "stop",
      }).success,
    ).toBe(true);
    expect(
      zCanonicalDeliveryStatus.safeParse({
        provider: "plivo",
        eventId: "e",
        providerMessageId: "m",
        status: "delivered",
        errorCode: null,
      }).success,
    ).toBe(false);
  });
});

describe("owner delivery preferences form", () => {
  it("accepts an optional E.164 alert phone", () => {
    expect(
      deliveryPreferencesSchema.safeParse({
        sms_enabled: true,
        email_enabled: false,
        alert_phone: "+15552223333",
      }).success,
    ).toBe(true);
    expect(
      deliveryPreferencesSchema.safeParse({
        sms_enabled: true,
        email_enabled: true,
        alert_phone: "555",
      }).success,
    ).toBe(false);
  });
});

describe("messaging business profile form", () => {
  const base = {
    legal_name: "Riverside Auto Repair LLC",
    business_type: "llc" as const,
    ein: "12-3456789",
    street_line1: "1 Main St",
    city: "Springfield",
    region: "IL",
    postal_code: "62701",
    contact_first_name: "Dana",
    contact_last_name: "Lee",
    contact_email: "dana@example.com",
    contact_phone: "+15551234567",
    monthly_volume_estimate: 500,
  };

  it("accepts a complete profile", () => {
    expect(messagingBusinessProfileSchema.safeParse(base).success).toBe(true);
  });

  it("requires an EIN for every business type except sole proprietor", () => {
    const { ein: _ein, ...noEin } = base;
    const llc = messagingBusinessProfileSchema.safeParse(noEin);
    expect(llc.success).toBe(false);
    expect(llc.error?.issues[0]?.path).toEqual(["ein"]);
    expect(
      messagingBusinessProfileSchema.safeParse({ ...noEin, business_type: "sole_proprietor" })
        .success,
    ).toBe(true);
  });

  it("rejects a malformed EIN, state code, or ZIP", () => {
    expect(messagingBusinessProfileSchema.safeParse({ ...base, ein: "1234" }).success).toBe(false);
    expect(messagingBusinessProfileSchema.safeParse({ ...base, region: "Illinois" }).success).toBe(
      false,
    );
    expect(messagingBusinessProfileSchema.safeParse({ ...base, postal_code: "6270" }).success).toBe(
      false,
    );
  });
});
