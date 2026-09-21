import type { ToolResultEnvelope } from "./types.ts";
import type { RequiredIntakeField } from "./vertical-intake.ts";

export const FALLBACK_MESSAGE = "I'll take your details and have someone confirm.";

/** The one graceful-fallback shape every /voice-tools branch returns on
 * abort/circuit-break instead of an HTTP error (BACKEND_SPEC §7.2) — never
 * silence, never a non-200 for a business-logic failure. */
export function fallbackEnvelope(message: string = FALLBACK_MESSAGE): ToolResultEnvelope {
  return { result: { fallback: true, message } };
}

/**
 * CALL-8 (docs/BUILD_PLAN.md) — the required-field counterpart to
 * `fallbackEnvelope`: returned by `voice-tools/handler.ts` when a
 * create_booking/create_order/take_message call is missing one or more of
 * this vertical's required intake fields (`_shared/vertical-intake.ts`),
 * BEFORE any DB write happens. Deliberately a distinct shape from
 * `fallbackEnvelope` — that one means "give up, take a message instead";
 * this one means "keep going, but ask these specific questions first and
 * call this same tool again" — so the model has an actionable next step
 * instead of prematurely abandoning a completable booking/order/message.
 * `missing_fields` is the dot-path list (`RequiredIntakeField.path`) for
 * any machine consumer (e.g. the batch-test harness's own field-capture
 * report); `message` is the natural-language instruction the model reads.
 */
export function missingFieldsEnvelope(missing: RequiredIntakeField[]): ToolResultEnvelope {
  return {
    result: {
      error: "missing_required_fields",
      missing_fields: missing.map((f) => f.path),
      message: `Ask the caller for the following before trying again: ${missing
        .map((f) => f.askFor)
        .join("; ")}.`,
    },
  };
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
