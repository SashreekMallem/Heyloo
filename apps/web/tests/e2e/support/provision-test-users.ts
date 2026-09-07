/**
 * Provisions real Supabase test users + the DB rows their role's guard
 * checks for (tenant `memberships`, `platform_admins`) against a LOCAL
 * `supabase start` instance — so the authenticated Playwright specs
 * (`dashboard-realtime.spec.ts`, `admin-aal2-authenticated.spec.ts`,
 * `forwarding-wizard.spec.ts`) can drive a REAL browser login through the
 * real `/login` form (client-side `supabase.auth.signInWithPassword`,
 * `apps/web/src/app/[locale]/login/page.tsx`) rather than fabricating a
 * session cookie — `@supabase/ssr`'s cookie encoding is an internal detail
 * this repo has no business hand-rolling, and Playwright's own
 * `storageState()` mechanism exists precisely so a real login only ever
 * has to happen once per test run (see `auth.setup.ts`).
 *
 * Dependency-free by design (plain `fetch`), matching
 * `scripts/ci/rls-cross-tenant-probe.ts` and `scripts/e2e-backend.ts` — this
 * lives under `apps/web/tests/e2e/`, not `packages/`, so it must not grow a
 * new pnpm-workspace dependency either. Idempotent-ish: every run creates
 * fresh users with a timestamp-suffixed email/slug (auth users can't
 * cheaply be "found by email" without an admin list-and-filter call), so
 * re-running against a long-lived local stack just accumulates harmless
 * fixture rows — acceptable for a local/CI-only Supabase instance that gets
 * reset regularly, same accepted tradeoff `scripts/setup-stripe.ts`
 * documents for its own orphan-row case.
 *
 * Requires (see .env.example / docs/DEPLOY.md):
 *   SUPABASE_URL            local stack, e.g. http://127.0.0.1:54321
 *   SUPABASE_SECRET_KEY     service-role/secret key
 *   SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY  (only used as the PostgREST
 *                           `apikey` header on the admin-API calls below)
 */

export interface TestUser {
  email: string;
  password: string;
  userId: string;
}

function env(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v) return v;
  }
  throw new Error(
    `Missing required env var ${name} (also checked fallbacks: ${fallbacks.join(", ")}) — ` +
      "authenticated e2e specs require a local `supabase start` instance; see docs/DEPLOY.md.",
  );
}

function supabaseUrl(): string {
  return env("SUPABASE_URL").replace(/\/$/, "");
}

function serviceKey(): string {
  return env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
}

async function adminRequest(
  path: string,
  opts: { method?: string; body?: unknown; extraHeaders?: Record<string, string> } = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${supabaseUrl()}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": "application/json",
      ...(opts.extraHeaders ?? {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}Aa1!`;
}

async function createAuthUser(emailPrefix: string): Promise<TestUser> {
  const email = `${emailPrefix}-${Date.now().toString(36)}@heyloo-e2e.local`;
  const password = randomPassword();
  const { status, json } = await adminRequest("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  if (status >= 300) {
    throw new Error(`Failed to create auth user ${email} (${status}): ${JSON.stringify(json)}`);
  }
  const body = json as { id?: string; user?: { id?: string } };
  const userId = body.id ?? body.user?.id;
  if (!userId) {
    throw new Error(`Auth admin create-user response had no id: ${JSON.stringify(json)}`);
  }
  return { email, password, userId };
}

/** Tenant owner, fully provisioned (`tenants.status = 'active'`, an owner
 * `memberships` row, a phone number so `/dashboard/phone-setup` and
 * `/signup/forwarding` have something to render) — reused by
 * `dashboard-realtime.spec.ts` and `forwarding-wizard.spec.ts`. */
export async function provisionTenantOwner(): Promise<TestUser & { tenantId: string }> {
  const suffix = Date.now().toString(36);
  const tenantRes = await adminRequest("/rest/v1/tenants", {
    method: "POST",
    body: {
      name: `E2E Playwright Co ${suffix}`,
      slug: `e2e-pw-${suffix}`,
      vertical: "generic",
      business_type: "General service business",
      status: "active",
      timezone: "America/New_York",
      business_hours: {},
    },
    extraHeaders: { Prefer: "return=representation" },
  });
  if (tenantRes.status >= 300 || !Array.isArray(tenantRes.json) || tenantRes.json.length === 0) {
    throw new Error(`Failed to create fixture tenant: ${JSON.stringify(tenantRes.json)}`);
  }
  const tenantId = (tenantRes.json[0] as { id: string }).id;

  const user = await createAuthUser("tenant-owner");
  await adminRequest("/rest/v1/memberships", {
    method: "POST",
    body: { tenant_id: tenantId, user_id: user.userId, role: "owner" },
    extraHeaders: { Prefer: "return=minimal" },
  });
  await adminRequest("/rest/v1/phone_numbers", {
    method: "POST",
    body: {
      tenant_id: tenantId,
      e164: `+1555${suffix.padEnd(7, "0").slice(0, 7)}`,
      twilio_sid: `PNe2e${suffix}`,
    },
    extraHeaders: { Prefer: "return=minimal" },
  });

  return { ...user, tenantId };
}

/** Platform-admin user WITHOUT a verified MFA factor — the default state
 * for a freshly created `platform_admins` row, and the one AAL2-gate branch
 * that's actually scriptable without also programmatically enrolling and
 * verifying a real TOTP factor (see `admin-aal2-authenticated.spec.ts`'s own
 * doc comment for why the AAL1-with-a-verified-factor branch is a manual/staging check
 * instead). */
export async function provisionPlatformAdminNoMfa(): Promise<TestUser> {
  const user = await createAuthUser("platform-admin");
  await adminRequest("/rest/v1/platform_admins", {
    method: "POST",
    body: { user_id: user.userId, role: "support" },
    extraHeaders: { Prefer: "return=minimal" },
  });
  return user;
}
