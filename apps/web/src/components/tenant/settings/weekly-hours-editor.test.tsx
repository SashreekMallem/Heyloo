import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type HoursPayload, scheduleFromStored } from "@/lib/settings/hours";
import { WeeklyHoursEditor } from "./weekly-hours-editor";

function Harness({
  initial,
  errors,
  onValue,
}: {
  initial: HoursPayload;
  errors?: Record<string, string>;
  onValue: (value: HoursPayload) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <WeeklyHoursEditor
      value={value}
      errors={errors ?? {}}
      onChange={(next) => {
        setValue(next);
        onValue(next);
      }}
    />
  );
}

const STORED_WEEK = {
  mon: [{ open: "08:00", close: "18:00" }],
  tue: [{ open: "08:00", close: "18:00" }],
  wed: [{ open: "08:00", close: "18:00" }],
  thu: [{ open: "08:00", close: "18:00" }],
  fri: [{ open: "08:00", close: "18:00" }],
  sat: [],
  sun: [],
};

describe("WeeklyHoursEditor (SETTINGS-1)", () => {
  it("shows a day stored as [] as CLOSED (the old editor showed it open 9-5 and dropped edits)", () => {
    render(
      <Harness
        initial={{ hours: scheduleFromStored(STORED_WEEK), exceptions: [] }}
        onValue={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Saturday closed" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Monday closed" })).not.toBeChecked();
    expect(screen.queryByLabelText("Saturday opening time")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Monday opening time")).toHaveValue("08:00");
  });

  it("re-opening a closed day makes its times editable", async () => {
    const onValue = vi.fn();
    render(
      <Harness
        initial={{ hours: scheduleFromStored(STORED_WEEK), exceptions: [] }}
        onValue={onValue}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: "Saturday closed" }));
    const open = screen.getByLabelText("Saturday opening time");
    fireEvent.change(open, { target: { value: "10:00" } });
    const last = onValue.mock.calls.at(-1)?.[0] as HoursPayload;
    expect(last.hours.sat).toEqual({ closed: false, windows: [{ open: "10:00", close: "17:00" }] });
  });

  it("adds a second time range (split shift) and a special-hours date", async () => {
    const onValue = vi.fn();
    render(
      <Harness
        initial={{ hours: scheduleFromStored(STORED_WEEK), exceptions: [] }}
        onValue={onValue}
      />,
    );
    await userEvent.click(screen.getAllByRole("button", { name: /Add a break/ })[0] as HTMLElement);
    let last = onValue.mock.calls.at(-1)?.[0] as HoursPayload;
    expect(last.hours.mon.windows).toEqual([
      { open: "08:00", close: "18:00" },
      { open: "19:00", close: "22:00" },
    ]);

    await userEvent.click(screen.getByRole("button", { name: /Add a date/ }));
    fireEvent.change(screen.getByLabelText("Date 1"), { target: { value: "2026-12-24" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Date 1 closed all day" }));
    last = onValue.mock.calls.at(-1)?.[0] as HoursPayload;
    expect(last.exceptions[0]).toMatchObject({ date: "2026-12-24", closed: false });
    expect(screen.getByLabelText("Date 1 opening time")).toBeInTheDocument();
  });

  it("copies Monday to Tue-Fri", async () => {
    const onValue = vi.fn();
    const hours = scheduleFromStored({ ...STORED_WEEK, mon: [{ open: "07:00", close: "15:00" }] });
    render(<Harness initial={{ hours, exceptions: [] }} onValue={onValue} />);
    await userEvent.click(screen.getByRole("button", { name: "Copy Monday to Tue–Fri" }));
    const last = onValue.mock.calls.at(-1)?.[0] as HoursPayload;
    expect(last.hours.fri.windows).toEqual([{ open: "07:00", close: "15:00" }]);
    expect(last.hours.sat.closed).toBe(true);
  });

  it("shows field errors under the right day and date", () => {
    render(
      <Harness
        initial={{
          hours: scheduleFromStored(STORED_WEEK),
          exceptions: [{ date: "", closed: true, windows: [], note: "" }],
        }}
        errors={{
          "hours.tue.windows.0.close": "Closing time must be after opening time.",
          "exceptions.0.date": "Pick a date.",
        }}
        onValue={vi.fn()}
      />,
    );
    expect(screen.getByText("Closing time must be after opening time.")).toBeInTheDocument();
    expect(screen.getByText("Pick a date.")).toBeInTheDocument();
  });
});
