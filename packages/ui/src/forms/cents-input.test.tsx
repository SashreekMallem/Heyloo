import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { CentsInput, CurrencyInput, parseCurrencyToCents } from "./cents-input.js";

describe("parseCurrencyToCents (QA-1 F-4)", () => {
  it.each([
    ["45.99", 4599],
    ["1,234.50", 123450],
    ["$20", 2000],
    ["$ 20.5", 2050],
    ["1234", 123400],
    [".5", 50],
    ["20.", 2000],
    ["0", 0],
    ["19.99", 1999],
    ["0.29", 29],
    ["1,000", 100000],
  ])("accepts %j as %d cents", (raw, cents) => {
    expect(parseCurrencyToCents(raw)).toEqual({ kind: "ok", cents });
  });

  it.each([
    "12abc",
    "abc",
    "1e3",
    "45.555",
    "-5",
    "1,23",
    "12,34.5",
    "1,2345",
    ".",
    "$",
    "1.2.3",
    "9999999999999.00",
  ])("rejects %j", (raw) => {
    expect(parseCurrencyToCents(raw)).toEqual({ kind: "invalid" });
  });

  it("treats blank as empty", () => {
    expect(parseCurrencyToCents("")).toEqual({ kind: "empty" });
    expect(parseCurrencyToCents("   ")).toEqual({ kind: "empty" });
  });
});

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

  it("reads a thousands-grouped amount correctly instead of stopping at the comma", () => {
    let latest: number | undefined;
    render(<CentsInput value={undefined} onChange={(cents) => (latest = cents)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "1,234.50" } });
    expect(latest).toBe(123450);
  });

  it("accepts a leading dollar sign", () => {
    let latest: number | undefined;
    render(<CentsInput value={undefined} onChange={(cents) => (latest = cents)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "$20" } });
    expect(latest).toBe(2000);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports undefined when cleared", () => {
    let latest: number | undefined = 100;
    render(<CentsInput value={500} onChange={(cents) => (latest = cents)} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    expect(latest).toBeUndefined();
  });

  it.each(["abc", "12abc", "1e3", "45.555"])(
    "reports NaN (so the form fails validation) and shows an error for %j",
    (typed) => {
      let latest: number | undefined = 100;
      render(<CentsInput value={100} onChange={(cents) => (latest = cents)} />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: typed } });
      expect(latest).toBeNaN();
      expect(screen.getByRole("alert")).toHaveTextContent(/valid|amount/i);
      expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
    },
  );

  it("clears the error once the text becomes valid again", () => {
    render(<CentsInput value={100} onChange={() => {}} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "12abc" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "12" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reformats a valid entry to two decimals on blur", () => {
    render(<CentsInput value={undefined} onChange={() => {}} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "$1,234.5" } });
    fireEvent.blur(box);
    expect(box).toHaveValue("1234.50");
  });

  it("leaves invalid text alone on blur so the person can fix it", () => {
    render(<CentsInput value={undefined} onChange={() => {}} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "12abc" } });
    fireEvent.blur(box);
    expect(box).toHaveValue("12abc");
  });

  it("adopts an external value change (form reset) but not the echo of its own report", () => {
    function Harness() {
      const [v, setV] = useState<number | undefined>(500);
      return (
        <>
          <CentsInput value={v} onChange={setV} />
          <button type="button" onClick={() => setV(2500)}>
            reset
          </button>
        </>
      );
    }
    render(<Harness />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "7" } });
    // Own echo: the typed text is preserved verbatim (not reformatted to 7.00).
    expect(box).toHaveValue("7");
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    expect(box).toHaveValue("25.00");
  });

  it("does not rewrite an emptied field to 0.00 while typing when the parent maps empty to 0", () => {
    function Harness() {
      const [v, setV] = useState<number>(500);
      return <CentsInput value={v} onChange={(cents) => setV(cents ?? 0)} />;
    }
    render(<Harness />);
    const box = screen.getByRole("textbox");
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: "" } });
    expect(box).toHaveValue("");
    fireEvent.change(box, { target: { value: "5" } });
    expect(box).toHaveValue("5");
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);
    // Blur re-syncs to what the form actually holds.
    expect(box).toHaveValue("0.00");
  });
});

describe("CurrencyInput (CentsInput alias, DESIGN-4)", () => {
  it("is the same conversion, under the customer-facing name", () => {
    expect(CurrencyInput).toBe(CentsInput);
  });
});
