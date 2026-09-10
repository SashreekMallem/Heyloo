import "server-only";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { CURRENT_FTC_POLICY_VERSION, PREVIEW_PARTNER, PREVIEW_PARTNER_USER } from "../fixtures";

/**
 * UI Preview Mode replacement for `@/lib/auth/require-partner-session` —
 * see `./require-tenant-session.ts` for the full rationale. `acknowledged`
 * is `true` everywhere EXCEPT for the disclosure page's own route: the
 * real page does `if (acknowledged) redirect("/portal")`, so hardcoding
 * `true` unconditionally made `/preview/portal/disclosure` immediately
 * redirect itself away on every visit — its own screen could never be
 * reviewed under UI Preview Mode (round-2 admin-partner design review,
 * moderate). Every other partner page still sees `acknowledged: true` so
 * the disclosure gate never blocks them.
 */
export async function requirePartnerSession(nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  return {
    supabase,
    user: PREVIEW_PARTNER_USER,
    claims: { referral_partner_id: PREVIEW_PARTNER.id },
    partner: PREVIEW_PARTNER,
    acknowledged: nextPath !== "/portal/disclosure",
    policyVersion: CURRENT_FTC_POLICY_VERSION,
  };
}

export { CURRENT_FTC_POLICY_VERSION };
