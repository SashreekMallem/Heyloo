import { describe, expect, it } from "vitest";
import { describeOutboundMessage } from "./outbound-preview";

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
