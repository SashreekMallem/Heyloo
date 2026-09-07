/**
 * Minimal, dependency-free Sentry error reporting over the public Envelope
 * HTTP API — no `@sentry/*` SDK. Same rationale as every
 * `_shared/providers/*.ts` module (see `docs/BUILD_NOTES.md`'s T3 entry):
 * the Deno Edge Function runtime can't cleanly pull in a Node-oriented SDK
 * without a bundling step this codebase doesn't add, and a hand-rolled
 * envelope POST is a handful of lines against a long-stable public wire
 * format (protocol_version 7 — unchanged since Sentry's SDK development
 * docs were first published).
 *
 * Env-gated and fail-open by design (CLAUDE.md Rule 2 draws the fail-closed
 * line at webhook signature verification and money/tenant boundaries — an
 * *observability* sink is deliberately the opposite: a missing/invalid
 * `SENTRY_DSN`, a DNS failure, or Sentry itself being down must never
 * surface as an application error or delay a response). Every exported
 * "send" path swallows its own failures.
 *
 * VERIFY (docs/VERIFY.md, T9 entry): `develop.sentry.dev` was egress-blocked
 * in this build environment (CLAUDE.md Rule 1 item 2) — the envelope shape
 * below was built from indexed WebSearch summaries of Sentry's own
 * publicly-documented envelope/DSN format, not a first-party fetch. Confirm
 * one real delivery against a live Sentry project (a throwaway
 * `logger.error()` call with `SENTRY_DSN` set, then check the project's
 * Issues stream) before relying on this for production alerting.
 */

export interface ParsedDsn {
  /** The DSN's public key (Basic-auth "username" portion). */
  publicKey: string;
  /** Ingest host, e.g. `o123456.ingest.us.sentry.io`. */
  host: string;
  /** Numeric project id, the last path segment. */
  projectId: string;
  /** Any path prefix before the project id (self-hosted installs behind a
   * subpath); empty string for the common SaaS DSN shape. */
  pathPrefix: string;
}

/** Parses a Sentry DSN (`https://<public_key>@<host>/<path_prefix>/<project_id>`)
 * into its ingest-relevant parts. Returns `undefined` for anything that
 * isn't a well-formed DSN — callers treat that as "Sentry disabled", never
 * a thrown error. */
export function parseDsn(dsn: string): ParsedDsn | undefined {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return undefined;
  }
  const publicKey = url.username;
  if (!publicKey || !url.host) {
    return undefined;
  }
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  const projectId = segments.pop();
  if (!projectId) {
    return undefined;
  }
  return {
    publicKey,
    host: url.host,
    projectId,
    pathPrefix: segments.length > 0 ? `/${segments.join("/")}` : "",
  };
}

/** The envelope-endpoint URL a parsed DSN's events must POST to. */
export function envelopeEndpoint(parsed: ParsedDsn): string {
  return `https://${parsed.host}${parsed.pathPrefix}/api/${parsed.projectId}/envelope/`;
}

/** 32 lowercase-hex characters, no dashes — Sentry's `event_id` shape. Uses
 * Web Crypto (`crypto.getRandomValues`), available as a global under both
 * Deno and Node ≥19, so this stays dependency- and Deno-global-free. */
export function randomEventId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type SentryLevel = "fatal" | "error" | "warning" | "info" | "debug";

export interface CaptureInput {
  message: string;
  level: SentryLevel;
  /** Structured context — this codebase's `LogFields`, attached under the
   * event's `extra` bag verbatim (never `tags`, since call-site fields are
   * arbitrary-cardinality and Sentry tags are meant to be low-cardinality
   * filters — see `docs/OPS_RUNBOOK.md`'s logging-conventions section). */
  extra?: Record<string, unknown> | undefined;
  /** Low-cardinality dimensions worth filtering Issues by — currently just
   * the emitting function's name, set once per `createLogger()` call. */
  tags?: Record<string, string> | undefined;
}

export interface EnvelopeContext {
  dsn: string;
  environment?: string | undefined;
  release?: string | undefined;
  eventId?: string | undefined;
  sentAt?: Date | undefined;
}

/** Builds the newline-delimited three-line envelope body for one error/
 * message event. Pure and synchronous (no network, no randomness unless
 * `eventId`/`sentAt` are omitted) so it's unit-testable without a live
 * Sentry project — the impure `sendToSentry` below is a thin fetch wrapper
 * around this. Returns `undefined` when `dsn` doesn't parse. */
export function buildErrorEnvelope(
  ctx: EnvelopeContext,
  input: CaptureInput,
): { url: string; body: string } | undefined {
  const parsed = parseDsn(ctx.dsn);
  if (!parsed) {
    return undefined;
  }
  const eventId = ctx.eventId ?? randomEventId();
  const sentAt = (ctx.sentAt ?? new Date()).toISOString();

  const envelopeHeader = JSON.stringify({ event_id: eventId, sent_at: sentAt, dsn: ctx.dsn });
  const itemHeader = JSON.stringify({ type: "event", content_type: "application/json" });
  const eventPayload = JSON.stringify({
    event_id: eventId,
    timestamp: sentAt,
    platform: "other",
    level: input.level,
    logger: "heyloo.edge-functions",
    message: { formatted: input.message },
    environment: ctx.environment ?? "production",
    release: ctx.release,
    tags: input.tags,
    extra: input.extra,
  });

  return {
    url: envelopeEndpoint(parsed),
    body: `${envelopeHeader}\n${itemHeader}\n${eventPayload}\n`,
  };
}

/** Fire-and-forget delivery. Never throws, never rejects — a Sentry outage
 * or bad DSN must never surface to (or delay) the caller. `fetchImpl`
 * defaults to the global `fetch` (Web-standard, present under both Deno and
 * Node ≥18 with no import) and is only ever overridden by tests. */
export function sendToSentry(
  ctx: EnvelopeContext,
  input: CaptureInput,
  fetchImpl: typeof fetch = fetch,
): void {
  const envelope = buildErrorEnvelope(ctx, input);
  if (!envelope) {
    return;
  }
  fetchImpl(envelope.url, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body: envelope.body,
  }).catch(() => {
    // Deliberately swallowed — see file header. Never re-enter the logger
    // here (would risk a report-about-a-report loop under a sustained
    // Sentry outage).
  });
}
