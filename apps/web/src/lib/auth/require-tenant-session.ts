import "server-only";

import { redirect } from "next/navigation";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { claimsFromUser } from "./claims";

/**
 * Guard #2 (the real backstop, FRONTEND_SPEC.md §0.1) for every page that
 * needs an authenticated tenant member. Redirects per the §0.2 matrix.
 * Shared by the (tenant) root layout and the signup provisioning/
 * forwarding steps, which sit outside that layout (still `(marketing)`
 * route-group-wise) but need the identical check.
 */
export async function requireTenantSession(nextPath: string) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);

  const claims = claimsFromUser(user);
  if (!claims.tenant_id) redirect("/?toast=no_access");

  const { data: tenant } = await supabase
    .from("tenants")
    .select(
      "id, name, status, vertical, business_hours, branding, manual_mode, manual_mode_enabled_at",
    )
    .eq("id", claims.tenant_id)
    .maybeSingle();

  if (!tenant) redirect("/?toast=no_access");

  return { supabase, user, claims, tenant };
}
