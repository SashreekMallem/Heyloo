"use client";

import { AlertTriangle, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import { Button } from "../primitives/button.js";

export interface EmptyStateProps {
  title: string;
  description?: string | undefined;
  action?: ({ label: string; onClick: () => void } | ReactNode) | undefined;
  icon?: ReactNode | undefined;
  className?: string | undefined;
}

/** Building block `DataState` composes (FRONTEND_SPEC.md §0.4/§1.3). Distinguish "no data ever" from "no data in this filter/range" via different `title`/`description` at the call site — this component never assumes which. */
export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-10 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground">{icon ?? <Inbox className="size-8" />}</div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action &&
        (isActionButton(action) ? (
          <Button size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : (
          action
        ))}
    </div>
  );
}

function isActionButton(action: unknown): action is { label: string; onClick: () => void } {
  return typeof action === "object" && action !== null && "label" in action && "onClick" in action;
}

export interface ErrorStateProps {
  eventId?: string | undefined;
  onRetry?: (() => void) | undefined;
  message?: string | undefined;
  className?: string | undefined;
}

/** Retry + Sentry event id so a support ticket can reference it (FRONTEND_SPEC.md §0.4) — never swallow an error into an empty-looking state. */
export function ErrorState({ eventId, onRetry, message, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="size-8 text-destructive" />
      <div className="space-y-1">
        <p className="text-sm font-medium">{message ?? "Something went wrong loading this."}</p>
        {eventId && <p className="text-xs text-muted-foreground">Reference: {eventId}</p>}
      </div>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
