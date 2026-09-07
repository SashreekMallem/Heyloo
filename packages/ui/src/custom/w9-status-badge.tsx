import { Badge } from "../primitives/badge.js";

export type W9Status = "not_submitted" | "submitted" | "verified";

const META: Record<W9Status, { label: string; variant: "outline" | "secondary" | "success" }> = {
  not_submitted: { label: "Not submitted", variant: "outline" },
  submitted: { label: "Submitted — pending review", variant: "secondary" },
  verified: { label: "Verified", variant: "success" },
};

export function W9StatusBadge({ status }: { status: W9Status }) {
  const meta = META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}
