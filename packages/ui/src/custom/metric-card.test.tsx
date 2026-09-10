import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricCard } from "./metric-card.js";

describe("MetricCard", () => {
  it("renders a formatted numeric value", () => {
    render(<MetricCard label="Calls today" value={12} format="number" />);
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders 0 as a real value, not the empty state", () => {
    render(<MetricCard label="Bookings today" value={0} format="number" />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });

  it("shows a designed empty state (not a bare '—') for a non-finite value", () => {
    render(<MetricCard label="Avg handle time" value={Number.NaN} format="duration" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  it("shows the loading skeleton (not the empty state) while loading, even with a non-finite value", () => {
    render(<MetricCard label="Avg handle time" value={Number.NaN} format="duration" loading />);
    expect(screen.queryByText("No data")).not.toBeInTheDocument();
  });
});
