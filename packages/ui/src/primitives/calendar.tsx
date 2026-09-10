"use client";

import type { ComponentProps } from "react";
import { DayPicker } from "react-day-picker";
import { cn } from "../lib/utils.js";

export type CalendarProps = ComponentProps<typeof DayPicker>;

/**
 * Used by `<DateRangePicker>` and slot pickers (reschedule flow,
 * phone-setup, config-lab period selectors). Deliberately thin — passes
 * through to `react-day-picker`'s own default styling via a handful of
 * Tailwind utility overrides on the wrapper rather than reimplementing its
 * full `classNames` map (that map's exact keys shift between major
 * react-day-picker versions; re-verify against the installed version's docs
 * before hand-tuning per-part styling further).
 */
export function Calendar({ className, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-background p-3 [&_table]:w-full",
        className,
      )}
    >
      <DayPicker showOutsideDays={showOutsideDays} {...props} />
    </div>
  );
}
