"use client";

import { ErrorState } from "@heyloo/ui";
import { useEffect, useState } from "react";

/**
 * Shared body for every route segment's `error.tsx` (FRONTEND_SPEC.md
 * §0.7 — each ships its own file per Next.js convention; this is the one
 * implementation they all delegate to, INCLUDING
 * `(marketing)/signup/error.tsx`). Reports to Sentry, renders
 * `<ErrorState>` with a retry that resets the segment.
 *
 * SITE REPAIR finding (blocker, 5th pass): a top-level `import * as
 * Sentry from "@sentry/nextjs"` here pulled the SDK into the signup
 * route's bundle — the same class of leak fixed in `global-error.tsx`
 * this same pass. Deferred to a dynamic `import()`, fired only when a
 * segment actually errors (rare) — same tradeoff Sentry's own docs
 * describe as safe for error-boundary reporting (see `global-error.tsx`'s
 * comment).
 */
export function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void import("@sentry/nextjs").then((Sentry) => {
      const id = Sentry.captureException(error);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Sentry's documented Next.js error-boundary pattern: the event id is only known after reporting to the external service
      if (!cancelled) setEventId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [error]);

  return <ErrorState eventId={eventId} onRetry={reset} />;
}
