import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

export interface TenantPlanResponse {
  vertical: string;
  included_minutes: number;
  base_cents: number;
  overage_cents: number;
  usage_alert_thresholds: { warn_pct: number; critical_pct: number };
  // BACKEND_SPEC.md §13.3 — same `price_card_<vertical>` row, merged in by
  // `20260911110000_channels_pricing_and_usage.sql`. Defaults (200 / 5¢)
  // match that migration's own documented default exactly, so a `value`
  // that predates the merge (or an environment where
  // `supabase/seed/seed.sql` wiped it back out —
  // docs/audit/CHANNELS_REQUESTS.md item 2) still shows a sane number
  // instead of 0.
  included_text_conversations: number;
  text_conversation_overage_cents: number;
}

/**
 * The caller's OWN tenant's current price card (FRONTEND_AUDIT.md H2/H3 —
 * Overview/Billing hardcoded `minutesIncluded`/`included: 300` regardless of
 * the tenant's real plan). `platform_settings` is admin-only RLS
 * (`platform_settings_all` policy, `supabase/migrations/20260907131500_rls.sql`),
 * so a tenant member can never read it directly with the publishable-key
 * browser client — this Route Handler re-derives `tenant_id` from the
 * caller's own session (never a client-supplied value, matching
 * `billing/portal`'s pattern, FRONTEND_AUDIT.md H1), looks up that tenant's
 * OWN `vertical` server-side, then reads `price_card_<vertical>` with the
 * service-role client — never a body/query-supplied vertical either.
 */
export async function GET() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // SIGNUP-1 fix (docs/BUILD_NOTES.md): see claims.ts's doc comment —
  // `session.user.app_metadata` never carries the Custom Access Token
  // Hook's tenant_id. Confirmed live: this endpoint 403'd for a real,
  // freshly provisioned tenant owner before this fix.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const service = createSupabaseServiceRoleServerClient();

  const { data: tenant } = await service
    .from("tenants")
    .select("vertical")
    .eq("id", claims.tenant_id)
    .maybeSingle();
  const vertical = tenant?.vertical ?? "generic";

  const [{ data }, { data: thresholdsRow }] = await Promise.all([
    service
      .from("platform_settings")
      .select("value")
      .eq("key", `price_card_${vertical}`)
      .maybeSingle(),
    service
      .from("platform_settings")
      .select("value")
      .eq("key", "usage_alert_thresholds")
      .maybeSingle(),
  ]);

  const value = (data?.value ?? {}) as Partial<TenantPlanResponse>;
  const thresholds = (thresholdsRow?.value ?? {}) as Partial<{
    warn_pct: number;
    critical_pct: number;
  }>;
  const body: TenantPlanResponse = {
    vertical,
    included_minutes: value.included_minutes ?? 0,
    base_cents: value.base_cents ?? 0,
    overage_cents: value.overage_cents ?? 0,
    usage_alert_thresholds: {
      warn_pct: thresholds.warn_pct ?? 0.8,
      critical_pct: thresholds.critical_pct ?? 1.0,
    },
    included_text_conversations: value.included_text_conversations ?? 200,
    text_conversation_overage_cents: value.text_conversation_overage_cents ?? 5,
  };
  return NextResponse.json(body);
}
