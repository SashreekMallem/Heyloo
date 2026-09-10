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

  it("falls back to a generic label for an unrecognized template", () => {
    expect(describeOutboundMessage("something_new", {})).toEqual({
      text: "System message sent",
      isVerbatim: false,
    });
  });
});
