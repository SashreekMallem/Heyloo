import { sendToSentry } from "./sentry.js";
import type { LogFields, Logger } from "./types.js";

/** Reads an env var portably under both Deno (edge functions) and Node
 * (Vitest) with no `Deno`-global type dependency — an inline `globalThis`
 * cast, same technique `_shared/deno/background.ts` uses for `EdgeRuntime`.
 * Keeps this file in the portable set (no Deno globals, no `npm:`/`jsr:`
 * specifiers — see `supabase/functions/README.md`'s Node/Deno split) while
 * still reading real env vars at either runtime. */
function readEnvVar(name: string): string | undefined {
  const g = globalThis as {
    Deno?: { env?: { get(key: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

export interface LoggerOptions {
  /** Overrides the `SENTRY_DSN` env lookup — set in tests only. Passing an
   * empty string explicitly disables Sentry reporting for this logger
   * regardless of env (undefined, the default, means "read the env var"). */
  sentryDsn?: string;
  sentryEnvironment?: string;
  sentryRelease?: string;
  /** Overrides the `fetch` implementation `sendToSentry` posts through —
   * tests only, so an enabled-Sentry code path never makes a real network
   * call in CI. Defaults to the global `fetch`. */
  sentryFetch?: typeof fetch;
}

/**
 * Structured JSON logger. One line per event (`console.*` on Supabase Edge
 * Functions is captured as structured log lines by the platform), never
 * multi-line/pretty output which would break log ingestion parsing. See
 * `docs/OPS_RUNBOOK.md`'s "Structured logging conventions" section for the
 * field-naming rules every call site should follow (event-name `msg`
 * convention, low-cardinality vs. high-cardinality fields, etc.).
 *
 * Sentry wiring (T9, env-gated): every `error()` call also fires a
 * best-effort Sentry event (see `./sentry.ts`) whenever `SENTRY_DSN` is set
 * in the function's environment — no call-site changes needed anywhere in
 * `supabase/functions/**`, since every function already constructs its
 * logger via this one factory. Completely inert (zero network calls, zero
 * behavior change) when `SENTRY_DSN` is unset, which is the case for every
 * existing test and for any deploy that hasn't configured Sentry yet.
 */
export function createLogger(base: LogFields = {}, options: LoggerOptions = {}): Logger {
  const dsn = options.sentryDsn ?? readEnvVar("SENTRY_DSN");
  const environment = options.sentryEnvironment ?? readEnvVar("SENTRY_ENVIRONMENT");
  const release = options.sentryRelease ?? readEnvVar("SENTRY_RELEASE");
  // `base` fields are this logger's fixed per-function tags (today, just
  // `{ fn: "voice-tools" }` etc.) — low-cardinality by construction, so they
  // double as Sentry `tags` (filterable in the Issues UI) rather than
  // `extra` (searchable but not facetable).
  const baseTags: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (typeof value === "string") {
      baseTags[key] = value;
    }
  }

  const emit = (level: string, msg: string, fields?: LogFields): void => {
    const line = JSON.stringify({
      level,
      msg,
      ts: new Date().toISOString(),
      ...base,
      ...fields,
    });
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  const reportError = (msg: string, fields?: LogFields): void => {
    if (!dsn) {
      return;
    }
    sendToSentry(
      { dsn, environment, release },
      { message: msg, level: "error", tags: baseTags, extra: fields },
      options.sentryFetch,
    );
  };

  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => {
      emit("error", msg, fields);
      reportError(msg, fields);
    },
  };
}
