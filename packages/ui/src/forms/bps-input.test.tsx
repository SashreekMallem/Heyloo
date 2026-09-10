import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BpsInput } from "./bps-input.js";

describe("BpsInput", () => {
  it("displays a bps value as its equivalent percentage", () => {
    render(<BpsInput value={825} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("8.25");
  });

  it("reports a typed percentage back as basis points", () => {
    let latest: number | undefined;
    render(<BpsInput value={undefined} onChange={(bps) => (latest = bps)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "8.25" } });
    expect(latest).toBe(825);
  });

  it("reports undefined when cleared", () => {
    let latest: number | undefined = 100;
    render(<BpsInput value={500} onChange={(bps) => (latest = bps)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(latest).toBeUndefined();
  });
});
