import { NextResponse } from "next/server";
import { claimsFromUser } from "@/lib/auth/claims";
import { env } from "@/lib/env";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Generic proxy to the `/admin-*` single-function internal router
 * (BACKEND_SPEC.md §7.7 — "one function with internal path routing").
 * Forwards the caller's own access token (that edge function is
 * `verify_jwt: true` and checks `platform_admin` + AAL2 itself server-side
 * — this proxy re-checks role here too, defense in depth matching
 * FRONTEND_SPEC.md §0.1's two-guard model). `path` reconstructs
 * `admin-tenants`, `admin-cockpit/waterfall`, etc. exactly as
 * BACKEND_SPEC.md names them.
 */
async function handle(request: Request, path: string[]) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(session.user);
  if (!claims.platform_admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const target = `${env.supabaseFunctionsUrl}/${path.join("/")}${new URL(request.url).search}`;
  const init: RequestInit = {
    method: request.method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }

  const res = await fetch(target, init);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return handle(request, (await params).path);
}
export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return handle(request, (await params).path);
}
export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return handle(request, (await params).path);
}
