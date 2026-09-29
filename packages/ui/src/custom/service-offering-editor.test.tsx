import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ServiceOfferingEditor } from "./service-offering-editor.js";

const OFFERINGS = [
  { id: "o1", name: "Oil change", durationMinutes: 30, priceCents: 4999, active: true },
  { id: "o2", name: "Tire rotation", durationMinutes: null, priceCents: null, active: true },
];

describe("ServiceOfferingEditor", () => {
  it("QA-1 F-11: renders a card per service (name, length, price, Edit/Delete) for phone widths", async () => {
    const onChange = vi.fn();
    render(<ServiceOfferingEditor offerings={OFFERINGS} onChange={onChange} />);
    const cards = screen.getByTestId("service-cards");
    // The cards sit in an md:hidden list, the table in a hidden md:block — never both on screen.
    expect(cards.className).toContain("md:hidden");
    const card = within(cards).getAllByRole("listitem")[0] as HTMLElement;
    expect(within(card).getByText("$49.99")).toBeInTheDocument();
    expect(within(card).getByText("30 min")).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Edit Oil change" }));
    expect(onChange).toHaveBeenCalledWith("edit", OFFERINGS[0]);
    await userEvent.click(within(card).getByRole("button", { name: "Delete Oil change" }));
    expect(onChange).toHaveBeenCalledWith("delete", OFFERINGS[0]);
  });

  it("QA-1 MAP-15: the actions column header is not empty (screen-reader 'Actions')", () => {
    render(<ServiceOfferingEditor offerings={OFFERINGS} onChange={() => {}} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers).toHaveLength(5);
    for (const header of headers) expect(header.textContent?.trim()).not.toBe("");
    expect(headers[4]).toHaveTextContent("Actions");
  });

  it("QA-1 F-5: readOnly hides Add, Edit and Delete everywhere", () => {
    render(<ServiceOfferingEditor offerings={OFFERINGS} onChange={() => {}} readOnly />);
    expect(screen.queryByRole("button", { name: /Add service/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete / })).not.toBeInTheDocument();
    expect(screen.getAllByText("Oil change").length).toBeGreaterThan(0);
  });
});
