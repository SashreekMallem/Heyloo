import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type LeadRowData, LeadTable } from "./lead-table.js";

function lead(overrides: Partial<LeadRowData> = {}): LeadRowData {
  return {
    id: "l1",
    companyName: "Acme Auto",
    contactName: "Jane Doe",
    email: "owner@acme.example",
    status: "new",
    suppressed: false,
    isDuplicate: false,
    ...overrides,
  };
}

// OUTREACH-2: Score column (phone-complaint review scoring).
describe("LeadTable — Score column", () => {
  it("shows a dash for a lead that hasn't been scored yet", () => {
    render(<LeadTable data={[lead({ phoneComplaintScore: null })]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the score as a rounded percentage", () => {
    render(<LeadTable data={[lead({ phoneComplaintScore: 0.83 })]} />);
    expect(screen.getByText("83%")).toBeInTheDocument();
  });

  it("visually distinguishes a high-scoring lead from a low-scoring one", () => {
    const { container: highContainer } = render(
      <LeadTable data={[lead({ id: "high", phoneComplaintScore: 0.9 })]} />,
    );
    const { container: lowContainer } = render(
      <LeadTable data={[lead({ id: "low", phoneComplaintScore: 0.1 })]} />,
    );
    const highBadge = screen.getAllByText("90%")[0]?.className;
    void highContainer;
    void lowContainer;
    const lowBadge = screen.getByText("10%").className;
    expect(highBadge).toBeTruthy();
    expect(highBadge).not.toBe(lowBadge);
  });
});
