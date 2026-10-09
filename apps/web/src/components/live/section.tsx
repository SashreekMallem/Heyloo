"use client";

import { Skeleton } from "@heyloo/ui";
import type { ReactNode } from "react";

/** A titled live-screen panel with its loading / error states. */
export function LiveSection({
  id,
  title,
  count,
  state,
  errorText,
  action,
  children,
}: {
  id: string;
  title: string;
  count: number;
  state: "loading" | "error" | "ready";
  errorText: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-xl border border-border bg-background p-4"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="font-display text-h3 font-semibold">
          {title}
          {state === "ready" && (
            <span className="ml-2 align-middle text-base font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {state === "loading" ? (
        <div className="space-y-3" data-testid={`${id}-loading`}>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : state === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
