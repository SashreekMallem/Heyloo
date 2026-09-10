/**
 * GoTrue (Supabase Auth) admin API — plain `fetch`, same rationale as every
 * other `providers/*.ts` module (no `@supabase/supabase-js` import from a
 * Deno edge function's dependency graph). Used by `admin`'s impersonation
 * endpoint (BACKEND_SPEC §7.7) to mint a real scoped session rather than
 * the `501` stub T3 left (BUILD_NOTES: "the Supabase Auth Admin API
 * mechanism for that needs confirming before it's wired in"). Endpoint
 * shape (`POST /auth/v1/admin/generate_link`, `apikey`+`Authorization:
 * Bearer <service-role/secret key>` headers) matches the pattern
 * `scripts/ci/rls-cross-tenant-probe.ts` (T1) already exercises against a
 * real running GoTrue instance for `/auth/v1/admin/users` — VERIFY.md:
 * confirm the exact `generate_link` request/response shape (this build's
 * environment egress-blocks supabase.com) before the first real
 * impersonation.
 */

export type SupabaseAdminFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface GenerateLinkResult {
  ok: boolean;
  status: number;
  actionLink?: string;
  hashedToken?: string;
}

/**
 * `type: "magiclink"` mints a one-time sign-in link for an existing user by
 * email — the mechanism this build uses for impersonation: the admin
 * console opens `action_link` (or exchanges `hashed_token` via `verifyOtp`)
 * to obtain a session scoped to the target tenant owner's account, with
 * `admin_actions`' `impersonate_start` row (already written by
 * `admin/handler.ts` before this call) as the audit trail of who did it and
 * when (G15).
 */
export async function generateMagicLink(
  fetchImpl: SupabaseAdminFetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
  redirectTo?: string,
): Promise<GenerateLinkResult> {
  // `redirectTo` (docs/audit/FIX_REQUESTS.md, cluster C): lets a caller
  // (e.g. `admin/handler.ts`'s impersonation route) deep-link the minted
  // session straight into `${APP_BASE_URL}/dashboard` instead of wherever
  // the project's default Site URL happens to land — optional and
  // backward-compatible, existing callers that omit it get today's
  // behavior unchanged. VERIFY (docs/VERIFY.md): `options.redirect_to` is
  // this file's own existing assumption about GoTrue's `generate_link`
  // field name (egress-blocked); unconfirmed like the rest of this
  // endpoint's shape.
  const res = await fetchImpl(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "magiclink",
      email,
      ...(redirectTo ? { options: { redirect_to: redirectTo } } : {}),
    }),
  });
  const body = (await res.json().catch(() => undefined)) as
    | {
        action_link?: string;
        properties?: { action_link?: string; hashed_token?: string };
        hashed_token?: string;
      }
    | undefined;
  const actionLink = body?.properties?.action_link ?? body?.action_link;
  const hashedToken = body?.properties?.hashed_token ?? body?.hashed_token;
  return {
    ok: res.ok,
    status: res.status,
    ...(actionLink ? { actionLink } : {}),
    ...(hashedToken ? { hashedToken } : {}),
  };
}

export interface InviteUserResult {
  ok: boolean;
  status: number;
  userId?: string;
  /** GoTrue returns 422 `email_exists` (or similar) when the email already
   * has an account — the caller decides how to handle that (e.g. add the
   * existing user straight to `memberships` instead of re-inviting). */
  alreadyExists?: boolean;
}

/**
 * FIX_REQUESTS.md — team invite. `POST {SUPABASE_URL}/auth/v1/invite`
 * (confirmed via `supabase/auth-js`'s `GoTrueAdminApi.inviteUserByEmail`
 * source — `_request(fetch, 'POST', ${url}/invite, {body: {email, data},
 * redirectTo})`, with `redirectTo` sent as a `redirect_to` query
 * parameter, same plain-fetch-not-supabase-js rationale as
 * `generateMagicLink` above). `data` carries `tenant_id`/`role` so the
 * invited user's `app_metadata`/`user_metadata` (GoTrue merges `data` into
 * `user_metadata`, not `app_metadata` — the tenant/role claim this repo's
 * Custom Access Token Hook actually reads comes from the `memberships` row
 * this function's caller inserts after a successful invite, NOT from this
 * metadata) carries enough context for the acceptance email/page; the
 * `data` payload itself is informational only, never a trust boundary.
 */
export async function inviteUser(
  fetchImpl: SupabaseAdminFetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  email: string,
  data?: Record<string, unknown>,
  redirectTo?: string,
): Promise<InviteUserResult> {
  const url = new URL(`${supabaseUrl}/auth/v1/invite`);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);

  const res = await fetchImpl(url.toString(), {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, data: data ?? {} }),
  });
  const body = (await res.json().catch(() => undefined)) as
    | { id?: string; user?: { id?: string }; error_code?: string; msg?: string; code?: number }
    | undefined;
  const userId = body?.id ?? body?.user?.id;
  const alreadyExists =
    res.status === 422 ||
    body?.error_code === "email_exists" ||
    (typeof body?.msg === "string" && /already registered|already exists/i.test(body.msg));

  return {
    ok: res.ok,
    status: res.status,
    ...(userId ? { userId } : {}),
    ...(alreadyExists ? { alreadyExists: true } : {}),
  };
}

export async function getUserEmailById(
  fetchImpl: SupabaseAdminFetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<string | null> {
  const res = await fetchImpl(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "GET",
    headers: { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => undefined)) as { email?: string } | undefined;
  return body?.email ?? null;
}
