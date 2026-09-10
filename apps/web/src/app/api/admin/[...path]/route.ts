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
 * FRONTEND_SPEC.md §0.1's two-guard model). The single deployed function
 * slug is `admin` (supabase/config.toml's `[functions.admin]`, directory
 * `supabase/functions/admin/`) — the internal route names
 * (`admin-tenants`, `admin-cockpit/waterfall`, etc.) are its FIRST PATH
 * SEGMENT, not separate function slugs, so the target URL must be
 * `.../functions/v1/admin/<internal-route>` (Supabase's function routing
 * always prefixes with the function name — see
 * supabase.com/docs/guides/functions/routing). `admin/index.ts` strips
 * that same `admin/` segment back off before dispatching.
 *
 * Impersonation cookie-fix (docs/audit/FIX_REQUESTS.md): `@supabase/ssr`
 * stores the session in one cookie per domain, not per tab, so opening the
 * admin's impersonation magic link in a new tab overwrites that cookie for
 * the whole browser. A request made afterward from either tab then
 * authenticates as the TENANT OWNER's own session — `claims.platform_admin`
 * is false — even though that same token still carries `impersonated_by`
 * (stamped only by `custom_access_token_hook` from a real, currently active
 * `impersonation_sessions` row; unforgeable by an ordinary tenant login).
 * For the two narrow self-service impersonation routes below, this proxy
 * forwards on that alternative identity too — the edge function itself
 * (`admin/handler.ts`'s `resolveImpersonationActor`) re-derives and
 * re-checks the same claim server-side and scopes every write to
 * `tenant_id` + the resolved admin's own `impersonation_sessions` row, so
 * this relaxation here is only ever a forwarding decision, never the
 * authorization decision itself.
 */
function isImpersonationSelfServicePath(path: string[]): boolean {
  return (
    path[0] === "admin-tenants" &&
    !!path[1] &&
    ((path[2] === "impersonate-end" && path[3] === undefined) ||
      (path[2] === "impersonate" && path[3] === "edit-mode" && path[4] === undefined))
  );
}

function impersonatedByClaim(user: { app_metadata?: unknown } | null | undefined): string | null {
  const appMetadata = user?.app_metadata;
  if (!appMetadata || typeof appMetadata !== "object") return null;
  const value = (appMetadata as Record<string, unknown>)["impersonated_by"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function handle(request: Request, path: string[]) {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const claims = claimsFromUser(session.user);
  const isSelfServiceImpersonation =
    request.method === "POST" &&
    isImpersonationSelfServicePath(path) &&
    impersonatedByClaim(session.user) !== null;
  if (!claims.platform_admin && !isSelfServiceImpersonation) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const target = `${env.supabaseFunctionsUrl}/admin/${path.join("/")}${new URL(request.url).search}`;
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
