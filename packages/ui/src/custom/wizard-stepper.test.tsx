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

  it("sizes label visibility to the stepper's own width, not the viewport", () => {
    // A six-step stepper in the signup wizard's 448px column once showed every
    // nowrap label at lg and they ran into each other.
    const six = ["Business info", "Plan", "Account", "Payment", "Provisioning", "Phone setup"];
    const { container } = render(<WizardStepper steps={six} current={2} completed={[0, 1]} />);
    expect(container.querySelector("ol")?.className).toContain("@container");
    for (const step of six) {
      const cls = screen.getByText(step).className;
      expect(cls).not.toMatch(/(^|\s)(sm|md|lg|xl):inline/);
      expect(cls).toContain(step === "Account" ? "@2xs:inline" : "@4xl:inline");
    }
  });
});
