/**
 * Server-side verifier for the embeddable widget's short-lived session
 * token (BACKEND_SPEC.md §13.2; full cross-cluster contract in
 * `docs/audit/CHANNELS_REQUESTS.md` item 4). The token is MINTED in
 * `apps/web/src/lib/widget/session-token.ts` (`mintWidgetToken`, Node
 * `node:crypto`) after that route checks the request's `Origin` against
 * `tenants.widget_settings.allowed_origins` and `widget_public_key` against
 * `tenants.widget_public_key` — every edge function downstream of that
 * mint (`api-widget-voice-token` here, and `api-text-chat` for Chat mode)
 * re-verifies the SAME HMAC construction independently rather than
 * trusting a caller-supplied `tenant_id`, since both are publicly
 * reachable (`verify_jwt: false` — there is no Supabase user JWT in this
 * flow at all). Ported to `_shared/crypto.ts`'s Web Crypto primitives
 * (`hmacSha256Hex`/`timingSafeEqual`) so this is portable to the Deno edge
 * runtime exactly like every other file in `_shared/**` — construction
 * must stay byte-for-byte identical to the Node version (base64url JSON
 * payload + "." + lowercase hex HMAC-SHA256 digest) or every token this
 * verifier receives fails immediately.
 */
import { hmacSha256Hex, timingSafeEqual } from "./crypto.ts";

export interface WidgetTokenPayload {
  tenant_id: string;
  widget_public_key: string;
  origin: string;
  iat: number;
  exp: number;
}

export type WidgetTokenVerifyResult =
  | { ok: true; payload: WidgetTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

function base64UrlDecode(value: string): string {
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return atob(padded);
}

export async function verifyWidgetToken(
  token: string | undefined | null,
  secret: string,
  now: () => Date = () => new Date(),
): Promise<WidgetTokenVerifyResult> {
  if (!token) return { ok: false, reason: "malformed" };
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { ok: false, reason: "malformed" };

  const expected = await hmacSha256Hex(secret, payloadB64);
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };

  let payload: WidgetTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64)) as WidgetTokenPayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    typeof payload.tenant_id !== "string" ||
    typeof payload.widget_public_key !== "string" ||
    typeof payload.origin !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (payload.exp * 1000 <= now().getTime()) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
