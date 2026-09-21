import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { env } from "@/lib/env";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * `POST /api/tenant/agent/publish` (PUBLISH-1, docs/BUILD_NOTES.md): the
 * owner-facing "Publish changes" action. Proxies to the
 * `api-tenant-agent-publish` edge function — provider isolation (CLAUDE.md
 * Rule 2) means the actual Retell compile/create/publish calls only ever
 * happen inside `supabase/functions/**`, never here. Mirrors
 * `test-agent/web-call/route.ts`'s exact shape: no body sent at all —
 * `tenant_id` comes from the caller's own verified JWT on the OTHER side
 * of this proxy (the edge function decodes it itself), never from
 * anything this route could pass along, so there is no client-controlled
 * `tenant_id` anywhere in this path (CLAUDE.md Rule 2). Role (owner/admin)
 * is enforced by the edge function too, from the same JWT — this route
 * only needs a signed-in tenant member to reach it at all; a lesser role
 * gets the edge function's own 403 passed straight through.
 */
export async function POST() {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // AUTH-1 fix (docs/BUILD_NOTES.md): claims live only in the JWT itself,
  // never in the User/session object's app_metadata.
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const target = `${env.supabaseFunctionsUrl}/api-tenant-agent-publish`;
  try {
    const res = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`,
      },
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "publish_unavailable" }, { status: 503 });
  }
}
