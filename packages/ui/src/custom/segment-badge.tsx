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

/** VIP/Loyal/Returning/New (FRONTEND_SPEC.md §1.3) — segmentation itself is computed server-side (a Postgres view), never here. */
export function SegmentBadge({
  segment,
  className,
}: {
  segment: CustomerSegment;
  className?: string;
}) {
  const meta = SEGMENT_META[segment];
  return (
    <Badge variant={meta.variant} className={className}>
      {meta.label}
    </Badge>
  );
}
