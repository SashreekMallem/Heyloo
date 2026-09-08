/**
 * Retell webhook signature verification.
 *
 * RETELL-VERIFY (docs/VERIFY.md VERIFY-1, RESOLVED): confirmed byte-for-byte
 * against the OFFICIAL `retell-typescript-sdk`'s own signing/verification
 * source (`src/lib/webhook_auth.ts`) — reachable via raw.githubusercontent.com
 * even though `docs.retellai.com` itself is egress-blocked here:
 *
 *   Header: `X-Retell-Signature: v={unix_ms_timestamp},d={hex_digest}`
 *   Digest:  HMAC-SHA256(raw_body + timestamp, api_key), hex-encoded, where
 *            `+` is plain string concatenation (raw body bytes, then the
 *            ASCII digits of the timestamp — NOT a separator character).
 *
 * Every part of this — header format, concatenation order/absence of a
 * separator, the API key itself as the HMAC secret, and the 5-minute
 * default replay tolerance — is confirmed exactly against the SDK's own
 * `symmetric.verify`/`FIVE_MINUTES` implementation. Nothing needed fixing
 * here; this file was correct as originally built.
 *
 * Verification steps (BACKEND_SPEC §7, API_AND_FLOWS.md A.1 "Inbound
 * webhook"): parse header -> reject stale timestamps (replay window) ->
 * constant-time compare the computed digest against `d`. Fails CLOSED: a
 * missing header, a malformed header, or a missing signing key all reject —
 * never silently skip verification (CLAUDE.md Rule 2).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  VerifyWebhookSignatureInput,
  VerifyWebhookSignatureResult,
} from "@heyloo/canonical-types";

/** `v={digits},d={hex}` — hex digest is a SHA-256 HMAC, so exactly 64 lowercase hex chars. */
const SIGNATURE_HEADER_PATTERN = /^v=(\d+),d=([0-9a-f]{64})$/i;

/** Default replay-window tolerance: 5 minutes, per the documented verification steps. */
export const DEFAULT_SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

function computeDigestHex(rawBody: string, timestampMs: string, apiKey: string): string {
  return createHmac("sha256", apiKey)
    .update(rawBody + timestampMs, "utf8")
    .digest("hex");
}

/**
 * Verify a Retell `X-Retell-Signature` header against the raw (unparsed)
 * request body. `apiKey` must be the workspace's webhook-badged API key
 * (VERIFY-1: "only the API key that has a webhook badge next to it can be
 * used to verify the webhook" — we assume the single `RETELL_API_KEY` env
 * var is that key; if Retell issues a SEPARATE signing secret, T3/T4's env
 * wiring must confirm and this function's `apiKey` param renamed
 * accordingly before go-live).
 */
export function verifyRetellWebhookSignature(
  input: VerifyWebhookSignatureInput & { apiKey: string },
): VerifyWebhookSignatureResult {
  const { rawBody, signatureHeader, apiKey, toleranceMs = DEFAULT_SIGNATURE_TOLERANCE_MS } = input;

  if (!signatureHeader) {
    return { valid: false, reason: "missing_header" };
  }

  const match = SIGNATURE_HEADER_PATTERN.exec(signatureHeader.trim());
  if (!match) {
    return { valid: false, reason: "malformed_header" };
  }
  const [, timestampStr, digestHex] = match;
  if (!timestampStr || !digestHex) {
    return { valid: false, reason: "malformed_header" };
  }

  const timestampMs = Number(timestampStr);
  if (!Number.isFinite(timestampMs)) {
    return { valid: false, reason: "malformed_header" };
  }
  if (Math.abs(Date.now() - timestampMs) > toleranceMs) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expectedDigestHex = computeDigestHex(rawBody, timestampStr, apiKey);

  const expected = Buffer.from(expectedDigestHex, "hex");
  const actual = Buffer.from(digestHex.toLowerCase(), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true };
}
