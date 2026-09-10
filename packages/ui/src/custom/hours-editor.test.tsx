import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HoursEditor, type WeeklyHours } from "./hours-editor.js";

const DAY: WeeklyHours[keyof WeeklyHours][number] = {
  open: "09:00",
  close: "17:00",
  closed: false,
};

const HOURS: WeeklyHours = {
  mon: [DAY],
  tue: [DAY],
  wed: [DAY],
  thu: [DAY],
  fri: [DAY],
  sat: [{ open: "09:00", close: "17:00", closed: true }],
  sun: [{ open: "09:00", close: "17:00", closed: true }],
};

describe("HoursEditor", () => {
  it("renders normally when exceptions is a real array", () => {
    render(<HoursEditor hours={HOURS} exceptions={[]} onChange={vi.fn()} />);
    expect(screen.getByText("No exceptions added.")).toBeInTheDocument();
  });

  it("does not crash when exceptions is undefined and treats it as empty", () => {
    // Real data doesn't always honor the `HoursException[]` type — a
    // wrong-typed or missing `hours_exceptions` column must never throw
    // "exceptions.map is not a function".
    const exceptions = undefined as unknown as Parameters<typeof HoursEditor>[0]["exceptions"];
    expect(() =>
      render(<HoursEditor hours={HOURS} exceptions={exceptions} onChange={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByText("No exceptions added.")).toBeInTheDocument();
  });

  it("does not crash when exceptions is null and treats it as empty", () => {
    const exceptions = null as unknown as Parameters<typeof HoursEditor>[0]["exceptions"];
    expect(() =>
      render(<HoursEditor hours={HOURS} exceptions={exceptions} onChange={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByText("No exceptions added.")).toBeInTheDocument();
  });

  it("does not crash when exceptions is a non-array (e.g. a synthesized placeholder string)", () => {
    const exceptions = "Sample hours exceptions" as unknown as Parameters<
      typeof HoursEditor
    >[0]["exceptions"];
    expect(() =>
      render(<HoursEditor hours={HOURS} exceptions={exceptions} onChange={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByText("No exceptions added.")).toBeInTheDocument();
  });

  it("still renders real exceptions when the prop is a proper array", () => {
    render(
      <HoursEditor
        hours={HOURS}
        exceptions={[{ date: "2026-12-25", closed: true, note: "Christmas" }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("No exceptions added.")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Christmas")).toBeInTheDocument();
  });

  it("keeps the open/close time pair grouped in one wrap unit (768px wrap fix)", () => {
    render(<HoursEditor hours={HOURS} exceptions={[]} onChange={vi.fn()} />);
    const openInput = screen.getByLabelText("Monday opening time");
    const closeInput = screen.getByLabelText("Monday closing time");
    // Both time inputs (and the "to" between them) must share one
    // non-wrapping flex parent so they move to the next line together
    // instead of the "to" and closing time splitting apart.
    expect(openInput.parentElement).toBe(closeInput.parentElement);
    expect(openInput.parentElement).toHaveClass("flex-nowrap");
  });
});
