import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Payment-link resend (MASTER_SPEC.md §3.2/§3.10). A Stripe Checkout
 * Session's own `url` isn't retrievable again after creation through a
 * public re-fetch, and the session expires by default — so "resend" means
 * minting a fresh Checkout Session for the same amount/purpose/order/
 * booking and re-enqueueing the SMS, exactly the shape
 * `voice-tools/tools/send_payment_link.ts` already writes for the initial
 * send. That Stripe-touching + `messages_outbound` enqueue step has to
 * happen in an edge function, not here (CLAUDE.md Rule 2 provider
 * isolation — nothing outside `packages/adapters/*`/the Deno functions may
 * import a provider SDK), so this Route Handler only verifies the caller
 * owns the `payment_links` row, then proxies — same pattern as
 * `/api/billing/portal`. `supabase/functions/api-payment-link-resend`
 * (docs/audit/FIX_REQUESTS.md) now implements this exact contract.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const { data: link, error: fetchError } = await supabase
    .from("payment_links")
    .select("id, status")
    .eq("id", id)
    .eq("tenant_id", claims.tenant_id)
    .maybeSingle();
  if (fetchError || !link) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (link.status === "paid") {
    return NextResponse.json({ error: "already_paid" }, { status: 409 });
  }

  const { status, body } = await callEdgeFunction<{ ok?: boolean; error?: string }>(
    "api-payment-link-resend",
    {
      method: "POST",
      accessToken: session.access_token,
      body: { tenant_id: claims.tenant_id, payment_link_id: id },
    },
  );

  return NextResponse.json(body, { status });
}
