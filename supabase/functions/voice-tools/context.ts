import { normalizeE164 } from "../_shared/phone.ts";
import type { ToolCall } from "../_shared/schemas/voice-tools.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * Resolves the live call's tenant + real caller number so every tool
 * handler can safely scope its query to a `tenant_id` (CLAUDE.md Rule 2:
 * "every secret-key edge function still explicitly filters by a verified
 * tenant_id"). Also the source of truth for `lookup_customer`'s
 * caller-scope check (BACKEND_SPEC §7.2, G6) — never trust `args` alone for
 * the caller's own number.
 *
 * CALL-2 (docs/BUILD_NOTES.md CALL-1's own traced gap): a `call_logs` row
 * only ever existed via `voice-events`'s `call_started` webhook, so a
 * Retell batch-test/chat/playground session (no such webhook ever fires
 * for those) — and, on a REAL call, a tool call that races ahead of
 * `call_started`'s own commit — always fell through to the fail-closed
 * fallback. Resolution order, every branch keeping tenant authorization:
 *
 *  (a) `call_logs` by `retell_call_id` — the existing, common-case path
 *      (single indexed lookup, ~0 extra latency for a real call once
 *      `call_started` has landed).
 *  (b) else, from the tool payload's own `call` object — `call.agent_id`
 *      -> `agent_configs.retell_agent_id` -> `tenant_id` (indexed — CALL-2
 *      migration adds `idx_agent_configs_retell_agent_id`, not yet applied
 *      live, see `upsertPlaceholderCallLog`'s DEPLOYMENT NOTE; this query
 *      is still correct without it) for a REAL call, falling back to
 *      `call.to_number` -> `phone_numbers.e164` -> `tenant_id` (indexed,
 *      `phone_numbers_e164_key`) if `agent_id` is absent or doesn't
 *      resolve, falling back again to
 *      `call.retell_llm_dynamic_variables.heyloo_tenant_id` (RETELL-
 *      VERIFIED live: neither `agent_id` nor `to_number` is EVER present
 *      in a Retell batch-test simulator's tool-call payload — see
 *      `resolveTenantFromPayload`'s own doc comment) for a QA-harness
 *      batch-test run. Every one of these is a Retell-controlled call
 *      field or server-set test metadata, never anything caller/
 *      `args`-influenced — nothing from `args` is ever consulted for
 *      tenant identity. A minimal `call_logs` row is then UPSERTed so
 *      later webhooks update it in place rather than duplicating (see
 *      `voice-events/handler.ts#handleCallStarted`'s matching upsert fix).
 *  (c) neither resolves -> `null` (fail closed, existing graceful spoken
 *      fallback) — logged at `warn` with the reason.
 */
export interface CallContext {
  tenantId: string;
  callLogId: string; // call_logs.id (internal uuid) — FK target for source_call_id
  retellCallId: string; // Retell's own call_id string — the idempotency-key convention's "call_id"
  callerNumber: string | null;
  /** `tenants.vertical` — resolved alongside tenant_id in the same indexed
   * join (no extra query) so tools that need vertical-specific behavior
   * (e.g. `create_booking`'s typed `structured_payload` validator,
   * GAP_REGISTER.md §1.7, and the motel deposit-hold path, §2 Motel item
   * 4) don't each re-fetch it. */
  vertical: string;
}

interface ExistingCallLogRow {
  id: string;
  tenant_id: string;
  caller_number: string | null;
  vertical: string;
}

async function lookupExistingCallLog(
  sql: SqlClient,
  retellCallId: string,
): Promise<ExistingCallLogRow | null> {
  const rows = await sql<ExistingCallLogRow>`
    select cl.id, cl.tenant_id, cl.caller_number, t.vertical
    from public.call_logs cl
    join public.tenants t on t.id = cl.tenant_id
    where cl.retell_call_id = ${retellCallId}
    limit 1
  `;
  return rows[0] ?? null;
}

interface PayloadResolution {
  tenantId: string;
  vertical: string;
  phoneNumberId: string | null;
  via: "agent_id" | "to_number" | "test_harness_tenant_id";
}

/**
 * (b)'s tenant resolution, in order:
 *
 *  1. `call.agent_id` -> `agent_configs.retell_agent_id` -> tenant_id
 *     (indexed). Present and authoritative for a REAL call (phone or
 *     widget web_voice) per docs.retellai.com's custom-function examples.
 *  2. `call.to_number` -> `phone_numbers.e164` -> tenant_id (indexed),
 *     only tried if (1) didn't resolve.
 *  3. `call.retell_llm_dynamic_variables.heyloo_tenant_id` — RETELL-
 *     VERIFIED live 2026-09-20 (docs/BUILD_NOTES.md CALL-2): Retell's
 *     batch-test simulator's tool-call payload has NEITHER `agent_id` NOR
 *     `to_number` populated at all (confirmed via this project's own live
 *     `voice_tools_call_context_unresolved` warn logs during a real batch
 *     test run — no real Agent/phone-number resource is bound to a
 *     bare-response_engine test run). `api-admin-run-agent-tests` sets
 *     this dynamic variable when creating its test cases specifically so
 *     this tier can resolve them; a REAL call never has it set (neither
 *     `voice-inbound`'s dynamic-variable response nor a real caller can
 *     set it), so this tier is QA-harness-only in practice, not a general
 *     production signal or a caller-spoofable one — still just a direct
 *     tenant-id lookup (validated against a real `tenants` row), same
 *     trust boundary as (1)/(2): Retell-controlled call metadata, never
 *     anything from `args`.
 */
async function resolveTenantFromPayload(
  sql: SqlClient,
  call: ToolCall,
): Promise<PayloadResolution | null> {
  if (call.agent_id) {
    const rows = await sql<{ tenant_id: string; vertical: string }>`
      select ac.tenant_id, t.vertical
      from public.agent_configs ac
      join public.tenants t on t.id = ac.tenant_id
      where ac.retell_agent_id = ${call.agent_id}
      limit 1
    `;
    const row = rows[0];
    if (row) {
      return {
        tenantId: row.tenant_id,
        vertical: row.vertical,
        phoneNumberId: null,
        via: "agent_id",
      };
    }
  }

  const toNumber = normalizeE164(call.to_number ?? null);
  if (toNumber) {
    const rows = await sql<{ tenant_id: string; vertical: string; phone_number_id: string }>`
      select pn.tenant_id, t.vertical, pn.id as phone_number_id
      from public.phone_numbers pn
      join public.tenants t on t.id = pn.tenant_id
      where pn.e164 = ${toNumber} and pn.released_at is null
      limit 1
    `;
    const row = rows[0];
    if (row) {
      return {
        tenantId: row.tenant_id,
        vertical: row.vertical,
        phoneNumberId: row.phone_number_id,
        via: "to_number",
      };
    }
  }

  const dynamicVars = call.retell_llm_dynamic_variables;
  const testHarnessTenantId =
    dynamicVars && typeof dynamicVars["heyloo_tenant_id"] === "string"
      ? dynamicVars["heyloo_tenant_id"]
      : null;
  if (testHarnessTenantId) {
    const rows = await sql<{ id: string; vertical: string }>`
      select id, vertical from public.tenants where id = ${testHarnessTenantId} and deleted_at is null
      limit 1
    `;
    const row = rows[0];
    if (row) {
      return {
        tenantId: row.id,
        vertical: row.vertical,
        phoneNumberId: null,
        via: "test_harness_tenant_id",
      };
    }
  }

  return null;
}

interface UpsertedCallLogRow {
  id: string;
  tenant_id: string;
  caller_number: string | null;
}

/**
 * UPSERTs the minimal placeholder row. `on conflict ... do update set
 * tenant_id = call_logs.tenant_id` is a deliberate no-op write, not a real
 * update — its only purpose is making `returning` yield the ALREADY-
 * EXISTING row on conflict (plain `do nothing` returns zero rows), so a
 * concurrent winner (another tool call for the same `call_id` racing this
 * one, or `call_started`'s own webhook landing in between) is read back
 * atomically instead of this insert silently losing the race with no
 * result. This is the race the task's own test requires: two near-
 * simultaneous resolutions for the same never-before-seen `call_id` must
 * never produce two `call_logs` rows.
 *
 * CALL-5 UPDATE: `supabase/migrations/20260920180000_call_logs_tool_first_
 * seen.sql` (the richer intended shape this DEPLOYMENT NOTE used to
 * describe as un-appliable) IS now live (confirmed via the project's own
 * `schema_migrations` history) — this insert writes `source =
 * 'tool_first_seen'` accordingly, so `voice-events`'s `call_started`
 * handler (which never overwrites `source` on conflict — see that
 * function's own comment) can still tell a placeholder row from a
 * webhook-created one, matching the migration's own column comment.
 * `is_test_call` is also set here now: `true` whenever the tenant was
 * resolved via the QA-harness-only `test_harness_tenant_id` tier (Retell
 * batch tests — `api-admin-run-agent-tests` sets that dynamic variable) or
 * whenever `retellCallId` is the literal `"playground"` Retell's batch
 * simulator/chat-completion sessions all share (CALL-5, docs/BUILD_NOTES.md:
 * every batch-test scenario's tool calls land on the SAME call_logs row
 * for exactly this reason — collapsing to one row is a real, documented,
 * Retell-controlled limitation, not a bug this fix changes; marking it
 * `is_test_call` is what keeps it out of the tenant's real dashboard).
 */
async function upsertPlaceholderCallLog(
  sql: SqlClient,
  params: {
    retellCallId: string;
    tenantId: string;
    phoneNumberId: string | null;
    callerNumber: string | null;
    direction: "inbound" | "outbound";
    channel: "phone" | "web_voice";
    isTestCall: boolean;
  },
): Promise<UpsertedCallLogRow | null> {
  const rows = await sql<UpsertedCallLogRow>`
    insert into public.call_logs (
      tenant_id, phone_number_id, retell_call_id, caller_number, direction,
      started_at, channel, source, is_test_call
    ) values (
      ${params.tenantId}, ${params.phoneNumberId}, ${params.retellCallId}, ${params.callerNumber},
      ${params.direction}, now(), ${params.channel}, 'tool_first_seen', ${params.isTestCall}
    )
    on conflict (retell_call_id) do update set tenant_id = call_logs.tenant_id
    returning id, tenant_id, caller_number
  `;
  return rows[0] ?? null;
}

export async function resolveCallContext(
  sql: SqlClient,
  retellCallId: string,
  call: ToolCall | undefined,
  logger: Logger,
): Promise<CallContext | null> {
  // (a) existing call_logs row — the common case once call_started has
  // landed, and the ONLY query most real-call tool invocations pay for.
  const existing = await lookupExistingCallLog(sql, retellCallId);
  if (existing) {
    return {
      tenantId: existing.tenant_id,
      callLogId: existing.id,
      retellCallId,
      callerNumber: existing.caller_number,
      vertical: existing.vertical,
    };
  }

  // (b) resolve from the tool payload itself — never trust anything other
  // than call.agent_id/call.to_number for tenant identity (args are never
  // consulted here; G6/cross-tenant safety).
  if (call) {
    const resolved = await resolveTenantFromPayload(sql, call);
    if (resolved) {
      const callerNumber = normalizeE164(call.from_number ?? null);
      const direction: "inbound" | "outbound" =
        call.direction === "outbound" ? "outbound" : "inbound";
      const channel: "phone" | "web_voice" =
        call.call_type === "phone_call" ? "phone" : "web_voice";
      // CALL-5 (docs/BUILD_NOTES.md): a batch-test/chat-completion QA
      // session only ever resolves via the `test_harness_tenant_id` tier,
      // and Retell's simulator always sends the literal call_id
      // "playground" for these — either signal alone is enough, checked
      // for robustness against a future Retell change to one but not the
      // other.
      const isTestCall = resolved.via === "test_harness_tenant_id" || retellCallId === "playground";

      const upserted = await upsertPlaceholderCallLog(sql, {
        retellCallId,
        tenantId: resolved.tenantId,
        phoneNumberId: resolved.phoneNumberId,
        callerNumber,
        direction,
        channel,
        isTestCall,
      });
      if (upserted) {
        logger.warn("voice_tools_call_context_resolved_from_payload", {
          call_id: retellCallId,
          tenant_id: upserted.tenant_id,
          via: resolved.via,
        });
        return {
          tenantId: upserted.tenant_id,
          callLogId: upserted.id,
          retellCallId,
          callerNumber: upserted.caller_number,
          vertical: resolved.vertical,
        };
      }
    }
  }

  // (c) fail closed.
  logger.warn("voice_tools_call_context_unresolved", {
    call_id: retellCallId,
    had_call_payload: !!call,
    had_agent_id: !!call?.agent_id,
    had_to_number: !!call?.to_number,
  });
  return null;
}
