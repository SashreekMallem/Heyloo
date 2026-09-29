import { describe, expect, it } from "vitest";
import {
  describeOutboundMessage,
  isConversationTemplate,
  isOutboundDelivered,
  undeliveredReason,
} from "./outbound-preview";

describe("describeOutboundMessage", () => {
  it("returns the verbatim body for an owner's own reply", () => {
    expect(describeOutboundMessage("owner_reply", { body: "Sure, see you then!" })).toEqual({
      text: "Sure, see you then!",
      isVerbatim: true,
    });
  });

  it("returns a neutral label for a known system template", () => {
    expect(describeOutboundMessage("payment_link", { url: "https://pay" })).toEqual({
      text: "Payment link sent",
      isVerbatim: false,
    });
  });

  it("renders take_message verbatim with caller name, message text, and callback window", () => {
    expect(
      describeOutboundMessage("take_message", {
        caller_name: "Jordan",
        caller_phone: "+15551234567",
        message_text: "Please call me back",
        callback_window: "weekday afternoons",
      }),
    ).toEqual({
      text: 'Jordan left a message: "Please call me back" (callback: weekday afternoons)',
      isVerbatim: true,
    });
  });

  it("renders take_message without a callback segment when callback_window is absent", () => {
    expect(
      describeOutboundMessage("take_message", {
        caller_name: "Jordan",
        message_text: "Please call me back",
      }),
    ).toEqual({
      text: 'Jordan left a message: "Please call me back"',
      isVerbatim: true,
    });
  });

  it("falls back to a generic label for an unrecognized template", () => {
    expect(describeOutboundMessage("something_new", {})).toEqual({
      text: "System message sent",
      isVerbatim: false,
    });
  });
});

describe("delivery-aware labels (QA-1 F-03)", () => {
  it("only sent/delivered count as delivered", () => {
    expect(isOutboundDelivered("sent")).toBe(true);
    expect(isOutboundDelivered("delivered")).toBe(true);
    for (const s of ["queued", "failed", "bounced", "pending_verification", null, undefined]) {
      expect(isOutboundDelivered(s)).toBe(false);
    }
  });

  it("never labels a failed / queued / pending-verification system message as 'sent'", () => {
    expect(describeOutboundMessage("booking_confirmation", {}, "failed").text).toBe(
      "Booking confirmation - not sent - delivery failed",
    );
    expect(describeOutboundMessage("booking_cancelled", {}, "queued").text).toBe(
      "Cancellation notice - queued - waiting to send",
    );
    expect(describeOutboundMessage("something_new", {}, "pending_verification").text).toBe(
      "System message - not sent - texting is pending verification",
    );
    expect(describeOutboundMessage("booking_confirmation", {}, "delivered").text).toBe(
      "Booking confirmation sent",
    );
  });

  it("labels the templates that used to fall through to 'System message sent'", () => {
    expect(describeOutboundMessage("waitlist_slot_opened", {}, "sent").text).toBe(
      "Waitlist opening notice sent",
    );
    expect(describeOutboundMessage("weekly_value_summary", {}, "sent").text).toBe(
      "Weekly summary sent",
    );
  });

  it("explains reasons and identifies conversation templates", () => {
    expect(undeliveredReason("sent")).toBeNull();
    expect(undeliveredReason("bounced")).toContain("failed");
    expect(isConversationTemplate("owner_reply")).toBe(true);
    expect(isConversationTemplate("take_message")).toBe(true);
    expect(isConversationTemplate("booking_confirmation")).toBe(false);
  });
});
