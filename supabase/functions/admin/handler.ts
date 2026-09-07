import { writeAdminAction } from "../_shared/admin-actions.js";
import type { AdminJwtClaims } from "../_shared/admin-auth.js";
import { isAal2, isPlatformAdmin } from "../_shared/admin-auth.js";
import {
  type CompilerAgentTemplate,
  compileTemplate,
} from "../_shared/compiler/template-compiler.js";
import { isSuppressed } from "../_shared/lead-dedup.js";
import type { ResendFetch } from "../_shared/providers/resend.js";
import { sendEmail } from "../_shared/providers/resend.js";
import type { RetellFetch } from "../_shared/providers/retell.js";
import {
  createAgent,
  createConversationFlow,
  createRetellLLM,
  publishAgentVersion,
} from "../_shared/providers/retell.js";
import type { SmartleadFetch } from "../_shared/providers/smartlead.js";
import {
  createCampaign as createSmartleadCampaign,
  updateCampaignStatus as updateSmartleadCampaignStatus,
} from "../_shared/providers/smartlead.js";
import type { SupabaseAdminFetch } from "../_shared/providers/supabase-admin.js";
import { generateMagicLink, getUserEmailById } from "../_shared/providers/supabase-admin.js";
import { renderTemplate } from "../_shared/templates.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `/admin-*` single-function internal router (BACKEND_SPEC §7.7 —
 * "recommend one function with internal path routing... fewer Edge
 * Functions favors the low-QPS admin surface"). Every mutating route writes
 * `admin_actions`; AAL2 is required (session-level — see admin-auth.ts's
 * own caveat about true 15-minute freshness) for impersonation specifically.
 *
 * Scope note (docs/BUILD_NOTES.md T3/T4/T8 entries): BACKEND_SPEC §7.7 names
 * ten endpoint groups. T3 implemented Tenants (list/get/patch) and Alerts
 * (list/ack) fully, plus impersonation's AAL2 gate + audit-log write (token
 * minting itself deferred). T4 completes impersonation (real
 * `generate_link` mint, `deps.supabaseAdmin` required) and implements
 * Margin cockpit, Config Lab, Referral P&L (+ payout-override), CAC, and
 * Templates (+ publish via `_shared/compiler/template-compiler.ts` and the
 * Retell publish call). T8 completes the Outreach group (leads, campaign
 * CRUD, add-leads, funnel, reply feed + one-click actions, a per-vertical
 * CAC rollup — distinct from the channel-level `GET /admin-cac` T4 already
 * built). Support and Feature flags remain an explicit `501 not_implemented`
 * (never a silent 200) — outside T8's named scope (task explicitly scopes
 * this build to the Outreach group only within `admin/`), left for a later
 * wave.
 */

export interface AdminRequestContext {
  method: string;
  path: string; // e.g. "/admin-tenants/abc123/impersonate"
  claims: AdminJwtClaims | null;
  body: unknown;
  adminUserId: string | null;
  ipAddress?: string;
  userAgent?: string;
  /** Parsed `URL.searchParams` — only the Outreach group's list/filter
   * routes read this today (T8); every other group ignores it. */
  query?: Record<string, string>;
}

export interface AdminResponse {
  status: number;
  body: unknown;
}

/** Provider clients only some route groups need — optional so every
 * existing caller/test that doesn't touch impersonation-mint,
 * template-publish, or outreach-campaign-provider-calls keeps working
 * unchanged. */
export interface AdminDeps {
  retell?: { fetchImpl: RetellFetch; apiKey: string; toolWebhookUrl: string };
  supabaseAdmin?: { fetchImpl: SupabaseAdminFetch; url: string; serviceRoleKey: string };
  /** Smartlead client + the CAN-SPAM footer text every created campaign
   * must carry (compliance hard rule, T8) — deliberately all-or-nothing:
   * when this is unset, campaign-create/status-change degrade to a `501`
   * rather than ever creating a campaign with no footer configured. */
  outreach?: {
    smartleadFetchImpl: SmartleadFetch;
    smartleadApiKey: string;
    canSpamFooter: string;
  };
  /** Used only by the Outreach group's "mark interested -> demo link send"
   * reply action (T8) — a direct Resend send, deliberately NOT routed
   * through `messages_outbound`/`worker-messages-outbound` (that table's
   * `tenant_id` is `NOT NULL`; a cold-outreach lead has no tenant yet). */
  resend?: { fetchImpl: ResendFetch; apiKey: string; fromAddress: string };
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

async function handleTenants(
  sql: SqlClient,
  ctx: AdminRequestContext,
  logger: Logger,
  deps: AdminDeps,
): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-tenants", ":id"?, "impersonate"?]
  const tenantId = parts[1];

  if (ctx.method === "GET" && !tenantId) {
    const rows = await sql<{ id: string; name: string; vertical: string; status: string }>`
      select id, name, vertical, status from public.tenants where deleted_at is null order by created_at desc limit 100
    `;
    return { status: 200, body: { tenants: rows } };
  }

  if (ctx.method === "GET" && tenantId && parts[2] === undefined) {
    const rows = await sql<
      Record<string, unknown>
    >`select * from public.tenants where id = ${tenantId}`;
    const tenant = rows[0];
    if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };
    return { status: 200, body: { tenant } };
  }

  if (ctx.method === "PATCH" && tenantId && parts[2] === undefined) {
    const before = (
      await sql<Record<string, unknown>>`select * from public.tenants where id = ${tenantId}`
    )[0];
    if (!before) return { status: 404, body: { error: "tenant_not_found" } };

    const patch = (ctx.body ?? {}) as Record<string, unknown>;
    const allowedFields = new Set([
      "status",
      "usage_hard_cap_minutes",
      "manual_mode",
      "retention_days",
    ]);
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (allowedFields.has(key)) updates[key] = value;
    }
    if (Object.keys(updates).length === 0)
      return { status: 422, body: { error: "no_valid_fields" } };

    if ("status" in updates) {
      await sql`update public.tenants set status = ${updates["status"] as string} where id = ${tenantId}`;
    }
    if ("manual_mode" in updates) {
      await sql`update public.tenants set manual_mode = ${updates["manual_mode"] as boolean}, manual_mode_enabled_at = now() where id = ${tenantId}`;
    }
    if ("usage_hard_cap_minutes" in updates) {
      await sql`update public.tenants set usage_hard_cap_minutes = ${updates["usage_hard_cap_minutes"] as number} where id = ${tenantId}`;
    }
    if ("retention_days" in updates) {
      await sql`update public.tenants set retention_days = ${updates["retention_days"] as number} where id = ${tenantId}`;
    }

    const after = (
      await sql<Record<string, unknown>>`select * from public.tenants where id = ${tenantId}`
    )[0];
    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "tenant_edit",
        targetType: "tenant",
        targetId: tenantId,
        before,
        after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { tenant: after } };
  }

  if (ctx.method === "POST" && tenantId && parts[2] === "impersonate") {
    if (!isAal2(ctx.claims)) {
      return { status: 403, body: { error: "aal2_required" } };
    }
    const tenantRows = await sql<{
      id: string;
    }>`select id from public.tenants where id = ${tenantId} and deleted_at is null`;
    if (!tenantRows[0]) return { status: 404, body: { error: "tenant_not_found" } };

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "impersonate_start",
        targetType: "tenant",
        targetId: tenantId,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    logger.warn("admin_impersonation_started", {
      admin_user_id: ctx.adminUserId,
      tenant_id: tenantId,
    });

    if (!deps.supabaseAdmin) {
      // Minting the actual short-lived scoped session token is a Supabase
      // Auth Admin API call (VERIFY.md: confirm current `generate_link`
      // mechanism) — the audit-log write above is the security-relevant
      // part this build guarantees happens regardless of whether the mint
      // itself is wired for this deploy.
      return { status: 501, body: { error: "impersonation_token_mint_not_implemented" } };
    }

    const ownerRows = await sql<{ user_id: string }>`
      select user_id from public.memberships where tenant_id = ${tenantId} and role = 'owner' limit 1
    `;
    const ownerUserId = ownerRows[0]?.user_id;
    if (!ownerUserId) return { status: 404, body: { error: "tenant_owner_not_found" } };

    const email = await getUserEmailById(
      deps.supabaseAdmin.fetchImpl,
      deps.supabaseAdmin.url,
      deps.supabaseAdmin.serviceRoleKey,
      ownerUserId,
    );
    if (!email) return { status: 502, body: { error: "owner_email_lookup_failed" } };

    const link = await generateMagicLink(
      deps.supabaseAdmin.fetchImpl,
      deps.supabaseAdmin.url,
      deps.supabaseAdmin.serviceRoleKey,
      email,
    );
    if (!link.ok || !link.actionLink) {
      return { status: 502, body: { error: "impersonation_link_mint_failed" } };
    }
    return { status: 200, body: { impersonation_link: link.actionLink, tenant_id: tenantId } };
  }

  return { status: 404, body: { error: "not_found" } };
}

async function handleAlerts(sql: SqlClient, ctx: AdminRequestContext): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-alerts", ":id"?, "ack"?]
  const alertId = parts[1];

  if (ctx.method === "GET" && !alertId) {
    const rows = await sql<Record<string, unknown>>`
      select * from public.alerts where status = 'open' order by created_at desc limit 100
    `;
    return { status: 200, body: { alerts: rows } };
  }

  if (ctx.method === "PATCH" && alertId && parts[2] === "ack") {
    if (!ctx.adminUserId) return { status: 403, body: { error: "forbidden" } };
    const rows = await sql<{ id: string }>`
      update public.alerts set status = 'acked', acked_at = now(), acked_by = ${ctx.adminUserId}
      where id = ${alertId} and status = 'open'
      returning id
    `;
    if (!rows[0]) return { status: 404, body: { error: "alert_not_found_or_already_acked" } };
    return { status: 200, body: { acked: true } };
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------
// Margin cockpit (BACKEND_SPEC §7.7) — reads T1's §6 views + cost_events/
// revenue_events directly for drill-down. No writes, no admin_actions.
// ---------------------------------------------------------------------
async function handleCockpit(sql: SqlClient, ctx: AdminRequestContext): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-cockpit", "<page>"]
  const page = parts[1];
  if (ctx.method !== "GET") return { status: 404, body: { error: "not_found" } };

  if (page === "waterfall") {
    const rows = await sql<{ revenue_cents: number; cost_cents: number; margin_cents: number }>`
      select coalesce(sum(revenue_cents),0)::int as revenue_cents,
             coalesce(sum(cost_cents),0)::int as cost_cents,
             coalesce(sum(margin_cents),0)::int as margin_cents
      from public.v_tenant_margin
    `;
    return {
      status: 200,
      body: { waterfall: rows[0] ?? { revenue_cents: 0, cost_cents: 0, margin_cents: 0 } },
    };
  }

  if (page === "per-customer-margin") {
    const rows = await sql<Record<string, unknown>>`
      select * from public.v_tenant_margin order by margin_cents asc limit 200
    `;
    return { status: 200, body: { tenants: rows } };
  }

  if (page === "per-call-cost") {
    const rows = await sql<Record<string, unknown>>`
      select * from public.v_call_cost_vs_billed order by provider_cost_cents desc nulls last limit 100
    `;
    return { status: 200, body: { calls: rows } };
  }

  if (page === "repricing-drift") {
    // BACKEND_SPEC §8's "price drift >8%" needs a per-provider/product cost
    // BASELINE this build has no platform_settings key for yet (T1/T3 left
    // it as a literal-thresholds follow-up) — rather than guess a baseline,
    // this surfaces the current trailing-30-day average unit cost per
    // provider/product so an admin can eyeball drift manually until a real
    // baseline key is introduced (docs/BUILD_NOTES.md T4 entry).
    const rows = await sql<{
      provider: string;
      product: string;
      avg_unit_cost_cents: number;
      sample_count: number;
    }>`
      select provider, product, avg(unit_cost_cents)::numeric(12,4) as avg_unit_cost_cents, count(*)::int as sample_count
      from public.cost_events
      where occurred_at >= now() - interval '30 days' and unit_cost_cents is not null
      group by provider, product
      order by provider, product
    `;
    return { status: 200, body: { drift: rows, baseline_configured: false } };
  }

  if (page === "bottleneck") {
    const rows = await sql<{
      tool_name: string;
      calls: number;
      error_rate: number;
      p95_ms: number;
    }>`
      select
        tool_name,
        count(*)::int as calls,
        (count(*) filter (where not success))::numeric / nullif(count(*), 0) as error_rate,
        percentile_cont(0.95) within group (order by latency_ms) as p95_ms
      from public.tool_health
      where occurred_at >= now() - interval '1 hour'
      group by tool_name
      order by p95_ms desc nulls last
    `;
    return { status: 200, body: { tools: rows } };
  }

  if (page === "alerts") {
    const rows = await sql<Record<string, unknown>>`
      select * from public.alerts where status = 'open' order by created_at desc limit 100
    `;
    return { status: 200, body: { alerts: rows } };
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------
// Config Lab (BACKEND_SPEC §7.7) — "what-if" margin projection against a
// proposed price-card edit, WITHOUT committing it to platform_settings.
// ---------------------------------------------------------------------
interface PriceCardValue {
  base_cents: number;
  included_minutes: number;
  overage_cents: number;
}

async function handleConfigLab(sql: SqlClient, ctx: AdminRequestContext): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-config-lab", "simulate"]
  if (parts[1] !== "simulate" || (ctx.method !== "GET" && ctx.method !== "POST")) {
    return { status: 404, body: { error: "not_found" } };
  }

  const body = (ctx.body ?? {}) as Partial<PriceCardValue> & { vertical?: string };
  if (!body.vertical) return { status: 422, body: { error: "missing_vertical" } };

  const currentRows = await sql<{ value: PriceCardValue }>`
    select value from public.platform_settings where key = ${`price_card_${body.vertical}`}
  `;
  const current = currentRows[0]?.value;
  if (!current) return { status: 404, body: { error: "unknown_vertical" } };

  const proposed: PriceCardValue = {
    base_cents: body.base_cents ?? current.base_cents,
    included_minutes: body.included_minutes ?? current.included_minutes,
    overage_cents: body.overage_cents ?? current.overage_cents,
  };

  const usageRows = await sql<{ tenant_id: string; billable_minutes: number }>`
    select t.id as tenant_id, coalesce(sum(ud.billable_minutes), 0) as billable_minutes
    from public.tenants t
    left join public.usage_daily ud on ud.tenant_id = t.id and ud.date >= date_trunc('month', now())::date
    where t.vertical = ${body.vertical} and t.deleted_at is null and t.status = 'active'
    group by t.id
  `;

  const costRows = await sql<{ cost_cents: number }>`
    select coalesce(sum(ce.total_cost_cents), 0)::int as cost_cents
    from public.cost_events ce
    join public.tenants t on t.id = ce.tenant_id
    where t.vertical = ${body.vertical} and ce.occurred_at >= date_trunc('month', now())
  `;
  const costCents = costRows[0]?.cost_cents ?? 0;

  const project = (card: PriceCardValue) => {
    let revenue = 0;
    for (const row of usageRows) {
      const overage = Math.max(0, row.billable_minutes - card.included_minutes);
      revenue += card.base_cents + Math.round(overage * card.overage_cents);
    }
    return { revenue_cents: revenue, cost_cents: costCents, margin_cents: revenue - costCents };
  };

  return {
    status: 200,
    body: {
      vertical: body.vertical,
      tenant_count: usageRows.length,
      current: project(current),
      simulated: project(proposed),
    },
  };
}

// ---------------------------------------------------------------------
// Referral P&L (BACKEND_SPEC §7.7)
// ---------------------------------------------------------------------
async function handleReferrals(sql: SqlClient, ctx: AdminRequestContext): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-referrals", ":commission_event_id"?, "payout-override"?]
  const commissionEventId = parts[1];

  if (ctx.method === "GET" && !commissionEventId) {
    const rows = await sql<Record<string, unknown>>`
      select * from public.v_referral_pnl order by accrued_cents desc nulls last limit 200
    `;
    return { status: 200, body: { referral_partners: rows } };
  }

  if (ctx.method === "POST" && commissionEventId && parts[2] === "payout-override") {
    const body = (ctx.body ?? {}) as { amount_cents?: number };
    if (typeof body.amount_cents !== "number" || body.amount_cents < 0) {
      return { status: 422, body: { error: "invalid_amount_cents" } };
    }
    const before = (
      await sql<Record<string, unknown>>`
        select * from public.commission_events where id = ${commissionEventId}
      `
    )[0];
    if (!before) return { status: 404, body: { error: "commission_event_not_found" } };
    if (before["status"] !== "accrued") {
      return { status: 409, body: { error: "commission_already_batched_or_paid" } };
    }

    const after = (
      await sql<Record<string, unknown>>`
        update public.commission_events set amount_cents = ${body.amount_cents}
        where id = ${commissionEventId}
        returning *
      `
    )[0];

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "referral_payout_override",
        targetType: "referral",
        targetId: commissionEventId,
        before,
        after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { commission_event: after } };
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------
// CAC (BACKEND_SPEC §7.7) — reads cac_events joined to leads/campaigns.
// ---------------------------------------------------------------------
async function handleCac(sql: SqlClient, ctx: AdminRequestContext): Promise<AdminResponse> {
  if (ctx.method !== "GET") return { status: 404, body: { error: "not_found" } };
  const rows = await sql<{
    channel: string;
    total_cost_cents: number;
    lead_count: number;
    converted_tenant_count: number;
  }>`
    select
      channel,
      sum(cost_cents)::int as total_cost_cents,
      count(*) filter (where lead_id is not null)::int as lead_count,
      count(distinct tenant_id) filter (where tenant_id is not null)::int as converted_tenant_count
    from public.cac_events
    group by channel
    order by total_cost_cents desc
  `;
  return {
    status: 200,
    body: {
      channels: rows.map((r) => ({
        ...r,
        cac_cents:
          r.converted_tenant_count > 0
            ? Math.round(r.total_cost_cents / r.converted_tenant_count)
            : null,
      })),
    },
  };
}

// ---------------------------------------------------------------------
// Templates (BACKEND_SPEC §7.7) — CRUD + publish (compiler +
// _shared/compiler/template-compiler.ts + Retell publish call, following
// T3's _shared/providers pattern since Deno can't import
// packages/adapters/retell directly — see that module's docstring).
// ---------------------------------------------------------------------
function toCompilerTemplate(row: Record<string, unknown>): CompilerAgentTemplate {
  return {
    compile_target: row["compile_target"] as CompilerAgentTemplate["compile_target"],
    system_prompt: (row["system_prompt"] as string | null) ?? null,
    states: (row["states"] as CompilerAgentTemplate["states"]) ?? [],
    transitions: (row["transitions"] as CompilerAgentTemplate["transitions"]) ?? [],
    global_intents: (row["global_intents"] as CompilerAgentTemplate["global_intents"]) ?? [],
    tools: (row["tools"] as CompilerAgentTemplate["tools"]) ?? [],
    disclosure_line: row["disclosure_line"] as string,
  };
}

async function handleTemplates(
  sql: SqlClient,
  ctx: AdminRequestContext,
  deps: AdminDeps,
): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-templates", ":id"?, "publish"?]
  const templateId = parts[1];

  if (ctx.method === "GET" && !templateId) {
    const rows = await sql<Record<string, unknown>>`
      select id, vertical, name, version, compile_target, voice_id, model, is_active, created_at
      from public.agent_templates order by vertical, version desc
    `;
    return { status: 200, body: { templates: rows } };
  }

  if (ctx.method === "GET" && templateId && parts[2] === undefined) {
    const row = (
      await sql<
        Record<string, unknown>
      >`select * from public.agent_templates where id = ${templateId}`
    )[0];
    if (!row) return { status: 404, body: { error: "template_not_found" } };
    return { status: 200, body: { template: row } };
  }

  if (ctx.method === "POST" && !templateId) {
    const body = (ctx.body ?? {}) as Record<string, unknown>;
    const required = [
      "vertical",
      "name",
      "version",
      "compile_target",
      "voice_id",
      "model",
      "disclosure_line",
    ];
    for (const field of required) {
      if (body[field] === undefined) return { status: 422, body: { error: `missing_${field}` } };
    }
    const inserted = (
      await sql<{ id: string }>`
        insert into public.agent_templates (
          vertical, name, version, compile_target, system_prompt, states, transitions,
          global_intents, tools, voice_id, model, disclosure_line, created_by
        ) values (
          ${body["vertical"] as string}, ${body["name"] as string}, ${body["version"] as number},
          ${body["compile_target"] as string}, ${(body["system_prompt"] as string) ?? null},
          ${JSON.stringify(body["states"] ?? [])}::jsonb, ${JSON.stringify(body["transitions"] ?? [])}::jsonb,
          ${JSON.stringify(body["global_intents"] ?? [])}::jsonb, ${JSON.stringify(body["tools"] ?? [])}::jsonb,
          ${body["voice_id"] as string}, ${body["model"] as string}, ${body["disclosure_line"] as string},
          ${ctx.adminUserId}
        )
        returning id
      `
    )[0];
    if (!inserted) return { status: 500, body: { error: "template_create_failed" } };
    return { status: 201, body: { template_id: inserted.id } };
  }

  if (ctx.method === "PATCH" && templateId && parts[2] === undefined) {
    const before = (
      await sql<
        Record<string, unknown>
      >`select * from public.agent_templates where id = ${templateId}`
    )[0];
    if (!before) return { status: 404, body: { error: "template_not_found" } };

    const patch = (ctx.body ?? {}) as Record<string, unknown>;
    let didUpdate = false;
    // One explicit statement per editable field (never a dynamic-identifier
    // query) — matches `handleTenants`' PATCH pattern; `SqlClient` is a
    // plain tagged-template callable, not postgres.js's richer `Sql`
    // object, so there is no safe `sql(column)` dynamic-identifier helper
    // to reach for here even if it looked tempting.
    if ("name" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set name = ${patch["name"] as string} where id = ${templateId}`;
    }
    if ("system_prompt" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set system_prompt = ${patch["system_prompt"] as string} where id = ${templateId}`;
    }
    if ("states" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set states = ${JSON.stringify(patch["states"])}::jsonb where id = ${templateId}`;
    }
    if ("transitions" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set transitions = ${JSON.stringify(patch["transitions"])}::jsonb where id = ${templateId}`;
    }
    if ("global_intents" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set global_intents = ${JSON.stringify(patch["global_intents"])}::jsonb where id = ${templateId}`;
    }
    if ("tools" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set tools = ${JSON.stringify(patch["tools"])}::jsonb where id = ${templateId}`;
    }
    if ("voice_id" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set voice_id = ${patch["voice_id"] as string} where id = ${templateId}`;
    }
    if ("model" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set model = ${patch["model"] as string} where id = ${templateId}`;
    }
    if ("disclosure_line" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set disclosure_line = ${patch["disclosure_line"] as string} where id = ${templateId}`;
    }
    if (!didUpdate) return { status: 422, body: { error: "no_valid_fields" } };

    const after = (
      await sql<
        Record<string, unknown>
      >`select * from public.agent_templates where id = ${templateId}`
    )[0];
    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "template_edit",
        targetType: "agent_template",
        targetId: templateId,
        before,
        after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { template: after } };
  }

  if (ctx.method === "POST" && templateId && parts[2] === "publish") {
    const row = (
      await sql<
        Record<string, unknown>
      >`select * from public.agent_templates where id = ${templateId}`
    )[0];
    if (!row) return { status: 404, body: { error: "template_not_found" } };
    if (!deps.retell) return { status: 501, body: { error: "retell_publish_not_configured" } };

    const template = toCompilerTemplate(row);
    const compiled = compileTemplate(template, deps.retell.toolWebhookUrl);
    if (!compiled.disclosureVerified) {
      return { status: 422, body: { error: "disclosure_gate_failed" } };
    }

    const flowPayload = { ...compiled.flow.body, model: row["model"] };
    const flowResult =
      compiled.flow.kind === "conversation_flow"
        ? await createConversationFlow(deps.retell.fetchImpl, deps.retell.apiKey, flowPayload)
        : await createRetellLLM(deps.retell.fetchImpl, deps.retell.apiKey, flowPayload);
    const flowBody = flowResult.body as { conversation_flow_id?: string; llm_id?: string };
    const flowId = flowBody.conversation_flow_id ?? flowBody.llm_id;
    if (!flowResult.ok || !flowId) {
      return { status: 502, body: { error: "retell_flow_create_failed" } };
    }

    const responseEngine =
      compiled.flow.kind === "conversation_flow"
        ? { type: "conversation-flow", conversation_flow_id: flowId }
        : { type: "retell-llm", llm_id: flowId };
    const agentResult = await createAgent(deps.retell.fetchImpl, deps.retell.apiKey, {
      agent_name: `heyloo-template-${templateId}-v${row["version"]}`,
      voice_id: row["voice_id"],
      response_engine: responseEngine,
    });
    const agentBody = agentResult.body as { agent_id?: string };
    if (!agentResult.ok || !agentBody.agent_id) {
      return { status: 502, body: { error: "retell_agent_create_failed" } };
    }

    const publishResult = await publishAgentVersion(
      deps.retell.fetchImpl,
      deps.retell.apiKey,
      agentBody.agent_id,
    );
    if (!publishResult.ok) {
      return { status: 502, body: { error: "retell_publish_failed" } };
    }

    await sql`update public.agent_templates set is_active = false where vertical = ${row["vertical"] as string} and id <> ${templateId}`;
    await sql`update public.agent_templates set is_active = true where id = ${templateId}`;

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "template_publish",
        targetType: "agent_template",
        targetId: templateId,
        before: { is_active: row["is_active"] },
        after: { is_active: true, retell_agent_id: agentBody.agent_id, retell_flow_id: flowId },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }

    return {
      status: 200,
      body: {
        published: true,
        template_id: templateId,
        retell_agent_id: agentBody.agent_id,
        retell_flow_id: flowId,
      },
    };
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------
// Outreach (BACKEND_SPEC §7.7 Outreach group; §1.8 tables; T8). Every
// mutating route re-checks `suppression_list` before touching a lead
// (compliance rule: "suppression checked before every lead add") and
// writes `admin_actions`. `leads.phone` is read here only for display/
// dedup — it is NEVER passed to any voice/batch-call path anywhere in
// this codebase (SYSTEM_DESIGN §11 TCPA rule; outreach is email-only).
// ---------------------------------------------------------------------
async function handleOutreach(
  sql: SqlClient,
  ctx: AdminRequestContext,
  deps: AdminDeps,
): Promise<AdminResponse> {
  const parts = segments(ctx.path);
  // ["admin-outreach", "leads"|"campaigns"|"funnel"|"replies"|"cac"|"suppression", id?, action?]
  const resource = parts[1];
  const query = ctx.query ?? {};

  if (resource === "leads" && ctx.method === "GET" && !parts[2]) {
    const status = query["status"];
    const vertical = query["vertical"];
    const source = query["source"];
    const rows = await sql<Record<string, unknown>>`
      select id, source, vertical, company_name, contact_name, email, phone, status, created_at
      from public.leads
      where (${status ?? null}::text is null or status = ${status ?? null})
        and (${vertical ?? null}::text is null or vertical = ${vertical ?? null})
        and (${source ?? null}::text is null or source = ${source ?? null})
      order by created_at desc
      limit 200
    `;
    return { status: 200, body: { leads: rows } };
  }

  if (resource === "suppression" && ctx.method === "POST" && !parts[2]) {
    const body = (ctx.body ?? {}) as { contact?: string; reason?: string };
    if (!body.contact) return { status: 422, body: { error: "missing_contact" } };
    const reason = body.reason ?? "manual";
    if (!["unsubscribe", "bounce", "complaint", "manual"].includes(reason)) {
      return { status: 422, body: { error: "invalid_reason" } };
    }
    await sql`
      insert into public.suppression_list (contact, reason)
      values (${body.contact.trim().toLowerCase()}, ${reason})
      on conflict (contact) do nothing
    `;
    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "outreach_suppression_add",
        targetType: "suppression_list",
        after: { contact: body.contact, reason },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { suppressed: true } };
  }

  if (resource === "campaigns" && ctx.method === "GET" && !parts[2]) {
    const rows = await sql<Record<string, unknown>>`
      select id, name, vertical, sender_domain, provider, status, external_campaign_id, complaint_rate, created_at
      from public.campaigns order by created_at desc limit 100
    `;
    return { status: 200, body: { campaigns: rows } };
  }

  if (resource === "campaigns" && ctx.method === "POST" && !parts[2]) {
    if (!deps.outreach) return { status: 501, body: { error: "outreach_sender_not_configured" } };
    const body = (ctx.body ?? {}) as {
      name?: string;
      vertical?: string;
      sender_domain?: string;
      provider?: string;
    };
    if (!body.name || !body.sender_domain) {
      return { status: 422, body: { error: "missing_name_or_sender_domain" } };
    }
    const provider = body.provider ?? "smartlead";
    if (provider !== "smartlead") {
      // Compliance/scope: only the Smartlead adapter is implemented (see
      // this module's provider-choice docstring) — never silently accept
      // a provider value this build can't actually create a campaign for.
      return { status: 422, body: { error: "unsupported_provider" } };
    }

    const created = await createSmartleadCampaign(
      deps.outreach.smartleadFetchImpl,
      deps.outreach.smartleadApiKey,
      {
        name: body.name,
      },
    );
    if (!created.ok || !created.externalCampaignId) {
      return { status: 502, body: { error: "smartlead_campaign_create_failed" } };
    }

    const inserted = await sql<{ id: string }>`
      insert into public.campaigns (name, vertical, sender_domain, provider, status, external_campaign_id)
      values (${body.name}, ${body.vertical ?? null}, ${body.sender_domain}, ${provider}, 'draft', ${created.externalCampaignId})
      returning id
    `;
    const campaignId = inserted[0]?.id;
    if (!campaignId) return { status: 500, body: { error: "campaign_create_failed" } };

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "outreach_campaign_create",
        targetType: "campaign",
        targetId: campaignId,
        after: { name: body.name, provider, external_campaign_id: created.externalCampaignId },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return {
      status: 201,
      body: { campaign_id: campaignId, external_campaign_id: created.externalCampaignId },
    };
  }

  if (resource === "campaigns" && ctx.method === "PATCH" && parts[2] && !parts[3]) {
    const campaignId = parts[2];
    const body = (ctx.body ?? {}) as { status?: string };
    if (!body.status || !["draft", "warming", "active", "paused"].includes(body.status)) {
      return { status: 422, body: { error: "invalid_status" } };
    }
    const before = (
      await sql<Record<string, unknown>>`select * from public.campaigns where id = ${campaignId}`
    )[0];
    if (!before) return { status: 404, body: { error: "campaign_not_found" } };

    await sql`update public.campaigns set status = ${body.status} where id = ${campaignId}`;

    if (deps.outreach && before["provider"] === "smartlead" && before["external_campaign_id"]) {
      const providerStatus =
        body.status === "active" ? "START" : body.status === "paused" ? "PAUSED" : undefined;
      if (providerStatus) {
        await updateSmartleadCampaignStatus(
          deps.outreach.smartleadFetchImpl,
          deps.outreach.smartleadApiKey,
          before["external_campaign_id"] as string,
          providerStatus,
        );
      }
    }

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "outreach_campaign_status_change",
        targetType: "campaign",
        targetId: campaignId,
        before: { status: before["status"] },
        after: { status: body.status },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { campaign_id: campaignId, status: body.status } };
  }

  if (resource === "campaigns" && ctx.method === "POST" && parts[2] && parts[3] === "add-leads") {
    const campaignId = parts[2] as string;
    const body = (ctx.body ?? {}) as { lead_ids?: string[] };
    if (!Array.isArray(body.lead_ids) || body.lead_ids.length === 0) {
      return { status: 422, body: { error: "missing_lead_ids" } };
    }
    const campaignRows = await sql<{
      id: string;
    }>`select id from public.campaigns where id = ${campaignId}`;
    if (!campaignRows[0]) return { status: 404, body: { error: "campaign_not_found" } };

    let added = 0;
    let skippedSuppressed = 0;
    let skippedNotEligible = 0;
    for (const leadId of body.lead_ids) {
      const leadRows = await sql<{
        id: string;
        email: string | null;
        phone: string | null;
        status: string;
      }>`
        select id, email, phone, status from public.leads where id = ${leadId}
      `;
      const lead = leadRows[0];
      if (lead?.status !== "new") {
        skippedNotEligible += 1;
        continue;
      }
      // Re-checked here, not just at fetch time — the suppression list can
      // grow between lead-fetch and campaign-add (compliance rule).
      if (await isSuppressed(sql, { email: lead.email, phone: lead.phone })) {
        skippedSuppressed += 1;
        continue;
      }
      await sql`
        insert into public.send_events (campaign_id, lead_id, step_index, status)
        values (${campaignId}, ${leadId}, 0, 'queued')
      `;
      await sql`update public.leads set status = 'queued' where id = ${leadId}`;
      added += 1;
    }

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "outreach_campaign_add_leads",
        targetType: "campaign",
        targetId: campaignId,
        after: {
          added,
          skipped_suppressed: skippedSuppressed,
          skipped_not_eligible: skippedNotEligible,
        },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return {
      status: 200,
      body: {
        added,
        skipped_suppressed: skippedSuppressed,
        skipped_not_eligible: skippedNotEligible,
      },
    };
  }

  if (resource === "funnel" && ctx.method === "GET") {
    const byStatus = await sql<{ status: string; count: number }>`
      select status, count(*)::int as count from public.leads group by status
    `;
    const byIntent = await sql<{ ai_intent: string | null; count: number }>`
      select ai_intent, count(*)::int as count from public.replies group by ai_intent
    `;
    return { status: 200, body: { leads_by_status: byStatus, replies_by_intent: byIntent } };
  }

  if (resource === "replies" && ctx.method === "GET" && !parts[2]) {
    const rows = await sql<Record<string, unknown>>`
      select r.id, r.body, r.ai_intent, r.received_at,
             l.id as lead_id, l.company_name, l.contact_name, l.email, l.status as lead_status,
             c.name as campaign_name
      from public.replies r
      join public.leads l on l.id = r.lead_id
      left join public.send_events se on se.id = r.send_event_id
      left join public.campaigns c on c.id = se.campaign_id
      order by r.received_at desc
      limit 200
    `;
    return { status: 200, body: { replies: rows } };
  }

  if (resource === "replies" && ctx.method === "POST" && parts[2] && parts[3] === "actions") {
    const replyId = parts[2] as string;
    const body = (ctx.body ?? {}) as { action?: string; tenant_id?: string };
    const replyRows = await sql<{ id: string; lead_id: string }>`
      select id, lead_id from public.replies where id = ${replyId}
    `;
    const reply = replyRows[0];
    if (!reply) return { status: 404, body: { error: "reply_not_found" } };

    const leadRows = await sql<{
      id: string;
      email: string | null;
      phone: string | null;
      contact_name: string | null;
    }>`
      select id, email, phone, contact_name from public.leads where id = ${reply.lead_id}
    `;
    const lead = leadRows[0];
    if (!lead) return { status: 404, body: { error: "lead_not_found" } };

    if (body.action === "mark_interested") {
      if (!lead.email) return { status: 422, body: { error: "lead_has_no_email" } };
      if (!deps.resend) return { status: 501, body: { error: "resend_not_configured" } };
      // A direct send, not the tenant-scoped `messages_outbound` pipeline —
      // this lead has no tenant yet (see AdminDeps.resend's docstring).
      const rendered = renderTemplate("outreach_demo_followup", {
        contact_name: lead.contact_name,
        demo_url: "https://heyloo.ai/demo",
      });
      const sendResult = await sendEmail(deps.resend.fetchImpl, deps.resend.apiKey, {
        from: deps.resend.fromAddress,
        to: lead.email,
        subject: rendered.subject ?? "See your AI receptionist in action",
        html: `<p>${rendered.body}</p>`,
      });
      if (!sendResult.ok) return { status: 502, body: { error: "demo_followup_send_failed" } };
      await sql`update public.leads set status = 'replied' where id = ${lead.id} and status <> 'converted'`;
    } else if (body.action === "suppress") {
      const contact = (lead.email ?? lead.phone)?.trim().toLowerCase();
      if (contact) {
        await sql`insert into public.suppression_list (contact, reason) values (${contact}, 'manual') on conflict (contact) do nothing`;
      }
      await sql`update public.leads set status = 'suppressed' where id = ${lead.id}`;
    } else if (body.action === "convert") {
      if (!body.tenant_id) return { status: 422, body: { error: "missing_tenant_id" } };
      await sql`update public.leads set status = 'converted', converted_tenant_id = ${body.tenant_id} where id = ${lead.id}`;
      await sql`update public.cac_events set tenant_id = ${body.tenant_id} where lead_id = ${lead.id} and tenant_id is null`;
    } else {
      return { status: 422, body: { error: "unknown_action" } };
    }

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: `outreach_reply_${body.action}`,
        targetType: "lead",
        targetId: lead.id,
        after: { reply_id: replyId, ...(body.tenant_id ? { tenant_id: body.tenant_id } : {}) },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { action: body.action, lead_id: lead.id } };
  }

  if (resource === "cac" && ctx.method === "GET") {
    // Per-vertical CAC rollup (task's own wording) — distinct from `GET
    // /admin-cac`'s channel-level rollup (T4, `handleCac` above): that
    // group stays untouched (this build's exclusive admin/ surface is the
    // Outreach group only), so the vertical view lives under this prefix
    // instead of extending that one.
    const rows = await sql<{
      vertical: string | null;
      total_cost_cents: number;
      lead_count: number;
      converted_tenant_count: number;
    }>`
      select
        l.vertical,
        sum(ce.cost_cents)::int as total_cost_cents,
        count(distinct ce.lead_id)::int as lead_count,
        count(distinct ce.tenant_id) filter (where ce.tenant_id is not null)::int as converted_tenant_count
      from public.cac_events ce
      join public.leads l on l.id = ce.lead_id
      group by l.vertical
      order by total_cost_cents desc
    `;
    return {
      status: 200,
      body: {
        verticals: rows.map((r) => ({
          ...r,
          cac_cents:
            r.converted_tenant_count > 0
              ? Math.round(r.total_cost_cents / r.converted_tenant_count)
              : null,
        })),
      },
    };
  }

  return { status: 404, body: { error: "not_found" } };
}

const NOT_YET_IMPLEMENTED_PREFIXES = ["admin-support-requests", "admin-flags"];

export async function routeAdminRequest(
  sql: SqlClient,
  ctx: AdminRequestContext,
  logger: Logger,
  deps: AdminDeps = {},
): Promise<AdminResponse> {
  if (!isPlatformAdmin(ctx.claims)) {
    return { status: 403, body: { error: "not_a_platform_admin" } };
  }

  const [first] = segments(ctx.path);
  if (first === "admin-tenants") return handleTenants(sql, ctx, logger, deps);
  if (first === "admin-alerts") return handleAlerts(sql, ctx);
  if (first === "admin-cockpit") return handleCockpit(sql, ctx);
  if (first === "admin-config-lab") return handleConfigLab(sql, ctx);
  if (first === "admin-referrals") return handleReferrals(sql, ctx);
  if (first === "admin-cac") return handleCac(sql, ctx);
  if (first === "admin-templates") return handleTemplates(sql, ctx, deps);
  if (first === "admin-outreach") return handleOutreach(sql, ctx, deps);

  if (first && NOT_YET_IMPLEMENTED_PREFIXES.includes(first)) {
    logger.info("admin_route_not_yet_implemented", { path: ctx.path });
    return { status: 501, body: { error: "not_implemented", group: first } };
  }

  return { status: 404, body: { error: "not_found" } };
}
