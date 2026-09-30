import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  BookingCalendar,
  type BookingCalendarEntry,
  startOfMonthGrid,
} from "./booking-calendar.js";

const bookings: BookingCalendarEntry[] = [
  { id: "a", startAt: "2026-09-10T15:00:00Z", customerName: "Alpha Early", status: "scheduled" },
  { id: "b", startAt: "2026-09-20T15:00:00Z", customerName: "Bravo Late", status: "scheduled" },
];

function order() {
  return screen.getAllByRole("button").map((b) => b.textContent ?? "");
}

describe("BookingCalendar (QA-1 F-08 / F-20)", () => {
  it("lists soonest first by default and newest first with listOrder=desc", () => {
    const { rerender } = render(
      <BookingCalendar
        bookings={bookings}
        view="list"
        onViewChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(order()[0]).toContain("Alpha Early");
    rerender(
      <BookingCalendar
        bookings={bookings}
        view="list"
        listOrder="desc"
        onViewChange={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(order()[0]).toContain("Bravo Late");
  });

  it("reports the newly visible month when paged, so the page can fetch that month", async () => {
    const onMonthChange = vi.fn();
    const user = userEvent.setup();
    render(
      <BookingCalendar
        bookings={[]}
        view="calendar"
        onViewChange={() => {}}
        onSelect={() => {}}
        onMonthChange={onMonthChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Next month" }));
    const next = onMonthChange.mock.calls[0]?.[0] as Date;
    const now = new Date();
    expect(next.getMonth()).toBe(new Date(now.getFullYear(), now.getMonth() + 1, 1).getMonth());
    expect(next.getDate()).toBe(1);
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    const back = onMonthChange.mock.calls[1]?.[0] as Date;
    expect(back.getMonth()).toBe(now.getMonth());
  });

  it("lets calendar chips wrap on phones so an event shows its customer, not just '3:00…'", () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0);
    render(
      <BookingCalendar
        bookings={[
          {
            id: "c",
            startAt: today.toISOString(),
            customerName: "Jamie Cruz",
            status: "scheduled",
          },
        ]}
        view="calendar"
        onViewChange={() => {}}
        onSelect={() => {}}
      />,
    );
    const chip = screen.getByRole("button", { name: /Jamie Cruz/ });
    expect(chip.className).toContain("break-words");
    // truncation is desktop-only
    expect(chip.className).toContain("sm:truncate");
    expect(chip.className).not.toMatch(/(^|\s)truncate(\s|$)/);
  });

  it("startOfMonthGrid always spans 42 days starting on a Sunday", () => {
    const grid = startOfMonthGrid(new Date(2026, 8, 15));
    expect(grid).toHaveLength(42);
    expect(grid[0]?.getDay()).toBe(0);
  });
});
