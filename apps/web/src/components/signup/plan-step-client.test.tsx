import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PriceCardResponse } from "@/app/api/platform-settings/price-card/route";

vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { PlanStepClient } = await import("./plan-step-client");

const CARD: PriceCardResponse = {
  vertical: "auto",
  base_cents: 29900,
  included_minutes: 300,
  overage_cents: 35,
  annual_discount_pct: 12,
  setup_fee_cents: null,
  white_glove_fee_cents: null,
  white_glove_description: null,
};

describe("PlanStepClient free-trial copy (TRIAL-1)", () => {
  it("states the trial terms above the price", () => {
    render(<PlanStepClient priceCard={CARD} />);
    expect(screen.getByText(/starts with a 7-day free trial/i)).toBeInTheDocument();
    expect(
      screen.getByText(/7 days or 100 call minutes, whichever comes first/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/card required\. one free trial per business/i)).toBeInTheDocument();
  });

  it("says the setup fee is waived with the trial, and white-glove is charged at signup", () => {
    render(
      <PlanStepClient
        priceCard={{ ...CARD, setup_fee_cents: 15000, white_glove_fee_cents: 50000 }}
      />,
    );
    expect(screen.getByText("$150.00")).toBeInTheDocument();
    expect(screen.getByText(/waived when you start with the free trial/i)).toBeInTheDocument();
    expect(
      screen.getByText(/charged when you sign up, even during the free trial/i),
    ).toBeInTheDocument();
  });

  it("shows no fee notes when the vertical has no fees", () => {
    render(<PlanStepClient priceCard={CARD} />);
    expect(screen.queryByText(/waived when you start/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/even during the free trial/i)).not.toBeInTheDocument();
  });

  it("labels the checkout step as starting the trial", () => {
    render(<PlanStepClient priceCard={CARD} />);
    expect(screen.getByText("Start trial")).toBeInTheDocument();
    expect(screen.queryByText("Payment")).not.toBeInTheDocument();
  });
});
