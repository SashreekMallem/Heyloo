"use client";

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../primitives/button.js";
import { Calendar } from "../primitives/calendar.js";
import { Popover, PopoverContent, PopoverTrigger } from "../primitives/popover.js";

export interface DateRange {
  from: Date | undefined;
  to?: Date | undefined;
}

export interface DateRangePickerProps {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  className?: string;
}

function formatRange(range: DateRange | undefined): string {
  if (!range?.from) return "Pick a date range";
  const from = range.from.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!range.to) return from;
  const to = range.to.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${from} – ${to}`;
}

/** Used by `DateRangePills`' "custom" option and the margin cockpit's period selector. */
export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <CalendarIcon className="size-4" />
          {formatRange(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={value as never}
          onSelect={(range: unknown) => onChange(range as DateRange)}
          numberOfMonths={2}
        />
      </PopoverContent>
    </Popover>
  );
}
