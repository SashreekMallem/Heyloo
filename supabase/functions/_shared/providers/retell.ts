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

/** PATCH /update-conversation-flow/{conversation_flow_id} — RETELL-VERIFIED
 * live 2026-09-20 (docs.retellai.com/api-references/update-conversation-flow):
 * same request body shape as create (nodes/tools/start_node_id/
 * global_prompt/...), no `version` query param (updates the latest
 * version in place). Used by CALL-2's compiler-bug fix to push a
 * recompiled flow to an ALREADY-provisioned tenant's existing
 * conversation_flow_id, since `api-admin-provision-test-tenant` only ever
 * calls `createConversationFlow` once per tenant (`if (!agentId)`). */
export async function updateConversationFlow(
  fetchImpl: RetellFetch,
  apiKey: string,
  conversationFlowId: string,
  payload: Record<string, unknown>,
) {
  return retellRequest(
    fetchImpl,
    apiKey,
    `/update-conversation-flow/${encodeURIComponent(conversationFlowId)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
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

/** POST /create-agent-version/{agent_id} — RETELL-VERIFIED live 2026-09-20
 * (docs.retellai.com/api-references/create-agent-version, corroborated by
 * community.retellai.com/t/api-workflow-for-updating-a-published-
 * conversation-flow/2805's official-answer summary): the ONLY way to
 * change a published agent — `update-agent`/`update-conversation-flow`
 * both flatly reject any edit touching a currently-published agent/flow
 * (`400`/`422 "Cannot update published ..."`, confirmed live against
 * this project's own test-tenant agent, CALL-2). Body is `{base_version}`
 * (the version to branch a new, unpublished DRAFT from — typically the
 * agent's current published version); response is the new draft version's
 * full agent object (`is_published: false`, same `agent_id`, incremented
 * `version`). CALL-2's `force_recompile` flow: create-agent-version ->
 * update-agent (now succeeds — it's a draft) -> publish-agent-version. */
export async function createAgentVersion(
  fetchImpl: RetellFetch,
  apiKey: string,
  agentId: string,
  baseVersion: number,
) {
  return retellRequest(fetchImpl, apiKey, `/create-agent-version/${encodeURIComponent(agentId)}`, {
    method: "POST",
    body: JSON.stringify({ base_version: baseVersion }),
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

/**
 * GET /v2/list-phone-numbers (CALL-1, RETELL-VERIFY: confirmed live against
 * `docs.retellai.com/api-references/list-phone-numbers` 2026-09-20 —
 * `limit`/`sort_order`/`pagination_key` query params). The response body is
 * NOT a bare array — it's `{items: [...], has_more, pagination_key}`
 * (`PaginatedResponseBase`, same envelope as list-test-runs); a first pass
 * of this comment assumed a bare array from an imprecise doc summary and
 * that assumption produced a real live 502 (`attach_retell_number_list_
 * failed`) before being corrected here. Each `items[]` entry carries
 * `phone_number` (E.164, the resource's own identifier — there is no
 * separate id), `phone_number_type`, `inbound_agents`, `nickname`. Only
 * `limit` is passed here — the live account owns a single number today,
 * well under any default page size, and CALL-1's attach flow fails loudly
 * rather than silently paginating if that assumption ever stops holding
 * (see api-admin-attach-retell-number/handler.ts).
 */
export async function listPhoneNumbers(fetchImpl: RetellFetch, apiKey: string, limit = 1000) {
  return retellRequest(
    fetchImpl,
    apiKey,
    `/v2/list-phone-numbers?limit=${encodeURIComponent(String(limit))}`,
    { method: "GET" },
  );
}

/**
 * GET /get-phone-number/{phone_number} (CALL-5, RETELL-VERIFY: confirmed
 * live against docs.retellai.com/api-references/get-phone-number
 * 2026-09-20 — `PhoneNumberResponse`: `phone_number`, `inbound_agents`
 * (weighted array, nullable), `inbound_webhook_url` (nullable, "webhook for
 * inbound calls, where you can override" — phone-number-scoped, matching
 * `updatePhoneNumber`/`importPhoneNumber` above), `outbound_agents`,
 * `last_modification_timestamp`. Used by
 * `api-admin-attach-retell-number`'s read-only `action: "inspect"` to
 * confirm a number's live routing without calling Twilio or mutating
 * anything.
 */
export async function getPhoneNumber(
  fetchImpl: RetellFetch,
  apiKey: string,
  phoneNumberE164: string,
) {
  return retellRequest(
    fetchImpl,
    apiKey,
    `/get-phone-number/${encodeURIComponent(phoneNumberE164)}`,
    { method: "GET" },
  );
}

/**
 * PATCH /update-phone-number/{phone_number} (CALL-1, RETELL-VERIFY:
 * confirmed live against `docs.retellai.com/api-references/update-phone-number`
 * 2026-09-20 — same confirmed shape as `importPhoneNumber` above:
 * `inbound_agents`/`outbound_agents` are weighted-array fields, not a bare
 * `inbound_agent_id` string; `inbound_webhook_url` lives here
 * (phone-number-scoped), matching `docs/research/RETELL_TESTABILITY_2026-09-20.md`
 * row 5a). Used to re-point an EXISTING number (already owned by the Retell
 * account, imported outside this codebase) at a newly-compiled agent —
 * never calls Twilio.
 */
export async function updatePhoneNumber(
  fetchImpl: RetellFetch,
  apiKey: string,
  phoneNumberE164: string,
  payload: {
    inbound_agents?: Array<{ agent_id: string; weight: number; agent_version?: string | number }>;
    outbound_agents?: Array<{ agent_id: string; weight: number; agent_version?: string | number }>;
    inbound_webhook_url?: string;
    nickname?: string;
  },
) {
  return retellRequest(
    fetchImpl,
    apiKey,
    `/update-phone-number/${encodeURIComponent(phoneNumberE164)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}

/**
 * POST /create-test-case-definition, POST /create-batch-test,
 * GET /v2/list-test-runs/{id} (CALL-1) — the same three calls
 * `packages/adapters/retell/src/tests-api.ts` already wraps for the
 * Node-side red-team harness, reimplemented here as plain-`fetch`
 * Deno-importable functions for the identical Node/Deno workspace-package
 * boundary reason every other function in this file exists (see this
 * file's own header). Shapes confirmed against `docs.retellai.com`
 * (`/api-references/create-batch-test`, `/create-test-case-definition`)
 * 2026-09-20 and cross-checked against that package's own VERIFY-13 note:
 * `response_engine` targets a `conversation-flow`/`retell-llm` id (never an
 * agent id directly — "Custom LLM is not supported" for batch testing).
 * Confirmed this pass: omitting `tool_mocks` on a test case definition
 * means "a tool call matching no mock falls through to the real tool" —
 * i.e. batch tests CAN and DO hit a real custom-tool webhook live, no mock
 * required (docs/research/RETELL_TESTABILITY_2026-09-20.md's own open
 * question, resolved here).
 */
export async function createTestCaseDefinition(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: {
    name: string;
    response_engine: Record<string, unknown>;
    user_prompt: string;
    metrics: string[];
    dynamic_variables?: Record<string, string>;
  },
) {
  return retellRequest(fetchImpl, apiKey, "/create-test-case-definition", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createBatchTest(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: { response_engine: Record<string, unknown>; test_case_definition_ids: string[] },
) {
  return retellRequest(fetchImpl, apiKey, "/create-batch-test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listTestRuns(
  fetchImpl: RetellFetch,
  apiKey: string,
  batchJobId: string,
  limit = 1000,
) {
  return retellRequest(
    fetchImpl,
    apiKey,
    `/v2/list-test-runs/${encodeURIComponent(batchJobId)}?limit=${encodeURIComponent(String(limit))}`,
    { method: "GET" },
  );
}

/**
 * DELETE /delete-agent/{agent_id} (CALL-7, docs/BUILD_PLAN.md task 4 —
 * "do not accumulate Retell agents"). RETELL-VERIFY: confirmed both via a
 * live `docs.retellai.com/api-references/delete-agent` fetch AND the
 * official `retell-typescript-sdk` source (`Agent.delete`,
 * `src/resources/agent.ts`: `this._client.delete(path\`/delete-agent/${id}\`)`)
 * 2026-09-20 — no request body, `204 No Content` on success ("Deletes all
 * versions of the agent."). Used by `api-admin-provision-test-tenant`'s
 * opt-in `cleanup_superseded_agent` (see handler.ts) to remove the OLD
 * agent a `force_recompile` just superseded, never called for an agent this
 * codebase didn't itself just create.
 */
export async function deleteAgent(fetchImpl: RetellFetch, apiKey: string, agentId: string) {
  return retellRequest(fetchImpl, apiKey, `/delete-agent/${encodeURIComponent(agentId)}`, {
    method: "DELETE",
  });
}

/**
 * POST /create-chat, POST /create-chat-completion (CALL-1) — the headless
 * text-mode path `docs/research/RETELL_TESTABILITY_2026-09-20.md` row 4a/4b
 * confirms against `docs.retellai.com/api-references/create-chat` and
 * `.../create-chat-completion`: drives the SAME agent prompt/tool config
 * as a live phone call, over text, with no telephony required. Used as a
 * secondary live smoke-check of the custom-tool webhook path (CALL-1 RUN
 * IT LIVE step d) independent of the batch-test API.
 */
export async function createChat(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: {
    agent_id: string;
    agent_version?: number;
    metadata?: Record<string, unknown>;
    retell_llm_dynamic_variables?: Record<string, unknown>;
  },
) {
  return retellRequest(fetchImpl, apiKey, "/create-chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function createChatCompletion(
  fetchImpl: RetellFetch,
  apiKey: string,
  payload: { chat_id: string; content: string },
) {
  return retellRequest(fetchImpl, apiKey, "/create-chat-completion", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
