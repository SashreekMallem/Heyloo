import "server-only";

import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { CURRENT_FTC_POLICY_VERSION, PREVIEW_PARTNER, PREVIEW_PARTNER_USER } from "../fixtures";

/** UI Preview Mode replacement for `@/lib/auth/require-partner-session` — see `./require-tenant-session.ts` for the full rationale. `acknowledged` is always `true` so the FTC disclosure gate never redirects a preview page away; `/preview/portal/disclosure` is still reachable directly to review that screen itself. */
export async function requirePartnerSession(_nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  return {
    supabase,
    user: PREVIEW_PARTNER_USER,
    claims: { referral_partner_id: PREVIEW_PARTNER.id },
    partner: PREVIEW_PARTNER,
    acknowledged: true,
    policyVersion: CURRENT_FTC_POLICY_VERSION,
  };
}

export { CURRENT_FTC_POLICY_VERSION };
