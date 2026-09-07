/**
 * Minimal Retell REST client via plain `fetch` (portable — no SDK import,
 * so this stays off the `packages/adapters` provider-SDK boundary; see
 * supabase/functions/BUILD_NOTES.md for why edge functions call provider
 * REST APIs directly with `fetch` instead of going through
 * `packages/adapters/retell` — that package is Node-only and Deno can't
 * import a pnpm workspace package without a bundling step this task doesn't
 * add). VERIFY (docs/VERIFY.md): endpoint paths/fields below are the
 * training-knowledge-confident Retell v2 REST shapes (`api.retellai.com`,
 * bearer auth) — confirm against Retell's live API reference before the
 * first real provisioning/reconciliation call (egress-blocked in this
 * build).
 */

const RETELL_BASE_URL = "https://api.retellai.com";

export type RetellFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function retellRequest(
  fetchImpl: RetellFetch,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetchImpl(`${RETELL_BASE_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => undefined);
  return { ok: res.ok, status: res.status, body };
}

export async function getCall(fetchImpl: RetellFetch, apiKey: string, callId: string) {
  return retellRequest(fetchImpl, apiKey, `/v2/get-call/${encodeURIComponent(callId)}`, {
    method: "GET",
  });
}

export async function createAgent(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: Record<string, unknown>,
) {
  return retellRequest(fetchImpl, apiKey, "/create-agent", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function publishAgent(fetchImpl: RetellFetch, apiKey: string, agentId: string) {
  return retellRequest(fetchImpl, apiKey, `/publish-agent/${encodeURIComponent(agentId)}`, {
    method: "POST",
  });
}

export async function importPhoneNumber(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: { phone_number: string; termination_uri?: string; agent_id?: string; nickname?: string },
) {
  return retellRequest(fetchImpl, apiKey, "/import-phone-number", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createWebCall(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: { agent_id: string; retell_llm_dynamic_variables?: Record<string, unknown> },
) {
  return retellRequest(fetchImpl, apiKey, "/v2/create-web-call", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
