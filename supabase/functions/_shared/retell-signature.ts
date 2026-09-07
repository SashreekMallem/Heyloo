import { hmacSha256Hex, timingSafeEqual } from "./crypto.js";

/**
 * Retell webhook signature verification (`/voice-inbound`, `/voice-tools`,
 * `/voice-events` — BACKEND_SPEC §7.1-7.3, CLAUDE.md Rule 2 "fail closed").
 *
 * VERIFY (docs/VERIFY.md): Retell's official docs
 * (https://docs.retellai.com/features/secure-webhook) were unreachable from
 * this environment (egress-blocked); the shape below is reconstructed from
 * third-party summaries (Hookdeck's Retell webhook guide, Retell community
 * forum) rather than Retell's own reference, per CLAUDE.md Rule 1 fallback:
 *   - Header `X-Retell-Signature: v=<unix_ms_timestamp>,d=<hex HMAC-SHA256 digest>`.
 *   - Digest = HMAC-SHA256(secret = the Retell API key that has the webhook
 *     badge, message = raw request body concatenated with the timestamp).
 *   - Only the API-key-as-secret scheme is confirmed; the EXACT
 *     concatenation (body+timestamp directly vs. a separator such as `.`)
 *     is not — this implementation assumes direct concatenation
 *     (`rawBody + timestampString`), matching Retell's own SDK verify
 *     helper description ("always verify against the raw body ... never a
 *     re-serialized JSON string"). Confirm against Retell's live docs or the
 *     `retell-sdk` verify() source before the first production webhook, and
 *     update this file + its fixture test if the concatenation differs.
 *
 * Fails closed: a missing secret, missing header, malformed header, or a
 * timestamp outside the replay-tolerance window all reject.
 */

export interface RetellSignatureResult {
  valid: boolean;
  reason?:
    | "missing_secret"
    | "missing_header"
    | "malformed_header"
    | "stale_timestamp"
    | "mismatch";
}

const HEADER_RE = /^v=(\d+),d=([0-9a-f]+)$/i;

export async function verifyRetellSignature(params: {
  rawBody: string;
  header: string | null | undefined;
  secret: string | undefined;
  now: Date;
  toleranceMs?: number;
}): Promise<RetellSignatureResult> {
  const { rawBody, header, secret, now, toleranceMs = 5 * 60 * 1000 } = params;

  if (!secret) return { valid: false, reason: "missing_secret" };
  if (!header) return { valid: false, reason: "missing_header" };

  const match = HEADER_RE.exec(header.trim());
  if (!match) return { valid: false, reason: "malformed_header" };

  const [, timestampStr, digest] = match;
  const timestampMs = Number(timestampStr);
  if (!Number.isFinite(timestampMs)) return { valid: false, reason: "malformed_header" };

  if (Math.abs(now.getTime() - timestampMs) > toleranceMs) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expected = await hmacSha256Hex(secret, rawBody + timestampStr);
  if (!timingSafeEqual(expected, (digest ?? "").toLowerCase())) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}
