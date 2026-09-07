/**
 * Minimal Resend REST client via plain `fetch` (BACKEND_SPEC §10.2 — Resend
 * picked as the email provider recommendation, MASTER_SPEC §2 binding).
 * VERIFY (docs/VERIFY.md): confirm the current `/emails` endpoint shape
 * against Resend's live API reference before go-live (egress-blocked here);
 * this is the training-knowledge-confident v1 shape.
 */

const RESEND_BASE_URL = "https://api.resend.com";

export type ResendFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function sendEmail(
  fetchImpl: ResendFetch,
  apiKey: string,
  params: { from: string; to: string; subject: string; html: string },
): Promise<{ ok: boolean; status: number; id?: string; error?: unknown }> {
  const res = await fetchImpl(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => undefined)) as { id?: string } | undefined;
  if (!res.ok) return { ok: false, status: res.status, error: body };
  return { ok: true, status: res.status, ...(body?.id ? { id: body.id } : {}) };
}
