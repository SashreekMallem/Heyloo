import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UsageMeter } from "./usage-meter.js";

describe("UsageMeter", () => {
  it("renders a normal fraction when included minutes is set", () => {
    render(<UsageMeter includedMinutes={300} usedMinutes={120} overageMinutes={0} />);
    expect(screen.getByText("120 of 300 minutes used")).toBeInTheDocument();
  });

  it("shows 'Unlimited' instead of dividing by zero when included minutes is 0 but some usage exists", () => {
    render(<UsageMeter includedMinutes={0} usedMinutes={45} overageMinutes={0} />);
    expect(screen.getByText("45 minutes used · Unlimited")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("shows a plain '0 of 0' when both included and used minutes are 0", () => {
    render(<UsageMeter includedMinutes={0} usedMinutes={0} overageMinutes={0} />);
    expect(screen.getByText("0 of 0 minutes used")).toBeInTheDocument();
  });

  it("never renders NaN for a missing/non-finite included minutes value", () => {
    render(
      <UsageMeter
        includedMinutes={Number.NaN}
        usedMinutes={Number.NaN}
        overageMinutes={Number.NaN}
      />,
    );
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.getByText("0 of 0 minutes used")).toBeInTheDocument();
  });
});
