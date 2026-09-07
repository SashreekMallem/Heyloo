import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface CheckoutSessionResponse {
  url?: string;
  error?: string;
}

/**
 * `POST /api/checkout/session` (FRONTEND_STACK.md/API_AND_FLOWS.md §Checkout
 * Session) — creates the Stripe Checkout Session and returns its hosted
 * URL for redirect. Proxies to an edge function rather than importing the
 * `stripe` SDK here (CLAUDE.md Rule 2 — provider SDKs only in
 * `packages/adapters/*`, none of which is `apps/web`).
 *
 * VERIFY (docs/VERIFY.md): assumes an `api-checkout-session` edge function
 * (billing wave, not yet observed in `supabase/functions/`) matching
 * `POST /v1/checkout/sessions` semantics from API_AND_FLOWS.md — confirm
 * the exact function name/path once that wave lands.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = json as { tenant_id?: string; annual?: boolean };
  if (!body.tenant_id) return NextResponse.json({ error: "missing_tenant_id" }, { status: 422 });

  const { status, body: result } = await callEdgeFunction<CheckoutSessionResponse>(
    "api-checkout-session",
    {
      method: "POST",
      accessToken: session.access_token,
      body: {
        tenant_id: body.tenant_id,
        annual: body.annual === true,
        success_url_base: `${new URL(request.url).origin}/signup/provisioning`,
        cancel_url: `${new URL(request.url).origin}/signup/plan?cancelled=true`,
      },
    },
  );

  return NextResponse.json(result, { status });
}
