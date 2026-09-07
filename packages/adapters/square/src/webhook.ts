/**
 * Square webhook signature verification + canonical normalization.
 *
 * Scheme (SYSTEM_DESIGN §14 salvage note, carried forward from the legacy
 * `CLOVER_CRUD_DOCUMENTATION.md` notes and independently corroborated by
 * WebSearch against Square's current webhooks docs during this build —
 * `developer.squareup.com` itself was egress-blocked, see docs/VERIFY.md):
 * `HMAC-SHA256(notificationUrl + rawBody)`, base64-encoded, compared against
 * the `x-square-hmacsha256-signature` request header using a timing-safe
 * comparison (Square's own docs explicitly warn about timing attacks on a
 * naive `===` compare here).
 *
 * This duplicates `supabase/functions/_shared/providers/square.ts`'s
 * verify/normalize logic (T3 built that one first, against Deno's Web
 * Crypto API for the Edge Function runtime) rather than importing it — the
 * Deno Edge Function runtime cannot import a pnpm workspace package without
 * a bundling step (documented boundary, T3's own BUILD_NOTES.md entry:
 * "Provider isolation deviation"). Both implementations are unit-tested
 * against the same HMAC algorithm; a change to the scheme needs updating
 * both, flagged in this task's BUILD_NOTES.md entry as a named follow-up.
 */

import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CanonicalAdapterEvent } from "./adapter-types.js";

export interface SquareVerifyParams {
  rawBody: string;
  signatureHeader: string | null | undefined;
  notificationUrl: string;
  signatureKey: string | undefined;
}

export type SquareVerifyResult =
  | { valid: true }
  | { valid: false; reason: "missing_secret" | "missing_header" | "mismatch" };

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}

export function verifySquareWebhookSignature(params: SquareVerifyParams): SquareVerifyResult {
  const { rawBody, signatureHeader, notificationUrl, signatureKey } = params;
  if (!signatureKey) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const expected = createHmac("sha256", signatureKey)
    .update(notificationUrl + rawBody, "utf8")
    .digest("base64");

  if (!timingSafeEqualStrings(expected, signatureHeader.trim())) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}

/** Square's own notification envelope — VERIFY exact field names
 * (docs/VERIFY.md); only `type`/`data.id`/`data.object` are relied on,
 * matching the Clover-pattern salvage note that webhooks carry the changed
 * object's id, not a full payload. */
const zSquareWebhookEnvelope = z.object({
  merchant_id: z.string().optional(),
  type: z.string().default(""),
  event_id: z.string().optional(),
  data: z
    .object({
      id: z.string().optional(),
      object: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export function normalizeSquareWebhook(payload: unknown): CanonicalAdapterEvent {
  const parsed = zSquareWebhookEnvelope.safeParse(payload);
  if (!parsed.success) {
    return { type: "unknown", externalId: null, changes: {} };
  }
  const { type, data } = parsed.data;
  const externalId = data?.id ?? null;
  const changes = (data?.object ?? {}) as Record<string, unknown>;

  if (type.startsWith("oauth.authorization.revoked")) {
    return { type: "auth_revoked", externalId, changes };
  }
  if (type.startsWith("order.")) {
    return { type: "order_changed", externalId, changes };
  }
  if (type.startsWith("booking.")) {
    return { type: "booking_changed", externalId, changes };
  }
  return { type: "unknown", externalId, changes };
}
