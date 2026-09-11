import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived, server-signed session token for the embeddable website
 * widget (BACKEND_SPEC.md §13.2's "Widget session auth" — CLAUDE.md Rule 1:
 * this is our own construction, not a third-party API, so no external docs
 * to verify against; the HMAC scheme mirrors
 * `apps/web/src/lib/signup/draft-cookie.ts`'s `encodeSignupDraft`/
 * `SIGNUP_DRAFT_SECRET` pattern exactly, just carried as a bearer token
 * instead of a cookie value since the widget runs on an arbitrary
 * third-party origin where our own first-party cookies aren't sent).
 *
 * Minted by `POST /api/widget/session` only after that route has checked
 * the request's `Origin` header against `tenants.widget_settings
 * .allowed_origins` and the presented `widget_public_key` against
 * `tenants.widget_public_key` (BACKEND_SPEC.md §13.2 — two independent
 * checks). The token itself is what `POST /api/widget/voice-token` and the
 * widget's direct browser call to `api-text-chat` (Cluster T) then trust —
 * see `docs/audit/CHANNELS_REQUESTS.md` item 4 for the full cross-cluster
 * contract. `verifyWidgetToken` is exported so any other server-side
 * verifier of this exact token shape (an edge function, once ported to
 * Deno's `_shared/crypto.ts` HMAC primitives) can be built against the same
 * construction without guessing it from the wire format alone.
 */

const DEFAULT_TTL_SECONDS = 15 * 60; // short-lived, per BACKEND_SPEC.md §13.2

export interface WidgetTokenPayload {
  tenant_id: string;
  widget_public_key: string;
  origin: string;
  iat: number; // unix seconds
  exp: number; // unix seconds
}

function secret(): string {
  const value = process.env.WIDGET_TOKEN_SECRET;
  if (!value) throw new Error("Missing required env var: WIDGET_TOKEN_SECRET");
  return value;
}

function sign(payloadB64: string): string {
  return createHmac("sha256", secret()).update(payloadB64).digest("hex");
}

export function mintWidgetToken(
  params: { tenantId: string; widgetPublicKey: string; origin: string },
  opts: { ttlSeconds?: number; now?: () => Date } = {},
): { token: string; expiresAt: string } {
  const now = opts.now?.() ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS);
  const payload: WidgetTokenPayload = {
    tenant_id: params.tenantId,
    widget_public_key: params.widgetPublicKey,
    origin: params.origin,
    iat,
    exp,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${payloadB64}.${sign(payloadB64)}`;
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}

export type WidgetTokenVerifyResult =
  | { ok: true; payload: WidgetTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyWidgetToken(
  token: string | undefined | null,
  opts: { now?: () => Date } = {},
): WidgetTokenVerifyResult {
  if (!token) return { ok: false, reason: "malformed" };
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { ok: false, reason: "malformed" };

  const expected = sign(payloadB64);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: WidgetTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as WidgetTokenPayload;
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

  const now = opts.now?.() ?? new Date();
  if (payload.exp * 1000 <= now.getTime()) return { ok: false, reason: "expired" };

  return { ok: true, payload };
}

export const WIDGET_TOKEN_DEFAULT_TTL_SECONDS = DEFAULT_TTL_SECONDS;
