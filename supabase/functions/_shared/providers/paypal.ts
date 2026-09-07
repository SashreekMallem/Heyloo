/**
 * Minimal PayPal REST client via plain `fetch` (referral payout batches —
 * BACKEND_SPEC §8 "Referral qualification + payout batch"). VERIFY
 * (docs/VERIFY.md): OAuth + Payouts endpoint shapes are the long-stable
 * PayPal REST v1 API (egress-blocked in this build); confirm sandbox vs
 * live base URL selection and current Payouts API field names before the
 * first real batch.
 */

export type PayPalFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function paypalBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
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
