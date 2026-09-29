/**
 * Minimal Resend REST client via plain `fetch` (BACKEND_SPEC §10.2 — Resend
 * picked as the email provider recommendation, MASTER_SPEC §2 binding).
 * Core code never calls this directly: it goes through the `EmailProvider`
 * adapter in `./messaging/resend.ts`.
 *
 * Rule 1 (fetched 2026-09-29, docs/VERIFY.md MESSAGING-1):
 * resend.com/docs/api-reference/emails/send-email — `POST /emails`, Bearer
 * key, JSON `{from, to, subject, html, text?, reply_to?}`, response `{id}`;
 * `Idempotency-Key` header, max 256 chars, keys expire after 24 hours.
 */

const RESEND_BASE_URL = "https://api.resend.com";

export type ResendFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function sendEmail(
  fetchImpl: ResendFetch,
  apiKey: string,
  params: {
    from: string;
    to: string;
    subject: string;
    html: string;
    text?: string;
    reply_to?: string;
  },
  options: { idempotencyKey?: string } = {},
): Promise<{ ok: boolean; status: number; id?: string; error?: unknown }> {
  const res = await fetchImpl(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
    },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => undefined)) as { id?: string } | undefined;
  if (!res.ok) return { ok: false, status: res.status, error: body };
  return { ok: true, status: res.status, ...(body?.id ? { id: body.id } : {}) };
}
