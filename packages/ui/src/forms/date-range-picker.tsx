"use client";

import { CalendarIcon } from "lucide-react";
import { useEffect, useState } from "react";
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

/** Two months side by side need ~650px; below `sm` (640px) one month is what fits in the popover. */
function useMonthCount(): 1 | 2 {
  const [count, setCount] = useState<1 | 2>(2);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(min-width: 640px)");
    const sync = () => setCount(query.matches ? 2 : 1);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return count;
}

/** Used by `DateRangePills`' "custom" option and the margin cockpit's period selector. */
export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const numberOfMonths = useMonthCount();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={className}>
          <CalendarIcon className="size-4" />
          {formatRange(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label="Choose a date range"
        className="w-auto max-w-[calc(100vw-1rem)] p-0"
      >
        <Calendar
          mode="range"
          selected={value as never}
          onSelect={(range: unknown) => onChange(range as DateRange)}
          numberOfMonths={numberOfMonths}
        />
      </PopoverContent>
    </Popover>
  );
}
