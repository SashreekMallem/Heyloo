import { timingSafeEqual } from "../crypto.js";

/**
 * Square webhook signature verification + canonical normalization
 * (`/webhooks-pos/square` — BACKEND_SPEC §7.6, T3's assigned "wire Square
 * salvage-shape as the first handleWebhook"). Scheme carried forward from
 * the legacy repo's `CLOVER_CRUD_DOCUMENTATION.md` salvage note
 * (HMAC-SHA256(notificationUrl + rawBody), base64) — BACKEND_SPEC flags this
 * explicitly as "re-verify against Square's current docs before coding,
 * only the shape is carried forward as a starting hypothesis"; egress to
 * Square's docs was blocked in this build, so it stands as a Rule-1 VERIFY
 * item (docs/VERIFY.md) rather than a confirmed implementation. Square's
 * webhook body carries only the changed object's id/type per BACKEND_SPEC
 * (matching the Clover pattern) — the adapter fetches the full object
 * separately (left as a Wave-3 TODO here since `syncCatalog`/`pushOrder`
 * etc. are T7 scope per packages/adapters/README.md; this file implements
 * ONLY `handleWebhook`'s verify+normalize step, per this task's explicit
 * scope).
 */

export interface SquareVerifyParams {
  rawBody: string;
  signatureHeader: string | null | undefined;
  notificationUrl: string;
  signatureKey: string | undefined;
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function verifySquareSignature(
  params: SquareVerifyParams,
): Promise<{ valid: boolean; reason?: "missing_secret" | "missing_header" | "mismatch" }> {
  const { rawBody, signatureHeader, notificationUrl, signatureKey } = params;
  if (!signatureKey) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const expected = await hmacSha256Base64(signatureKey, notificationUrl + rawBody);
  if (!timingSafeEqual(expected, signatureHeader.trim())) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}

export interface CanonicalPosWebhookEvent {
  type: "booking_changed" | "order_changed" | "auth_revoked" | "unknown";
  external_id: string | null;
  changes: Record<string, unknown>;
}

/** Normalizes a Square webhook notification into the canonical shape every
 * adapter's `handleWebhook` must return (BACKEND_SPEC §7.6 "Shared side
 * effects across all adapters"). Square's notification envelope carries
 * `type` (e.g. `order.updated`, `oauth.authorization.revoked`) and
 * `data.id`/`data.object` — VERIFY exact field names (docs/VERIFY.md). */
export function normalizeSquareWebhook(payload: Record<string, unknown>): CanonicalPosWebhookEvent {
  const eventType = typeof payload["type"] === "string" ? (payload["type"] as string) : "";
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const externalId = typeof data["id"] === "string" ? (data["id"] as string) : null;

  if (eventType.startsWith("oauth.authorization.revoked")) {
    return { type: "auth_revoked", external_id: externalId, changes: data };
  }
  if (eventType.startsWith("order.")) {
    return { type: "order_changed", external_id: externalId, changes: data };
  }
  if (eventType.startsWith("booking.")) {
    return { type: "booking_changed", external_id: externalId, changes: data };
  }
  return { type: "unknown", external_id: externalId, changes: data };
}
