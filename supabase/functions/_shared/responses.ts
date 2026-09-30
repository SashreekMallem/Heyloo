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
 * F4 (BEHAVIOR-voice-agent): the tools whose result the agent reports to the
 * caller as "done" — a booking, an order, a recorded message. For these the
 * generic `fallbackEnvelope` ("I'll take your details and have someone
 * confirm.") reads like success, so a Zod failure, an unresolved call
 * context, an open circuit or a dispatch error silently dropped the caller's
 * data while the agent said it was taken.
 */
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "take_message",
  "create_booking",
  "create_order",
]);

export const NOT_SAVED_MESSAGE =
  "NOT saved. The system could not record this. Do not tell the caller it was recorded, booked or passed along. Say you had trouble saving it, then call the same tool again once with the same details; if it fails again, apologise and ask the caller to try again in a few minutes or call back.";

/** The explicit "this did NOT happen" answer for a write tool that could not run. */
export function writeFailureEnvelope(
  tool: string,
  message: string = NOT_SAVED_MESSAGE,
): ToolResultEnvelope {
  if (tool === "take_message") {
    return { result: { recorded: false, reason: "not_saved", message } };
  }
  return { result: { confirmed: false, reason: "not_saved", message } };
}

/** The graceful answer when a tool cannot run at all: explicit for a write tool, the generic fallback otherwise. */
export function unavailableEnvelope(tool: string): ToolResultEnvelope {
  return WRITE_TOOL_NAMES.has(tool) ? writeFailureEnvelope(tool) : fallbackEnvelope();
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
export function missingFieldsEnvelope(
  missing: RequiredIntakeField[],
  opts: { partialEscape?: boolean } = {},
): ToolResultEnvelope {
  // F5: for a message the escape hatch is spelled out, so the model neither
  // invents values ("none", "not yet asked") nor keeps a caller who cannot or
  // will not answer on the line: it calls the tool again, marked partial.
  const escapeHatch = opts.partialEscape
    ? ' Ask once. If the caller cannot or will not answer, or you are about to transfer them, call take_message again right away with structured_payload.intake_status set to "partial" and whatever you have (never invent a value): a partial message is stored, and it is NOT stored until you do.'
    : "";
  return {
    result: {
      error: "missing_required_fields",
      missing_fields: missing.map((f) => f.path),
      message: `Ask the caller for the following before trying again: ${missing
        .map((f) => f.askFor)
        .join("; ")}.${escapeHatch}`,
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
