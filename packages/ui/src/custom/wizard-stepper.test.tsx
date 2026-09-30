import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WizardStepper } from "./wizard-stepper.js";

const STEPS = ["Business type", "Business info", "Phone setup", "Plan"];

describe("WizardStepper (QA-1 F-18)", () => {
  it("never wraps a step label onto two lines", () => {
    render(<WizardStepper steps={STEPS} current={1} completed={[0]} />);
    for (const step of STEPS) {
      expect(screen.getByText(step).className).toContain("whitespace-nowrap");
    }
  });

  it("marks the current step for assistive tech", () => {
    render(<WizardStepper steps={STEPS} current={2} completed={[0, 1]} />);
    expect(screen.getByText("Phone setup").closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Plan").closest("li")).not.toHaveAttribute("aria-current");
  });
});
