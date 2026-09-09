import type { ToolResultEnvelope } from "./types.ts";

export const FALLBACK_MESSAGE = "I'll take your details and have someone confirm.";

/** The one graceful-fallback shape every /voice-tools branch returns on
 * abort/circuit-break instead of an HTTP error (BACKEND_SPEC §7.2) — never
 * silence, never a non-200 for a business-logic failure. */
export function fallbackEnvelope(message: string = FALLBACK_MESSAGE): ToolResultEnvelope {
  return { result: { fallback: true, message } };
}

export function toolEnvelope<T>(result: T): ToolResultEnvelope<T> {
  return { result };
}

export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}
