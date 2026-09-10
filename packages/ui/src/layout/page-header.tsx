import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Eyebrow / kicker — small caps label above the title (e.g. a vertical name or section label). */
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard in-app page header — title + optional description + a right-
 * aligned action cluster that wraps below the title on narrow screens
 * instead of squeezing (DESIGN BRIEF: every page reads at 390px).
 */
export function PageHeader({ title, description, eyebrow, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="min-w-0 space-y-1.5">
        {eyebrow && (
          <p className="text-small font-medium uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="text-h2 font-display font-semibold text-balance">{title}</h1>
        {description && (
          <p className="text-body text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
