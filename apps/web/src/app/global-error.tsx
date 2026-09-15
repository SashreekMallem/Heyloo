"use client";

import NextError from "next/error";
import { useEffect } from "react";

/**
 * Root-level error boundary (outside `[locale]`) — reports to Sentry per
 * the Next.js SDK's documented `global-error.tsx` pattern (CLAUDE.md
 * Rule 1: verify against current docs).
 *
 * SITE REPAIR finding (blocker, 5th pass): this file used to `import *
 * as Sentry from "@sentry/nextjs"` at the top level — the SAME class of
 * bug the "2nd pass" SITE REPAIR entry already fixed for
 * `instrumentation-client.ts` (docs/VERIFY.md), just missed here.
 * `global-error.tsx` is a Next.js App Router convention loaded EAGERLY
 * as part of every route's root client bundle (it must be ready to catch
 * a root-layout render failure on any page, marketing included) — a live
 * webpack-stats capture (SITE REPAIR, 5th pass) confirmed `@sentry/core`
 * (scope.js, spanUtils.js, prepareEvent.js, exports.js, ...) present in
 * a ~15KB gz chunk loaded on the marketing home route specifically
 * because of this file, even though `instrumentation-client.ts` and
 * `(marketing)/layout.tsx` have zero reachable Sentry references of
 * their own. Per Sentry's own docs (docs.sentry.io/platforms/javascript/
 * guides/nextjs/capturing-errors/), `global-error.tsx` is "a last-resort
 * safety net that only triggers when your root layout itself fails" —
 * rare — so deferring the SDK fetch to the moment an error actually
 * occurs (mirroring `sentry-init.tsx`'s own deferred-`import()` pattern)
 * costs nothing functionally and keeps `@sentry/nextjs` out of every
 * route's eager bundle.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    void import("@sentry/nextjs").then((Sentry) => {
      Sentry.captureException(error);
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
