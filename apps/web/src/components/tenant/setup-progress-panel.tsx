"use client";

import { Button, Card, CardContent, Progress } from "@heyloo/ui";
import { Check, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import type { SetupProgressResponse } from "@/app/api/tenant/setup-progress/route";
import { Link } from "@/i18n/navigation";
import { useTenantQuery } from "@/lib/hooks/use-tenant-query";

function dismissedKey(tenantId: string): string {
  return `heyloo:setup-progress-dismissed:${tenantId}`;
}

/** Browser-only read, never during SSR (`localStorage` is undefined there — caught, defaults to not-dismissed). */
function readDismissed(tenantId: string): boolean {
  try {
    return window.localStorage.getItem(dismissedKey(tenantId)) === "1";
  } catch {
    // localStorage unavailable (SSR, private mode, blocked) — never dismissed, safe default.
    return false;
  }
}

/**
 * Setup-progress panel (Cluster H task brief item 1) — every step is
 * computed server-side from real tenant state (`api/tenant/setup-progress`
 * — see that route for exactly what each step reads). Persists on the
 * dashboard home until every required step is done; the dismiss control
 * only appears (and only ever collapses the panel, nothing else) once
 * `complete` is true — dismissal itself is a per-device convenience stored
 * in `localStorage` (this panel has no dedicated persistence column to
 * write to; the underlying completion state is always recomputed
 * truthfully from the database on every load regardless of dismissal).
 */
export function SetupProgressPanel({ tenantId }: { tenantId: string }) {
  // Lazy initializer reads the browser-only localStorage flag exactly once per
  // mount — avoids a setState-inside-effect render cascade for what is a plain
  // synchronous read, not an external-system subscription (mirrors
  // use-impersonation-banner.tsx's identical pattern).
  const [dismissed, setDismissed] = useState(() => readDismissed(tenantId));

  const query = useTenantQuery(
    tenantId,
    "setup_progress",
    [],
    async (): Promise<SetupProgressResponse> => {
      const res = await fetch("/api/tenant/setup-progress");
      if (!res.ok) throw new Error(`setup_progress_failed:${res.status}`);
      return (await res.json()) as SetupProgressResponse;
    },
  );

  if (!query.data || dismissed) return null;
  const { steps, requiredDone, requiredTotal, complete } = query.data;

  function dismiss() {
    try {
      window.localStorage.setItem(dismissedKey(tenantId), "1");
    } catch {
      // best-effort only
    }
    setDismissed(true);
  }

  const pct = requiredTotal === 0 ? 100 : Math.round((requiredDone / requiredTotal) * 100);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">
              {complete ? "You're all set up" : "Finish setting up your agent"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {requiredDone} of {requiredTotal} steps complete
            </p>
          </div>
          {complete && (
            <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss">
              <X className="size-4" />
            </Button>
          )}
        </div>
        <Progress value={pct} />
        <ul className="divide-y divide-border">
          {steps.map((step) => {
            const row = (
              <div className="flex items-center gap-3 py-2 text-sm">
                <span
                  className={
                    step.done
                      ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground"
                      : "flex size-5 shrink-0 items-center justify-center rounded-full border border-border"
                  }
                >
                  {step.done && <Check className="size-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={step.done ? "text-muted-foreground line-through" : "font-medium"}>
                    {step.label}
                    {step.optional && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        (optional)
                      </span>
                    )}
                  </p>
                </div>
                {step.href && !step.done && (
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                )}
              </div>
            );
            return (
              <li key={step.id}>
                {step.href && !step.done ? (
                  <Link href={step.href} className="block hover:bg-muted/40">
                    {row}
                  </Link>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
