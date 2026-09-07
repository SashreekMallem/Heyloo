import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/edge-functions";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Phone setup "test it" (FRONTEND_SPEC.md §6.7) — proxies to the `forwarding-verify` edge function (verify_jwt: true, so the caller's own access token is forwarded). */
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
  const body = json as { tenant_id?: string; carrier_hint?: string };
  if (!body.tenant_id) return NextResponse.json({ error: "missing_tenant_id" }, { status: 422 });

  const { status, body: result } = await callEdgeFunction("forwarding-verify", {
    method: "POST",
    accessToken: session.access_token,
    body,
  });

  return NextResponse.json(result, { status });
}
