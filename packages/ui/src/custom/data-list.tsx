import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

export interface DataListItem {
  label: ReactNode;
  value: ReactNode;
  /** Renders `value` in `font-mono tabular-nums` — phone numbers, ids, money, durations. */
  mono?: boolean;
}

export interface DataListProps {
  items: DataListItem[];
  /** `inline` pairs label/value on one row (settings-style); `stacked` puts value below the label (detail-card style). */
  layout?: "inline" | "stacked";
  className?: string;
}

/** Label/value key-facts list — booking detail, call detail, customer detail, settings summaries. */
export function DataList({ items, layout = "inline", className }: DataListProps) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {items.map((item, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: labels aren't guaranteed unique/stringifiable across every call site
          key={index}
          className={cn(
            "py-2.5 first:pt-0 last:pb-0",
            layout === "inline"
              ? "flex items-baseline justify-between gap-4"
              : "flex flex-col gap-0.5",
          )}
        >
          <dt className="text-small text-muted-foreground">{item.label}</dt>
          <dd
            className={cn(
              "text-body text-right",
              layout === "stacked" && "text-left",
              item.mono && "font-mono tabular-nums",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
