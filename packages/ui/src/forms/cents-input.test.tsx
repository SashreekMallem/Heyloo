import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CentsInput, CurrencyInput } from "./cents-input.js";

describe("CentsInput", () => {
  it("displays a cents value as its equivalent dollar amount", () => {
    render(<CentsInput value={4599} onChange={() => {}} />);
    expect(screen.getByRole("textbox")).toHaveValue("45.99");
  });

  it("reports a typed dollar amount back as cents", () => {
    let latest: number | undefined;
    render(<CentsInput value={undefined} onChange={(cents) => (latest = cents)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "45.99" } });
    expect(latest).toBe(4599);
  });

  it("reports undefined when cleared", () => {
    let latest: number | undefined = 100;
    render(<CentsInput value={500} onChange={(cents) => (latest = cents)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(latest).toBeUndefined();
  });

  it("ignores a non-numeric edit rather than reporting NaN", () => {
    let latest: number | undefined = 100;
    render(<CentsInput value={100} onChange={(cents) => (latest = cents)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "abc" } });
    expect(latest).toBe(100);
  });
});

describe("CurrencyInput (CentsInput alias, DESIGN-4)", () => {
  it("is the same conversion, under the customer-facing name", () => {
    expect(CurrencyInput).toBe(CentsInput);
  });
});
