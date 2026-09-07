/**
 * Shopmonkey webhook signature verification + canonical normalization.
 *
 * BACKEND_SPEC §7.6's own table marks Shopmonkey's signature scheme "per
 * Shopmonkey's current docs (verify, Rule 1)" — no confirmed scheme was
 * reachable in this environment (`shopmonkey.dev` egress-blocked). Rather
 * than invent a shape with false confidence, this implements the common
 * webhook-HMAC pattern most SaaS platforms use (`HMAC-SHA256(rawBody)`,
 * hex-encoded, compared against an `x-shopmonkey-signature` header) as a
 * documented, testable HYPOTHESIS — flagged in docs/VERIFY.md as needing
 * first-party confirmation before go-live. If Shopmonkey turns out to have
 * no staff-reschedule/cancellation webhook at all (BACKEND_SPEC §7.6's
 * "poll-back on a schedule ... if no cancellation webhook exists" branch),
 * `pullChanges` (sync.ts) is the adapter's real two-way sync fallback
 * regardless of which of these two paths turns out to be correct.
 */

import { createHmac, timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { CanonicalAdapterEvent } from "./adapter-types.js";

export interface ShopmonkeyVerifyParams {
  rawBody: string;
  signatureHeader: string | null | undefined;
  signingSecret: string | undefined;
}

export type ShopmonkeyVerifyResult =
  | { valid: true }
  | { valid: false; reason: "missing_secret" | "missing_header" | "mismatch" };

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return nodeTimingSafeEqual(bufA, bufB);
}

export function verifyShopmonkeyWebhookSignature(
  params: ShopmonkeyVerifyParams,
): ShopmonkeyVerifyResult {
  const { rawBody, signatureHeader, signingSecret } = params;
  if (!signingSecret) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const expected = createHmac("sha256", signingSecret).update(rawBody, "utf8").digest("hex");
  if (!timingSafeEqualStrings(expected, signatureHeader.trim())) {
    return { valid: false, reason: "mismatch" };
  }
  return { valid: true };
}

const zShopmonkeyWebhookEnvelope = z.object({
  event: z.string().default(""),
  data: z
    .object({
      id: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional(),
});

export function normalizeShopmonkeyWebhook(payload: unknown): CanonicalAdapterEvent {
  const parsed = zShopmonkeyWebhookEnvelope.safeParse(payload);
  if (!parsed.success) return { type: "unknown", externalId: null, changes: {} };

  const { event, data } = parsed.data;
  const externalId = data?.id ?? null;
  const changes = (data ?? {}) as Record<string, unknown>;

  if (event.includes("revoked") || event.includes("uninstall")) {
    return { type: "auth_revoked", externalId, changes };
  }
  if (event.startsWith("appointment.") || event.startsWith("workorder.")) {
    return { type: "booking_changed", externalId, changes };
  }
  return { type: "unknown", externalId, changes };
}
