/**
 * Minimal Anthropic Messages API client via plain `fetch` (used for the
 * demo-agent's hours/services extraction pass, BACKEND_SPEC §7.8, and
 * outreach reply intent classification, §7.5). VERIFY (docs/VERIFY.md):
 * confirm the current model id and `anthropic-version` header against
 * docs.anthropic.com before go-live (egress-blocked in this build) — the
 * request/response envelope shape itself is the stable, documented
 * Messages API contract.
 */

const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export type AnthropicFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function createMessage(
  fetchImpl: AnthropicFetch,
  apiKey: string,
  params: { model: string; maxTokens: number; system?: string; userMessage: string },
): Promise<{ ok: boolean; status: number; text?: string }> {
  const res = await fetchImpl(ANTHROPIC_BASE_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      ...(params.system ? { system: params.system } : {}),
      messages: [{ role: "user", content: params.userMessage }],
    }),
  });

  if (!res.ok) return { ok: false, status: res.status };

  const body = (await res.json().catch(() => undefined)) as
    | { content?: { type: string; text?: string }[] }
    | undefined;
  const text = body?.content?.find((c) => c.type === "text")?.text;
  return { ok: true, status: res.status, ...(text ? { text } : {}) };
}
