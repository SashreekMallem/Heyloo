import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge.js";

describe("StatusBadge — invoice variant", () => {
  // billing/page.tsx used to route invoice statuses through `variant="tenant"`
  // (the tenant *lifecycle* palette) — every real `billing_invoices.status`
  // value except "past_due" fell through to a default "outline" instead of
  // a status-appropriate color (DESIGN-4).
  it.each([
    ["draft", "Draft"],
    ["finalized", "Finalized"],
    ["paid", "Paid"],
    ["past_due", "Past due"],
    ["void", "Void"],
  ])("labels %s as %s", (status, label) => {
    render(<StatusBadge variant="invoice" value={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("gives paid and void invoices visually distinct colors (not both the shared default)", () => {
    const { container: paidContainer } = render(<StatusBadge variant="invoice" value="paid" />);
    const { container: voidContainer } = render(<StatusBadge variant="invoice" value="void" />);
    const paidClass = paidContainer.firstElementChild?.className;
    const voidClass = voidContainer.firstElementChild?.className;
    expect(paidClass).toBeTruthy();
    expect(paidClass).not.toBe(voidClass);
  });

  it("falls back to a plain, non-crashing label for an unrecognized value", () => {
    render(<StatusBadge variant="invoice" value="something_new" />);
    expect(screen.getByText("Something new")).toBeInTheDocument();
  });
});
