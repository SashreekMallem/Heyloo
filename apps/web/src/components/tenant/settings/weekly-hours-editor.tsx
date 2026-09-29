"use client";

import { Button, Checkbox, Input, Label } from "@heyloo/ui";
import { Plus, Trash2 } from "lucide-react";
import {
  DAY_KEYS,
  DAY_LABELS,
  type DayKey,
  type DaySchedule,
  DEFAULT_WINDOW,
  type HoursExceptionInput,
  type HoursPayload,
  MAX_WINDOWS_PER_DAY,
  type TimeWindow,
} from "@/lib/settings/hours";

/**
 * SETTINGS-1: Agent → Hours editor, built on the canonical model in
 * `lib/settings/hours.ts`. Replaces `@heyloo/ui`'s `HoursEditor` on this
 * page because that one (a) rendered a day stored as `[]` (the vertical
 * defaults' closed days) as OPEN 9-5 and silently dropped edits to it,
 * (b) allowed only one window per day, and (c) could only add closed
 * holidays with a blank date. This one supports split shifts (up to 3
 * windows), special-hours exceptions, and shows each field's error inline.
 *
 * `errors` is keyed by the zod issue path joined with "." (e.g.
 * `hours.mon.windows.0.close`, `exceptions.2.date`).
 */
export interface WeeklyHoursEditorProps {
  value: HoursPayload;
  onChange: (next: HoursPayload) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}

/** "HH:MM" plus `minutes`, capped at 23:59 (a range can't cross midnight). */
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = Math.min((h || 0) * 60 + (m || 0) + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function errorsUnder(errors: Record<string, string>, prefix: string): string[] {
  return Object.entries(errors)
    .filter(([path]) => path === prefix || path.startsWith(`${prefix}.`))
    .map(([, message]) => message);
}

function WindowRows({
  label,
  windows,
  onChange,
  disabled,
}: {
  label: string;
  windows: TimeWindow[];
  onChange: (windows: TimeWindow[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {windows.map((window, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: windows have no identity beyond position
          key={index}
          className="flex flex-nowrap items-center gap-2"
        >
          <Input
            type="time"
            className="w-32"
            value={window.open}
            disabled={disabled}
            onChange={(e) =>
              onChange(windows.map((w, i) => (i === index ? { ...w, open: e.target.value } : w)))
            }
            aria-label={`${label} opening time${windows.length > 1 ? ` ${index + 1}` : ""}`}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="time"
            className="w-32"
            value={window.close}
            disabled={disabled}
            onChange={(e) =>
              onChange(windows.map((w, i) => (i === index ? { ...w, close: e.target.value } : w)))
            }
            aria-label={`${label} closing time${windows.length > 1 ? ` ${index + 1}` : ""}`}
          />
          {windows.length > 1 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={disabled}
              onClick={() => onChange(windows.filter((_, i) => i !== index))}
              aria-label={`Remove ${label} time range ${index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      ))}
      {windows.length < MAX_WINDOWS_PER_DAY && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="self-start px-2 text-xs"
          disabled={disabled}
          onClick={() => {
            const last = windows[windows.length - 1];
            // Default: starts an hour after the last range ends, lasts 3 hours.
            const start = last ? addMinutes(last.close, 60) : DEFAULT_WINDOW.open;
            onChange([...windows, { open: start, close: addMinutes(start, 180) }]);
          }}
        >
          <Plus className="size-3.5" /> Add a break / second range
        </Button>
      )}
    </div>
  );
}

export function WeeklyHoursEditor({
  value,
  onChange,
  errors = {},
  disabled = false,
}: WeeklyHoursEditorProps) {
  function setDay(day: DayKey, next: DaySchedule) {
    onChange({ ...value, hours: { ...value.hours, [day]: next } });
  }

  function setException(index: number, next: HoursExceptionInput) {
    onChange({
      ...value,
      exceptions: value.exceptions.map((ex, i) => (i === index ? next : ex)),
    });
  }

  function copyMondayToWeekdays() {
    const monday = value.hours.mon;
    const copy = (): DaySchedule => ({
      closed: monday.closed,
      windows: monday.windows.map((w) => ({ ...w })),
    });
    onChange({
      ...value,
      hours: { ...value.hours, tue: copy(), wed: copy(), thu: copy(), fri: copy() },
    });
  }

  return (
    <div className="space-y-8">
      <fieldset className="space-y-3" disabled={disabled} aria-labelledby="weekly-hours-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="weekly-hours-heading" className="text-sm font-medium">
            Weekly hours
          </h3>
          <Button type="button" size="sm" variant="outline" onClick={copyMondayToWeekdays}>
            Copy Monday to Tue–Fri
          </Button>
        </div>
        {DAY_KEYS.map((day) => {
          const schedule = value.hours[day];
          const label = DAY_LABELS[day];
          const dayErrors = errorsUnder(errors, `hours.${day}`);
          return (
            <div
              key={day}
              className="flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 sm:flex-row sm:items-start sm:gap-4"
            >
              <div className="flex items-center gap-3 sm:w-44 sm:pt-2">
                <span className="w-24 text-sm font-medium">{label}</span>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${day}-closed`}
                    aria-label={`${label} closed`}
                    checked={schedule.closed}
                    onCheckedChange={(checked) =>
                      setDay(day, {
                        closed: checked === true,
                        windows:
                          schedule.windows.length > 0 ? schedule.windows : [{ ...DEFAULT_WINDOW }],
                      })
                    }
                  />
                  <Label htmlFor={`${day}-closed`} className="font-normal">
                    Closed
                  </Label>
                </div>
              </div>
              <div className="flex-1 space-y-1">
                {schedule.closed ? (
                  <p className="text-sm text-muted-foreground sm:pt-2">
                    Closed — no bookings offered.
                  </p>
                ) : (
                  <WindowRows
                    label={label}
                    windows={schedule.windows}
                    disabled={disabled}
                    onChange={(windows) => setDay(day, { closed: false, windows })}
                  />
                )}
                {dayErrors.map((message) => (
                  <p key={message} className="text-xs text-destructive" role="alert">
                    {message}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </fieldset>

      <fieldset className="space-y-3" disabled={disabled} aria-labelledby="exceptions-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="exceptions-heading" className="text-sm font-medium">
            Holidays and special hours
          </h3>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              onChange({
                ...value,
                exceptions: [
                  ...value.exceptions,
                  { date: "", closed: true, windows: [{ ...DEFAULT_WINDOW }], note: "" },
                ],
              })
            }
          >
            <Plus className="size-3.5" /> Add a date
          </Button>
        </div>
        {value.exceptions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No holidays or special hours. Add a date when you&apos;re closed or keep different
            hours.
          </p>
        )}
        {value.exceptions.map((exception, index) => {
          const exErrors = errorsUnder(errors, `exceptions.${index}`);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: a new exception starts with a blank date, so the date isn't a stable key
              key={index}
              className="space-y-2 rounded-md border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="date"
                  className="w-44"
                  value={exception.date}
                  onChange={(e) => setException(index, { ...exception, date: e.target.value })}
                  aria-label={`Date ${index + 1}`}
                  aria-invalid={!!errors[`exceptions.${index}.date`]}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`exception-${index}-closed`}
                    aria-label={`Date ${index + 1} closed all day`}
                    checked={exception.closed}
                    onCheckedChange={(checked) =>
                      setException(index, { ...exception, closed: checked === true })
                    }
                  />
                  <Label htmlFor={`exception-${index}-closed`} className="font-normal">
                    Closed all day
                  </Label>
                </div>
                <Input
                  placeholder="Note (e.g. Thanksgiving)"
                  className="min-w-40 flex-1"
                  value={exception.note}
                  maxLength={200}
                  onChange={(e) => setException(index, { ...exception, note: e.target.value })}
                  aria-label={`Note for date ${index + 1}`}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...value,
                      exceptions: value.exceptions.filter((_, i) => i !== index),
                    })
                  }
                  aria-label={`Remove date ${index + 1}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {!exception.closed && (
                <WindowRows
                  label={`Date ${index + 1}`}
                  windows={exception.windows}
                  disabled={disabled}
                  onChange={(windows) => setException(index, { ...exception, windows })}
                />
              )}
              {exErrors.map((message) => (
                <p key={message} className="text-xs text-destructive" role="alert">
                  {message}
                </p>
              ))}
            </div>
          );
        })}
      </fieldset>
    </div>
  );
}
