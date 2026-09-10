import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { decodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { buildApiCheckoutRequest } from "./build-request";

export const runtime = "nodejs";

interface ApiCheckoutResponse {
  tenant_id?: string;
  checkout_url?: string;
  error?: string;
}

/**
 * `POST /api/checkout/session` (signup step 4, FRONTEND_SPEC.md §4.4):
 * proxies to the REAL `api-checkout` edge function, which owns tenant
 * creation (see that function's handler.ts docstring — BACKEND_SPEC's
 * intended "provisioning saga creates the tenant row" ordering conflicts
 * with `webhooks-stripe`/`api-provision`'s already-built assumption that a
 * `tenants` row exists by `checkout.session.completed`, so `api-checkout`
 * is the one that creates it; the separate `/api/signup/create-tenant`
 * Route Handler that used to also create a `tenants` row has been removed
 * — E2E_FLOWS_AUDIT B1).
 *
 * Every identity-bearing field (vertical, business_name, email) is derived
 * from the signed, server-verified signup draft cookie and the caller's own
 * authenticated session — never trusted from the client-supplied request
 * body (FRONTEND_AUDIT "checkout tenant_id trust gap": there is no
 * tenant_id in this contract at all for a caller to spoof).
 *
 * VERIFY (docs/VERIFY.md): `api-checkout` has no annual/monthly billing
 * toggle yet (`CheckoutRequestSchema` doesn't accept one, and
 * `createSubscriptionCheckoutSession` only ever creates the monthly-priced
 * session) — an `annual` flag collected earlier in the wizard is accepted
 * here for forward compatibility but currently has no effect; tracked in
 * docs/BUILD_NOTES.md, out of this cluster's assigned scope.
 *
 * `white_glove` (the opt-in white-glove onboarding add-on, unlike
 * `annual`) DOES reach `api-checkout` and change what it does —
 * `CheckoutRequestSchema.white_glove` gates a real Stripe one-time line
 * item (`supabase/functions/api-checkout/handler.ts`). The tenant's choice
 * is made on the plan step (`PlanStepClient`) and carried the same way
 * `annual` already is: a `?white_glove=1` query param through to
 * `/signup/account`, then as a plain boolean in this route's own request
 * body (`AccountStepClient`'s checkout POST) — never trusted beyond that
 * boolean read here, since it only ever selects a real, admin-configured
 * price (`fees_<vertical>.white_glove_price_cents`), not an amount.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!user?.email || !session)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const cookieStore = await cookies();
  const draft = decodeSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value);
  if (!draft) return NextResponse.json({ error: "missing_draft" }, { status: 400 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const timezone =
    typeof (json as { timezone?: unknown }).timezone === "string"
      ? (json as { timezone: string }).timezone
      : undefined;
  const whiteGlove = (json as { white_glove?: unknown }).white_glove === true;

  const { status, body: result } = await callEdgeFunction<ApiCheckoutResponse>("api-checkout", {
    method: "POST",
    accessToken: session.access_token,
    body: buildApiCheckoutRequest(draft, user.email, timezone, whiteGlove),
  });

  if (status !== 200 || !result.checkout_url) {
    return NextResponse.json(
      { error: result.error ?? "checkout_failed" },
      { status: status || 502 },
    );
  }

  // The tenant + owner membership rows now exist (created service-role,
  // inside api-checkout) but this browser session's own JWT was minted
  // before they did — refresh so the Custom Access Token Hook mints a
  // fresh tenant_id/role claim before the redirect back from Stripe lands
  // on a page that needs it (FRONTEND_SPEC.md §0.1's "one claim source").
  await supabase.auth.refreshSession();
  cookieStore.delete(SIGNUP_DRAFT_COOKIE.name);

  return NextResponse.json({ url: result.checkout_url });
}
