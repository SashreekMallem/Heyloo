/**
 * Portable shared types used across edge-function handlers.
 *
 * Deliberately dependency-free (no Deno globals, no `npm:`/`jsr:` specifiers)
 * so every file that imports only from here can be typechecked and unit
 * tested under Node/Vitest exactly as it runs under Deno at deploy time —
 * see supabase/functions/BUILD_NOTES.md for the split this enables.
 */

/**
 * Shape-compatible with postgres.js's `Sql` tagged-template callable
 * (`import postgres from "postgres"; const sql = postgres(url); sql\`select 1\``).
 * Handlers depend on this interface, never on postgres.js itself, so tests
 * inject a fake tagged-template function instead of a real DB connection.
 */
export type SqlClient = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T[]>;

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

/** Minimal clock abstraction so time-dependent logic (HMAC tolerance windows,
 * circuit-breaker rolling windows, quiet-hours checks) is deterministic in tests. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();

/** Common envelope every /voice/tools branch returns to Retell. Never an HTTP
 * error for a business-logic failure — only auth/parse failures return non-200
 * (BACKEND_SPEC §7.2). */
export interface ToolResultEnvelope<T = unknown> {
  result: T | { fallback: true; message: string };
}

export class UnauthorizedToolCallError extends Error {
  constructor(message = "unauthorized_lookup") {
    super(message);
    this.name = "UnauthorizedToolCallError";
  }
}
