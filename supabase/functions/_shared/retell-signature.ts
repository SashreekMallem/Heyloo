import { hmacSha256Hex, timingSafeEqual } from "./crypto.ts";

/**
 * Retell webhook signature verification (`/voice-inbound`, `/voice-tools`,
 * `/voice-events` — BACKEND_SPEC §7.1-7.3, CLAUDE.md Rule 2 "fail closed").
 *
 * RETELL-VERIFY (docs/VERIFY.md VERIFY-1, RESOLVED): confirmed byte-for-byte
 * against the OFFICIAL `retell-typescript-sdk`'s own signing/verification
 * source (`src/lib/webhook_auth.ts`, exported as `verify`/`sign` from the
 * package root) — not a third-party summary:
 *   - Header `v=<timestamp>,d=<hex HMAC-SHA256 digest>` — confirmed exact.
 *   - Digest = HMAC-SHA256(secret = the Retell API key itself, message =
 *     `rawBody + String(timestamp)`, direct concatenation, no separator) —
 *     confirmed exact; this file's implementation already matched.
 *   - Default replay-window tolerance 5 minutes (`FIVE_MINUTES = 5*60*1000`
 *     in the SDK source) — confirmed exact.
 * Nothing needed fixing here; this file was correct as originally built.
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
