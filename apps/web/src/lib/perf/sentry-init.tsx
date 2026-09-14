"use client";

import { useEffect } from "react";
import { deferUntilInteraction } from "./defer-non-critical";

/**
 * Route-group-scoped Sentry browser init — render this once near the
 * root of a NON-marketing layout only ((tenant)/(admin)/(partner) today).
 *
 * SITE REPAIR finding (blocker, 2nd pass): the home route's initial JS
 * was still measured at 677.2KB gz against the 250KB budget even after
 * `Sentry.init()` (formerly called from `instrumentation-client.ts`) was
 * moved behind a dynamic `import()` deferred to first interaction — a
 * live measurement (`node --experimental-strip-types
 * scripts/site-perf/measure.ts`, curling the built home route's raw HTML)
 * found two Sentry-dominated chunks (~68KB + ~63KB gz, confirmed by
 * grepping the built `.next/static/chunks/*.js` for `sentry` string
 * markers) `<script async>`-tagged directly in the initial HTML, not
 * lazily fetched. Root cause: `instrumentation-client.ts` is a Next.js
 * framework convention loaded on EVERY route unconditionally — "this file
 * runs before your application becomes interactive" per Next's own docs
 * — so its mere existence pulls `@sentry/nextjs`'s whole module graph
 * into every route's client entry regardless of how the code inside
 * times its own execution; a deferred `import()` only delays WHEN
 * `Sentry.init()` runs, not whether the SDK is reachable from the
 * marketing route's bundle at build time. There is no supported way to
 * scope that single global file to a subset of routes, so
 * `instrumentation-client.ts` no longer references `@sentry/nextjs` at
 * all — this component reproduces the same deferred-init behavior, but
 * only from layouts that actually need it. A marketing (or signup, which
 * lives in the `(marketing)` route group) visitor's bundle now has zero
 * reachable references to `@sentry/nextjs`, at the accepted cost of no
 * browser-side error monitoring on those routes — logged in
 * `docs/VERIFY.md`.
 */
export function SentryInit() {
  useEffect(() => {
    return deferUntilInteraction(() => {
      void import("@sentry/nextjs").then((Sentry) => {
        Sentry.init({
          dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          tracesSampleRate: 0.1,
        });
      });
    });
  }, []);

  return null;
}
