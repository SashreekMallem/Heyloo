/**
 * Next.js loads this file's module graph unconditionally on EVERY route
 * — "this file runs before your application becomes interactive," per
 * Next's own `instrumentation-client.ts` docs — with no supported way to
 * scope it to a subset of routes.
 *
 * SITE REPAIR finding (blocker, 2nd pass): this file used to call
 * `Sentry.init()` behind a dynamic `import("@sentry/nextjs")` deferred to
 * first interaction (see the prior "SITE REPAIR (2026-09-14)" entry in
 * docs/VERIFY.md), which cut the home route's initial JS from 955.2KB to
 * 686.9KB gz but left it well over the 250KB budget — a live
 * re-measurement found two Sentry-dominated chunks (~68KB + ~63KB gz)
 * still `<script async>`-tagged directly in the marketing home route's
 * initial HTML. The deferral only delayed WHEN `Sentry.init()` ran, not
 * whether `@sentry/nextjs` was reachable from this file's (= every
 * route's) client entry graph at build time — and every route includes
 * this file by Next's own design, marketing included.
 *
 * Error monitoring now initializes from `lib/perf/sentry-init.tsx`'s
 * `<SentryInit>` instead, mounted only from the tenant/admin/partner root
 * layouts — never from `(marketing)/layout.tsx` or the shared
 * `[locale]/layout.tsx` — so a marketing (or signup, which lives in the
 * `(marketing)` route group) visitor's bundle has zero reachable
 * references to `@sentry/nextjs` at all. Accepted tradeoff, not an
 * oversight: those routes no longer get browser-side error monitoring —
 * see docs/VERIFY.md's "SITE REPAIR" entries.
 *
 * This file is kept (rather than deleted) as the documented, discoverable
 * place a future route-group-scoped Sentry decision belongs, and because
 * Next's own convention expects it to exist for the client instrumentation
 * hook point even when a given build has nothing route-global to run here.
 */
export {};
