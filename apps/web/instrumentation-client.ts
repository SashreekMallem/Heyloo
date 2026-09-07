import * as Sentry from "@sentry/nextjs";

/** Browser-side Sentry init (Next.js 15+'s `instrumentation-client.ts` convention, replacing the older `sentry.client.config.ts` — VERIFY against current docs before deploy, CLAUDE.md Rule 1). */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
