import { cn } from "../lib/utils.js";
import { Progress } from "../primitives/progress.js";

export interface UsageMeterProps {
  includedMinutes: number;
  usedMinutes: number;
  overageMinutes: number;
  thresholds?: { warn: number; critical: number };
  className?: string;
}

/** Included-vs-used-vs-overage progress bar, color at 80%/100% (FRONTEND_SPEC.md §1.3/§6.9). Renders correctly at zero usage — never blank. */
export function UsageMeter({
  includedMinutes,
  usedMinutes,
  overageMinutes,
  thresholds = { warn: 80, critical: 100 },
  className,
}: UsageMeterProps) {
  const pct = includedMinutes > 0 ? Math.min(100, (usedMinutes / includedMinutes) * 100) : 0;
  const color =
    pct >= thresholds.critical
      ? "bg-destructive"
      : pct >= thresholds.warn
        ? "bg-warning"
        : "bg-primary";

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {usedMinutes.toLocaleString()} of {includedMinutes.toLocaleString()} minutes used
        </span>
        {overageMinutes > 0 && (
          <span className="text-xs font-medium text-destructive">
            +{overageMinutes.toLocaleString()} min overage
          </span>
        )}
      </div>
      <Progress value={pct} indicatorClassName={color} aria-label="Minutes used this period" />
    </div>
  );
}
