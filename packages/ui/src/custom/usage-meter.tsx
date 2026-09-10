import { cn } from "../lib/utils.js";
import { Progress } from "../primitives/progress.js";

export interface UsageMeterProps {
  includedMinutes: number;
  usedMinutes: number;
  overageMinutes: number;
  thresholds?: { warn: number; critical: number };
  className?: string;
}

/**
 * Included-vs-used-vs-overage progress bar, color at 80%/100%
 * (FRONTEND_SPEC.md §1.3/§6.9). Renders correctly at zero usage — never
 * blank, and never a bare `NaN` — an `includedMinutes` of 0 or a
 * non-finite input (missing/failed plan lookup) never divides into the
 * label: it reads "Unlimited" when there's real usage to show, or a plain
 * "0 of 0" when there's genuinely nothing yet.
 */
export function UsageMeter({
  includedMinutes,
  usedMinutes,
  overageMinutes,
  thresholds = { warn: 80, critical: 100 },
  className,
}: UsageMeterProps) {
  const included = Number.isFinite(includedMinutes) && includedMinutes > 0 ? includedMinutes : 0;
  const used = Number.isFinite(usedMinutes) ? usedMinutes : 0;
  const overage = Number.isFinite(overageMinutes) ? overageMinutes : 0;
  const pct = included > 0 ? Math.min(100, (used / included) * 100) : 0;
  const color =
    pct >= thresholds.critical
      ? "bg-destructive"
      : pct >= thresholds.warn
        ? "bg-warning"
        : "bg-primary";
  const label =
    included > 0
      ? `${used.toLocaleString()} of ${included.toLocaleString()} minutes used`
      : used > 0
        ? `${used.toLocaleString()} minutes used · Unlimited`
        : "0 of 0 minutes used";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        {overage > 0 && (
          <span className="text-xs font-medium text-destructive">
            +{overage.toLocaleString()} min overage
          </span>
        )}
      </div>
      <Progress value={pct} indicatorClassName={color} aria-label="Minutes used this period" />
    </div>
  );
}
