import { writeAdminAction } from "../_shared/admin-actions.js";
import type { AdminJwtClaims } from "../_shared/admin-auth.js";
import { isAal2, isPlatformAdmin } from "../_shared/admin-auth.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `/admin-*` single-function internal router (BACKEND_SPEC §7.7 —
 * "recommend one function with internal path routing... fewer Edge
 * Functions favors the low-QPS admin surface"). Every mutating route writes
 * `admin_actions`; AAL2 is required (session-level — see admin-auth.ts's
 * own caveat about true 15-minute freshness) for impersonation specifically.
 *
 * Scope note (BUILD_NOTES): BACKEND_SPEC §7.7 names nine endpoint groups
 * (Tenants, Margin cockpit, Config Lab, Referral P&L, CAC, Alerts,
 * Templates, Support, Outreach, Feature flags). This build implements
 * Tenants (list/get/patch/impersonate) and Alerts (list/ack) fully — the
 * two groups with the clearest, already-available data sources and the
 * security-relevant impersonation/AAL2 path — and shells the rest as an
 * explicit `501 not_implemented` (never a silent 200) so the admin
 * dashboard's own build-out (a later wave) has a real, visible contract to
 * fill in rather than guessed-at response shapes for margin-cockpit views,
 * Config Lab simulation, referral payout overrides, CAC joins, template
 * publish (which needs T2's compiler), and outreach/flags CRUD.
 */

export interface AdminRequestContext {
  method: string;
  path: string; // e.g. "/admin-tenants/abc123/impersonate"
  claims: AdminJwtClaims | null;
  body: unknown;
  adminUserId: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export interface AdminResponse {
  status: number;
  body: unknown;
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

async function handleTenants(
  sql: SqlClient,
  ctx: AdminRequestContext,
  logger: Logger,
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
    // Minting the actual short-lived scoped session token is a Supabase
    // Auth Admin API call (VERIFY.md: confirm current
    // `admin.generateLink`/session-impersonation mechanism) — not modeled
    // here; the audit-log write above is the security-relevant part this
    // build guarantees happens before any such token is issued.
    return { status: 501, body: { error: "impersonation_token_mint_not_implemented" } };
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

const NOT_YET_IMPLEMENTED_PREFIXES = [
  "admin-cockpit",
  "admin-config-lab",
  "admin-referrals",
  "admin-cac",
  "admin-templates",
  "admin-support-requests",
  "admin-outreach",
  "admin-flags",
];

export async function routeAdminRequest(
  sql: SqlClient,
  ctx: AdminRequestContext,
  logger: Logger,
): Promise<AdminResponse> {
  if (!isPlatformAdmin(ctx.claims)) {
    return { status: 403, body: { error: "not_a_platform_admin" } };
  }

  const [first] = segments(ctx.path);
  if (first === "admin-tenants") return handleTenants(sql, ctx, logger);
  if (first === "admin-alerts") return handleAlerts(sql, ctx);

  if (first && NOT_YET_IMPLEMENTED_PREFIXES.includes(first)) {
    logger.info("admin_route_not_yet_implemented", { path: ctx.path });
    return { status: 501, body: { error: "not_implemented", group: first } };
  }

  return { status: 404, body: { error: "not_found" } };
}
