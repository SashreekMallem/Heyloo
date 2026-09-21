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
 * fallback.
 *
 * CALL-6 (docs/BUILD_NOTES.md — cross-tenant write, verified live): Retell's
 * batch-test/simulator/chat-completion harness sends the exact SAME literal
 * `call_id`, `"playground"`, for EVERY tenant's EVERY scenario. `call_logs`
 * is unique on `retell_call_id`, so path (a) below (trusting a cached row)
 * used to mean the FIRST tenant ever to batch-test against that literal id
 * won a real row permanently, and every later batch-test call from ANY
 * OTHER tenant silently resolved to that same first tenant — a real
 * cross-tenant write (CLAUDE.md Rule 2), confirmed live: all 18 `bookings`
 * rows this bug ever produced landed under one tenant, including bookings a
 * different tenant's own test suite created. Fixed by never trusting path
 * (a) for a call id that isn't shaped like a real Retell call id (see
 * `isPlaceholderCallId` below) — `"playground"` (and anything else that
 * doesn't match) always re-resolves from the payload instead, every single
 * time, never from a shared cache row.
 *
 * Resolution order, every branch keeping tenant authorization:
 *
 *  (a) `call_logs` by `retell_call_id` — ONLY for an id shaped like a real
 *      Retell call id (`isPlaceholderCallId` returns false). The common
 *      case once `call_started` has landed (single indexed lookup, ~0 extra
 *      latency for a real call).
 *  (b) else (a placeholder/simulator id, or a real-shaped id with no cached
 *      row yet — the real-call race), resolve from the tool payload's own
 *      `call` object: `call.agent_id` -> `agent_configs.retell_agent_id` ->
 *      `tenant_id` (indexed, `idx_agent_configs_retell_agent_id`) — the
 *      strongest signal, since Retell itself sets `agent_id` and it's the
 *      one field most tightly scoped to a single tenant's single agent —
 *      falling back to
 *      `call.retell_llm_dynamic_variables.heyloo_tenant_id` (RETELL-
 *      VERIFIED live: neither `agent_id` nor `to_number` is EVER present in
 *      a Retell batch-test simulator's tool-call payload — see
 *      `resolveTenantFromPayload`'s own doc comment) for a QA-harness
 *      batch-test run, falling back again to `call.to_number` ->
 *      `phone_numbers.e164` -> `tenant_id` (indexed, `phone_numbers_e164_
 *      key`) if neither of the above resolved. Every one of these is a
 *      Retell-controlled call field or server-set test metadata, never
 *      anything caller/`args`-influenced — nothing from `args` is ever
 *      consulted for tenant identity. A minimal `call_logs` row is then
 *      UPSERTed so later webhooks update it in place rather than
 *      duplicating (see `voice-events/handler.ts#handleCallStarted`'s
 *      matching upsert fix) — for a placeholder id, keyed PER AGENT (see
 *      `placeholderRetellCallId`), not by the shared literal id, so a
 *      later batch-test call from a DIFFERENT tenant/agent never collides
 *      with — or resolves through — this one's row.
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
  /** CALL-6: `call_logs.is_test_call` for this call's row — `create_booking`
   * (and any future write that shouldn't count toward a tenant's real
   * dashboard/KPIs) mirrors this onto its own row's `is_test` column rather
   * than re-deriving it. */
  isTestCall: boolean;
}

/**
 * A real Retell call id (phone or `web_voice`) is `call_` followed by a
 * lowercase-hex string — confirmed live against THIS account's own
 * `call_logs` (`select retell_call_id from call_logs where source =
 * 'call_started'`, e.g. `call_30d9a235551f7b5bd80364cab4b`,
 * `call_353a8c7e18fbd42894503c4f5de`), which is the authoritative, current
 * shape for the actual Retell account this codebase talks to (stronger
 * ground truth than the generic example in docs.retellai.com's own
 * `get-call`/`list-calls` reference pages, which shows a bare-alphanumeric
 * example with no `call_` prefix at all — noted in `docs/VERIFY.md`
 * CALL-6). Retell's batch-test/chat-completion/playground simulator sends
 * the literal string `"playground"` instead, for every tenant, every
 * scenario — never this shape.
 *
 * Deliberately conservative in the direction that matters for CLAUDE.md
 * Rule 2 (cross-tenant safety): anything that doesn't confidently match
 * this shape is treated as a placeholder (never trusts a cached row for
 * it), even if that means occasionally re-resolving a real call from its
 * payload instead of the cache. Trusting the cache is the only way this
 * check can cause a cross-tenant bug, so being wrong in the "treat as
 * placeholder" direction only costs a few extra indexed queries per call,
 * never a wrong tenant.
 */
const REAL_RETELL_CALL_ID_RE = /^call_[0-9a-f]{16,64}$/;

export function isPlaceholderCallId(retellCallId: string): boolean {
  return !REAL_RETELL_CALL_ID_RE.test(retellCallId);
}

interface ExistingCallLogRow {
  id: string;
  tenant_id: string;
  caller_number: string | null;
  vertical: string;
  is_test_call: boolean;
}

async function lookupExistingCallLog(
  sql: SqlClient,
  retellCallId: string,
): Promise<ExistingCallLogRow | null> {
  const rows = await sql<ExistingCallLogRow>`
    select cl.id, cl.tenant_id, cl.caller_number, cl.is_test_call, t.vertical
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
 * (b)'s tenant resolution, in order — CALL-6: `agent_id` moved ahead of
 * `to_number`/the dynamic-variable tier since it's the strongest, most
 * tightly-scoped signal Retell sends (see the module doc comment above).
 *
 *  1. `call.agent_id` -> `agent_configs.retell_agent_id` -> tenant_id
 *     (indexed). Present and authoritative for a REAL call (phone or
 *     widget web_voice) per docs.retellai.com's custom-function examples.
 *  2. `call.retell_llm_dynamic_variables.heyloo_tenant_id` — RETELL-
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
 *     trust boundary as (1)/(3): Retell-controlled call metadata, never
 *     anything from `args`. Tried before `to_number` because it's Retell/
 *     harness-set metadata, not something a real call could ever populate
 *     ambiguously.
 *  3. `call.to_number` -> `phone_numbers.e164` -> tenant_id (indexed),
 *     only tried if (1) and (2) didn't resolve.
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

  return null;
}

/**
 * CALL-6: a placeholder call's `call_logs.retell_call_id` is keyed PER
 * AGENT — `"playground:" + agent_id` — rather than the bare literal id
 * every tenant's simulator shares. This is the actual fix for the
 * cross-tenant collision (CALL-5/OPS-5 both flagged this as open): the
 * unique index on `retell_call_id` now scopes the row to one agent (so one
 * tenant, `agent_configs.retell_agent_id` is unique per tenant) instead of
 * globally. When `call.agent_id` itself is absent (only the weaker
 * `to_number`/dynamic-variable tiers resolved), falls back to keying by the
 * resolved tenant id instead — still per-tenant-unique, just not per-agent.
 */
function placeholderRetellCallId(
  originalCallId: string,
  agentId: string | null | undefined,
  resolvedTenantId: string,
): string {
  return agentId ? `${originalCallId}:${agentId}` : `${originalCallId}:tenant:${resolvedTenantId}`;
}

interface UpsertedCallLogRow {
  id: string;
  tenant_id: string;
  caller_number: string | null;
  is_test_call: boolean;
}

/**
 * CALL-6: reads a placeholder row's CURRENT tenant_id before the upsert
 * below runs, so the caller can tell whether the upsert's `excluded.
 * tenant_id` override (agent_id-resolved placeholders only) actually
 * CHANGED anything worth a warning — a plain, separate SELECT rather than
 * folding this into the upsert's own statement (e.g. a `WITH` CTE) so the
 * upsert's own query text stays simple and unambiguous, and this extra
 * round trip only ever happens on the narrow placeholder+agent_id path,
 * never the real-call hot path.
 */
async function lookupPlaceholderRowPriorTenant(
  sql: SqlClient,
  retellCallId: string,
): Promise<string | null> {
  const rows = await sql<{ prior_tenant_id: string }>`
    select tenant_id as prior_tenant_id from public.call_logs
    where retell_call_id = ${retellCallId}
    limit 1
  `;
  return rows[0]?.prior_tenant_id ?? null;
}

/**
 * UPSERTs the minimal placeholder row, keyed by `params.retellCallId` (the
 * per-agent/per-tenant composite key for a placeholder call — see
 * `placeholderRetellCallId` — or the real Retell call id unchanged for a
 * real-call race).
 *
 * `on conflict ... do update set tenant_id = case when
 * params.overwriteTenantOnConflict then excluded.tenant_id else
 * call_logs.tenant_id end` — CALL-6: when the caller resolved via the
 * strongest signal (`call.agent_id`), the freshly-resolved tenant always
 * wins on conflict (an agent reassigned to a different tenant between two
 * calls is a real, if rare, config change — the CURRENT resolution should
 * win, not a stale cached one; `lookupPlaceholderRowPriorTenant` above is
 * how the caller notices and logs that). For every other resolution tier,
 * this stays the original CALL-2 "deliberate no-op" (first-writer-wins) —
 * `returning` still yields the ALREADY-EXISTING row on conflict (plain `do
 * nothing` returns zero rows), so a concurrent winner (another tool call
 * for the same `call_id` racing this one, or `call_started`'s own webhook
 * landing in between) is read back atomically instead of this insert
 * silently losing the race with no result.
 *
 * CALL-5 UPDATE: `supabase/migrations/20260920180000_call_logs_tool_first_
 * seen.sql` (the richer intended shape this DEPLOYMENT NOTE used to
 * describe as un-appliable) IS now live (confirmed via the project's own
 * `schema_migrations` history) — this insert writes `source =
 * 'tool_first_seen'` accordingly, so `voice-events`'s `call_started`
 * handler (which never overwrites `source` on conflict — see that
 * function's own comment) can still tell a placeholder row from a
 * webhook-created one, matching the migration's own column comment.
 * `is_test_call` is also set here now: `true` whenever `retellCallId` is a
 * placeholder shape (CALL-6, `isPlaceholderCallId`) OR the tenant was
 * resolved via the QA-harness-only `test_harness_tenant_id` tier — either
 * signal alone is sufficient, checked for both for robustness even though
 * they should always co-occur in practice.
 *
 * CALL-9 UPDATE: `caller_number` briefly gained an `on conflict` refresh
 * (`coalesce(excluded.caller_number, call_logs.caller_number)`) to make
 * `heyloo_test_caller_number` (this task's new QA-only dynamic variable)
 * take effect on a REUSED placeholder row — reverted (kept first-writer-
 * wins, unchanged from CALL-6) after finding it caused a real cross-
 * SCENARIO contamination bug live: every scenario in the SAME batch job
 * shares ONE placeholder row per tenant (CALL-6's own documented keying),
 * so once one scenario's turn wrote a real caller number onto that shared
 * row, a LATER, completely unrelated scenario in the same batch (e.g.
 * `cancellation`) would inherit it too if `resolveCallContext` ever read
 * `callerNumber` back from this row instead of from that call's OWN
 * payload — live-observed cancelling/mutating the WRONG simulated
 * customer's data. The actual fix is in `resolveCallContext` itself: a
 * placeholder call's `CallContext.callerNumber` is now built ONLY from
 * that exact tool call's own freshly-resolved value, never from this
 * row — see that function's own doc comment. This insert needs no special
 * handling for it at all, so it's back to the original CALL-6 shape.
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
    overwriteTenantOnConflict: boolean;
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
    on conflict (retell_call_id) do update set
      tenant_id = case when ${params.overwriteTenantOnConflict} then excluded.tenant_id else call_logs.tenant_id end
    returning id, tenant_id, caller_number, is_test_call
  `;
  return rows[0] ?? null;
}

export async function resolveCallContext(
  sql: SqlClient,
  retellCallId: string,
  call: ToolCall | undefined,
  logger: Logger,
): Promise<CallContext | null> {
  const placeholder = isPlaceholderCallId(retellCallId);

  // (a) existing call_logs row — ONLY for a real-shaped call id (CALL-6):
  // a placeholder id (e.g. Retell's shared "playground" literal) NEVER
  // trusts a cached row for tenant identity, no matter who wrote it —
  // that cache is exactly the cross-tenant collision this fix closes.
  if (!placeholder) {
    const existing = await lookupExistingCallLog(sql, retellCallId);
    if (existing) {
      return {
        tenantId: existing.tenant_id,
        callLogId: existing.id,
        retellCallId,
        callerNumber: existing.caller_number,
        vertical: existing.vertical,
        isTestCall: existing.is_test_call,
      };
    }
  }

  // (b) resolve from the tool payload itself — never trust anything other
  // than call.agent_id/call.to_number/the harness dynamic variable for
  // tenant identity (args are never consulted here; G6/cross-tenant
  // safety).
  if (call) {
    const resolved = await resolveTenantFromPayload(sql, call);
    if (resolved) {
      // CALL-9 (docs/BUILD_NOTES.md): `heyloo_test_caller_number` — a
      // QA-harness-only dynamic variable `api-admin-run-agent-tests` sets
      // per scenario so a batch test can simulate a REAL caller number
      // (e.g. a seeded returning customer's phone) even though Retell's
      // batch-test/simulator payload never carries a real `from_number`
      // (this module's own header, CALL-2). Honored ONLY when `placeholder`
      // is true — the exact same gate that already proves this is a
      // simulator/QA call, never a real one (a real Retell call id never
      // matches `isPlaceholderCallId`, so this ternary is provably
      // unreachable for a genuine phone/web call, which always keeps using
      // `call.from_number` unchanged below). Never trusted from `args` —
      // only from Retell's own call-metadata object, same trust boundary as
      // `heyloo_tenant_id` above.
      const testCallerNumber = placeholder
        ? normalizeE164(
            typeof call.retell_llm_dynamic_variables?.["heyloo_test_caller_number"] === "string"
              ? (call.retell_llm_dynamic_variables["heyloo_test_caller_number"] as string)
              : null,
          )
        : null;
      const callerNumber = testCallerNumber ?? normalizeE164(call.from_number ?? null);
      const direction: "inbound" | "outbound" =
        call.direction === "outbound" ? "outbound" : "inbound";
      const channel: "phone" | "web_voice" =
        call.call_type === "phone_call" ? "phone" : "web_voice";
      const isTestCall = placeholder || resolved.via === "test_harness_tenant_id";

      // CALL-6: a placeholder id is keyed per-agent (or per-tenant, if
      // agent_id itself is absent) so it can never collide with a
      // different tenant's placeholder row — this IS the fix, not just the
      // skip-the-cache-read above. A real-shaped id (the race case) keeps
      // the original literal key unchanged.
      const upsertKey = placeholder
        ? placeholderRetellCallId(retellCallId, call.agent_id, resolved.tenantId)
        : retellCallId;
      // Only the strongest signal (agent_id) is allowed to override a
      // stale tenant already stored under this exact key on conflict.
      const overwriteTenantOnConflict = placeholder && resolved.via === "agent_id";
      const priorTenantId = overwriteTenantOnConflict
        ? await lookupPlaceholderRowPriorTenant(sql, upsertKey)
        : null;

      const upserted = await upsertPlaceholderCallLog(sql, {
        retellCallId: upsertKey,
        tenantId: resolved.tenantId,
        phoneNumberId: resolved.phoneNumberId,
        callerNumber,
        direction,
        channel,
        isTestCall,
        overwriteTenantOnConflict,
      });
      if (upserted) {
        if (priorTenantId && priorTenantId !== resolved.tenantId) {
          logger.warn("voice_tools_call_context_agent_id_mismatch", {
            call_id: retellCallId,
            placeholder_key: upsertKey,
            agent_id: call.agent_id,
            prior_tenant_id: priorTenantId,
            resolved_tenant_id: resolved.tenantId,
          });
        }
        logger.warn("voice_tools_call_context_resolved_from_payload", {
          call_id: retellCallId,
          tenant_id: upserted.tenant_id,
          via: resolved.via,
          placeholder,
        });
        return {
          tenantId: upserted.tenant_id,
          callLogId: upserted.id,
          retellCallId,
          // CALL-9: a placeholder call NEVER reads its caller number back
          // from the shared row — `callerNumber` (this exact tool call's
          // own freshly-resolved value, `null` when this scenario set
          // neither `from_number` nor `heyloo_test_caller_number`) is
          // final, full stop. This is the actual fix for the cross-
          // scenario contamination bug this module's header now
          // documents: EVERY scenario in a batch job shares one
          // placeholder row per tenant, so reading a cached column back
          // would leak whichever scenario happened to write a real number
          // to it first into every OTHER scenario's own conversation. A
          // real (non-placeholder) call keeps the original CALL-2/CALL-6
          // behavior unchanged — trusting the row's returned value, which
          // is safe there since a real `retell_call_id` is unique to that
          // one call, never shared across callers.
          callerNumber: placeholder ? callerNumber : upserted.caller_number,
          vertical: resolved.vertical,
          isTestCall: upserted.is_test_call,
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
