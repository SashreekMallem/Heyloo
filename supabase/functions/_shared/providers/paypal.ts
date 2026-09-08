/**
 * Minimal PayPal REST client via plain `fetch` (referral payout batches —
 * BACKEND_SPEC §8 "Referral qualification + payout batch").
 *
 * VERIFY (docs/VERIFY.md): OAuth2 client-credentials grant (Basic auth of
 * client_id:client_secret + `grant_type=client_credentials` form body) and
 * the Payouts request/response field names below (`sender_batch_header`,
 * `sender_batch_id`, `email_subject`, `items[].{recipient_type, amount:
 * {value, currency}, receiver, note, sender_item_id}`) are CONFIRMED
 * against the official `@paypal/payouts-sdk` npm package's own source
 * (`paypal/Payouts-NodeJS-SDK` on GitHub — real request-builder code and
 * README example, not docs prose; `developer.paypal.com` itself was
 * egress-blocked here). Base URL fixed from this build's original
 * `api-m.(sandbox.)paypal.com` guess to `api.(sandbox.)paypal.com` (no
 * `-m`) to match that SDK's `paypal_environment.js` exactly — flagged as
 * lower-certainty than the other confirmations here since that SDK package
 * hasn't been republished since 2021 and PayPal is independently known to
 * have introduced an `api-m.paypal.com` host for some newer REST surfaces;
 * a live sandbox OAuth token call against this host is still worth doing
 * before the first real payout batch, in case PayPal has since retired the
 * older bare `api.paypal.com` host for this v1 endpoint specifically.
 */

export type PayPalFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function paypalBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api.paypal.com" : "https://api.sandbox.paypal.com";
}

export async function getAccessToken(
  fetchImpl: PayPalFetch,
  baseUrl: string,
  clientId: string,
  clientSecret: string,
): Promise<{ ok: boolean; accessToken?: string; status: number }> {
  const res = await fetchImpl(`${baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = (await res.json().catch(() => undefined)) as { access_token?: string } | undefined;
  return body?.access_token
    ? { ok: res.ok, status: res.status, accessToken: body.access_token }
    : { ok: res.ok, status: res.status };
}

export interface PayoutItem {
  recipientEmail: string;
  amountCents: number;
  currency: string;
  note: string;
  senderItemId: string;
}

export async function createPayoutBatch(
  fetchImpl: PayPalFetch,
  baseUrl: string,
  accessToken: string,
  params: { senderBatchId: string; emailSubject: string; items: PayoutItem[] },
) {
  const res = await fetchImpl(`${baseUrl}/v1/payments/payouts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender_batch_header: {
        sender_batch_id: params.senderBatchId,
        email_subject: params.emailSubject,
      },
      items: params.items.map((item) => ({
        recipient_type: "EMAIL",
        amount: { value: (item.amountCents / 100).toFixed(2), currency: item.currency },
        receiver: item.recipientEmail,
        note: item.note,
        sender_item_id: item.senderItemId,
      })),
    }),
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}
