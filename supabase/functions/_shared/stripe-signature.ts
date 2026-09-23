import { hmacSha256Hex, timingSafeEqual } from "./crypto.ts";

/**
 * Stripe webhook signature verification (`/webhooks-stripe` — BACKEND_SPEC
 * §7.4, CLAUDE.md Rule 2 "fail closed"), implemented by hand against
 * Stripe's long-published, versioned-stable signing scheme rather than
 * pulling in the `stripe` SDK: (a) it keeps this handler off the
 * `noRestrictedImports` provider-SDK boundary entirely (packages/adapters
 * README) instead of needing an exception for the Deno runtime, (b) it's
 * leaner than importing the whole SDK for one HMAC check, and (c) the
 * algorithm itself is a stable, extensively documented public contract, not
 * an internal shape likely to drift silently the way a REST payload would.
 *
 * VERIFY (docs/VERIFY.md, QA-BILL 2026-09-23): confirmed VERBATIM live
 * against docs.stripe.com/webhooks/signatures (reachable this session,
 * unlike an earlier session's EGRESS_BLOCKED result) — the scheme below
 * matches Stripe's documented signing-secret v1 scheme exactly:
 *   - Header `Stripe-Signature: t=<unix_seconds>,v1=<hex HMAC-SHA256>[,v1=...][,v0=...]`
 *     (multiple `v1` values appear during secret rotation — accept a match
 *     against ANY of them, never require exactly one).
 *   - Signed payload = `${t}.${rawBody}` (literal dot separator).
 *   - HMAC-SHA256 with the endpoint's signing secret (`whsec_...`), hex digest.
 *   - Default replay tolerance 300s (5 minutes) — "Our libraries have a
 *     default tolerance of 5 minutes between the timestamp and the current
 *     time," per that same doc.
 */

export interface StripeSignatureResult {
  valid: boolean;
  reason?:
    | "missing_secret"
    | "missing_header"
    | "malformed_header"
    | "stale_timestamp"
    | "mismatch";
}

export async function verifyStripeSignature(params: {
  rawBody: string;
  header: string | null | undefined;
  secret: string | undefined;
  now: Date;
  toleranceMs?: number;
}): Promise<StripeSignatureResult> {
  const { rawBody, header, secret, now, toleranceMs = 5 * 60 * 1000 } = params;

  if (!secret) return { valid: false, reason: "missing_secret" };
  if (!header) return { valid: false, reason: "missing_header" };

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t" && value) timestamp = value;
    else if (key === "v1" && value) v1Signatures.push(value);
  }

  if (!timestamp || v1Signatures.length === 0) return { valid: false, reason: "malformed_header" };

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) return { valid: false, reason: "malformed_header" };
  if (Math.abs(now.getTime() - timestampMs) > toleranceMs) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const expected = await hmacSha256Hex(secret, `${timestamp}.${rawBody}`);
  const matched = v1Signatures.some((sig) => timingSafeEqual(expected, sig));
  if (!matched) return { valid: false, reason: "mismatch" };
  return { valid: true };
}
