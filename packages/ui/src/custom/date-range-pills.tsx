"use client";

import { type DateRange, DateRangePicker } from "../forms/date-range-picker.js";
import { cn } from "../lib/utils.js";
import { Button } from "../primitives/button.js";

export type DateRangePreset = "today" | "7d" | "30d" | "custom";

export interface DateRangePillsProps {
  value: DateRangePreset;
  customRange?: DateRange;
  onChange: (preset: DateRangePreset, customRange?: DateRange) => void;
  /** Tenant IANA timezone — day boundaries for "today"/"7d"/"30d" are computed tenant-local, never UTC (FRONTEND_SPEC.md §6.1 — the audit's UTC-day-boundary bug is explicitly not allowed back). */
  tenantTz: string;
  className?: string;
}

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
];

/** Today/7d/30d/custom pill row (FRONTEND_SPEC.md §1.3) — overview, calls, margin pages. */
export function DateRangePills({ value, customRange, onChange, className }: DateRangePillsProps) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {PRESETS.map((preset) => (
        <Button
          key={preset.key}
          size="sm"
          variant={value === preset.key ? "default" : "outline"}
          onClick={() => onChange(preset.key)}
        >
          {preset.label}
        </Button>
      ))}
      <DateRangePicker
        value={value === "custom" ? customRange : undefined}
        onChange={(range) => onChange("custom", range)}
      />
    </div>
  );
}
