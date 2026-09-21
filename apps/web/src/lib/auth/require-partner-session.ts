import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { claimsFromSupabaseClient } from "./claims";

const CURRENT_FTC_POLICY_VERSION = "2026-09";

/** Guard #2 for `(partner)` — referral_partner_id claim + FTC disclosure acknowledgment, versioned (FRONTEND_SPEC.md §0.1/§8.4). */
export async function requirePartnerSession(nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  // SIGNUP-1 fix (docs/BUILD_NOTES.md): see claims.ts's doc comment.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.referral_partner_id) redirect("/?toast=no_access");

  const { data: partner } = await supabase
    .from("referral_partners")
    .select("id, name, w9_status, ftc_acknowledged_at, ftc_acknowledged_version")
    .eq("id", claims.referral_partner_id)
    .maybeSingle();

  if (!partner) redirect("/?toast=no_access");

  const acknowledged =
    !!partner.ftc_acknowledged_at &&
    partner.ftc_acknowledged_version === CURRENT_FTC_POLICY_VERSION;

  return {
    supabase,
    user,
    claims,
    partner,
    acknowledged,
    policyVersion: CURRENT_FTC_POLICY_VERSION,
  };
}

export { CURRENT_FTC_POLICY_VERSION };
