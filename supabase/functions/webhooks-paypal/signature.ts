/**
 * PayPal webhook signature verification via PayPal's own
 * `/v1/notifications/verify-webhook-signature` API (CLAUDE.md Rule 2 "fail
 * closed"). Unlike Stripe's locally-computable HMAC scheme
 * (`_shared/stripe-signature.ts`), PayPal does not publish a stable local
 * verification algorithm for third-party server integrations — PayPal's
 * own documented pattern (and every real integration found via GitHub code
 * search, see `schema.ts`'s VERIFY note) is to POST the five
 * `PAYPAL-*` transmission headers plus the raw parsed event body to this
 * endpoint and check `verification_status === "SUCCESS"`.
 *
 * VERIFY (docs/VERIFY.md): `developer.paypal.com` is egress-blocked in this
 * build; the request/response shape below (`transmission_id`,
 * `transmission_time`, `cert_url`, `auth_algo`, `transmission_sig`,
 * `webhook_id`, `webhook_event`) is confirmed against multiple independent
 * real-world integrations' source (not memory alone) — this endpoint/shape
 * has been stable and unchanged for years across PayPal's own SDKs. A live
 * sandbox delivery is still worth confirming before go-live.
 */
export type PayPalFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PayPalWebhookHeaders {
  transmissionId: string | null;
  transmissionTime: string | null;
  certUrl: string | null;
  authAlgo: string | null;
  transmissionSig: string | null;
}

export function extractPayPalWebhookHeaders(headers: Headers): PayPalWebhookHeaders {
  return {
    transmissionId: headers.get("paypal-transmission-id"),
    transmissionTime: headers.get("paypal-transmission-time"),
    certUrl: headers.get("paypal-cert-url"),
    authAlgo: headers.get("paypal-auth-algo"),
    transmissionSig: headers.get("paypal-transmission-sig"),
  };
}

export interface VerifyPayPalWebhookResult {
  valid: boolean;
  reason?: "missing_headers" | "missing_webhook_id" | "verify_call_failed" | "not_success";
}

export async function verifyPayPalWebhookSignature(params: {
  fetchImpl: PayPalFetch;
  baseUrl: string;
  accessToken: string;
  webhookId: string | undefined;
  headers: PayPalWebhookHeaders;
  webhookEvent: unknown;
}): Promise<VerifyPayPalWebhookResult> {
  const { fetchImpl, baseUrl, accessToken, webhookId, headers, webhookEvent } = params;

  if (!webhookId) return { valid: false, reason: "missing_webhook_id" };
  if (
    !headers.transmissionId ||
    !headers.transmissionTime ||
    !headers.certUrl ||
    !headers.authAlgo ||
    !headers.transmissionSig
  ) {
    return { valid: false, reason: "missing_headers" };
  }

  const res = await fetchImpl(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      transmission_id: headers.transmissionId,
      transmission_time: headers.transmissionTime,
      cert_url: headers.certUrl,
      auth_algo: headers.authAlgo,
      transmission_sig: headers.transmissionSig,
      webhook_id: webhookId,
      webhook_event: webhookEvent,
    }),
  });

  if (!res.ok) return { valid: false, reason: "verify_call_failed" };
  const body = (await res.json().catch(() => undefined)) as
    | { verification_status?: string }
    | undefined;
  if (body?.verification_status !== "SUCCESS") return { valid: false, reason: "not_success" };
  return { valid: true };
}
