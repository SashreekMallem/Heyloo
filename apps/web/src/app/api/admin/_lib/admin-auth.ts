import "server-only";

import type { SupabaseServiceRoleClient } from "@heyloo/supabase-client";
import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

/**
 * `commission_events`/`referral_partner_vertical_overrides` postdate
 * `@heyloo/supabase-client`'s hand-maintained `Database` type (added by
 * `20260910140000_referral_commission_recurring.sql`) — that package is
 * not in this cluster's ownership. One cast site rather than repeating
 * `.from as any` per call, per the established workaround for tables this
 * package hasn't caught up to yet (docs/audit/FIX_REQUESTS.md).
 */
// biome-ignore lint/suspicious/noExplicitAny: see comment above — the untyped table's real query-builder shape is enforced by its own migration/RLS, not by this client.
export function fromUntypedTable(supabase: SupabaseServiceRoleClient, table: string): any {
  // biome-ignore lint/suspicious/noExplicitAny: see comment above.
  return (supabase.from as (t: string) => any)(table);
}

/**
 * Shared guard for the `api/admin/**` Route Handlers this cluster owns
 * that talk to Postgres directly (service-role) instead of proxying to
 * `supabase/functions/admin` (that edge function does not implement every
 * route this cluster needs yet — see `docs/audit/FIX_REQUESTS.md`).
 * Mirrors `api/admin/[...path]/route.ts`'s own check exactly (session +
 * `platform_admin` app_metadata claim) so every `/api/admin/*` path shares
 * one security bar regardless of which handler serves it.
 */
export async function requireAdminApiSession(): Promise<
  { ok: true; adminUserId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  const claims = claimsFromUser(session.user);
  if (!claims.platform_admin) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { ok: true, adminUserId: session.user.id };
}

export type AdminActionTargetType =
  | "tenant"
  | "call"
  | "booking"
  | "order"
  | "referral"
  | "agent_template"
  | "support_request"
  | "payout"
  | "campaign"
  | "flag"
  | "other";

/**
 * Append-only audit row, same shape `supabase/functions/admin/handler.ts`'s
 * own `writeAdminAction` writes — kept as a small local mirror here since
 * this cluster's Route Handlers write directly to Postgres via service
 * role rather than going through that edge function.
 */
export async function writeAdminAction(params: {
  adminUserId: string;
  action: string;
  targetType: AdminActionTargetType;
  targetId?: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): Promise<void> {
  const supabase = createSupabaseServiceRoleServerClient();
  await supabase.from("admin_actions").insert({
    admin_user_id: params.adminUserId,
    action: params.action,
    target_type: params.targetType,
    target_id: params.targetId ?? null,
    before: params.before,
    after: params.after,
  });
}
