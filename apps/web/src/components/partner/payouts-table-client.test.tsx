import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayoutsTableClient } from "./payouts-table-client";

describe("PayoutsTableClient", () => {
  it("renders the real referral_payouts columns (total_cents/period/status, not the stale amount_cents/method shape)", () => {
    render(
      <PayoutsTableClient
        payouts={[
          {
            id: "p1",
            total_cents: 12500,
            period: "2026-08-01",
            status: "sent",
            created_at: "2026-08-01T00:00:00Z",
          },
        ]}
      />,
    );
    expect(screen.getByText("$125.00")).toBeInTheDocument();
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("shows an empty state with no payouts", () => {
    render(<PayoutsTableClient payouts={[]} />);
    expect(screen.getByText("No payouts yet")).toBeInTheDocument();
  });
});
