import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * "Manage payment method" → Stripe Billing Portal redirect (FRONTEND_SPEC.md
 * §6.9). Proxies to an edge function rather than importing the `stripe`
 * SDK here (CLAUDE.md Rule 2). VERIFY (docs/VERIFY.md): assumes an
 * `api-billing-portal` edge function — confirm the exact name once the
 * billing wave lands it.
 */
export async function POST() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // AUTH-1 fix (docs/BUILD_NOTES.md, SIGNUP-1 root cause #3): claims live
  // only in the JWT itself, never in the User/session object's
  // app_metadata; claimsFromUser(user) always evaluated to {} for a real
  // tenant/admin/partner here.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { status, body } = await callEdgeFunction<{ url?: string }>("api-billing-portal", {
    method: "POST",
    accessToken: session.access_token,
    body: { tenant_id: claims.tenant_id },
  });

  return NextResponse.json(body, { status });
}
