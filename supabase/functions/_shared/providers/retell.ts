/**
 * Minimal Retell REST client via plain `fetch` (portable — no SDK import,
 * so this stays off the `packages/adapters` provider-SDK boundary; see
 * supabase/functions/BUILD_NOTES.md for why edge functions call provider
 * REST APIs directly with `fetch` instead of going through
 * `packages/adapters/retell` — that package is Node-only and Deno can't
 * import a pnpm workspace package without a bundling step this task doesn't
 * add).
 *
 * RETELL-VERIFY: endpoint paths/fields below were re-verified against the
 * OFFICIAL `retell-typescript-sdk` (v5.64.0, reachable via
 * raw.githubusercontent.com even though docs.retellai.com itself is
 * egress-blocked here) — see docs/VERIFY.md's Retell entries for what was
 * confirmed correct as-built vs. fixed. `api.retellai.com`, bearer auth, and
 * every path below are confirmed exactly against the SDK's own
 * `src/resources/*.ts` request builders.
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

/**
 * POST /create-agent. RETELL-VERIFY (VERIFY-6, resolved): confirmed via
 * retell-typescript-sdk that `inbound_webhook_url` does NOT exist on this
 * resource at all — it's phone-number-scoped (`importPhoneNumber` below).
 * Never add it to this payload. The response includes a REQUIRED `version`
 * field — callers that need to publish must read it from here (or from
 * `getAgent`) and pass it to `publishAgentVersion`.
 */
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

/** PATCH /update-agent/{id} — the second half of the two-step
 * create/update-agent protocol (API_AND_FLOWS.md A.1, `packages/adapters/
 * retell/src/agents.ts`'s `createOrUpdateRetellAgent`) for a template
 * publish that already has a `retell_agent_id` on file. */
export async function updateAgent(
  fetchImpl: RetellFetch,
  apiKey: string,
  agentId: string,
  payload: Record<string, unknown>,
) {
  return retellRequest(fetchImpl, apiKey, `/update-agent/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** POST /create-conversation-flow — step 1 of the two-step protocol for a
 * `compile_target: conversation_flow` template (agents.ts's
 * `FLOW_RESOURCE_ENDPOINT`); response carries `conversation_flow_id`. */
export async function createConversationFlow(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: Record<string, unknown>,
) {
  return retellRequest(fetchImpl, apiKey, "/create-conversation-flow", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** POST /create-retell-llm — step 1 of the two-step protocol for
 * `multi_prompt`/`single_prompt` templates; response carries `llm_id`. */
export async function createRetellLLM(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: Record<string, unknown>,
) {
  return retellRequest(fetchImpl, apiKey, "/create-retell-llm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** GET /get-agent/{id} — confirmed via retell-typescript-sdk
 * (`Agent.retrieve`, `src/resources/agent.ts`). Used to fetch an agent's
 * CURRENT `version` before publishing when the caller didn't just
 * create/update it in the same request (RETELL-VERIFY, VERIFY-6). */
export async function getAgent(fetchImpl: RetellFetch, apiKey: string, agentId: string) {
  return retellRequest(fetchImpl, apiKey, `/get-agent/${encodeURIComponent(agentId)}`, {
    method: "GET",
  });
}

/** POST /publish-agent-version/{id} — makes a version immutable
 * (BACKEND_SPEC §1.3). Endpoint name corrected from an earlier
 * `/publish-agent/{id}` guess to match the confirmed shape T2's
 * `packages/adapters/retell/src/agents.ts` uses (`publishRetellAgentVersion`)
 * — see docs/BUILD_NOTES.md T4 entry.
 *
 * RETELL-VERIFY (VERIFY-6, resolved): confirmed via retell-typescript-sdk's
 * `AgentPublishParams`/`Agent.publish` that this endpoint (a) REQUIRES a
 * `{version: number, ...}` request body — there is no "publish whatever's
 * latest draft" shorthand, and (b) returns `void` (no response body). The
 * caller MUST supply the version to publish (from the agent's own
 * create/update response, or a fresh `getAgent` call). */
export async function publishAgentVersion(
  fetchImpl: RetellFetch,
  apiKey: string,
  agentId: string,
  version: number,
) {
  return retellRequest(fetchImpl, apiKey, `/publish-agent-version/${encodeURIComponent(agentId)}`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

/**
 * RETELL-VERIFY (VERIFY-7, resolved): confirmed field-for-field against
 * retell-typescript-sdk's `PhoneNumberImportParams` —
 * `inbound_agents`/`outbound_agents` are both ARRAYS of
 * `{agent_id, weight, agent_version?}` (`weight` REQUIRED, must sum to 1
 * across each array — a single agent still needs `weight: 1`), NOT a bare
 * `agent_id` string as this file previously modeled. `inbound_webhook_url`
 * is confirmed to live HERE (phone-number-scoped), not on the agent — see
 * VERIFY-6 above and `createAgent`'s docstring.
 */
export async function importPhoneNumber(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: {
    phone_number: string;
    termination_uri: string;
    inbound_agents: Array<{ agent_id: string; weight: number; agent_version?: string | number }>;
    outbound_agents?: Array<{ agent_id: string; weight: number; agent_version?: string | number }>;
    inbound_webhook_url?: string;
    sip_trunk_auth_username?: string;
    sip_trunk_auth_password?: string;
    nickname?: string;
  },
) {
  return retellRequest(fetchImpl, apiKey, "/import-phone-number", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * POST /v2/create-phone-call — outbound calling (GAP_REGISTER Cluster A
 * item 6 / Cluster G item 2, real-estate lead callback). Same confirmed
 * shape as `packages/adapters/retell/src/outbound.ts`'s
 * `createRetellOutboundCall` (that file's own header: confirmed via
 * `retell-sdk`'s `Call.createPhoneCall`/`CallCreatePhoneCallParams`,
 * `/v2` prefix, `{from_number, to_number, override_agent_id?,
 * retell_llm_dynamic_variables?, metadata?}` — see docs/VERIFY.md
 * VERIFY-10 for the one open item, response fields beyond `call_id`) —
 * reimplemented here as a plain-`fetch` Deno-importable function rather
 * than consumed from that package directly, for the same Node/Deno import
 * boundary reason every other function in this file exists (`packages/
 * adapters/retell` cannot be imported from the Deno Edge Function
 * runtime).
 *
 * Fails CLOSED (never calls Retell) when `dynamicVariables.disclosure_line`
 * is missing/blank — an outbound call has no compiled-in first turn the way
 * an inbound template does, so this is the enforcement point instead (G1/G2:
 * the AI + recording disclosure is non-negotiable on every call).
 */
export async function createPhoneCall(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: {
    from_number: string;
    to_number: string;
    override_agent_id: string;
    retell_llm_dynamic_variables: Record<string, string> & { disclosure_line: string };
    metadata?: Record<string, unknown>;
  },
) {
  if (
    !payload.retell_llm_dynamic_variables.disclosure_line ||
    payload.retell_llm_dynamic_variables.disclosure_line.trim() === ""
  ) {
    return {
      ok: false as const,
      status: 0,
      body: { error: "disclosure_line_missing_refusing_to_call" },
    };
  }
  return retellRequest(fetchImpl, apiKey, "/v2/create-phone-call", {
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
