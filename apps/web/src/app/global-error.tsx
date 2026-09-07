"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

/** Root-level error boundary (outside `[locale]`) — reports to Sentry per the Next.js SDK's documented `global-error.tsx` pattern (CLAUDE.md Rule 1: verify against current docs). */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
