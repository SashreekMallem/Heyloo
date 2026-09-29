import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CarrierForwardingCard, telHref } from "./carrier-forwarding-card.js";

describe("CarrierForwardingCard (QA-1 F-2)", () => {
  it("substitutes the number and percent-encodes # in the tel: link", () => {
    render(
      <CarrierForwardingCard
        carrier="AT&T"
        codes={[{ label: "Forward when busy or unanswered", code: "*004*{number}*11#" }]}
        forwardingNumber="6105383920"
      />,
    );
    expect(screen.getByText("*004*6105383920*11#")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Dial Forward when busy/ }).getAttribute("href")).toBe(
      "tel:*004*6105383920*11%23",
    );
  });

  it("telHref keeps * and + but drops other punctuation", () => {
    expect(telHref("##004#")).toBe("tel:%23%23004%23");
    expect(telHref("*71 (610) 538-3920")).toBe("tel:*716105383920");
  });
});
