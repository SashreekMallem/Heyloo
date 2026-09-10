import { ArrowDownRight, ArrowUpRight, MinusCircle } from "lucide-react";
import { cn } from "../lib/utils.js";
import { Card, CardContent, CardHeader, CardTitle } from "../primitives/card.js";
import { Skeleton } from "../primitives/skeleton.js";

export type MetricFormat = "number" | "currency" | "percent" | "duration";

export interface MetricCardProps {
  label: string;
  value: number;
  delta?: number;
  format: MetricFormat;
  loading?: boolean;
  className?: string;
}

function formatValue(value: number, format: MetricFormat): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
        value / 100,
      );
    case "percent":
      return `${value.toFixed(1)}%`;
    case "duration": {
      const minutes = Math.floor(value / 60);
      const seconds = Math.round(value % 60);
      return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
    }
    default:
      return new Intl.NumberFormat("en-US").format(value);
  }
}

/** Single KPI tile with optional trend delta — overview, billing, cockpit, portal (FRONTEND_SPEC.md §1.3). */
export function MetricCard({ label, value, delta, format, loading, className }: MetricCardProps) {
  // A non-finite value (missing/NaN, e.g. a metric that hasn't been
  // computed yet) used to fall through to a bare "—" from formatValue —
  // inconsistent with the designed EmptyState used everywhere else in the
  // app. Give it the same "this is intentional, not broken" treatment at
  // tile scale instead.
  const isEmpty = !loading && !Number.isFinite(value);

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : isEmpty ? (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MinusCircle className="size-4" aria-hidden="true" />
            <span className="text-sm font-medium">No data</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums">
              {formatValue(value, format)}
            </span>
            {delta !== undefined && Number.isFinite(delta) && (
              <span
                className={cn(
                  "flex items-center gap-0.5 text-xs font-medium",
                  delta >= 0 ? "text-success" : "text-destructive",
                )}
              >
                {delta >= 0 ? (
                  <ArrowUpRight className="size-3.5" />
                ) : (
                  <ArrowDownRight className="size-3.5" />
                )}
                {Math.abs(delta).toFixed(1)}%
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
