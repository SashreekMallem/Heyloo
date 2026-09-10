import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { env } from "@/lib/env";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Team invite (docs/audit/FIX_REQUESTS.md — "team-invite UI/backend
 * needed for a real 'Invite your team' setup-progress action"). Proxies
 * to `api-team-invite` — minting an auth user via GoTrue's admin API can
 * only happen from a service-role context (CLAUDE.md Rule 2), never
 * `apps/web` directly. Same forward-the-caller's-own-bearer-token pattern
 * as `api/tenant/test-agent/web-call/route.ts`; the edge function itself
 * re-derives tenant_id/caller user id from that same JWT and independently
 * checks the caller's `memberships.role` is 'owner'.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(session.user);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const target = `${env.supabaseFunctionsUrl}/api-team-invite`;
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(json),
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "invite_unavailable" }, { status: 503 });
  }
}
