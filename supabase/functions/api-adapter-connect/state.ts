import { hmacSha256Hex, timingSafeEqual } from "../_shared/crypto.js";

/**
 * OAuth `state` parameter: signed, tamper-evident, and tenant-bound so the
 * callback step can trust which tenant/provider initiated the flow without
 * a server-side session store (matches the stateless pattern every other
 * webhook/signature check in this codebase uses — HMAC over a canonical
 * string, timing-safe compare, CLAUDE.md Rule 2). Payload:
 * `tenantId:provider:nonce:issuedAtMs`, base64url-encoded, `.`-joined with
 * its own hex HMAC signature.
 */
export interface OAuthStatePayload {
  tenantId: string;
  provider: string;
  nonce: string;
  issuedAtMs: number;
}

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): string {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  return atob(padded);
}

export async function signOAuthState(
  secret: string,
  payload: Omit<OAuthStatePayload, "issuedAtMs">,
): Promise<string> {
  const full: OAuthStatePayload = { ...payload, issuedAtMs: Date.now() };
  const encoded = toBase64Url(JSON.stringify(full));
  const signature = await hmacSha256Hex(secret, encoded);
  return `${encoded}.${signature}`;
}

export type VerifyOAuthStateResult =
  | { valid: true; payload: OAuthStatePayload }
  | { valid: false; reason: "malformed" | "mismatch" | "expired" };

const STATE_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes — an OAuth redirect round trip is fast

export async function verifyOAuthState(
  secret: string,
  state: string,
  now: () => number = () => Date.now(),
): Promise<VerifyOAuthStateResult> {
  const parts = state.split(".");
  if (parts.length !== 2) return { valid: false, reason: "malformed" };
  const [encoded, signature] = parts;
  if (!encoded || !signature) return { valid: false, reason: "malformed" };

  const expected = await hmacSha256Hex(secret, encoded);
  if (!timingSafeEqual(expected, signature)) return { valid: false, reason: "mismatch" };

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(fromBase64Url(encoded));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (typeof payload.issuedAtMs !== "number" || now() - payload.issuedAtMs > STATE_MAX_AGE_MS) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, payload };
}
