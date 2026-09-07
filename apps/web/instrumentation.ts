import * as Sentry from "@sentry/nextjs";

/**
 * Next.js instrumentation hook (server + edge runtimes) — same Sentry
 * project as the edge functions (FRONTEND_STACK.md). VERIFY the exact
 * current API shape (`register`/`onRequestError`) against
 * docs.sentry.io/platforms/javascript/guides/nextjs before deploy —
 * Sentry's Next.js SDK setup has changed across major versions.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
