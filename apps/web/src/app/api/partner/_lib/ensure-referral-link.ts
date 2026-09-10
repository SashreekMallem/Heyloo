import "server-only";

import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

function randomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Find-or-create a `referral_links` row for an already-existing referral
 * partner. `referral_links` has no client insert policy (service_role
 * only — same shape as the tenant "refer & earn" flow in
 * `api/tenant/refer/ensure-link/route.ts`), so this must run with the
 * service-role client.
 *
 * ADMIN-R4 fix: the partner dashboard (`(partner)/portal/page.tsx`)
 * previously only ever *read* `referral_links` and rendered a permanent
 * "Generating…" placeholder when no row existed yet — nothing in the app
 * ever created one for a partner provisioned by an admin (only the
 * tenant self-referral flow had a find-or-create). Called directly
 * (no HTTP round trip) from the portal's server component so the real
 * link is always resolved by first paint instead of getting stuck.
 */
export async function ensurePartnerReferralLink(partnerId: string): Promise<string | null> {
  const service = createSupabaseServiceRoleServerClient();

  const { data: existing } = await service
    .from("referral_links")
    .select("code")
    .eq("referral_partner_id", partnerId)
    .maybeSingle();
  if (existing?.code) return existing.code;

  // Unique `code` constraint (`referral_links_code_unique`) makes a retry
  // on collision safe; a genuinely failed insert just falls through to
  // the re-select below in case a concurrent request already created one.
  const { data: inserted } = await service
    .from("referral_links")
    .insert({ referral_partner_id: partnerId, code: randomCode() })
    .select("code")
    .single();
  if (inserted?.code) return inserted.code;

  const { data: afterRace } = await service
    .from("referral_links")
    .select("code")
    .eq("referral_partner_id", partnerId)
    .maybeSingle();
  return afterRace?.code ?? null;
}
