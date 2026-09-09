import { hmacSha1Base64, timingSafeEqual } from "./crypto.ts";

/**
 * Twilio webhook signature verification (`/webhooks-twilio-sms` —
 * BACKEND_SPEC §3.3/MASTER_SPEC §3.3, CLAUDE.md Rule 2 "fail closed").
 *
 * VERIFY (docs/VERIFY.md): Twilio's docs
 * (https://www.twilio.com/docs/usage/webhooks/webhooks-security) were
 * unreachable from this environment (egress-blocked); the algorithm below is
 * the long-stable, widely-documented Twilio `RequestValidator` scheme
 * (matches Twilio's own helper-library source across every language SDK, per
 * third-party summaries used per CLAUDE.md Rule 1 fallback):
 *   1. Take the exact URL Twilio requested (scheme+host+path+query, as
 *      configured on the number/messaging service — for us always the HTTPS
 *      `voice-inbound`/`webhooks-twilio-sms` function URL, no query string).
 *   2. For an `application/x-www-form-urlencoded` POST body, sort ALL POST
 *      parameters by key (byte/ordinal order) and append each `key+value`
 *      pair (no separator) directly onto the URL string.
 *   3. HMAC-SHA1 the resulting string with the account's primary Auth Token
 *      as the secret key, base64-encode the digest.
 *   4. Compare (constant-time) to the `X-Twilio-Signature` header.
 * Confirm this exact construction against Twilio's live docs before the
 * first production deploy — a single stray param (e.g. Twilio's `Body`
 * carrying non-ASCII SMS text) or URL normalization mismatch (trailing
 * slash, http vs https) breaks verification silently in production.
 */

export interface TwilioSignatureResult {
  valid: boolean;
  reason?: "missing_secret" | "missing_header" | "mismatch";
}

export async function verifyTwilioSignature(params: {
  url: string;
  formParams: Record<string, string>;
  authToken: string | undefined;
  signatureHeader: string | null | undefined;
}): Promise<TwilioSignatureResult> {
  const { url, formParams, authToken, signatureHeader } = params;

  if (!authToken) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const sortedKeys = Object.keys(formParams).sort();
  let message = url;
  for (const key of sortedKeys) {
    message += key + (formParams[key] ?? "");
  }

  const expected = await hmacSha1Base64(authToken, message);
  if (!timingSafeEqual(expected, signatureHeader.trim())) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}
