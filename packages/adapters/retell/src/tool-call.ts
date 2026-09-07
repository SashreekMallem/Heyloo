/**
 * `/voice/tools` support (BACKEND_SPEC §7.2, API_AND_FLOWS.md A.1 "Tool-call
 * webhook"). Bundles signature verification + parsing into one call, per the
 * `VoiceProvider.verifyAndParseToolCall` contract — this is the hot path
 * (p50<200ms/p95<500ms), so verification happens first and fails closed
 * before any JSON parsing of the (already-known-authentic) body.
 */

import {
  PayloadValidationError,
  SignatureVerificationError,
  type ToolCallRequest,
  type ToolCallResult,
} from "@heyloo/canonical-types";
import {
  type RetellToolCallResponse,
  type RetellToolCallWebhook,
  zRetellToolCallWebhook,
} from "./raw-types.js";
import { verifyRetellWebhookSignature } from "./signature.js";

export function verifyAndParseRetellToolCall(
  rawBody: string,
  signatureHeader: string | null,
  apiKey: string,
): ToolCallRequest {
  const verification = verifyRetellWebhookSignature({ rawBody, signatureHeader, apiKey });
  if (!verification.valid) {
    throw new SignatureVerificationError("retell", verification.reason);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (cause) {
    throw new PayloadValidationError("retell", "tool-call webhook: invalid JSON", cause);
  }

  const parsed = zRetellToolCallWebhook.safeParse(json);
  if (!parsed.success) {
    throw new PayloadValidationError("retell", "tool-call webhook", parsed.error);
  }

  return toCanonicalToolCallRequest(parsed.data);
}

function toCanonicalToolCallRequest(raw: RetellToolCallWebhook): ToolCallRequest {
  const providerCallId = raw.call_id ?? raw.call?.call_id;
  if (!providerCallId) {
    // Guarded by the schema's `.check()` already, but keeps this function total.
    throw new PayloadValidationError("retell", "tool-call webhook: no call id present", raw);
  }
  const request: ToolCallRequest = {
    providerCallId,
    toolName: raw.name,
    args: raw.args,
  };
  const callerNumber = extractCallerNumber(raw);
  if (callerNumber !== undefined) {
    request.callerNumberE164 = callerNumber;
  }
  return request;
}

/**
 * Best-effort extraction of the call's ACTUAL caller number from whatever of
 * the call object we were given (G6 — `lookup_customer` authorization cross-
 * checks against this, never against `args` alone). VERIFY-3: confirm the
 * exact field the nested `call` object carries this under (`from_number` is
 * the convention used elsewhere in Retell's call object, per raw-types.ts).
 */
function extractCallerNumber(raw: RetellToolCallWebhook): string | undefined {
  const call = raw.call as { from_number?: unknown } | undefined;
  return typeof call?.from_number === "string" ? call.from_number : undefined;
}

export function buildRetellToolCallResponse(result: ToolCallResult): RetellToolCallResponse {
  return { result: result.result };
}
