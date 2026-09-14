import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

export const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        success: "border-transparent bg-success text-success-foreground",
        warning: "border-transparent bg-warning text-warning-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /**
   * Micro-interaction for a badge used as a clickable filter/toggle chip
   * (not the default status-pill usage, which stays static) — a subtle
   * hover/press scale, CSS-only. Default `false`; existing status-badge
   * call sites (booking status, call outcome, …) are unaffected.
   */
  interactive?: boolean;
}

export function Badge({ className, variant, interactive = false, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        interactive &&
          "cursor-pointer transition-[background-color,color,transform] duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-px active:translate-y-0 active:scale-95",
        className,
      )}
      {...props}
    />
  );
}
