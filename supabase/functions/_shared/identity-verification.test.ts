import { describe, expect, it } from "vitest";
import { verifyBookingIdentity } from "./identity-verification.js";

const BASE = {
  callerNumber: "+15551234567",
  customerPhone: "+15551234567",
  customerName: "Jordan Lee",
  bookingStartAt: "2026-01-15T14:00:00.000Z",
};

describe("verifyBookingIdentity", () => {
  it("passes via phone_match when the caller number matches the customer's number", () => {
    expect(verifyBookingIdentity(BASE)).toEqual({ ok: true, verifiedBy: "phone_match" });
  });

  it("passes via phone_match even with differently-formatted-but-equivalent numbers", () => {
    const result = verifyBookingIdentity({ ...BASE, callerNumber: "(555) 123-4567" });
    expect(result).toEqual({ ok: true, verifiedBy: "phone_match" });
  });

  it("rejects a phone mismatch with no verification claim offered", () => {
    const result = verifyBookingIdentity({ ...BASE, callerNumber: "+15559998888" });
    expect(result).toEqual({ ok: false, reason: "phone_mismatch_no_verification_offered" });
  });

  it("passes via knowledge when phone differs but name + exact time both match", () => {
    const result = verifyBookingIdentity({
      ...BASE,
      callerNumber: "+15559998888",
      verify: { full_name: "jordan   LEE", appointment_time: "2026-01-15T14:00:30.000Z" },
    });
    expect(result).toEqual({ ok: true, verifiedBy: "knowledge" });
  });

  it("rejects when the name doesn't match", () => {
    const result = verifyBookingIdentity({
      ...BASE,
      callerNumber: "+15559998888",
      verify: { full_name: "Someone Else", appointment_time: BASE.bookingStartAt },
    });
    expect(result).toEqual({ ok: false, reason: "name_mismatch" });
  });

  it("rejects when the claimed appointment time doesn't match (different minute)", () => {
    const result = verifyBookingIdentity({
      ...BASE,
      callerNumber: "+15559998888",
      verify: { full_name: "Jordan Lee", appointment_time: "2026-01-15T15:00:00.000Z" },
    });
    expect(result).toEqual({ ok: false, reason: "time_mismatch" });
  });

  it("rejects when there is no customer name on file to compare against", () => {
    const result = verifyBookingIdentity({
      ...BASE,
      customerName: null,
      callerNumber: "+15559998888",
      verify: { full_name: "Jordan Lee", appointment_time: BASE.bookingStartAt },
    });
    expect(result).toEqual({ ok: false, reason: "name_mismatch" });
  });

  it("never reads back customer PII on failure (only a reason code)", () => {
    const result = verifyBookingIdentity({
      ...BASE,
      callerNumber: "+15559998888",
      verify: { full_name: "wrong", appointment_time: BASE.bookingStartAt },
    });
    expect(Object.keys(result)).toEqual(["ok", "reason"]);
  });
});
