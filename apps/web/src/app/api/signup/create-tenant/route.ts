import type { Vertical } from "@heyloo/canonical-types";
import { VERTICAL_TO_DB_VALUE } from "@heyloo/supabase-client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { decodeSignupDraft, SIGNUP_DRAFT_COOKIE } from "@/lib/signup/draft-cookie";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";

/**
 * Signup step 3 (FRONTEND_SPEC.md §4.3): creates the `tenants` row
 * (`status='trialing'`, RLS blocks client inserts — service_role only, per
 * `supabase/migrations/20260907131500_rls.sql`) and the owner
 * `memberships` row (same reason: a brand-new user has no `tenant_id`
 * claim yet to satisfy the client-side membership policy). Runs AFTER
 * `auth.signUp` on the client, using the just-created session to identify
 * the user server-side.
 */
export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = json as { annual?: boolean };

  const sessionClient = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const draft = decodeSignupDraft(cookieStore.get(SIGNUP_DRAFT_COOKIE.name)?.value);
  if (!draft) {
    return NextResponse.json({ error: "missing_draft" }, { status: 400 });
  }

  const vertical = VERTICAL_TO_DB_VALUE[draft.business_type as Vertical] ?? "generic";
  const service = createSupabaseServiceRoleServerClient();

  const { data: tenant, error: tenantError } = await service
    .from("tenants")
    .insert({
      name: draft.business_name,
      slug: slugify(draft.business_name),
      vertical,
      business_type: draft.business_type,
      status: "trialing",
      price_version: "v1",
      avg_transaction_value_cents: 0,
    })
    .select("id")
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: "tenant_create_failed" }, { status: 500 });
  }

  const { error: membershipError } = await service.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: user.id,
    role: "owner",
    accepted_at: new Date().toISOString(),
  });
  if (membershipError) {
    return NextResponse.json({ error: "membership_create_failed" }, { status: 500 });
  }

  // Force the session to pick up the new tenant_id/role claims the Custom
  // Access Token Hook will now set on the next mint (FRONTEND_SPEC.md
  // §0.1's "one claim source" model — the guard needs a fresh token).
  await sessionClient.auth.refreshSession();

  cookieStore.delete(SIGNUP_DRAFT_COOKIE.name);

  return NextResponse.json({ tenant_id: tenant.id, annual: body.annual === true });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "business"}-${Math.random().toString(36).slice(2, 8)}`;
}
