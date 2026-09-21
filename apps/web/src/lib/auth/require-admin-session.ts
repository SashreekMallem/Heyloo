import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { claimsFromSupabaseClient } from "./claims";

/**
 * Guard #2 for `(admin)` (FRONTEND_SPEC.md §0.1/§0.2) — platform_admin
 * claim + AAL2 step-up. `supabase.auth.mfa.getAuthenticatorAssuranceLevel()`
 * is Supabase's own built-in claim (not part of the Custom Access Token
 * Hook's `app_metadata`), set once an MFA factor is verified.
 */
export async function requireAdminSession(nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  // SIGNUP-1 fix (docs/BUILD_NOTES.md): see claims.ts's doc comment.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.platform_admin) redirect("/?toast=no_access");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const hasVerifiedFactor = (factorsData?.totp ?? []).some((f) => f.status === "verified");

  if (!hasVerifiedFactor) redirect("/mfa/enroll");
  if (aal?.currentLevel !== "aal2") redirect(`/mfa/challenge?next=${encodeURIComponent(nextPath)}`);

  return { supabase, user, claims };
}
