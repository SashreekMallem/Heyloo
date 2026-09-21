import { NextResponse } from "next/server";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { env } from "@/lib/env";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Web-call test (Cluster H task brief item 2). Proxies to the
 * `api-tenant-test-call` edge function — provider isolation (CLAUDE.md
 * Rule 2) means a Retell web-call session can only be created from inside
 * `supabase/functions/**`/`packages/adapters/retell`, neither of which is
 * in this cluster's file ownership (only `apps/web/**` is). The edge
 * function (`supabase/functions/api-tenant-test-call/{index,handler}.ts`)
 * resolves the caller's own published `agent_configs.retell_agent_id` and
 * returns `{access_token, call_id}` on success; the frontend
 * (`test-agent-client.tsx`'s `startWebCall`) consumes that token with
 * `retell-client-js-sdk`'s `RetellWebClient` to establish the browser
 * audio session, same pattern as the pre-signup demo flow
 * (`components/demo/demo-flow.tsx`). This route degrades honestly when the
 * edge function is unreachable or returns a non-2xx status: a real error
 * the UI shows as "not available yet", never a fabricated success.
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

  const target = `${env.supabaseFunctionsUrl}/api-tenant-test-call`;
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
    return NextResponse.json({ error: "web_call_unavailable" }, { status: 503 });
  }
}
