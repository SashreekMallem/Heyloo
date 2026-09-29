import { writeAdminAction } from "../_shared/admin-actions.ts";
import type { AdminJwtClaims } from "../_shared/admin-auth.ts";
import { impersonatedByClaim, isAal2, isPlatformAdmin } from "../_shared/admin-auth.ts";
import {
  type CompilerAgentTemplate,
  compileTemplate,
} from "../_shared/compiler/template-compiler.ts";
import { textToEmailHtml } from "../_shared/email-body.ts";
import { isSuppressed } from "../_shared/lead-dedup.ts";
import type { EmailProvider } from "../_shared/providers/messaging/types.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createAgent,
  createConversationFlow,
  createRetellLLM,
  publishAgentVersion,
} from "../_shared/providers/retell.ts";
import type { SmartleadFetch } from "../_shared/providers/smartlead.ts";
import {
  createCampaign as createSmartleadCampaign,
  updateCampaignStatus as updateSmartleadCampaignStatus,
} from "../_shared/providers/smartlead.ts";
import type { SupabaseAdminFetch } from "../_shared/providers/supabase-admin.ts";
import { generateMagicLink, getUserEmailById } from "../_shared/providers/supabase-admin.ts";
import { metricsAll } from "../_shared/queue.ts";
import { renderTemplate } from "../_shared/templates.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import { handleCockpit, handleConfigLab, n as toNumber } from "./cockpit.ts";
import {
  AdminAlertThresholdSchema,
  AdminCommissionTermsSchema,
  AdminCommissionVerticalOverrideSchema,
  AdminReferralSettingSchema,
  AdminSupportRequestNoteSchema,
  AdminSupportRequestUpdateSchema,
  AdminTenantPatchSchema,
  OutreachCampaignCreateSchema,
  PlatformPricingTableSchema,
  VERTICALS,
} from "./schemas.ts";

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
   * reply action (T8) — a direct send through the email provider port
   * (MESSAGING-1), deliberately NOT routed through `messages_outbound`/
   * `worker-messages-outbound` (that table's `tenant_id` is `NOT NULL`; a
   * cold-outreach lead has no tenant yet). */
  email?: { provider: EmailProvider; fromAddress: string };
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

/**
 * Impersonation cookie-fix (docs/audit/FIX_REQUESTS.md). Resolves WHO is
 * allowed to act on an impersonation session for `impersonate-end`/
 * `impersonate/edit-mode`: normally the calling platform admin (their own
 * `sub`, AAL2-confirmed) — but `@supabase/ssr`'s one-cookie-per-domain
 * session storage means opening the impersonation magic link in a new tab
 * overwrites that cookie browser-wide, so a request from the ADMIN's
 * original tab, or from the impersonated tab itself, can end up carrying
 * the TENANT OWNER's own session instead. That token still carries
 * `impersonated_by` (stamped only by `custom_access_token_hook` from a
 * real, currently active `impersonation_sessions` row — unforgeable by an
 * ordinary tenant login), so it is trusted as an alternative proof of the
 * same admin identity for exactly these two narrow, already
 * tenant_id+admin_user_id-scoped actions. AAL2 is not re-required on this
 * path: the underlying session was already AAL2-gated at
 * `impersonate`-start time.
 */
function resolveImpersonationActor(
  claims: AdminJwtClaims | null,
  jwtSub: string | null,
  opts: { requireAal2: boolean },
): string | null {
  if (isPlatformAdmin(claims) && jwtSub && (!opts.requireAal2 || isAal2(claims))) return jwtSub;
  return impersonatedByClaim(claims);
}

function isImpersonationSelfServicePath(path: string): boolean {
  const parts = segments(path);
  return (
    parts[0] === "admin-tenants" &&
    !!parts[1] &&
    ((parts[2] === "impersonate-end" && parts[3] === undefined) ||
      (parts[2] === "impersonate" && parts[3] === "edit-mode" && parts[4] === undefined))
  );
}

/** A tenant that is actually being billed: a Stripe subscription exists AND it is in a billing status. */
function hasLiveSubscription(status: string, subscriptionId: string | null): boolean {
  return !!subscriptionId && (status === "active" || status === "past_due");
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
    // COCKPIT-1: the list page's MRR / Margin % columns were always "—" (this
    // route only returned id/name/vertical/status). MRR = the plan's recurring
    // base fee for tenants that are billing (active/past_due); margin % is this
    // month's paid-invoice margin from `fn_margin_by_tenant` (null until a paid
    // invoice exists — never a fabricated 0%).
    const rows = await sql<{
      id: string;
      name: string;
      vertical: string;
      status: string;
      plan_code: string | null;
      created_at: string;
      stripe_subscription_id: string | null;
      base_cents: unknown;
      revenue_cents: unknown;
      margin_cents: unknown;
    }>`
      select t.id, t.name, t.vertical, t.status, t.plan_code, t.created_at, t.stripe_subscription_id,
             (ps.value->>'base_cents')::numeric as base_cents,
             m.revenue_cents, m.margin_cents
      from public.tenants t
      left join public.platform_settings ps on ps.key = 'price_card_' || t.vertical
      left join public.fn_margin_by_tenant(
        date_trunc('month', now() at time zone 'UTC') at time zone 'UTC',
        (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC',
        true
      ) m on m.tenant_id = t.id
      where t.deleted_at is null
      order by t.created_at desc limit 100
    `;
    return {
      status: 200,
      body: {
        tenants: rows.map((r) => {
          const revenue = toNumber(r.revenue_cents);
          return {
            id: r.id,
            name: r.name,
            vertical: r.vertical,
            status: r.status,
            plan_code: r.plan_code,
            created_at: r.created_at,
            // COCKPIT-F14: MRR only for a tenant with a live Stripe subscription;
            // a tenant without one has no recurring revenue, whatever its plan's
            // list price says (`list_price_cents`, shown separately).
            mrr_cents: hasLiveSubscription(r.status, r.stripe_subscription_id)
              ? toNumber(r.base_cents)
              : null,
            list_price_cents: toNumber(r.base_cents),
            margin_pct: revenue > 0 ? (toNumber(r.margin_cents) / revenue) * 100 : null,
          };
        }),
      },
    };
  }

  if (ctx.method === "GET" && tenantId && parts[2] === undefined) {
    const rows = await sql<
      Record<string, unknown>
    >`select * from public.tenants where id = ${tenantId}`;
    const tenant = rows[0];
    if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };

    // The tenants table itself carries no MRR/margin/usage columns — the
    // cockpit tenant-detail page needs all three (admin-partner design
    // review round 5: page destructured a flat `TenantDetail` the real
    // response never carried). COCKPIT-1: margin comes from the single
    // `fn_margin_by_tenant` definition (current UTC month, INCLUDING test
    // data — an admin looking at one tenant wants to see all of it), and MRR
    // is the plan's recurring base fee for a billing tenant, not "paid
    // invoices so far this month" (invoices are billed in arrears, so that was
    // always 0 mid-month).
    const marginRows = await sql<{
      revenue_cents: unknown;
      margin_cents: unknown;
    }>`
      select revenue_cents, margin_cents
      from public.fn_margin_by_tenant(
        date_trunc('month', now() at time zone 'UTC') at time zone 'UTC',
        (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC',
        true
      ) where tenant_id = ${tenantId}
    `;
    const revenueCents = toNumber(marginRows[0]?.revenue_cents);
    const marginCents = toNumber(marginRows[0]?.margin_cents);

    const minutesRows = await sql<{ minutes_used: number }>`
      select coalesce(sum(billable_minutes), 0)::numeric as minutes_used
      from public.usage_daily
      where tenant_id = ${tenantId} and date >= date_trunc('month', now())::date
    `;
    const baseRows = await sql<{ base_cents: unknown }>`
      select (value->>'base_cents')::numeric as base_cents
      from public.platform_settings where key = ${`price_card_${String(tenant["vertical"])}`}
    `;
    const listPriceCents = toNumber(baseRows[0]?.base_cents);

    const metrics = {
      // COCKPIT-F14: null (not 0, not the list price) without a live subscription.
      mrr_cents: hasLiveSubscription(
        String(tenant["status"]),
        (tenant["stripe_subscription_id"] as string | null | undefined) ?? null,
      )
        ? listPriceCents
        : null,
      list_price_cents: listPriceCents,
      // COCKPIT-F12: no paid revenue means no margin, never a fabricated 0.0%.
      margin_pct: revenueCents > 0 ? (marginCents / revenueCents) * 100 : null,
      // Rounded to one decimal (was "3.567").
      minutes_used: Math.round(Number(minutesRows[0]?.minutes_used ?? 0) * 10) / 10,
    };

    return { status: 200, body: { tenant, metrics } };
  }

  if (ctx.method === "PATCH" && tenantId && parts[2] === undefined) {
    const before = (
      await sql<Record<string, unknown>>`select * from public.tenants where id = ${tenantId}`
    )[0];
    if (!before) return { status: 404, body: { error: "tenant_not_found" } };

    // COCKPIT-F16: validate before the values reach SQL (an unknown status or a
    // fractional cap used to hit the CHECK / int cast as a 500).
    const parsed = AdminTenantPatchSchema.safeParse(ctx.body ?? {});
    if (!parsed.success) {
      return { status: 422, body: { error: "invalid_tenant_patch", issues: parsed.error.issues } };
    }
    const { reason, ...fields } = parsed.data;
    const updates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }
    if (Object.keys(updates).length === 0)
      return { status: 422, body: { error: "no_valid_fields" } };
    // Pausing or cancelling a customer stops their phone answering: it needs a
    // recorded reason (resuming does not).
    if ((updates["status"] === "paused" || updates["status"] === "canceled") && !reason) {
      return { status: 422, body: { error: "reason_required" } };
    }

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
        // The reason is not a tenants column: it lives only in this audit row.
        after: reason ? { ...after, reason } : after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { tenant: after } };
  }

  if (ctx.method === "POST" && tenantId && parts[2] === "impersonate" && parts[3] === "edit-mode") {
    // "Enable edits" toggle (FRONTEND_SPEC.md §7.2's "explicit 'Enable
    // edits' toggle... logs a second entry") — flips
    // `impersonation_sessions.edit_enabled` for the CALLING admin's own
    // active session on this tenant; `custom_access_token_hook` picks up
    // the new value on the impersonated tab's next token refresh (the JWT
    // is short-lived, so this is bounded, not instantaneous — the same
    // tradeoff every claims-based authorization change on Supabase has).
    const actorAdminUserId = resolveImpersonationActor(ctx.claims, ctx.adminUserId, {
      requireAal2: true,
    });
    if (!actorAdminUserId) {
      return isPlatformAdmin(ctx.claims)
        ? { status: 403, body: { error: "aal2_required" } }
        : { status: 403, body: { error: "forbidden" } };
    }

    const body = (ctx.body ?? {}) as { enabled?: boolean };
    if (typeof body.enabled !== "boolean") {
      return { status: 422, body: { error: "invalid_enabled" } };
    }

    const before = (
      await sql<{ edit_enabled: boolean }>`
        select edit_enabled from public.impersonation_sessions
        where tenant_id = ${tenantId} and admin_user_id = ${actorAdminUserId}
          and ended_at is null and expires_at > now()
        order by created_at desc limit 1
      `
    )[0];
    if (!before) return { status: 404, body: { error: "no_active_impersonation_session" } };

    await sql`
      update public.impersonation_sessions set edit_enabled = ${body.enabled}
      where tenant_id = ${tenantId} and admin_user_id = ${actorAdminUserId}
        and ended_at is null and expires_at > now()
    `;

    await writeAdminAction(sql, {
      adminUserId: actorAdminUserId,
      action: "impersonate_edit_mode_change",
      targetType: "tenant",
      targetId: tenantId,
      before: { edit_enabled: before.edit_enabled },
      after: { edit_enabled: body.enabled },
      ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
      ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
    });
    return { status: 200, body: { edit_enabled: body.enabled } };
  }

  if (ctx.method === "POST" && tenantId && parts[2] === "impersonate" && parts[3] === undefined) {
    if (!isAal2(ctx.claims)) {
      return { status: 403, body: { error: "aal2_required" } };
    }
    if (!ctx.adminUserId) return { status: 403, body: { error: "forbidden" } };
    // `adminImpersonateSchema` (FRONTEND_SPEC.md §7.2) requires a non-empty
    // `reason` — the audit row below is written with it BEFORE the session
    // is granted, so even an aborted/rejected attempt is logged with why.
    const reason = (ctx.body as { reason?: string } | null)?.reason?.trim();
    if (!reason) return { status: 422, body: { error: "reason_required" } };

    const tenantRows = await sql<{
      id: string;
    }>`select id from public.tenants where id = ${tenantId} and deleted_at is null`;
    if (!tenantRows[0]) return { status: 404, body: { error: "tenant_not_found" } };

    // 30-minute timebox (FRONTEND_SPEC.md §7.2's "e.g. 30 min"). Recorded in
    // the audit row, handed to the client for `ImpersonationBanner`'s
    // countdown, AND persisted below as `impersonation_sessions.expires_at`
    // — `custom_access_token_hook` (20260910110000_impersonation_claim.sql)
    // joins that row to stamp `impersonated_by`/`impersonation_edit_enabled`
    // into every token this session mints/refreshes, and every tenant-write
    // RLS policy requires `not fn_jwt_is_impersonating() or
    // fn_jwt_impersonation_edit_enabled()` — a genuine server-enforced
    // boundary, not just a display countdown. "End impersonation" in the
    // banner still calls `supabase.auth.signOut()` client-side (a real
    // sign-out of that real session) AND `impersonate-end` below sets
    // `ended_at` so the hook stops issuing the claim even if sign-out never
    // reaches the server.
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "impersonate_start",
        targetType: "tenant",
        targetId: tenantId,
        after: { reason, expires_at: expiresAt },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    logger.warn("admin_impersonation_started", {
      admin_user_id: ctx.adminUserId,
      tenant_id: tenantId,
      reason,
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

    // The row `custom_access_token_hook` joins against to stamp
    // `impersonated_by`/`impersonation_edit_enabled` onto every token this
    // impersonated session mints or refreshes (20260910110000_impersonation_
    // claim.sql) — read-only (`edit_enabled` defaults false) until the
    // "Enable edits" toggle above flips it. Inserted only after the mint
    // itself succeeds, so a failed mint never leaves an orphaned session row
    // a real token could later match.
    await sql`
      insert into public.impersonation_sessions
        (tenant_id, admin_user_id, target_user_id, edit_enabled, reason, expires_at)
      values (${tenantId}, ${ctx.adminUserId}, ${ownerUserId}, false, ${reason}, ${expiresAt})
    `;

    return {
      status: 200,
      body: {
        impersonation_link: link.actionLink,
        tenant_id: tenantId,
        expires_at: expiresAt,
      },
    };
  }

  if (ctx.method === "POST" && tenantId && parts[2] === "impersonate-end") {
    // Second audit entry (FRONTEND_SPEC.md §7.2 pattern — an explicit
    // "Enable edits" toggle logs a second entry; ending the session is the
    // same idea). Also sets `impersonation_sessions.ended_at` for every
    // still-active session this admin holds on this tenant, so
    // `custom_access_token_hook` stops issuing the claim on the next
    // mint/refresh regardless of whether the impersonated tab's client-side
    // `supabase.auth.signOut()` (the real session teardown) ever reaches it.
    const actorAdminUserId = resolveImpersonationActor(ctx.claims, ctx.adminUserId, {
      requireAal2: false,
    });
    if (actorAdminUserId) {
      await sql`
        update public.impersonation_sessions set ended_at = now()
        where tenant_id = ${tenantId} and admin_user_id = ${actorAdminUserId} and ended_at is null
      `;
      await writeAdminAction(sql, {
        adminUserId: actorAdminUserId,
        action: "impersonate_end",
        targetType: "tenant",
        targetId: tenantId,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { ended: true } };
  }

  return { status: 404, body: { error: "not_found" } };
}

const ALERT_RULES_SETTINGS_KEY = "admin_alert_rules";

interface StoredAlertRule {
  id: string;
  metric: string;
  operator: string;
  value: number;
  enabled: boolean;
  channel: string;
}

async function readAlertRules(sql: SqlClient): Promise<StoredAlertRule[]> {
  const rows = await sql<{ value: { rules?: StoredAlertRule[] } }>`
    select value from public.platform_settings where key = ${ALERT_RULES_SETTINGS_KEY}
  `;
  return rows[0]?.value.rules ?? [];
}

async function writeAlertRules(sql: SqlClient, rules: StoredAlertRule[]): Promise<void> {
  await sql`
    insert into public.platform_settings (key, value)
    values (${ALERT_RULES_SETTINGS_KEY}, ${{ rules }}::jsonb)
    on conflict (key) do update set value = excluded.value, updated_at = now()
  `;
}

/**
 * `/admin-alerts` (BACKEND_SPEC §7.7) — fired-alert list/ack (existing),
 * plus the alert-RULE editor (FRONTEND_AUDIT.md M2 — `/cockpit/alerts`'
 * rule create/edit was a `toast("coming soon")` stub). There is no
 * dedicated rule-definition table (`public.alerts` is fired-instance rows
 * only, confirmed by grep across every migration — `job-alert-evaluation`'s
 * own comment says thresholds are "not yet defined" in `platform_settings`),
 * so rules are stored as a single `platform_settings` row
 * (`admin_alert_rules`, `{ rules: StoredAlertRule[] }`) — that table is
 * exactly "Admin-editable key/value store" per its own table comment, so
 * this needs no new migration. Each rule gets a generated `id` so PATCH can
 * address one element of the array.
 */
async function handleAlerts(sql: SqlClient, ctx: AdminRequestContext): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-alerts", "rules"?, ":id"?, "ack"?]
  const alertId = parts[1];

  if (ctx.method === "GET" && !alertId) {
    // COCKPIT-F07: the cockpit lists these with the tenant's name, so join it in.
    const rows = await sql<Record<string, unknown>>`
      select a.*, t.name as tenant_name
      from public.alerts a
      left join public.tenants t on t.id = a.tenant_id
      where a.status = 'open'
      order by a.created_at desc limit 100
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

  if (parts[1] === "rules" && ctx.method === "GET" && !parts[2]) {
    return { status: 200, body: { rules: await readAlertRules(sql) } };
  }

  if (parts[1] === "rules" && ctx.method === "POST" && !parts[2]) {
    const parsed = AdminAlertThresholdSchema.safeParse(ctx.body);
    if (!parsed.success)
      return { status: 422, body: { error: "invalid_rule", issues: parsed.error.issues } };

    const before = await readAlertRules(sql);
    const rule: StoredAlertRule = { id: crypto.randomUUID(), ...parsed.data };
    const after = [...before, rule];
    await writeAlertRules(sql, after);

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "alert_rule_create",
        targetType: "other",
        targetId: rule.id,
        after: rule,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 201, body: { rule } };
  }

  if (parts[1] === "rules" && parts[2] && ctx.method === "PATCH" && !parts[3]) {
    const ruleId = parts[2];
    const parsed = AdminAlertThresholdSchema.partial().safeParse(ctx.body);
    if (!parsed.success)
      return { status: 422, body: { error: "invalid_rule", issues: parsed.error.issues } };

    const before = await readAlertRules(sql);
    const existing = before.find((r) => r.id === ruleId);
    if (!existing) return { status: 404, body: { error: "rule_not_found" } };

    const updated: StoredAlertRule = {
      id: existing.id,
      metric: parsed.data.metric ?? existing.metric,
      operator: parsed.data.operator ?? existing.operator,
      value: parsed.data.value ?? existing.value,
      enabled: parsed.data.enabled ?? existing.enabled,
      channel: parsed.data.channel ?? existing.channel,
    };
    const after = before.map((r) => (r.id === ruleId ? updated : r));
    await writeAlertRules(sql, after);

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "alert_rule_edit",
        targetType: "other",
        targetId: ruleId,
        before: existing,
        after: updated,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { rule: updated } };
  }

  if (parts[1] === "rules" && parts[2] && ctx.method === "DELETE" && !parts[3]) {
    const ruleId = parts[2];
    const before = await readAlertRules(sql);
    const existing = before.find((r) => r.id === ruleId);
    if (!existing) return { status: 404, body: { error: "rule_not_found" } };
    await writeAlertRules(
      sql,
      before.filter((r) => r.id !== ruleId),
    );

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "alert_rule_delete",
        targetType: "other",
        targetId: ruleId,
        before: existing,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { deleted: true } };
  }

  return { status: 404, body: { error: "not_found" } };
}

/**
 * `/admin-support-requests` (GAP_REGISTER Cluster G item 6 — change-request
 * tickets backend). `support_requests`/`support_request_notes`
 * (20260907131100_platform_support.sql) already exist and already have a
 * real tenant-write RLS policy (a tenant creates its own ticket directly
 * via an authenticated PostgREST insert — no edge function needed for
 * that half); this is the admin-side read/triage/respond half that was
 * still a `501 not_implemented` stub.
 */
async function handleSupportRequests(
  sql: SqlClient,
  ctx: AdminRequestContext,
): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-support-requests", ":id"?, "notes"?]
  const requestId = parts[1];

  if (ctx.method === "GET" && !requestId) {
    const status = ctx.query?.["status"];
    const rows = status
      ? await sql<Record<string, unknown>>`
          select * from public.support_requests where status = ${status}
          order by created_at desc limit 100
        `
      : await sql<Record<string, unknown>>`
          select * from public.support_requests order by created_at desc limit 100
        `;
    return { status: 200, body: { support_requests: rows } };
  }

  if (ctx.method === "GET" && requestId && parts[2] === undefined) {
    const ticket = (
      await sql<Record<string, unknown>>`
        select * from public.support_requests where id = ${requestId}
      `
    )[0];
    if (!ticket) return { status: 404, body: { error: "support_request_not_found" } };
    const notes = await sql<Record<string, unknown>>`
      select * from public.support_request_notes where support_request_id = ${requestId}
      order by created_at asc
    `;
    return { status: 200, body: { support_request: ticket, notes } };
  }

  if (ctx.method === "PATCH" && requestId && parts[2] === undefined) {
    const parsed = AdminSupportRequestUpdateSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { status: 422, body: { error: "invalid_update", issues: parsed.error.issues } };
    }
    if (Object.keys(parsed.data).length === 0) {
      return { status: 422, body: { error: "no_valid_fields" } };
    }
    const before = (
      await sql<
        Record<string, unknown>
      >`select * from public.support_requests where id = ${requestId}`
    )[0];
    if (!before) return { status: 404, body: { error: "support_request_not_found" } };

    if (parsed.data.status !== undefined) {
      await sql`update public.support_requests set status = ${parsed.data.status} where id = ${requestId}`;
    }
    if (parsed.data.priority !== undefined) {
      await sql`update public.support_requests set priority = ${parsed.data.priority} where id = ${requestId}`;
    }
    const after = (
      await sql<
        Record<string, unknown>
      >`select * from public.support_requests where id = ${requestId}`
    )[0];

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "support_request_update",
        targetType: "support_request",
        targetId: requestId,
        before,
        after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { support_request: after } };
  }

  if (ctx.method === "POST" && requestId && parts[2] === "notes") {
    if (!ctx.adminUserId) return { status: 403, body: { error: "forbidden" } };
    const parsed = AdminSupportRequestNoteSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { status: 422, body: { error: "invalid_note", issues: parsed.error.issues } };
    }
    const ticket = (
      await sql<{ id: string }>`select id from public.support_requests where id = ${requestId}`
    )[0];
    if (!ticket) return { status: 404, body: { error: "support_request_not_found" } };

    const note = (
      await sql<Record<string, unknown>>`
        insert into public.support_request_notes (support_request_id, author_id, body, visible_to_tenant)
        values (${requestId}, ${ctx.adminUserId}, ${parsed.data.body}, ${parsed.data.visible_to_tenant})
        returning *
      `
    )[0];

    await writeAdminAction(sql, {
      adminUserId: ctx.adminUserId,
      action: "support_request_note_add",
      targetType: "support_request",
      targetId: requestId,
      after: note,
      ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
      ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
    });
    return { status: 201, body: { note } };
  }

  return { status: 404, body: { error: "not_found" } };
}

/**
 * `/admin-platform-settings` (BACKEND_SPEC §7.7, FRONTEND_AUDIT.md H9 —
 * `/cockpit/settings` was seeded with invented constants and both Save
 * actions 404'd). Reads/writes the real `platform_settings` rows.
 *
 * The pricing POST updates `price_card_<vertical>` IN PLACE — the same key
 * `job-billing-cycle` and `v_usage_alerts`/`v_call_cost_vs_billed` already
 * join against (confirmed: none of them key off `tenants.price_version`
 * today) — rather than writing a separately-versioned key that the real
 * read path would never see. `platformPricingTableSchema`'s own doc
 * comment says this "writes a NEW price_version, never mutates one"; a
 * fuller versioned-price-history system isn't built anywhere in this
 * codebase yet, so building one here would be a redesign outside this
 * task's scope (CLAUDE.md Rule 4) — the full before/after is still
 * captured immutably in `admin_actions` (this is the audit-trail guarantee
 * the "never mutates" language is really protecting), and the gap is
 * flagged in docs/BUILD_NOTES.md.
 */
async function handlePlatformSettings(
  sql: SqlClient,
  ctx: AdminRequestContext,
): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-platform-settings", "referral"|"pricing"?]

  if (ctx.method === "GET" && !parts[1]) {
    const rows = await sql<{ key: string; value: Record<string, unknown> }>`
      select key, value from public.platform_settings
      where key = any(${[
        "referral_flat_amount_cents",
        "referral_qualification_rule",
        ...VERTICALS.map((v) => `price_card_${v}`),
      ]})
    `;
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    // COCKPIT-F06: the seeded/DB shapes are `{flat_amount_cents}` and
    // `{rule, value}` (what fn_check_referral_qualification reads); the old
    // route looked for `amount_cents`, so the page showed $0.00. The legacy key
    // is still accepted for rows the old route wrote.
    const flat = byKey.get("referral_flat_amount_cents") as
      | { flat_amount_cents?: number; amount_cents?: number }
      | undefined;
    const qualification = byKey.get("referral_qualification_rule") as
      | { rule?: string; value?: number }
      | undefined;
    return {
      status: 200,
      body: {
        referral: {
          flat_amount_cents: flat?.flat_amount_cents ?? flat?.amount_cents ?? 0,
          qualification_rule: qualification?.rule ?? "paid_invoices_gte",
          qualification_value: qualification?.value ?? 2,
        },
        price_cards: Object.fromEntries(
          VERTICALS.map((v) => [v, byKey.get(`price_card_${v}`) ?? null]),
        ),
      },
    };
  }

  if (ctx.method === "PATCH" && parts[1] === "referral") {
    const parsed = AdminReferralSettingSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return {
        status: 422,
        body: { error: "invalid_referral_setting", issues: parsed.error.issues },
      };
    }

    const beforeRows = await sql<{ key: string; value: Record<string, unknown> }>`
      select key, value from public.platform_settings
      where key in ('referral_flat_amount_cents', 'referral_qualification_rule')
    `;
    const before = Object.fromEntries(beforeRows.map((r) => [r.key, r.value]));

    // Merge onto the stored values (never replace the blob) and write the keys
    // fn_check_referral_qualification reads: `flat_amount_cents`, `rule`, `value`.
    const { amount_cents: _legacyAmount, ...flatBefore } = (before["referral_flat_amount_cents"] ??
      {}) as Record<string, unknown>;
    const qualificationBefore = (before["referral_qualification_rule"] ?? {}) as Record<
      string,
      unknown
    >;
    const flatValue = { ...flatBefore, flat_amount_cents: parsed.data.flat_amount_cents };
    const qualificationValue = {
      ...qualificationBefore,
      rule: parsed.data.qualification_rule,
      value: parsed.data.qualification_value ?? qualificationBefore["value"] ?? 2,
    };

    await sql`
      insert into public.platform_settings (key, value)
      values ('referral_flat_amount_cents', ${flatValue}::jsonb)
      on conflict (key) do update set value = excluded.value, updated_by = ${ctx.adminUserId}, updated_at = now()
    `;
    await sql`
      insert into public.platform_settings (key, value)
      values ('referral_qualification_rule', ${qualificationValue}::jsonb)
      on conflict (key) do update set value = excluded.value, updated_by = ${ctx.adminUserId}, updated_at = now()
    `;

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "platform_settings_referral_edit",
        targetType: "other",
        before,
        after: {
          referral_flat_amount_cents: flatValue,
          referral_qualification_rule: qualificationValue,
        },
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return {
      status: 200,
      body: {
        referral: {
          flat_amount_cents: parsed.data.flat_amount_cents,
          qualification_rule: parsed.data.qualification_rule,
          qualification_value: qualificationValue.value,
        },
      },
    };
  }

  if (ctx.method === "POST" && parts[1] === "pricing") {
    const parsed = PlatformPricingTableSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { status: 422, body: { error: "invalid_price_card", issues: parsed.error.issues } };
    }
    const key = `price_card_${parsed.data.vertical}`;
    const beforeRows = await sql<{ value: Record<string, unknown> }>`
      select value from public.platform_settings where key = ${key}
    `;
    const before = beforeRows[0]?.value ?? null;

    // Merge onto the previously-stored value rather than replacing the
    // whole JSONB blob — an admin save through this schema-typed form must
    // never silently drop fields it doesn't know about (e.g. a future key
    // added by a migration/seed but not yet surfaced in this form). Every
    // field this schema DOES know about is still sourced explicitly from
    // the validated request, never left over from `before`.
    const value = {
      ...(before ?? {}),
      base_cents: parsed.data.base_cents,
      included_minutes: parsed.data.included_minutes,
      overage_cents: parsed.data.overage_cents,
      included_text_conversations: parsed.data.included_text_conversations,
      text_conversation_overage_cents: parsed.data.text_conversation_overage_cents,
      effective_at: parsed.data.effective_at,
    };
    await sql`
      insert into public.platform_settings (key, value, updated_by)
      values (${key}, ${value}::jsonb, ${ctx.adminUserId})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
    `;

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "platform_settings_pricing_edit",
        targetType: "other",
        targetId: parsed.data.vertical,
        before,
        after: value,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { vertical: parsed.data.vertical, price_card: value } };
  }

  return { status: 404, body: { error: "not_found" } };
}

// ---------------------------------------------------------------------
// Margin cockpit + Config Lab (BACKEND_SPEC §7.7) — implemented in
// ./cockpit.ts (COCKPIT-1). Only the pgmq queue-depth page (OPS-8) stays here
// because it needs `_shared/queue.ts`.
// ---------------------------------------------------------------------
async function handleCockpitRoute(
  sql: SqlClient,
  ctx: AdminRequestContext,
): Promise<AdminResponse> {
  const parts = segments(ctx.path);
  // OPS-8 (docs/BUILD_NOTES.md deliverable 3) — every queue's
  // `pgmq.metrics_all()` row (including each `_dlq` companion), so an
  // admin can see backlog/DLQ depth without a direct DB query. Mirrors
  // `worker-tick`'s own `queues` field (same `_shared/queue.ts#metricsAll`
  // helper) so both surfaces stay in lockstep.
  if (ctx.method === "GET" && parts[1] === "queues") {
    return { status: 200, body: { queues: await metricsAll(sql) } };
  }
  return handleCockpit(sql, ctx);
}

// ---------------------------------------------------------------------
// Referral P&L (BACKEND_SPEC §7.7)
// ---------------------------------------------------------------------
async function handleReferrals(
  sql: SqlClient,
  ctx: AdminRequestContext,
  logger: Logger,
): Promise<AdminResponse> {
  const parts = segments(ctx.path); // ["admin-referrals", ":commission_event_id"?, "payout-override"?] or ["admin-referrals", "partners", ":partner_id", ...]
  const commissionEventId = parts[1] !== "partners" ? parts[1] : undefined;

  if (ctx.method === "GET" && !commissionEventId && parts[1] !== "partners") {
    const rows = await sql<Record<string, unknown>>`
      select * from public.v_referral_pnl order by accrued_cents desc nulls last limit 200
    `;
    // COCKPIT-1: the Referral P&L page reads `rows` with per-partner funnel
    // fields; `referral_partners` (raw view rows) is kept for existing callers.
    // `clicks` is null: link clicks are not tracked anywhere yet.
    return {
      status: 200,
      body: {
        rows: rows.map((r) => ({
          partner_id: r["referral_partner_id"],
          partner_name: r["name"],
          clicks: null,
          signups: toNumber(r["signup_count"]),
          qualified: toNumber(r["qualified_count"]),
          paid: toNumber(r["paid_count"]),
          payouts_cents: toNumber(r["paid_cents"]),
          accrued_cents: toNumber(r["accrued_cents"]),
          revenue_cents: toNumber(r["attributed_revenue_cents"]),
        })),
        referral_partners: rows,
      },
    };
  }

  // Recurring commission terms (GAP_REGISTER Cluster G item 1, owner
  // decision): admin-set rate_bps/commission_base/duration_months per
  // partner, with an optional per-vertical override — NO platform-wide
  // default is ever applied here or anywhere downstream (job-commission-
  // accrual simply skips a partner/vertical with no resolvable rate_bps).
  if (parts[1] === "partners" && parts[2] && parts[3] === undefined && ctx.method === "PATCH") {
    const partnerId = parts[2];
    const parsed = AdminCommissionTermsSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return {
        status: 422,
        body: { error: "invalid_commission_terms", issues: parsed.error.issues },
      };
    }
    const before = (
      await sql<Record<string, unknown>>`
        select id, rate_bps, commission_base, duration_months from public.referral_partners where id = ${partnerId}
      `
    )[0];
    if (!before) return { status: 404, body: { error: "referral_partner_not_found" } };

    const updates: string[] = [];
    if ("rate_bps" in parsed.data) updates.push("rate_bps");
    if ("commission_base" in parsed.data) updates.push("commission_base");
    if ("duration_months" in parsed.data) updates.push("duration_months");
    if (updates.length === 0) return { status: 422, body: { error: "no_valid_fields" } };

    if ("rate_bps" in parsed.data) {
      await sql`update public.referral_partners set rate_bps = ${parsed.data.rate_bps ?? null} where id = ${partnerId}`;
    }
    if ("commission_base" in parsed.data) {
      await sql`update public.referral_partners set commission_base = ${parsed.data.commission_base as string} where id = ${partnerId}`;
    }
    if ("duration_months" in parsed.data) {
      await sql`update public.referral_partners set duration_months = ${parsed.data.duration_months ?? null} where id = ${partnerId}`;
    }

    const after = (
      await sql<Record<string, unknown>>`
        select id, rate_bps, commission_base, duration_months from public.referral_partners where id = ${partnerId}
      `
    )[0];

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "referral_commission_terms_update",
        targetType: "referral",
        targetId: partnerId,
        before,
        after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    logger.info("admin_referral_commission_terms_updated", { partner_id: partnerId });
    return { status: 200, body: { referral_partner: after } };
  }

  if (
    parts[1] === "partners" &&
    parts[2] &&
    parts[3] === "vertical-overrides" &&
    parts[4] &&
    ctx.method === "PUT"
  ) {
    const partnerId = parts[2];
    const vertical = parts[4];
    if (!VERTICALS.includes(vertical as (typeof VERTICALS)[number])) {
      return { status: 422, body: { error: "invalid_vertical" } };
    }
    const parsed = AdminCommissionVerticalOverrideSchema.safeParse(ctx.body);
    if (!parsed.success) {
      return { status: 422, body: { error: "invalid_override", issues: parsed.error.issues } };
    }
    const partnerRows = await sql<{ id: string }>`
      select id from public.referral_partners where id = ${partnerId}
    `;
    if (!partnerRows[0]) return { status: 404, body: { error: "referral_partner_not_found" } };

    const after = (
      await sql<Record<string, unknown>>`
        insert into public.referral_partner_vertical_overrides
          (referral_partner_id, vertical, rate_bps, commission_base, duration_months)
        values (
          ${partnerId}, ${vertical}, ${parsed.data.rate_bps ?? null},
          ${parsed.data.commission_base ?? null}, ${parsed.data.duration_months ?? null}
        )
        on conflict (referral_partner_id, vertical) do update set
          rate_bps = excluded.rate_bps,
          commission_base = excluded.commission_base,
          duration_months = excluded.duration_months
        returning *
      `
    )[0];

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "referral_commission_vertical_override_upsert",
        targetType: "referral",
        targetId: partnerId,
        after,
        ...(ctx.ipAddress ? { ipAddress: ctx.ipAddress } : {}),
        ...(ctx.userAgent ? { userAgent: ctx.userAgent } : {}),
      });
    }
    return { status: 200, body: { override: after } };
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
  // COCKPIT-1: lead_count now counts DISTINCT leads (was one per cost row, so
  // a lead with several cost events was counted several times) and converted
  // tenants exclude test tenants. `pipeline_costs` is deliberately NOT added:
  // it is the campaign-level ledger of the very same spend `cac_events`
  // records per lead — summing both would double count.
  const rows = await sql<{
    channel: string;
    total_cost_cents: unknown;
    lead_count: unknown;
    converted_tenant_count: unknown;
  }>`
    select
      ce.channel,
      sum(ce.cost_cents)::int as total_cost_cents,
      count(distinct ce.lead_id)::int as lead_count,
      count(distinct ce.tenant_id) filter (where t.id is not null and not t.is_test)::int as converted_tenant_count
    from public.cac_events ce
    left join public.tenants t on t.id = ce.tenant_id
    group by ce.channel
    order by total_cost_cents desc
  `;
  const monthly = await sql<{
    channel: string;
    label: string;
    cost_cents: unknown;
    converted: unknown;
  }>`
    select
      ce.channel,
      to_char(date_trunc('month', ce.occurred_at), 'YYYY-MM') as label,
      sum(ce.cost_cents)::int as cost_cents,
      count(distinct ce.tenant_id) filter (where t.id is not null and not t.is_test)::int as converted
    from public.cac_events ce
    left join public.tenants t on t.id = ce.tenant_id
    group by ce.channel, date_trunc('month', ce.occurred_at)
    order by date_trunc('month', ce.occurred_at)
  `;
  // Cohort CAC per spend month: that month's spend / tenants converted from
  // the leads it paid for. A month with no conversions has no defined CAC and
  // is omitted from the trend (the channel table below still shows its spend).
  const byChannel: Record<string, { label: string; value: number }[]> = {};
  for (const m of monthly) {
    const converted = toNumber(m.converted);
    if (converted <= 0) continue;
    const series = byChannel[m.channel] ?? [];
    series.push({ label: m.label, value: Math.round(toNumber(m.cost_cents) / converted) });
    byChannel[m.channel] = series;
  }
  return {
    status: 200,
    body: {
      byChannel,
      channels: rows.map((r) => {
        const total = toNumber(r.total_cost_cents);
        const converted = toNumber(r.converted_tenant_count);
        return {
          channel: r.channel,
          total_cost_cents: total,
          lead_count: toNumber(r.lead_count),
          converted_tenant_count: converted,
          cac_cents: converted > 0 ? Math.round(total / converted) : null,
        };
      }),
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

// A real uuid (agent_templates.id's actual type) vs. anything else, which
// every real caller of admin-templates/:key sends instead — see
// resolveTemplateByKey below.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `admin-templates/:key`'s `:key` segment is a vertical *slug* (e.g.
 * `"auto_repair"`) in every real caller — `cockpit/templates/page.tsx`
 * always links to `/cockpit/templates/${row.vertical}`, and the editor's
 * GET + its "Run publish gate" POST both send that same slug straight
 * through — but `agent_templates.id` is a real `uuid` primary key, a
 * separate `vertical` text column (`unique (vertical, version)`, multiple
 * rows per vertical across versions). A literal `where id = $1` given a
 * vertical slug always errors or 404s in production (documented
 * docs/BUILD_NOTES.md ADMIN+PREVIEW-R6 — a real bug, not preview-only).
 * Resolve either shape: a genuine uuid still looks up by id (kept for any
 * future direct-by-id caller); anything else resolves to that vertical's
 * highest-`version` row (not filtered to `is_active` — the editor must
 * still be able to open and publish a vertical's very first, not-yet-
 * active draft, which an `is_active`-filtered query would never surface).
 */
async function resolveTemplateByKey(
  sql: SqlClient,
  key: string,
): Promise<Record<string, unknown> | undefined> {
  if (UUID_RE.test(key)) {
    return (
      await sql<Record<string, unknown>>`select * from public.agent_templates where id = ${key}`
    )[0];
  }
  return (
    await sql<Record<string, unknown>>`
      select * from public.agent_templates where vertical = ${key} order by version desc limit 1
    `
  )[0];
}

// agent_templates jsonb columns that always hold an array (default '[]').
const TEMPLATE_JSONB_ARRAY_FIELDS = ["states", "transitions", "global_intents", "tools"] as const;

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
    const row = await resolveTemplateByKey(sql, templateId);
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
    // JSONB-2: these four columns are jsonb ARRAYS; a caller-supplied string
    // would otherwise be stored as a jsonb string scalar (double-encoded
    // shape), so reject anything that is not an array before it reaches SQL.
    for (const field of TEMPLATE_JSONB_ARRAY_FIELDS) {
      if (body[field] !== undefined && !Array.isArray(body[field])) {
        return { status: 422, body: { error: `invalid_${field}` } };
      }
    }
    const inserted = (
      await sql<{ id: string }>`
        insert into public.agent_templates (
          vertical, name, version, compile_target, system_prompt, states, transitions,
          global_intents, tools, voice_id, model, disclosure_line, created_by
        ) values (
          ${body["vertical"] as string}, ${body["name"] as string}, ${body["version"] as number},
          ${body["compile_target"] as string}, ${(body["system_prompt"] as string) ?? null},
          ${body["states"] ?? []}::jsonb, ${body["transitions"] ?? []}::jsonb,
          ${body["global_intents"] ?? []}::jsonb, ${body["tools"] ?? []}::jsonb,
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
    for (const field of TEMPLATE_JSONB_ARRAY_FIELDS) {
      if (field in patch && !Array.isArray(patch[field])) {
        return { status: 422, body: { error: `invalid_${field}` } };
      }
    }
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
      await sql`update public.agent_templates set states = ${patch["states"]}::jsonb where id = ${templateId}`;
    }
    if ("transitions" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set transitions = ${patch["transitions"]}::jsonb where id = ${templateId}`;
    }
    if ("global_intents" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set global_intents = ${patch["global_intents"]}::jsonb where id = ${templateId}`;
    }
    if ("tools" in patch) {
      didUpdate = true;
      await sql`update public.agent_templates set tools = ${patch["tools"]}::jsonb where id = ${templateId}`;
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
    const row = await resolveTemplateByKey(sql, templateId);
    if (!row) return { status: 404, body: { error: "template_not_found" } };
    // `row.id` is the real uuid primary key from here on — `templateId`
    // itself is the raw path segment (a vertical slug for every real
    // caller, see resolveTemplateByKey above) and is never a safe `id`
    // value to write back into `agent_templates` with.
    const resolvedId = row["id"] as string;
    if (!deps.retell) return { status: 501, body: { error: "retell_publish_not_configured" } };

    const template = toCompilerTemplate(row);
    // PUBLISH-1 (docs/BUILD_NOTES.md): no compile options needed any more
    // (was OPS-5's explicit `{ transferNumber: null }`) — the compiler no
    // longer takes a transfer number at compile time at all; every
    // compiled flow always references the live `{{transfer_number}}`
    // dynamic variable instead, resolved by Retell per call.
    const compiled = compileTemplate(template, deps.retell.toolWebhookUrl);
    if (!compiled.disclosureVerified) {
      return { status: 422, body: { error: "disclosure_gate_failed" } };
    }

    // VERIFY-8 (resolved, RETELL-VERIFY): conversation-flow's model field is
    // a REQUIRED nested `model_choice: {model, type:"cascading"}` object, not
    // a flat `model` string — confirmed via retell-typescript-sdk. Retell
    // LLM (multi_prompt/single_prompt) keeps `model` flat. The two are not
    // wire-compatible; branch accordingly (mirrors packages/adapters/retell's
    // agents.ts).
    const flowPayload =
      compiled.flow.kind === "conversation_flow"
        ? { ...compiled.flow.body, model_choice: { model: row["model"], type: "cascading" } }
        : { ...compiled.flow.body, model: row["model"] };
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
      agent_name: `heyloo-template-${resolvedId}-v${row["version"]}`,
      voice_id: row["voice_id"],
      response_engine: responseEngine,
    });
    // `version` is REQUIRED on `AgentResponse` (RETELL-VERIFY, VERIFY-6
    // resolved) — publish-agent-version has no "latest" shorthand, so this
    // is not optional information to thread through.
    const agentBody = agentResult.body as { agent_id?: string; version?: number };
    if (!agentResult.ok || !agentBody.agent_id || agentBody.version === undefined) {
      return { status: 502, body: { error: "retell_agent_create_failed" } };
    }

    const publishResult = await publishAgentVersion(
      deps.retell.fetchImpl,
      deps.retell.apiKey,
      agentBody.agent_id,
      agentBody.version,
    );
    if (!publishResult.ok) {
      return { status: 502, body: { error: "retell_publish_failed" } };
    }

    await sql`update public.agent_templates set is_active = false where vertical = ${row["vertical"] as string} and id <> ${resolvedId}`;
    await sql`update public.agent_templates set is_active = true where id = ${resolvedId}`;

    if (ctx.adminUserId) {
      await writeAdminAction(sql, {
        adminUserId: ctx.adminUserId,
        action: "template_publish",
        targetType: "agent_template",
        targetId: resolvedId,
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
        template_id: resolvedId,
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
    // OUTREACH-2: `min_score` filters to leads scored at/above a threshold
    // (nulls — unscored leads — never match a min_score filter, matching
    // the "0-1 confidence, null = not yet scored" column contract);
    // `sort=score` re-orders by phone_complaint_score first (nulls last)
    // instead of the default newest-first, for the admin outreach UI's
    // Score column sort control.
    const minScoreRaw = query["min_score"];
    const minScore = minScoreRaw !== undefined ? Number(minScoreRaw) : null;
    // COCKPIT-F23: the score is a 0-1 confidence; clamp instead of trusting the input's min/max.
    const validMinScore =
      minScore !== null && Number.isFinite(minScore) ? Math.min(1, Math.max(0, minScore)) : null;
    const sortByScore = query["sort"] === "score";

    const rows = sortByScore
      ? await sql<Record<string, unknown>>`
          select id, source, vertical, company_name, contact_name, email, phone, status,
                 phone_complaint_score, phone_complaint_evidence, reviews_analyzed_at, created_at
          from public.leads
          where (${status ?? null}::text is null or status = ${status ?? null})
            and (${vertical ?? null}::text is null or vertical = ${vertical ?? null})
            and (${source ?? null}::text is null or source = ${source ?? null})
            and (${validMinScore}::numeric is null or phone_complaint_score >= ${validMinScore})
          order by phone_complaint_score desc nulls last, created_at desc
          limit 200
        `
      : await sql<Record<string, unknown>>`
          select id, source, vertical, company_name, contact_name, email, phone, status,
                 phone_complaint_score, phone_complaint_evidence, reviews_analyzed_at, created_at
          from public.leads
          where (${status ?? null}::text is null or status = ${status ?? null})
            and (${vertical ?? null}::text is null or vertical = ${vertical ?? null})
            and (${source ?? null}::text is null or source = ${source ?? null})
            and (${validMinScore}::numeric is null or phone_complaint_score >= ${validMinScore})
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
      select id, name, vertical, sender_domain, provider, status, external_campaign_id,
             complaint_rate, daily_send_cap, template_id, created_at
      from public.campaigns order by created_at desc limit 100
    `;
    return { status: 200, body: { campaigns: rows } };
  }

  // COCKPIT-F08: the campaign detail page reads `{ name, status, funnel, leads }`;
  // there was no branch, so every campaign opened as a 404.
  if (resource === "campaigns" && ctx.method === "GET" && parts[2] && !parts[3]) {
    const campaignId = parts[2];
    const campaign = (
      await sql<Record<string, unknown>>`
        select id, name, vertical, sender_domain, provider, status, external_campaign_id,
               complaint_rate, daily_send_cap, template_id, created_at
        from public.campaigns where id = ${campaignId}
      `
    )[0];
    if (!campaign) return { status: 404, body: { error: "campaign_not_found" } };

    const counts = (
      await sql<Record<string, unknown>>`
        select count(distinct se.lead_id)::int as added,
               count(distinct se.lead_id) filter (where se.sent_at is not null)::int as sent,
               count(distinct se.lead_id) filter (where se.opened_at is not null)::int as opened,
               count(distinct se.lead_id) filter (where se.clicked_at is not null)::int as clicked,
               count(distinct r.lead_id)::int as replied
        from public.send_events se
        left join public.replies r on r.send_event_id = se.id
        where se.campaign_id = ${campaignId}
      `
    )[0];
    const leads = await sql<{
      id: string;
      company_name: string | null;
      contact_name: string | null;
      email: string | null;
      status: string;
      phone_complaint_score: unknown;
    }>`
      select l.id, l.company_name, l.contact_name, l.email, l.status, l.phone_complaint_score
      from public.leads l
      where l.id in (select lead_id from public.send_events where campaign_id = ${campaignId})
      order by l.created_at desc
      limit 200
    `;
    return {
      status: 200,
      body: {
        ...campaign,
        funnel: [
          { label: "Leads added", count: toNumber(counts?.["added"]) },
          { label: "Sent", count: toNumber(counts?.["sent"]) },
          { label: "Opened", count: toNumber(counts?.["opened"]) },
          { label: "Clicked", count: toNumber(counts?.["clicked"]) },
          { label: "Replied", count: toNumber(counts?.["replied"]) },
        ],
        leads: leads.map((l) => ({
          id: l.id,
          companyName: l.company_name,
          contactName: l.contact_name,
          email: l.email,
          status: l.status,
          suppressed: l.status === "suppressed",
          isDuplicate: false,
          phoneComplaintScore:
            l.phone_complaint_score === null ? null : toNumber(l.phone_complaint_score),
        })),
      },
    };
  }

  if (resource === "campaigns" && ctx.method === "POST" && !parts[2]) {
    const raw = (ctx.body ?? {}) as Record<string, unknown>;
    const provider = typeof raw["provider"] === "string" ? raw["provider"] : "smartlead";
    if (provider !== "smartlead") {
      // Compliance/scope: only the Smartlead adapter is implemented (see
      // this module's provider-choice docstring) — never silently accept
      // a provider value this build can't actually create a campaign for.
      return { status: 422, body: { error: "unsupported_provider" } };
    }
    // COCKPIT-F08/F23: validate the form's canonical body BEFORE the
    // not-configured answer, so an invalid form always gets field errors.
    // `sender_domain` is accepted as the pre-F08 spelling of `sending_domain`.
    const parsed = OutreachCampaignCreateSchema.safeParse({
      respect_suppression: true,
      ...raw,
      sending_domain: raw["sending_domain"] ?? raw["sender_domain"],
    });
    if (!parsed.success) {
      return { status: 422, body: { error: "invalid_campaign", issues: parsed.error.issues } };
    }
    const body = parsed.data;
    if (!deps.outreach) return { status: 501, body: { error: "outreach_sender_not_configured" } };

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

    // The cap and template are stored for the sender; they are not pushed to
    // Smartlead yet (docs/BUILD_NOTES.md QA-1-cockpit).
    const inserted = await sql<{ id: string }>`
      insert into public.campaigns
        (name, vertical, sender_domain, provider, status, external_campaign_id, daily_send_cap, template_id)
      values (${body.name}, ${body.vertical}, ${body.sending_domain}, ${provider}, 'draft',
              ${created.externalCampaignId}, ${body.daily_send_cap}, ${body.template_id || null})
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
        after: {
          name: body.name,
          provider,
          external_campaign_id: created.externalCampaignId,
          sender_domain: body.sending_domain,
          daily_send_cap: body.daily_send_cap,
        },
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
    // COCKPIT-F09: overall complaint rate (a percentage; campaigns auto-pause at
    // 0.3%) so the overview can warn before the auto-pause trips.
    const complaint = (
      await sql<{ rate: unknown }>`
        select (count(*) filter (where status = 'complained'))::numeric / nullif(count(*), 0) as rate
        from public.send_events
      `
    )[0];
    return {
      status: 200,
      body: {
        leads_by_status: byStatus,
        replies_by_intent: byIntent,
        complaint_rate_pct: complaint?.rate == null ? 0 : toNumber(complaint.rate) * 100,
      },
    };
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
      if (!deps.email) return { status: 501, body: { error: "email_not_configured" } };
      // A direct send, not the tenant-scoped `messages_outbound` pipeline —
      // this lead has no tenant yet (see AdminDeps.email's docstring).
      const rendered = renderTemplate("outreach_demo_followup", {
        contact_name: lead.contact_name,
        demo_url: "https://heyloo.ai/demo",
      });
      const sendResult = await deps.email.provider.sendEmail({
        from: deps.email.fromAddress,
        to: lead.email,
        subject: rendered.subject ?? "See your AI receptionist in action",
        html: textToEmailHtml(rendered.body),
        text: rendered.body,
        // One demo-followup per reply, even if the admin double-clicks.
        idempotencyKey: `outreach_demo_followup:${reply.id}`,
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

/**
 * `/admin-agent-regression` (NIGHTLY-1): minimal read-only listing of the
 * last 14 days of `job-agent-regression` nightly runs, one row per
 * test-* tenant per night, for the admin surface to page/filter by
 * vertical itself (kept deliberately small — a single flat GET, no
 * sub-routes, matching this task's own "keep it small" scope). No
 * dedicated frontend page ships with this task; this is the API a future
 * cockpit page reads.
 */
async function handleAgentRegression(
  sql: SqlClient,
  ctx: AdminRequestContext,
): Promise<AdminResponse> {
  if (ctx.method !== "GET") return { status: 404, body: { error: "not_found" } };
  const rows = await sql<{
    id: string;
    tenant_id: string;
    tenant_slug: string;
    vertical: string;
    started_at: string;
    finished_at: string | null;
    scenarios_total: number | null;
    scenarios_passed: number | null;
    field_capture_ok: boolean | null;
    status: string;
    retell_batch_test_id: string | null;
    failures: unknown;
  }>`
    select r.id, r.tenant_id, t.slug as tenant_slug, r.vertical, r.started_at, r.finished_at,
      r.scenarios_total, r.scenarios_passed, r.field_capture_ok, r.status,
      r.retell_batch_test_id, r.failures
    from public.agent_regression_runs r
    join public.tenants t on t.id = r.tenant_id
    where r.started_at > now() - interval '14 days'
    order by r.started_at desc
    limit 500
  `;
  return { status: 200, body: { runs: rows } };
}

const NOT_YET_IMPLEMENTED_PREFIXES = ["admin-flags"];

/**
 * COCKPIT-F17: every path id below is interpolated into a `where id = $1`
 * against a `uuid` column, so a malformed one (`/admin-tenants/not-a-uuid`)
 * used to surface as an unhandled Postgres cast error, a 500 with no body.
 * A syntactically invalid id can never name a row: answer 404 up front.
 * (`admin-templates/:key` is deliberately absent: its key is a vertical slug
 * or a uuid and `resolveTemplateByKey` already handles both.)
 */
function pathIdSegments(parts: string[]): (string | undefined)[] {
  const [first, second, third] = parts;
  switch (first) {
    case "admin-tenants":
    case "admin-support-requests":
      return [second];
    case "admin-alerts":
      return [second === "rules" ? third : second];
    case "admin-cockpit":
      return second === "per-customer-margin" ? [third] : [];
    case "admin-outreach":
      return second === "campaigns" || second === "replies" ? [third] : [];
    case "admin-referrals":
      return [second === "partners" ? third : second];
    default:
      return [];
  }
}

export async function routeAdminRequest(
  sql: SqlClient,
  ctx: AdminRequestContext,
  logger: Logger,
  deps: AdminDeps = {},
): Promise<AdminResponse> {
  // Impersonation cookie-fix: the two self-service routes below accept a
  // resolved `impersonated_by` identity in place of a direct
  // platform_admin claim (see `resolveImpersonationActor`) — every other
  // route keeps the strict platform_admin gate unchanged.
  const isSelfServiceImpersonation =
    ctx.method === "POST" &&
    isImpersonationSelfServicePath(ctx.path) &&
    impersonatedByClaim(ctx.claims) !== null;
  if (!isPlatformAdmin(ctx.claims) && !isSelfServiceImpersonation) {
    return { status: 403, body: { error: "not_a_platform_admin" } };
  }

  const parts = segments(ctx.path);
  const [first] = parts;
  if (pathIdSegments(parts).some((id) => id !== undefined && !UUID_RE.test(id))) {
    return { status: 404, body: { error: "invalid_id" } };
  }
  if (first === "admin-tenants") return handleTenants(sql, ctx, logger, deps);
  if (first === "admin-alerts") return handleAlerts(sql, ctx);
  if (first === "admin-platform-settings") return handlePlatformSettings(sql, ctx);
  if (first === "admin-cockpit") return handleCockpitRoute(sql, ctx);
  if (first === "admin-config-lab") return handleConfigLab(sql, ctx);
  if (first === "admin-referrals") return handleReferrals(sql, ctx, logger);
  if (first === "admin-cac") return handleCac(sql, ctx);
  if (first === "admin-templates") return handleTemplates(sql, ctx, deps);
  if (first === "admin-outreach") return handleOutreach(sql, ctx, deps);
  if (first === "admin-support-requests") return handleSupportRequests(sql, ctx);
  if (first === "admin-agent-regression") return handleAgentRegression(sql, ctx);

  if (first && NOT_YET_IMPLEMENTED_PREFIXES.includes(first)) {
    logger.info("admin_route_not_yet_implemented", { path: ctx.path });
    return { status: 501, body: { error: "not_implemented", group: first } };
  }

  return { status: 404, body: { error: "not_found" } };
}
