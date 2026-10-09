"use client";

import { Badge, Button, formatPhoneDisplay } from "@heyloo/ui";
import { formatAge, formatDateTimeInZone, formatTimeInZone } from "@/lib/live/format";
import type { LiveBooking } from "@/lib/live/types";
import { tenantDateKey } from "@/lib/tenant/tz";
import { LiveSection } from "./section";

function whenLabel(startAt: string, now: Date, timeZone: string): string {
  const sameDay = tenantDateKey(timeZone, new Date(startAt)) === tenantDateKey(timeZone, now);
  return sameDay
    ? `Today ${formatTimeInZone(startAt, timeZone)}`
    : formatDateTimeInZone(startAt, timeZone);
}

export function BookingsFeed({
  bookings,
  isNew,
  now,
  timeZone,
  state,
  onAcknowledge,
  onAcknowledgeAll,
}: {
  bookings: LiveBooking[];
  isNew: (booking: LiveBooking) => boolean;
  now: Date;
  timeZone: string;
  state: "loading" | "error" | "ready";
  onAcknowledge: (booking: LiveBooking) => void;
  onAcknowledgeAll: () => void;
}) {
  const newCount = bookings.filter(isNew).length;
  return (
    <LiveSection
      id="live-bookings"
      title="Bookings"
      count={bookings.length}
      state={state}
      errorText="Couldn't load bookings. Trying again every 15 seconds."
      action={
        newCount > 1 ? (
          <Button type="button" variant="outline" size="sm" onClick={onAcknowledgeAll}>
            Mark all seen
          </Button>
        ) : null
      }
    >
      {bookings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No new bookings in the last 24 hours and nothing else coming up today.
        </p>
      ) : (
        <ul className="space-y-3">
          {bookings.map((booking) => {
            const fresh = isNew(booking);
            return (
              <li
                key={booking.id}
                className={
                  fresh
                    ? "rounded-lg border-2 border-primary bg-card p-3"
                    : "rounded-lg border border-border bg-card p-3"
                }
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-lg font-semibold">
                    {whenLabel(booking.startAt, now, timeZone)}
                  </p>
                  {fresh && <Badge>New</Badge>}
                </div>
                <p className="text-base">
                  {booking.customerName ?? "Customer"}
                  {booking.customerPhone && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatPhoneDisplay(booking.customerPhone)}
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">
                  {[
                    booking.serviceName,
                    booking.partySize ? `Party of ${booking.partySize}` : null,
                    `Booked ${formatAge(booking.createdAt, now)}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {booking.notes && <p className="mt-1 text-sm">{booking.notes}</p>}
                {fresh && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => onAcknowledge(booking)}
                  >
                    Got it
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </LiveSection>
  );
}
