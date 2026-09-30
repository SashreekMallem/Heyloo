import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * "Manage payment method" → Stripe Billing Portal redirect (FRONTEND_SPEC.md
 * §6.9). Proxies to an edge function rather than importing the `stripe`
 * SDK here (CLAUDE.md Rule 2). The `api-billing-portal` edge function
 * (docs/VERIFY.md) needs `STRIPE_SECRET_KEY` and a default Customer Portal
 * configuration saved once in the Stripe Dashboard.
 *
 * QA-2 F-12: whenever the function cannot answer (not deployed, so the
 * Supabase gateway answers a bare `404 NOT_FOUND`; unreachable; timing out;
 * an unexpected payload), this answers a stable `503 portal_unavailable`
 * rather than relaying the gateway's raw status/body, so the Billing page
 * always gets a code it understands and the failure is logged server-side.
 */
const PASSTHROUGH_ERRORS = new Set(["not_tenant_owner", "no_billing_account"]);
const PORTAL_TIMEOUT_MS = 10_000;

function portalUnavailable() {
  return NextResponse.json({ error: "portal_unavailable" }, { status: 503 });
}

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

  type PortalBody = { url?: string; error?: string; code?: string };
  let result: { status: number; body: PortalBody };
  try {
    result = await callEdgeFunction<PortalBody>("api-billing-portal", {
      method: "POST",
      accessToken: session.access_token,
      body: { tenant_id: claims.tenant_id },
      timeoutMs: PORTAL_TIMEOUT_MS,
    });
  } catch (err) {
    console.error("api-billing-portal unreachable", {
      tenant_id: claims.tenant_id,
      error: String(err),
    });
    return portalUnavailable();
  }

  const { status, body } = result;
  if (status >= 200 && status < 300 && typeof body.url === "string" && body.url) {
    return NextResponse.json({ url: body.url }, { status: 200 });
  }
  if (body.error && PASSTHROUGH_ERRORS.has(body.error) && status >= 400 && status < 500) {
    return NextResponse.json({ error: body.error }, { status });
  }
  console.error("api-billing-portal failed", {
    tenant_id: claims.tenant_id,
    status,
    error: body.error ?? body.code,
  });
  return portalUnavailable();
}
