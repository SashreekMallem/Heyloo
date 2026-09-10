import { Badge } from "../primitives/badge.js";

export type CustomerSegment = "new" | "returning" | "loyal" | "vip";

const SEGMENT_META: Record<
  CustomerSegment,
  { label: string; variant: "outline" | "secondary" | "success" | "default" }
> = {
  new: { label: "New", variant: "outline" },
  returning: { label: "Returning", variant: "secondary" },
  loyal: { label: "Loyal", variant: "success" },
  vip: { label: "VIP", variant: "default" },
};

/**
 * VIP/Loyal/Returning/New (FRONTEND_SPEC.md §1.3) — segmentation itself is
 * computed server-side (a Postgres view), never here. `segment` is typed as
 * `CustomerSegment`, but nothing enforces that at runtime — a legacy row, a
 * view change, or a null/unexpected value from the database must render a
 * neutral badge instead of throwing.
 */
export function SegmentBadge({
  segment,
  className,
}: {
  segment: CustomerSegment;
  className?: string;
}) {
  const meta = SEGMENT_META[segment];
  if (!meta) {
    return (
      <Badge variant="outline" className={className}>
        {typeof segment === "string" && segment ? segment : "Unknown"}
      </Badge>
    );
  }
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}
