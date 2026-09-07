import { Badge, type BadgeProps } from "../primitives/badge.js";

export type StatusBadgeVariant = "call-class" | "booking" | "ticket" | "tenant" | "margin";

const CALL_CLASS_COLOR: Record<string, BadgeProps["variant"]> = {
  new_booking: "success",
  reschedule: "secondary",
  cancel: "warning",
  question_faq: "outline",
  status_check: "outline",
  sales_lead: "secondary",
  solicitor: "destructive",
  wrong_number: "outline",
  spam_robocall: "destructive",
  emergency: "destructive",
  after_hours_message: "warning",
  transfer_request: "secondary",
};

const BOOKING_COLOR: Record<string, BadgeProps["variant"]> = {
  scheduled: "outline",
  confirmed: "success",
  checked_in: "secondary",
  completed: "secondary",
  no_show: "warning",
  cancelled: "destructive",
  rescheduled: "warning",
};

const TICKET_COLOR: Record<string, BadgeProps["variant"]> = {
  open: "warning",
  pending: "secondary",
  resolved: "success",
  closed: "outline",
};

const TENANT_COLOR: Record<string, BadgeProps["variant"]> = {
  trialing: "outline",
  active: "success",
  past_due: "warning",
  paused: "warning",
  canceled: "destructive",
};

const MARGIN_COLOR: Record<string, BadgeProps["variant"]> = {
  healthy: "success",
  watch: "warning",
  negative: "destructive",
};

const LABELS: Record<string, string> = {
  new_booking: "New booking",
  question_faq: "FAQ question",
  status_check: "Status check",
  sales_lead: "Sales lead",
  wrong_number: "Wrong number",
  spam_robocall: "Spam/robocall",
  after_hours_message: "After-hours message",
  transfer_request: "Transfer request",
  checked_in: "Checked in",
  no_show: "No-show",
};

function resolve(
  variant: StatusBadgeVariant,
  value: string,
): { color: BadgeProps["variant"]; label: string } {
  const table =
    variant === "call-class"
      ? CALL_CLASS_COLOR
      : variant === "booking"
        ? BOOKING_COLOR
        : variant === "ticket"
          ? TICKET_COLOR
          : variant === "tenant"
            ? TENANT_COLOR
            : MARGIN_COLOR;
  return {
    color: table[value] ?? "outline",
    label: LABELS[value] ?? value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
  };
}

export interface StatusBadgeProps {
  variant: StatusBadgeVariant;
  value: string;
  className?: string;
}

/** Enum → color-coded badge: 12 call classes, booking lifecycle, ticket status, tenant status, margin health (FRONTEND_SPEC.md §1.3). */
export function StatusBadge({ variant, value, className }: StatusBadgeProps) {
  const { color, label } = resolve(variant, value);
  return (
    <Badge variant={color} className={className}>
      {label}
    </Badge>
  );
}
