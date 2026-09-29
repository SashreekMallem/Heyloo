import { fromBase64, timingSafeEqual, toBase64 } from "./crypto.ts";

/**
 * Standard Webhooks signature verification, by hand on Web Crypto (no npm
 * dependency, portable to Deno and Node like the Stripe verifier next to
 * it). Used by `auth-send-email`: Supabase Auth signs Send Email Hook calls
 * with this scheme.
 *
 * Rule 1 (docs/VERIFY.md EMAIL-MSGRAPH):
 * - supabase.com/docs/guides/auth/auth-hooks/send-email-hook — headers
 *   `webhook-id`, `webhook-timestamp`, `webhook-signature`; the hook secret
 *   is `v1,whsec_<base64>` and "Strip the prefix and pass the base64 portion
 *   to the Webhook class"; the docs verify with the `standardwebhooks` package;
 * - supabase.com/docs/guides/auth/auth-hooks — the secret is shown as
 *   `v1,whsec_<base64-secret>`; several secrets may be stored pipe-separated
 *   for rotation;
 * - standardwebhooks.com / github.com/standard-webhooks/standard-webhooks
 *   (specification): signed content is `${id}.${timestamp}.${rawBody}`,
 *   HMAC-SHA256 with the base64-DECODED secret, signature header is a
 *   space-separated list of `v1,<base64 signature>` (several during
 *   rotation, any one match is enough), timestamp is Unix seconds and must
 *   be within a tolerance (5 minutes in the reference libraries) of now.
 *
 * Fail CLOSED (CLAUDE.md Rule 2): no secret, no header, an unparseable
 * secret, a stale timestamp or no matching signature are all rejections.
 */

export type StandardWebhookResult =
  | { valid: true }
  | {
      valid: false;
      reason: "missing_secret" | "missing_header" | "malformed" | "stale_timestamp" | "mismatch";
    };

export const STANDARD_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Accepts `v1,whsec_<base64>` (what Supabase generates and shows), a bare
 * `whsec_<base64>`, or raw base64, and returns the key bytes. Several
 * secrets may be joined with `|` (rotation). Returns `[]` when nothing
 * usable is configured.
 */
export function parseWebhookSecrets(raw: string | undefined | null): Uint8Array<ArrayBuffer>[] {
  if (!raw) return [];
  const keys: Uint8Array<ArrayBuffer>[] = [];
  for (const part of raw.split("|")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const base64 = trimmed.replace(/^v1,/, "").replace(/^whsec_/, "");
    try {
      const key = fromBase64(base64);
      if (key.byteLength > 0) keys.push(key);
    } catch {
      // Not base64: skip it; if none parse, the caller fails closed.
    }
  }
  return keys;
}

async function sign(key: Uint8Array<ArrayBuffer>, content: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toBase64(await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(content)));
}

export async function verifyStandardWebhook(params: {
  rawBody: string;
  header: (name: string) => string | null;
  /** The configured secret(s), exactly as stored (`v1,whsec_...`). */
  secret: string | undefined | null;
  now: Date;
  toleranceSeconds?: number;
}): Promise<StandardWebhookResult> {
  const {
    rawBody,
    header,
    secret,
    now,
    toleranceSeconds = STANDARD_WEBHOOK_TOLERANCE_SECONDS,
  } = params;

  if (!secret?.trim()) return { valid: false, reason: "missing_secret" };
  const keys = parseWebhookSecrets(secret);
  // A secret that is set but unusable is a deployment error, never a reason
  // to skip the check.
  if (keys.length === 0) return { valid: false, reason: "missing_secret" };

  const id = header("webhook-id");
  const timestamp = header("webhook-timestamp");
  const signatures = header("webhook-signature");
  if (!id || !timestamp || !signatures) return { valid: false, reason: "missing_header" };

  if (!/^\d{1,12}$/.test(timestamp)) return { valid: false, reason: "malformed" };
  const timestampSeconds = Number(timestamp);
  if (Math.abs(now.getTime() / 1000 - timestampSeconds) > toleranceSeconds) {
    return { valid: false, reason: "stale_timestamp" };
  }

  const candidates: string[] = [];
  for (const entry of signatures.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma < 1) continue;
    if (entry.slice(0, comma) !== "v1") continue; // unknown versions are ignored
    const value = entry.slice(comma + 1);
    if (value) candidates.push(value);
  }
  if (candidates.length === 0) return { valid: false, reason: "malformed" };

  const content = `${id}.${timestamp}.${rawBody}`;
  let matched = false;
  for (const key of keys) {
    const expected = await sign(key, content);
    for (const candidate of candidates) {
      // Evaluate every comparison: no early exit on the first match.
      if (timingSafeEqual(expected, candidate)) matched = true;
    }
  }
  return matched ? { valid: true } : { valid: false, reason: "mismatch" };
}
