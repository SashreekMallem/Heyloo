"use client";

import { Button, Label, Switch } from "@heyloo/ui";
import { useState } from "react";

export type MarginPeriodChoice = "mtd" | "last_month" | "quarter";

const PERIOD_LABELS: Record<MarginPeriodChoice, string> = {
  mtd: "This month",
  last_month: "Last month",
  quarter: "Quarter",
};

/**
 * Shared period + "include test data" state for the margin cockpit pages
 * (COCKPIT-1). Real margins exclude test tenants and test calls by default —
 * the toggle lets an admin see them (e.g. to verify cost capture on the
 * owner's own test calls) without ever mixing them into the real numbers.
 * `qs` is a ready-to-append query string for `admin-cockpit/*` routes.
 */
export function useMarginControls(opts: { withPeriod?: boolean; withTestToggle?: boolean } = {}) {
  const [period, setPeriod] = useState<MarginPeriodChoice>("mtd");
  const [includeTest, setIncludeTest] = useState(false);
  const params = new URLSearchParams();
  if (opts.withPeriod) params.set("period", period);
  if (includeTest && opts.withTestToggle !== false) params.set("include_test", "1");
  const qs = params.toString();

  const controls = (
    <div className="flex flex-wrap items-center gap-3">
      {opts.withPeriod && (
        <div className="flex gap-2">
          {(Object.keys(PERIOD_LABELS) as MarginPeriodChoice[]).map((p) => (
            <Button
              key={p}
              size="sm"
              variant={period === p ? "default" : "outline"}
              onClick={() => setPeriod(p)}
            >
              {PERIOD_LABELS[p]}
            </Button>
          ))}
        </div>
      )}
      {opts.withTestToggle !== false && (
        <div className="flex items-center gap-2">
          <Switch
            id="include-test-data"
            checked={includeTest}
            onCheckedChange={setIncludeTest}
            aria-label="Include test data"
          />
          <Label htmlFor="include-test-data" className="text-small text-muted-foreground">
            Include test data
          </Label>
        </div>
      )}
    </div>
  );

  return { period, includeTest, qs: qs ? `?${qs}` : "", controls };
}
