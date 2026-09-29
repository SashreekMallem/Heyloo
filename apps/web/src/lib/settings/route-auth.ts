import type { SupabaseServerClient } from "@heyloo/supabase-client";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { claimsFromSupabaseClient } from "@/lib/auth/claims";
import { createSupabaseServerComponentClient } from "@/lib/supabase/server";

/**
 * SETTINGS-1: the shared guard for the owner-settings route handlers. Same
 * shape every existing `api/tenant/**` route inlines (signed-in user ->
 * AUTH-1's `claimsFromSupabaseClient` -> `tenant_id` from the JWT only,
 * never from the request), plus the owner/admin role check the matching
 * RLS policies (`tenants_update`, `agent_configs_update`) apply — without
 * it a `member`'s save is silently filtered to zero rows by RLS and the
 * route would report success for a write that never happened.
 */

export type TenantGuardResult =
  | { ok: true; supabase: SupabaseServerClient; tenantId: string }
  | { ok: false; response: NextResponse };

async function guard(requireWriter: boolean): Promise<TenantGuardResult> {
  const supabase = await createSupabaseServerComponentClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "unauthenticated" }, { status: 401 }),
    };
  }
  const claims = await claimsFromSupabaseClient(supabase);
  if (!claims.tenant_id) {
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  if (
    requireWriter &&
    claims.role !== "owner" &&
    claims.role !== "admin" &&
    claims.platform_admin !== true
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "owner_or_admin_required" }, { status: 403 }),
    };
  }
  return { ok: true, supabase, tenantId: claims.tenant_id };
}

/** Any signed-in member of a tenant (reads). */
export function requireTenantMember(): Promise<TenantGuardResult> {
  return guard(false);
}

/** Owner/admin (or an impersonating platform admin) — every settings write. */
export function requireTenantWriter(): Promise<TenantGuardResult> {
  return guard(true);
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/** JSON body -> schema, with the repo's standard 400/422 error shapes. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedBody<z.output<S>>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "invalid_request", issues: parsed.error.issues },
        { status: 422 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Read-modify-write of `agent_configs.dynamic_variable_overrides`: sibling
 * tabs own sibling keys in the same jsonb, so a save only ever touches its
 * own keys. `null` in `patch` deletes the key (how an owner clears a
 * field); `undefined` (the key was not sent) leaves it untouched.
 */
export function mergeOverrides(
  existing: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete base[key];
    else base[key] = value;
  }
  return base;
}

/**
 * Applies an RLS-scoped update and confirms a row was actually written
 * (RLS filters silently — zero rows is not an error to PostgREST).
 */
export function updateResult(result: {
  data: unknown;
  error: unknown;
}): { ok: true } | { ok: false; response: NextResponse } {
  if (result.error) {
    return { ok: false, response: NextResponse.json({ error: "update_failed" }, { status: 500 }) };
  }
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  if (rows.length === 0) {
    return { ok: false, response: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  }
  return { ok: true };
}
