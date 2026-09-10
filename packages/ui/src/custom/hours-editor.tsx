"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "../primitives/button.js";
import { Checkbox } from "../primitives/checkbox.js";
import { Input } from "../primitives/input.js";
import { Label } from "../primitives/label.js";

export type DayHours = {
  open: string;
  close: string;
  closed: boolean;
};

export type HoursException = {
  date: string;
  closed?: boolean;
  open?: string;
  close?: string;
  note?: string;
};

export type WeeklyHours = {
  mon: DayHours[];
  tue: DayHours[];
  wed: DayHours[];
  thu: DayHours[];
  fri: DayHours[];
  sat: DayHours[];
  sun: DayHours[];
};

const DAY_LABELS: { key: keyof WeeklyHours; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export type HoursEditorProps = {
  hours: WeeklyHours;
  exceptions: HoursException[];
  onChange: (hours: WeeklyHours, exceptions: HoursException[]) => void;
};

/** Weekly hours + holiday exceptions — Agent → Hours (FRONTEND_SPEC.md §1.3/§6.6). */
export function HoursEditor({ hours, exceptions, onChange }: HoursEditorProps) {
  function updateDay(day: keyof WeeklyHours, index: number, patch: Partial<DayHours>) {
    const next = {
      ...hours,
      [day]: hours[day].map((h, i) => (i === index ? { ...h, ...patch } : h)),
    };
    onChange(next, exceptions);
  }

  function addException() {
    onChange(hours, [...exceptions, { date: "", closed: true }]);
  }

  function removeException(index: number) {
    onChange(
      hours,
      exceptions.filter((_, i) => i !== index),
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {DAY_LABELS.map(({ key, label }) => {
          const day = hours[key][0] ?? { open: "09:00", close: "17:00", closed: false };
          return (
            <div key={key} className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm font-medium">{label}</span>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`${key}-closed`}
                  checked={day.closed}
                  onCheckedChange={(checked) => updateDay(key, 0, { closed: checked === true })}
                />
                <Label htmlFor={`${key}-closed`} className="font-normal">
                  Closed
                </Label>
              </div>
              {!day.closed && (
                <>
                  <Input
                    type="time"
                    className="w-32"
                    value={day.open}
                    onChange={(e) => updateDay(key, 0, { open: e.target.value })}
                    aria-label={`${label} opening time`}
                  />
                  <span className="text-sm text-muted-foreground">to</span>
                  <Input
                    type="time"
                    className="w-32"
                    value={day.close}
                    onChange={(e) => updateDay(key, 0, { close: e.target.value })}
                    aria-label={`${label} closing time`}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Holiday exceptions</h4>
          <Button size="sm" variant="outline" onClick={addException}>
            <Plus className="size-3.5" /> Add exception
          </Button>
        </div>
        {exceptions.length === 0 && (
          <p className="text-sm text-muted-foreground">No exceptions added.</p>
        )}
        {exceptions.map((exception, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: new exceptions start with an empty date, so date isn't unique
            key={index}
            className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2"
          >
            <Input
              type="date"
              className="w-40"
              value={exception.date}
              onChange={(e) => {
                const next = exceptions.map((ex, i) =>
                  i === index ? { ...ex, date: e.target.value } : ex,
                );
                onChange(hours, next);
              }}
              aria-label="Exception date"
            />
            <Input
              placeholder="Note (e.g. Christmas)"
              className="flex-1"
              value={exception.note ?? ""}
              onChange={(e) => {
                const next = exceptions.map((ex, i) =>
                  i === index ? { ...ex, note: e.target.value } : ex,
                );
                onChange(hours, next);
              }}
              aria-label="Exception note"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => removeException(index)}
              aria-label="Remove exception"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
