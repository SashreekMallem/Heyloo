import { sha256Hex } from "../_shared/crypto.ts";
import { normalizeE164 } from "../_shared/phone.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import { createPhoneCall } from "../_shared/providers/retell.ts";
import { isQuietHours, nextQuietHoursEnd } from "../_shared/quiet-hours.ts";
import type { LeadCallbackRequest } from "../_shared/schemas/lead-callback.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-lead-callback` core logic (GAP_REGISTER Cluster G item 2 —
 * real-estate lead callback). Accepts a lead from a tenant's web form
 * backend or CRM webhook (never called directly from an untrusted browser
 * — see `resolveTenantFromApiToken` below), records the required TCPA
 * consent, and places an outbound AI-voice call within the tenant's
 * quiet-hours window — or refuses/defers otherwise. Every branch writes a
 * `lead_callback_requests` row so nothing about a submitted lead is ever
 * silently dropped.
 */

export interface ApiTokenLookupRow {
  tenant_id: string;
  api_token_id: string;
}

/** Resolves the caller's tenant from a bearer `api_tokens` token (never
 * from a client-supplied `tenant_id` — CLAUDE.md Rule 2). Requires the
 * `leads:write` scope and an unrevoked token. */
export async function resolveTenantFromApiToken(
  sql: SqlClient,
  bearerToken: string,
): Promise<ApiTokenLookupRow | null> {
  const tokenHash = await sha256Hex(bearerToken);
  const rows = await sql<{ id: string; tenant_id: string; scopes: string[] }>`
    select id, tenant_id, scopes from public.api_tokens
    where token_hash = ${tokenHash} and revoked_at is null
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  if (!Array.isArray(row.scopes) || !row.scopes.includes("leads:write")) return null;
  await sql`update public.api_tokens set last_used_at = now() where id = ${row.id}`;
  return { tenant_id: row.tenant_id, api_token_id: row.id };
}

export interface TenantCallingConfigRow {
  timezone: string;
  retell_agent_id: string | null;
  disclosure_line: string | null;
  from_number: string | null;
}

export async function resolveTenantCallingConfig(
  sql: SqlClient,
  tenantId: string,
): Promise<TenantCallingConfigRow | null> {
  const rows = await sql<TenantCallingConfigRow>`
    select
      t.timezone,
      ac.retell_agent_id,
      at.disclosure_line,
      (select pn.e164 from public.phone_numbers pn
        where pn.tenant_id = t.id and pn.is_primary = true and pn.released_at is null
        limit 1) as from_number
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    left join public.agent_templates at on at.id = ac.template_id
    where t.id = ${tenantId} and t.deleted_at is null
    limit 1
  `;
  return rows[0] ?? null;
}

export interface LeadCallbackDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  logger: Logger;
}

export type LeadCallbackResult =
  | { status: 200; body: { status: "called"; lead_callback_request_id: string; call_id: string } }
  | {
      status: 202;
      body: {
        status: "deferred_quiet_hours";
        lead_callback_request_id: string;
        scheduled_for: string;
      };
    }
  | { status: 404; body: { error: "tenant_not_found" } }
  | { status: 422; body: { error: "invalid_phone" } }
  | { status: 409; body: { status: string; lead_callback_request_id: string } }
  | {
      status: 502;
      body: {
        error: "tenant_not_configured_for_calling" | "outbound_call_failed";
        lead_callback_request_id: string;
      };
    };

export async function handleLeadCallback(
  sql: SqlClient,
  tenantId: string,
  input: LeadCallbackRequest,
  deps: LeadCallbackDeps,
  now: Date = new Date(),
): Promise<LeadCallbackResult> {
  const phoneE164 = normalizeE164(input.phone);
  if (!phoneE164) return { status: 422, body: { error: "invalid_phone" } };

  if (input.idempotency_key) {
    const existing = await sql<{ id: string; status: string }>`
      select id, status from public.lead_callback_requests
      where tenant_id = ${tenantId} and idempotency_key = ${input.idempotency_key}
      limit 1
    `;
    if (existing[0]) {
      return {
        status: 409,
        body: { status: existing[0].status, lead_callback_request_id: existing[0].id },
      };
    }
  }

  const config = await resolveTenantCallingConfig(sql, tenantId);
  if (!config) return { status: 404, body: { error: "tenant_not_found" } };

  const consentGivenAt = input.consent_given_at ?? now.toISOString();
  const inserted = await sql<{ id: string }>`
    insert into public.lead_callback_requests (
      tenant_id, name, phone_e164, source, consent_text, consent_given_at, consent_ip,
      idempotency_key, metadata, status
    ) values (
      ${tenantId}, ${input.name ?? null}, ${phoneE164}, ${input.source}, ${input.consent_text},
      ${consentGivenAt}::timestamptz, ${input.consent_ip ?? null}, ${input.idempotency_key ?? null},
      ${JSON.stringify(input.metadata ?? {})}::jsonb, 'pending'
    )
    returning id
  `;
  const leadCallbackRequestId = inserted[0]?.id;
  if (!leadCallbackRequestId) {
    // Should be unreachable (INSERT ... RETURNING always returns a row on
    // success) — fails closed rather than proceeding with an unknown id.
    return { status: 502, body: { error: "outbound_call_failed", lead_callback_request_id: "" } };
  }

  if (!config.retell_agent_id || !config.from_number || !config.disclosure_line) {
    await sql`
      update public.lead_callback_requests
      set status = 'failed', refusal_reason = 'tenant_not_configured_for_calling'
      where id = ${leadCallbackRequestId}
    `;
    deps.logger.error("lead_callback_tenant_not_configured", {
      tenant_id: tenantId,
      lead_callback_request_id: leadCallbackRequestId,
    });
    return {
      status: 502,
      body: {
        error: "tenant_not_configured_for_calling",
        lead_callback_request_id: leadCallbackRequestId,
      },
    };
  }

  return attemptLeadCallbackCall(
    sql,
    tenantId,
    leadCallbackRequestId,
    phoneE164,
    input.name ?? null,
    {
      timezone: config.timezone,
      retell_agent_id: config.retell_agent_id,
      from_number: config.from_number,
      disclosure_line: config.disclosure_line,
    },
    deps,
    now,
  );
}

/**
 * The quiet-hours-check -> place-or-defer-the-call sequence, extracted so
 * `job-lead-callback-retry` (FIX_REQUESTS.md — drains
 * `lead_callback_requests` rows stuck in `deferred_quiet_hours`) can reuse
 * the EXACT same call-placing logic as the original immediate-call path
 * instead of a second, drifting copy. `leadCallbackRequestId`'s row must
 * already exist (`status: 'pending'` on first call, `'deferred_quiet_hours'`
 * on a retry) — this function only ever transitions it to `'called'`,
 * `'deferred_quiet_hours'` (re-deferred, still within quiet hours), or
 * `'failed'`.
 */
export async function attemptLeadCallbackCall(
  sql: SqlClient,
  tenantId: string,
  leadCallbackRequestId: string,
  phoneE164: string,
  leadName: string | null,
  config: {
    timezone: string;
    retell_agent_id: string;
    from_number: string;
    disclosure_line: string;
  },
  deps: LeadCallbackDeps,
  now: Date,
): Promise<LeadCallbackResult> {
  if (isQuietHours(now, config.timezone)) {
    const scheduledFor = nextQuietHoursEnd(now, config.timezone).toISOString();
    await sql`
      update public.lead_callback_requests
      set status = 'deferred_quiet_hours', scheduled_for = ${scheduledFor}::timestamptz
      where id = ${leadCallbackRequestId}
    `;
    return {
      status: 202,
      body: {
        status: "deferred_quiet_hours",
        lead_callback_request_id: leadCallbackRequestId,
        scheduled_for: scheduledFor,
      },
    };
  }

  const result = await createPhoneCall(deps.retellFetch, deps.retellApiKey, {
    from_number: config.from_number,
    to_number: phoneE164,
    override_agent_id: config.retell_agent_id,
    retell_llm_dynamic_variables: {
      disclosure_line: config.disclosure_line,
      ...(leadName ? { lead_name: leadName } : {}),
    },
    metadata: {
      consent_ref: leadCallbackRequestId,
      lead_callback_request_id: leadCallbackRequestId,
    },
  });

  const providerCallId = (result.body as { call_id?: string } | undefined)?.call_id;
  if (!result.ok || !providerCallId) {
    await sql`
      update public.lead_callback_requests
      set status = 'failed', refusal_reason = 'outbound_call_failed'
      where id = ${leadCallbackRequestId}
    `;
    deps.logger.error("lead_callback_outbound_call_failed", {
      tenant_id: tenantId,
      lead_callback_request_id: leadCallbackRequestId,
      status: result.status,
    });
    return {
      status: 502,
      body: { error: "outbound_call_failed", lead_callback_request_id: leadCallbackRequestId },
    };
  }

  const phoneNumberRows = await sql<{ id: string }>`
    select id from public.phone_numbers where e164 = ${config.from_number} limit 1
  `;
  const callLogRows = await sql<{ id: string }>`
    insert into public.call_logs (
      tenant_id, phone_number_id, retell_call_id, caller_number, direction, started_at, is_test_call
    ) values (
      ${tenantId}, ${phoneNumberRows[0]?.id ?? null}, ${providerCallId}, ${phoneE164}, 'outbound', ${now.toISOString()}, false
    )
    on conflict (retell_call_id) do nothing
    returning id
  `;

  await sql`
    update public.lead_callback_requests
    set status = 'called', provider_call_id = ${providerCallId}, call_log_id = ${callLogRows[0]?.id ?? null}
    where id = ${leadCallbackRequestId}
  `;

  deps.logger.info("lead_callback_call_placed", {
    tenant_id: tenantId,
    lead_callback_request_id: leadCallbackRequestId,
    provider_call_id: providerCallId,
  });

  return {
    status: 200,
    body: {
      status: "called",
      lead_callback_request_id: leadCallbackRequestId,
      call_id: providerCallId,
    },
  };
}
