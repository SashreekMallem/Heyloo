import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Phone setup "test it" (FRONTEND_SPEC.md §6.7) — proxies to the
 * `forwarding-verify` edge function (verify_jwt: true, so the caller's own
 * access token is forwarded). `tenant_id` is asserted against the caller's
 * own JWT claims, never trusted bare from the body (defense in depth
 * alongside `forwarding-verify` itself already enforcing the identical
 * check server-side — same fix pattern as the checkout seam's tenant_id
 * trust gap, FRONTEND_AUDIT).
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || !user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = json as { tenant_id?: string; carrier_hint?: string };
  if (!body.tenant_id || body.tenant_id !== claims.tenant_id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { status, body: result } = await callEdgeFunction("forwarding-verify", {
    method: "POST",
    accessToken: session.access_token,
    body,
  });

  return NextResponse.json(result, { status });
}
