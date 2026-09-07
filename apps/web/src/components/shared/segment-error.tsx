"use client";

import { ErrorState } from "@heyloo/ui";
import * as Sentry from "@sentry/nextjs";
import { useEffect, useState } from "react";

/** Shared body for every route segment's `error.tsx` (FRONTEND_SPEC.md §0.7 — each ships its own file per Next.js convention; this is the one implementation they all delegate to). Reports to Sentry, renders `<ErrorState>` with a retry that resets the segment. */
export function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | undefined>(undefined);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Sentry's documented Next.js error-boundary pattern: the event id is only known after reporting to the external service
    setEventId(Sentry.captureException(error));
  }, [error]);

  return <ErrorState eventId={eventId} onRetry={reset} />;
}
