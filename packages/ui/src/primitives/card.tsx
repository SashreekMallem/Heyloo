import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils.js";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Micro-interaction (subtle hover lift + shadow deepen, gentle press):
   * opt-in only, default `false` — the vast majority of `Card` usage
   * across the tenant dashboard/admin cockpit/partner portal is a
   * STATIC info panel, not a clickable surface, so this stays inert
   * there unchanged. Set `true` only when the card itself is the click
   * target (wrapped in a link/button, or carries its own onClick) — a
   * marketing pricing/plan card, a clickable dashboard summary tile.
   * CSS-only (`transform`/`box-shadow`, main-thread-cheap); collapses to
   * nothing under `prefers-reduced-motion` via the blanket rule in
   * packages/ui/src/theme/globals.css.
   */
  interactive?: boolean;
}

export function Card({ className, interactive = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground shadow-sm",
        interactive &&
          "transition-[transform,box-shadow] duration-(--duration-fast) ease-(--ease-out) hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-base font-semibold leading-none", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;
}
