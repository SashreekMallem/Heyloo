import type { SupabaseAdminFetch } from "../_shared/providers/supabase-admin.ts";
import { inviteUser } from "../_shared/providers/supabase-admin.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-team-invite` core logic (docs/audit/FIX_REQUESTS.md — "team-invite
 * UI/backend needed for a real 'Invite your team' setup-progress action").
 * `memberships.user_id` is `not null`, so a row can't exist for someone
 * without an auth user yet — inviting means minting one via GoTrue's admin
 * invite endpoint (service-role only, `_shared/providers/supabase-admin.ts`)
 * THEN inserting the `memberships` row, matching this repo's RLS
 * (`memberships_write`, 20260910110000_impersonation_claim.sql): only an
 * 'owner' (or a platform admin) may write `memberships`, so this function
 * — running as service role, which bypasses RLS — independently verifies
 * the CALLER's own role is 'owner' before doing anything (CLAUDE.md Rule 2:
 * "every secret-key edge function still explicitly filters by a verified
 * tenant_id"; role, not just tenant_id, is the relevant check here).
 */

export interface TeamInviteDeps {
  supabaseAdmin: { fetchImpl: SupabaseAdminFetch; url: string; serviceRoleKey: string };
  logger: Logger;
  /** Where the invited user lands after accepting — `${APP_BASE_URL}/dashboard`. */
  redirectTo?: string;
}

export type TeamInviteResult =
  | { status: 200; body: { invited: true; membership_id: string } }
  | { status: 200; body: { invited: false; reason: "already_a_member" } }
  | { status: 403; body: { error: "not_tenant_owner" } }
  | { status: 502; body: { error: "invite_failed" } };

export async function handleTeamInvite(
  sql: SqlClient,
  tenantId: string,
  callerUserId: string,
  input: { email: string; role: "admin" | "member" },
  deps: TeamInviteDeps,
): Promise<TeamInviteResult> {
  const callerRows = await sql<{ role: string }>`
    select role from public.memberships where tenant_id = ${tenantId} and user_id = ${callerUserId}
    limit 1
  `;
  if (callerRows[0]?.role !== "owner") {
    return { status: 403, body: { error: "not_tenant_owner" } };
  }

  const result = await inviteUser(
    deps.supabaseAdmin.fetchImpl,
    deps.supabaseAdmin.url,
    deps.supabaseAdmin.serviceRoleKey,
    input.email,
    { tenant_id: tenantId, role: input.role },
    deps.redirectTo,
  );

  if (result.alreadyExists) {
    // GoTrue already has an account for this email — look it up and add
    // them to this tenant directly rather than re-inviting (a second
    // `/invite` call for an existing user is not the right mechanism).
    const existingUserRows = await sql<{ id: string }>`
      select id from auth.users where lower(email) = lower(${input.email}) limit 1
    `;
    const existingUserId = existingUserRows[0]?.id;
    if (!existingUserId) {
      deps.logger.error("team_invite_already_exists_but_user_not_found", {
        tenant_id: tenantId,
        email: input.email,
      });
      return { status: 502, body: { error: "invite_failed" } };
    }
    const existingMembership = await sql<{ id: string }>`
      select id from public.memberships where tenant_id = ${tenantId} and user_id = ${existingUserId}
      limit 1
    `;
    if (existingMembership[0]) {
      return { status: 200, body: { invited: false, reason: "already_a_member" } };
    }
    const inserted = await sql<{ id: string }>`
      insert into public.memberships (tenant_id, user_id, role, invited_email, invited_at)
      values (${tenantId}, ${existingUserId}, ${input.role}, ${input.email}, now())
      returning id
    `;
    const membershipId = inserted[0]?.id;
    if (!membershipId) return { status: 502, body: { error: "invite_failed" } };
    return { status: 200, body: { invited: true, membership_id: membershipId } };
  }

  if (!result.ok || !result.userId) {
    deps.logger.error("team_invite_gotrue_invite_failed", {
      tenant_id: tenantId,
      status: result.status,
    });
    return { status: 502, body: { error: "invite_failed" } };
  }

  const inserted = await sql<{ id: string }>`
    insert into public.memberships (tenant_id, user_id, role, invited_email, invited_at)
    values (${tenantId}, ${result.userId}, ${input.role}, ${input.email}, now())
    on conflict (tenant_id, user_id) do nothing
    returning id
  `;
  const membershipId = inserted[0]?.id;
  if (!membershipId) {
    // Idempotent replay of the same invite (e.g. a retried request) — the
    // membership already exists from a prior successful call.
    return { status: 200, body: { invited: false, reason: "already_a_member" } };
  }

  deps.logger.info("team_invite_sent", { tenant_id: tenantId, membership_id: membershipId });
  return { status: 200, body: { invited: true, membership_id: membershipId } };
}
