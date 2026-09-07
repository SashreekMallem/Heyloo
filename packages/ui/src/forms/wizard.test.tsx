import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useWizard, Wizard } from "./wizard.js";

function Harness() {
  const wizard = useWizard();
  return (
    <div>
      <p>step:{wizard.currentIndex}</p>
      <p>completed:{[...wizard.completed].join(",")}</p>
      <button type="button" onClick={wizard.next}>
        next
      </button>
      <button type="button" onClick={wizard.back}>
        back
      </button>
      <button type="button" onClick={() => wizard.goTo(2)}>
        goto2
      </button>
    </div>
  );
}

describe("Wizard", () => {
  it("starts at initialIndex", () => {
    render(
      <Wizard totalSteps={4} initialIndex={1}>
        <Harness />
      </Wizard>,
    );
    expect(screen.getByText("step:1")).toBeInTheDocument();
  });

  it("advances with next() and marks the previous step completed", async () => {
    const user = userEvent.setup();
    render(
      <Wizard totalSteps={3}>
        <Harness />
      </Wizard>,
    );
    await user.click(screen.getByText("next"));
    expect(screen.getByText("step:1")).toBeInTheDocument();
    expect(screen.getByText("completed:0")).toBeInTheDocument();
  });

  it("never advances past the last step", async () => {
    const user = userEvent.setup();
    render(
      <Wizard totalSteps={2} initialIndex={1}>
        <Harness />
      </Wizard>,
    );
    await user.click(screen.getByText("next"));
    expect(screen.getByText("step:1")).toBeInTheDocument();
  });

  it("never goes back below the first step", async () => {
    const user = userEvent.setup();
    render(
      <Wizard totalSteps={3}>
        <Harness />
      </Wizard>,
    );
    await user.click(screen.getByText("back"));
    expect(screen.getByText("step:0")).toBeInTheDocument();
  });

  it("goTo clamps to the valid range and jumps directly", async () => {
    const user = userEvent.setup();
    render(
      <Wizard totalSteps={4}>
        <Harness />
      </Wizard>,
    );
    await user.click(screen.getByText("goto2"));
    expect(screen.getByText("step:2")).toBeInTheDocument();
  });
});
