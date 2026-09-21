import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  getAgent,
  getConversationFlow,
  getPhoneNumber,
  getRetellLLM,
  listPhoneNumbers,
  updatePhoneNumber,
} from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `api-admin-attach-retell-number` (CALL-1, docs/BUILD_PLAN.md task 2):
 * re-points an EXISTING Retell-account phone number at a tenant's compiled
 * agent — never calls Twilio, never imports a number (the live account
 * already owns the number; the owner approved re-pointing it away from the
 * old product's agents, docs/BUILD_NOTES.md CALL-1 entry).
 *
 * `phone_numbers.twilio_sid` is NOT NULL + unique (`supabase/migrations/
 * 20260907130200_telephony.sql`) because every OTHER phone number this
 * platform provisions is purchased via Twilio and imported into Retell
 * (`api-provision`'s saga). This number was neither — it's a pre-existing
 * Retell-native/imported number this task re-points, so a deterministic
 * `retell-native:<e164>` placeholder is written instead of a real Twilio
 * SID. Known, documented limitation (BUILD_NOTES CALL-1 entry): code that
 * assumes every `phone_numbers.twilio_sid` is a real Twilio resource
 * (`api-a2p-register`, `job-retell-health-failover`, `job-offboarding`)
 * will not work correctly against this row — out of this task's scope to
 * fix, since none of those paths block a first live call.
 */

export interface AttachRetellNumberRequest {
  tenant_id: string;
  phone_e164?: string;
}

export interface AttachRetellNumberResult {
  status: number;
  body: { phone_e164: string } | { error: string };
}

export interface AttachRetellNumberDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  inboundWebhookUrl: string;
  logger: Logger;
}

export function validateRequest(
  body: unknown,
): { ok: true; data: AttachRetellNumberRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const tenantId = b["tenant_id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, error: "invalid_tenant_id" };
  }
  const phoneE164 = b["phone_e164"];
  if (phoneE164 !== undefined && typeof phoneE164 !== "string") {
    return { ok: false, error: "invalid_phone_e164" };
  }
  return {
    ok: true,
    data: {
      tenant_id: tenantId,
      ...(phoneE164 ? { phone_e164: phoneE164 } : {}),
    },
  };
}

interface RetellPhoneNumberListItem {
  phone_number: string;
  [key: string]: unknown;
}

export async function attachRetellNumber(
  sql: SqlClient,
  rawBody: unknown,
  deps: AttachRetellNumberDeps,
): Promise<AttachRetellNumberResult> {
  const parsed = validateRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;

  const agentRows = await sql<{ retell_agent_id: string | null }>`
    select retell_agent_id from public.agent_configs where tenant_id = ${req.tenant_id}
  `;
  const agentId = agentRows[0]?.retell_agent_id;
  if (!agentId) {
    return { status: 422, body: { error: "tenant_has_no_agent" } };
  }

  const listed = await listPhoneNumbers(deps.retellFetch, deps.retellApiKey);
  // RETELL-VERIFY (CALL-1, confirmed live against docs.retellai.com/
  // api-references/list-phone-numbers 2026-09-20): the response is NOT a
  // bare array — it's `{items: [...], has_more, pagination_key}`
  // (PaginatedResponseBase), same envelope shape as list-test-runs.
  const listedBody = listed.body as { items?: unknown } | undefined;
  if (!listed.ok || !Array.isArray(listedBody?.items)) {
    deps.logger.error("attach_retell_number_list_failed", {
      status: listed.status,
      body: JSON.stringify(listed.body).slice(0, 500),
    });
    return { status: 502, body: { error: "retell_list_phone_numbers_failed" } };
  }
  const numbers = listedBody.items as RetellPhoneNumberListItem[];

  let selected: RetellPhoneNumberListItem | undefined;
  if (req.phone_e164) {
    selected = numbers.find((n) => n.phone_number === req.phone_e164);
    if (!selected) return { status: 404, body: { error: "phone_number_not_found" } };
  } else if (numbers.length === 1) {
    selected = numbers[0];
  } else if (numbers.length === 0) {
    return { status: 422, body: { error: "no_numbers_on_account" } };
  } else {
    return { status: 422, body: { error: "ambiguous_number_selection_pass_phone_e164" } };
  }
  if (!selected) return { status: 404, body: { error: "phone_number_not_found" } };
  const phoneE164 = selected.phone_number;

  const updated = await updatePhoneNumber(deps.retellFetch, deps.retellApiKey, phoneE164, {
    inbound_agents: [{ agent_id: agentId, weight: 1 }],
    inbound_webhook_url: deps.inboundWebhookUrl,
  });
  if (!updated.ok) {
    deps.logger.error("attach_retell_number_update_failed", {
      tenant_id: req.tenant_id,
      status: updated.status,
    });
    return { status: 502, body: { error: "retell_update_phone_number_failed" } };
  }

  const twilioSidPlaceholder = `retell-native:${phoneE164}`;
  await sql`
    insert into public.phone_numbers (tenant_id, e164, twilio_sid, retell_number_id, is_primary)
    values (${req.tenant_id}, ${phoneE164}, ${twilioSidPlaceholder}, ${phoneE164}, true)
    on conflict (e164) do update set
      tenant_id = excluded.tenant_id,
      retell_number_id = excluded.retell_number_id,
      is_primary = true,
      released_at = null
  `;

  return { status: 200, body: { phone_e164: phoneE164 } };
}

/**
 * `action: "inspect"` (CALL-5, docs/BUILD_PLAN.md — item 1 of this task):
 * a read-only sibling of `attachRetellNumber` above, guarded by the SAME
 * `x-internal-secret` (index.ts never distinguishes — auth is identical),
 * added because nothing else in this repo can read `RETELL_API_KEY` from
 * outside a Deno edge function isolate (CLAUDE.md: never print secrets).
 * Calls Retell's own `GET /get-agent/{id}` + `GET /get-phone-number/{e164}`
 * for the tenant's CURRENT `agent_configs.retell_agent_id` and its primary
 * `phone_numbers` row, and returns only non-secret routing fields —
 * `webhook_url`/`webhook_timeout_ms`/`is_published`/`version` for the
 * agent, `inbound_agents`/`inbound_webhook_url` for the number. Never
 * mutates anything; never calls Twilio.
 */
export interface InspectRetellConfigRequest {
  tenant_id: string;
}

export interface InspectedAgent {
  agent_id: string;
  webhook_url: string | null;
  webhook_timeout_ms: number | null;
  is_published: boolean | null;
  version: number | null;
  /** PARITY-1: `response_engine.type` as returned by Retell
   * (`"conversation-flow"` or `"retell-llm"`), so a caller comparing two
   * tenants' agents can tell whether they're even the same compile
   * target before comparing `flow_hash`. */
  response_engine_type: string | null;
  /** PARITY-1: the SHA-256 hex digest of the compiled flow/LLM's own
   * canonical content (`nodes`+`start_node_id`+`tools`+`global_prompt` for
   * a conversation flow, or `general_prompt`+`general_tools`+`states`+
   * `starting_state` for a retell-llm) as Retell currently has it on
   * file — fetched fresh via `getConversationFlow`/`getRetellLLM`, never
   * read from this platform's own `agent_configs.compiled_config` (which
   * can itself be stale). Two tenants with an identical `flow_hash` have
   * byte-identical compiled prompts/tools/nodes; a different hash is the
   * actual, provable artifact difference. `null` when the flow/LLM
   * couldn't be fetched. */
  flow_hash: string | null;
  /** PARITY-1: the `general_tools` array's tool names, when the agent's
   * compile target is `multi_prompt`/`single_prompt` (a `retell-llm`
   * resource) — `null` for a `conversation_flow` agent (Retell's
   * `general_tools` field doesn't apply there; see `_shared/compiler/
   * template-compiler.ts`'s own `MultiPromptBody#general_tools` doc
   * comment). Requested by this task explicitly ("if needed") — included
   * whenever the fetched resource actually has one. */
  general_tools: string[] | null;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface InspectedPhoneNumber {
  phone_number: string;
  inbound_agents: unknown;
  inbound_webhook_url: string | null;
}

export interface InspectRetellConfigResult {
  status: number;
  body:
    | { agent: InspectedAgent | null; phone_number: InspectedPhoneNumber | null }
    | { error: string };
}

export function validateInspectRequest(
  body: unknown,
): { ok: true; data: InspectRetellConfigRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const tenantId = (body as Record<string, unknown>)["tenant_id"];
  if (typeof tenantId !== "string" || tenantId.length === 0) {
    return { ok: false, error: "invalid_tenant_id" };
  }
  return { ok: true, data: { tenant_id: tenantId } };
}

export async function inspectRetellConfig(
  sql: SqlClient,
  rawBody: unknown,
  deps: Pick<AttachRetellNumberDeps, "retellFetch" | "retellApiKey" | "logger">,
): Promise<InspectRetellConfigResult> {
  const parsed = validateInspectRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;

  const agentRows = await sql<{ retell_agent_id: string | null }>`
    select retell_agent_id from public.agent_configs where tenant_id = ${req.tenant_id}
  `;
  const agentId = agentRows[0]?.retell_agent_id ?? null;

  const phoneRows = await sql<{ e164: string }>`
    select e164 from public.phone_numbers
    where tenant_id = ${req.tenant_id} and released_at is null
    order by is_primary desc, created_at asc
    limit 1
  `;
  const phoneE164 = phoneRows[0]?.e164 ?? null;

  let agent: InspectedAgent | null = null;
  if (agentId) {
    const agentResult = await getAgent(deps.retellFetch, deps.retellApiKey, agentId);
    if (agentResult.ok) {
      const b = agentResult.body as {
        agent_id?: string;
        webhook_url?: string | null;
        webhook_timeout_ms?: number | null;
        is_published?: boolean | null;
        version?: number | null;
        response_engine?: {
          type?: string;
          conversation_flow_id?: string;
          llm_id?: string;
        } | null;
      };
      const responseEngine = b.response_engine ?? null;
      let flowHash: string | null = null;
      let generalTools: string[] | null = null;
      if (responseEngine?.type === "conversation-flow" && responseEngine.conversation_flow_id) {
        const flowResult = await getConversationFlow(
          deps.retellFetch,
          deps.retellApiKey,
          responseEngine.conversation_flow_id,
        );
        if (flowResult.ok) {
          const flowBody = flowResult.body as {
            start_node_id?: unknown;
            nodes?: unknown;
            tools?: unknown;
            global_prompt?: unknown;
          };
          flowHash = await sha256Hex(
            JSON.stringify({
              start_node_id: flowBody.start_node_id ?? null,
              nodes: flowBody.nodes ?? null,
              tools: flowBody.tools ?? null,
              global_prompt: flowBody.global_prompt ?? null,
            }),
          );
        } else {
          deps.logger.error("inspect_retell_config_get_conversation_flow_failed", {
            tenant_id: req.tenant_id,
            status: flowResult.status,
          });
        }
      } else if (responseEngine?.type === "retell-llm" && responseEngine.llm_id) {
        const llmResult = await getRetellLLM(
          deps.retellFetch,
          deps.retellApiKey,
          responseEngine.llm_id,
        );
        if (llmResult.ok) {
          const llmBody = llmResult.body as {
            general_prompt?: unknown;
            general_tools?: unknown;
            states?: unknown;
            starting_state?: unknown;
          };
          flowHash = await sha256Hex(
            JSON.stringify({
              general_prompt: llmBody.general_prompt ?? null,
              general_tools: llmBody.general_tools ?? null,
              states: llmBody.states ?? null,
              starting_state: llmBody.starting_state ?? null,
            }),
          );
          if (Array.isArray(llmBody.general_tools)) {
            generalTools = (llmBody.general_tools as Array<Record<string, unknown>>).map(
              (t) =>
                (t["name"] as string | undefined) ?? (t["type"] as string | undefined) ?? "unknown",
            );
          }
        } else {
          deps.logger.error("inspect_retell_config_get_retell_llm_failed", {
            tenant_id: req.tenant_id,
            status: llmResult.status,
          });
        }
      }
      agent = {
        agent_id: b.agent_id ?? agentId,
        webhook_url: b.webhook_url ?? null,
        webhook_timeout_ms: b.webhook_timeout_ms ?? null,
        is_published: b.is_published ?? null,
        version: b.version ?? null,
        response_engine_type: responseEngine?.type ?? null,
        flow_hash: flowHash,
        general_tools: generalTools,
      };
    } else {
      deps.logger.error("inspect_retell_config_get_agent_failed", {
        tenant_id: req.tenant_id,
        status: agentResult.status,
      });
    }
  }

  let phoneNumber: InspectedPhoneNumber | null = null;
  if (phoneE164) {
    const phoneResult = await getPhoneNumber(deps.retellFetch, deps.retellApiKey, phoneE164);
    if (phoneResult.ok) {
      const b = phoneResult.body as {
        phone_number?: string;
        inbound_agents?: unknown;
        inbound_webhook_url?: string | null;
      };
      phoneNumber = {
        phone_number: b.phone_number ?? phoneE164,
        inbound_agents: b.inbound_agents ?? null,
        inbound_webhook_url: b.inbound_webhook_url ?? null,
      };
    } else {
      deps.logger.error("inspect_retell_config_get_phone_number_failed", {
        tenant_id: req.tenant_id,
        status: phoneResult.status,
      });
    }
  }

  return { status: 200, body: { agent, phone_number: phoneNumber } };
}
