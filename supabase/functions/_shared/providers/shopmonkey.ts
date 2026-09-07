/**
 * Shopmonkey REST calls + webhook verify/normalize (BACKEND_SPEC §7.6,
 * API_AND_FLOWS.md A.6 "Shopmonkey (auto repair)"). Portable — no SDK,
 * plain `fetch`, mirroring `packages/adapters/shopmonkey`'s Node package
 * logic (documented intentional duplication — Deno can't import a pnpm
 * workspace package here, same boundary as every other `_shared/providers/
 * *.ts` file in this codebase).
 *
 * Auth model resolved per that package's `client.ts` docstring: a
 * self-generated, pasted API key (a Shopmonkey-side Bearer token the
 * tenant mints in their own dashboard), not an OAuth redirect this
 * function performs — `api-adapter-connect`'s paste-key path validates it
 * with a lightweight `GET /me` call before storing it.
 *
 * VERIFY (docs/VERIFY.md): `shopmonkey.dev` was egress-blocked in this
 * build; every endpoint/field below (including the webhook signature
 * scheme) is a documented, testable hypothesis, not a first-party fetch.
 */

import { hmacSha256Hex, timingSafeEqual } from "../crypto.js";

export const SHOPMONKEY_BASE_URL = "https://api.shopmonkey.cloud/v3";

export type ShopmonkeyFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function shopmonkeyRequest(
  fetchImpl: ShopmonkeyFetch,
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${SHOPMONKEY_BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsedBody = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body: parsedBody };
}

export async function validateShopmonkeyApiKey(fetchImpl: ShopmonkeyFetch, apiKey: string) {
  return shopmonkeyRequest(fetchImpl, apiKey, "GET", "/me");
}

export async function listShopmonkeyLaborRates(fetchImpl: ShopmonkeyFetch, apiKey: string) {
  return shopmonkeyRequest(fetchImpl, apiKey, "GET", "/laborrate");
}

export async function findShopmonkeyCustomerByPhone(
  fetchImpl: ShopmonkeyFetch,
  apiKey: string,
  phoneE164: string,
) {
  const query = new URLSearchParams({ phone: phoneE164 });
  return shopmonkeyRequest(fetchImpl, apiKey, "GET", `/customer?${query.toString()}`);
}

export async function createShopmonkeyCustomer(
  fetchImpl: ShopmonkeyFetch,
  apiKey: string,
  params: { name: string; phoneE164: string; email?: string | undefined },
) {
  return shopmonkeyRequest(fetchImpl, apiKey, "POST", "/customer", {
    name: params.name,
    phone: params.phoneE164,
    ...(params.email ? { email: params.email } : {}),
  });
}

export async function createShopmonkeyAppointment(
  fetchImpl: ShopmonkeyFetch,
  apiKey: string,
  params: {
    customerId: string;
    laborRateId?: string | undefined;
    bayId?: string | undefined;
    startAt: string;
    endAt: string;
    notes?: string | undefined;
    idempotencyKey: string;
  },
) {
  return shopmonkeyRequest(fetchImpl, apiKey, "POST", "/appointment", {
    customerId: params.customerId,
    laborRateId: params.laborRateId,
    bayId: params.bayId,
    startAt: params.startAt,
    endAt: params.endAt,
    notes: params.notes ?? "",
    externalReference: params.idempotencyKey,
  });
}

export async function listShopmonkeyAppointmentChanges(
  fetchImpl: ShopmonkeyFetch,
  apiKey: string,
  updatedAfter?: string,
) {
  const query = new URLSearchParams(updatedAfter ? { updatedAfter } : {});
  return shopmonkeyRequest(fetchImpl, apiKey, "GET", `/appointment?${query.toString()}`);
}

// ---------------------------------------------------------------------------
// Webhook verify/normalize (documented hypothesis — see file docstring)
// ---------------------------------------------------------------------------

export interface ShopmonkeyVerifyParams {
  rawBody: string;
  signatureHeader: string | null | undefined;
  signingSecret: string | undefined;
}

export type ShopmonkeyVerifyResult =
  | { valid: true }
  | { valid: false; reason: "missing_secret" | "missing_header" | "mismatch" };

export async function verifyShopmonkeyWebhookSignature(
  params: ShopmonkeyVerifyParams,
): Promise<ShopmonkeyVerifyResult> {
  const { rawBody, signatureHeader, signingSecret } = params;
  if (!signingSecret) return { valid: false, reason: "missing_secret" };
  if (!signatureHeader) return { valid: false, reason: "missing_header" };

  const expected = await hmacSha256Hex(signingSecret, rawBody);
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

export function normalizeShopmonkeyWebhook(
  payload: Record<string, unknown>,
): CanonicalPosWebhookEvent {
  const eventType = typeof payload["event"] === "string" ? (payload["event"] as string) : "";
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const externalId = typeof data["id"] === "string" ? (data["id"] as string) : null;

  if (eventType.includes("revoked") || eventType.includes("uninstall")) {
    return { type: "auth_revoked", external_id: externalId, changes: data };
  }
  if (eventType.startsWith("appointment.") || eventType.startsWith("workorder.")) {
    return { type: "booking_changed", external_id: externalId, changes: data };
  }
  return { type: "unknown", external_id: externalId, changes: data };
}
