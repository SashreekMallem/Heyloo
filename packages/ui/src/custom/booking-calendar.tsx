"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../lib/utils.js";
import { Button } from "../primitives/button.js";
import { StatusBadge } from "./status-badge.js";

export interface BookingCalendarEntry {
  id: string;
  startAt: string;
  customerName: string | null;
  status: string;
}

export type BookingCalendarView = "list" | "calendar";

export interface BookingCalendarProps {
  bookings: BookingCalendarEntry[];
  view: BookingCalendarView;
  onViewChange: (view: BookingCalendarView) => void;
  onSelect: (booking: BookingCalendarEntry) => void;
  className?: string;
}

function startOfMonthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startWeekday = first.getDay();
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startWeekday);
  return Array.from({ length: 42 }, (_, i) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + i);
    return day;
  });
}

/**
 * Month/week grid — hand-rolled CSS grid, not a scheduler library
 * (FRONTEND_SPEC.md §1.3/§6.4 DECIDE — bookings here are appointment-shaped,
 * not drag-resize-heavy). Below `sm`, callers should switch `view` to
 * "list" — a full month grid is unusable at phone width (§6.4 mobile rule);
 * this component itself does not force that switch since the surrounding
 * page owns the breakpoint decision alongside its own `List`/`Calendar`
 * toggle control.
 */
export function BookingCalendar({
  bookings,
  view,
  onViewChange,
  onSelect,
  className,
}: BookingCalendarProps) {
  const [anchor, setAnchor] = useState(() => new Date());

  const byDay = useMemo(() => {
    const map = new Map<string, BookingCalendarEntry[]>();
    for (const booking of bookings) {
      const key = new Date(booking.startAt).toDateString();
      const list = map.get(key) ?? [];
      list.push(booking);
      map.set(key, list);
    }
    return map;
  }, [bookings]);

  if (view === "list") {
    return (
      <div className={cn("space-y-2", className)}>
        {bookings
          .slice()
          .sort((a, b) => a.startAt.localeCompare(b.startAt))
          .map((booking) => (
            <button
              key={booking.id}
              type="button"
              onClick={() => onSelect(booking)}
              className="flex w-full items-center justify-between rounded-md border border-border p-3 text-left hover:bg-muted/60"
            >
              <div>
                <p className="text-sm font-medium">{booking.customerName ?? "Unknown customer"}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(booking.startAt).toLocaleString([], {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <StatusBadge variant="booking" value={booking.status} />
            </button>
          ))}
      </div>
    );
  }

  const days = startOfMonthGrid(anchor);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm font-medium">
          {anchor.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
          <div key={label} className="bg-muted p-1 text-center font-medium text-muted-foreground">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const inMonth = day.getMonth() === anchor.getMonth();
          const dayBookings = byDay.get(day.toDateString()) ?? [];
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-20 bg-background p-1",
                !inMonth && "bg-muted/40 text-muted-foreground",
              )}
            >
              <div className="text-right text-[11px]">{day.getDate()}</div>
              <div className="mt-1 space-y-0.5">
                {dayBookings.slice(0, 3).map((booking) => (
                  <button
                    key={booking.id}
                    type="button"
                    onClick={() => onSelect(booking)}
                    className="block w-full truncate rounded bg-secondary px-1 py-0.5 text-left text-[10px] hover:bg-secondary/80"
                  >
                    {new Date(booking.startAt).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    {booking.customerName ?? ""}
                  </button>
                ))}
                {dayBookings.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{dayBookings.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end gap-2 sm:hidden">
        <Button size="sm" variant="outline" onClick={() => onViewChange("list")}>
          Switch to agenda view
        </Button>
      </div>
    </div>
  );
}
