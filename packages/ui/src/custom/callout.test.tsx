import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Callout } from "./callout.js";

describe("Callout", () => {
  it("renders a title and body text", () => {
    render(<Callout title="Heads up">This call recording is on hold.</Callout>);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("This call recording is on hold.")).toBeInTheDocument();
  });

  it("renders without a title", () => {
    render(<Callout tone="warning">No consent on file for this customer.</Callout>);
    expect(screen.getByText("No consent on file for this customer.")).toBeInTheDocument();
  });
});
