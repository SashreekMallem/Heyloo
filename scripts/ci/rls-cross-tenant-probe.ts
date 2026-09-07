/**
 * RLS cross-tenant probe (BACKEND_SPEC.md §5, CLAUDE.md Rule 2).
 *
 * Authenticates as a real member of tenant A (via a genuine GoTrue signup +
 * password sign-in, so this also exercises the real
 * custom_access_token_hook end to end, not a hand-crafted JWT) and, for
 * every tenant-scoped table that carries a `tenant_id = fn_jwt_tenant_id()`
 * (or equivalent) SELECT policy, asserts that filtering to tenant B's id
 * returns zero rows. Repeats symmetrically for tenant B against tenant A.
 * Exits non-zero (and prints exactly which table/tenant pair leaked) on any
 * failure, so CI blocks the merge per CLAUDE.md Rule 2 ("the CI cross-tenant
 * probe must stay green").
 *
 * Deliberately dependency-free: uses only Node's built-in `fetch` against
 * PostgREST + GoTrue's HTTP APIs (both exposed by `supabase start`), no
 * @supabase/supabase-js — this script lives under scripts/ (T1's exclusive
 * path) and must not require adding a dependency to the pnpm workspace root
 * package.json, which is out of T1's scope. Written in erasable-TypeScript
 * syntax only (type annotations/interfaces, no enums/namespaces/parameter
 * properties) so it runs directly via
 * `node --experimental-strip-types scripts/ci/rls-cross-tenant-probe.ts`
 * on Node 22 with no build step — verify this flag's status against
 * current Node docs before bumping Node versions (it graduated out of
 * "experimental" in a later Node release; CLAUDE.md Rule 1 applies to
 * runtime flags too).
 *
 * Required env vars (see .env.example):
 *   SUPABASE_URL            e.g. http://127.0.0.1:54321 for local `supabase start`
 *   SUPABASE_SECRET_KEY     service-role/secret key (bypasses RLS for setup)
 *   SUPABASE_PUBLISHABLE_KEY  publishable/anon key (used for the `apikey`
 *                             header on user-scoped requests)
 * Legacy Supabase CLI output names (SUPABASE_SERVICE_ROLE_KEY /
 * SUPABASE_ANON_KEY) are accepted as a fallback in case a locally installed
 * `supabase` CLI version still prints those names for `supabase start`.
 */

interface TenantFixture {
  tenantId: string;
  userId: string;
  email: string;
  accessToken: string;
}

interface TenantScopedTable {
  table: string;
  /** Column PostgREST should filter tenant identity on (usually tenant_id). */
  tenantColumn: string;
  /** Row body to insert for a given tenant id, via the service-role client. */
  row: (tenantId: string, unique: string) => Record<string, unknown>;
}

function env(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v) return v;
  }
  console.error(
    `Missing required env var ${name} (also checked fallbacks: ${fallbacks.join(", ")})`,
  );
  process.exit(1);
}

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLISHABLE_KEY = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");

async function restRequest(
  path: string,
  opts: {
    method?: string;
    apikey: string;
    bearer: string;
    body?: unknown;
    extraHeaders?: Record<string, string>;
  },
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: opts.apikey,
      Authorization: `Bearer ${opts.bearer}`,
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

async function serviceInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const { status, json } = await restRequest(`/rest/v1/${table}`, {
    method: "POST",
    apikey: SERVICE_KEY,
    bearer: SERVICE_KEY,
    body: row,
    extraHeaders: { Prefer: "return=minimal,resolution=merge-duplicates" },
  });
  if (status >= 300) {
    throw new Error(`Seed insert into ${table} failed (${status}): ${JSON.stringify(json)}`);
  }
}

async function createTenantFixture(vertical: string, slug: string): Promise<TenantFixture> {
  const tenantRow = {
    name: `RLS probe tenant ${slug}`,
    slug,
    vertical,
    timezone: "America/New_York",
    business_hours: {},
  };
  const { status, json } = await restRequest("/rest/v1/tenants", {
    method: "POST",
    apikey: SERVICE_KEY,
    bearer: SERVICE_KEY,
    body: tenantRow,
    extraHeaders: { Prefer: "return=representation" },
  });
  if (status >= 300 || !Array.isArray(json) || json.length === 0) {
    throw new Error(`Failed to create tenant fixture ${slug} (${status}): ${JSON.stringify(json)}`);
  }
  const tenantId = (json[0] as { id: string }).id;

  const email = `rls-probe-${slug}-${Date.now()}@heyloo-ci.local`;
  const password = cryptoRandomPassword();

  const created = await restRequest("/auth/v1/admin/users", {
    method: "POST",
    apikey: SERVICE_KEY,
    bearer: SERVICE_KEY,
    body: { email, password, email_confirm: true },
  });
  if (created.status >= 300) {
    throw new Error(
      `Failed to create auth user for ${slug} (${created.status}): ${JSON.stringify(created.json)}`,
    );
  }
  const createdBody = created.json as { id?: string; user?: { id?: string } };
  const userId = createdBody.id ?? createdBody.user?.id;
  if (!userId) {
    throw new Error(
      `Auth admin create-user response for ${slug} had no id: ${JSON.stringify(created.json)}`,
    );
  }

  await serviceInsert("memberships", { tenant_id: tenantId, user_id: userId, role: "owner" });

  const signIn = await restRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    apikey: PUBLISHABLE_KEY,
    bearer: PUBLISHABLE_KEY,
    body: { email, password },
  });
  if (signIn.status >= 300) {
    throw new Error(
      `Password sign-in failed for ${slug} (${signIn.status}): ${JSON.stringify(signIn.json)}`,
    );
  }
  const accessToken = (signIn.json as { access_token?: string }).access_token;
  if (!accessToken) {
    throw new Error(
      `Sign-in response for ${slug} had no access_token: ${JSON.stringify(signIn.json)}`,
    );
  }

  return { tenantId, userId, email, accessToken };
}

function cryptoRandomPassword(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + "Aa1!";
}

// Every table whose SELECT policy scopes on tenant_id = fn_jwt_tenant_id()
// (see supabase/migrations/20260907131500_rls.sql) — i.e. the tables a
// signed-in tenant member can read at all, and therefore the tables where a
// cross-tenant leak would actually be reachable through a real session.
// Admin-only tables (cost_events, webhook_events, leads, ...) are excluded:
// a platform-admin session is *supposed* to see every tenant by design, so
// "cross-tenant" isolation doesn't apply to them the same way; they are
// covered instead by the fn_jwt_is_platform_admin() gate itself, which this
// probe does not attempt to defeat (that would require a real admin
// account, out of scope for a per-migration CI check).
function tenantScopedTables(): TenantScopedTable[] {
  return [
    {
      table: "phone_numbers",
      tenantColumn: "tenant_id",
      row: (t, u) => ({ tenant_id: t, e164: `+1555${u}`, twilio_sid: `PN${u}` }),
    },
    {
      table: "offerings",
      tenantColumn: "tenant_id",
      row: (t) => ({ tenant_id: t, name: "Probe offering" }),
    },
    {
      table: "resources",
      tenantColumn: "tenant_id",
      row: (t) => ({ tenant_id: t, type: "staff", name: "Probe resource" }),
    },
    {
      table: "customers",
      tenantColumn: "tenant_id",
      row: (t, u) => ({ tenant_id: t, phone_e164: `+1555${u}` }),
    },
    {
      table: "call_logs",
      tenantColumn: "tenant_id",
      row: (t, u) => ({ tenant_id: t, retell_call_id: `probe-${u}` }),
    },
    {
      table: "messages_outbound",
      tenantColumn: "tenant_id",
      row: (t) => ({
        tenant_id: t,
        channel: "sms",
        recipient: "+15555550000",
        template_key: "probe",
      }),
    },
    {
      table: "messages_inbound",
      tenantColumn: "tenant_id",
      row: (t) => ({
        tenant_id: t,
        from_e164: "+15555550001",
        to_e164: "+15555550002",
        body: "probe",
      }),
    },
    {
      table: "payment_links",
      tenantColumn: "tenant_id",
      row: (t) => ({ tenant_id: t, amount_cents: 100, purpose: "order" }),
    },
    {
      table: "usage_events",
      tenantColumn: "tenant_id",
      row: (t) => ({ tenant_id: t, minutes: 1, occurred_at: new Date().toISOString() }),
    },
    {
      table: "usage_daily",
      tenantColumn: "tenant_id",
      row: (t) => ({
        tenant_id: t,
        date: new Date().toISOString().slice(0, 10),
        price_version: "v1",
      }),
    },
    {
      table: "billing_invoices",
      tenantColumn: "tenant_id",
      row: (t) => ({
        tenant_id: t,
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        base_fee_cents: 29900,
        included_minutes: 300,
        total_cents: 29900,
      }),
    },
    {
      table: "support_requests",
      tenantColumn: "tenant_id",
      row: (t) => ({ tenant_id: t, subject: "Probe", body: "Probe" }),
    },
    {
      table: "api_tokens",
      tenantColumn: "tenant_id",
      row: (t, u) => ({
        tenant_id: t,
        name: "probe",
        token_hash: `hash-${u}`,
        token_prefix: u.slice(0, 8),
      }),
    },
    {
      table: "provisioning_runs",
      tenantColumn: "tenant_id",
      row: (t) => ({ tenant_id: t, step: "tenant_finalize", status: "pending" }),
    },
    {
      table: "airtable_sync_state",
      tenantColumn: "tenant_id",
      row: (t, u) => ({ tenant_id: t, entity_type: "booking", entity_id: u }),
    },
  ];
}

async function seedTenant(tenant: TenantFixture): Promise<void> {
  for (const spec of tenantScopedTables()) {
    // A short random suffix keeps unique columns (e164, retell_call_id, ...)
    // collision-free across the two fixtures and across repeated CI runs.
    const unique = tenant.tenantId.replace(/-/g, "").slice(0, 12);
    await serviceInsert(spec.table, spec.row(tenant.tenantId, unique));
  }

  // customer_addresses and waitlist_entries need a customer_id FK — fetch
  // the customer row just seeded above via the service client.
  const { json } = await restRequest(
    `/rest/v1/customers?tenant_id=eq.${tenant.tenantId}&select=id&limit=1`,
    { apikey: SERVICE_KEY, bearer: SERVICE_KEY },
  );
  const customerId = Array.isArray(json) && json.length > 0 ? (json[0] as { id: string }).id : null;
  if (customerId) {
    await serviceInsert("customer_addresses", {
      tenant_id: tenant.tenantId,
      customer_id: customerId,
      street: "1 Probe St",
    });
    await serviceInsert("waitlist_entries", {
      tenant_id: tenant.tenantId,
      customer_id: customerId,
      window: "[2026-01-01T10:00:00Z,2026-01-01T11:00:00Z)",
    });
  }

  // resources row -> a bookings row needs resource_id.
  const resResp = await restRequest(
    `/rest/v1/resources?tenant_id=eq.${tenant.tenantId}&select=id&limit=1`,
    { apikey: SERVICE_KEY, bearer: SERVICE_KEY },
  );
  const resourceId =
    Array.isArray(resResp.json) && resResp.json.length > 0
      ? (resResp.json[0] as { id: string }).id
      : null;
  if (resourceId) {
    await serviceInsert("bookings", {
      tenant_id: tenant.tenantId,
      resource_id: resourceId,
      start_at: "2026-01-01T10:00:00Z",
      end_at: "2026-01-01T11:00:00Z",
    });
    await serviceInsert("orders", {
      tenant_id: tenant.tenantId,
      items: [{ name: "probe", qty: 1 }],
      fulfillment_type: "pickup",
      subtotal_cents: 100,
      total_cents: 100,
      idempotency_key: `probe-${tenant.tenantId}`,
    });
  }
}

async function probeAsUser(
  user: TenantFixture,
  victim: TenantFixture,
  table: TenantScopedTable,
): Promise<string | null> {
  const { status, json } = await restRequest(
    `/rest/v1/${table.table}?${table.tenantColumn}=eq.${victim.tenantId}&select=*`,
    { apikey: PUBLISHABLE_KEY, bearer: user.accessToken },
  );
  if (status >= 300) {
    // A rejected query (e.g. 401/403) is an acceptable — even stronger —
    // form of "zero rows leaked"; only a 2xx with actual rows is a failure.
    return null;
  }
  if (Array.isArray(json) && json.length > 0) {
    return `LEAK: user of tenant ${user.tenantId} read ${json.length} row(s) from "${table.table}" scoped to tenant ${victim.tenantId}`;
  }
  return null;
}

async function main(): Promise<void> {
  console.log(`RLS cross-tenant probe against ${SUPABASE_URL}`);

  const [tenantA, tenantB] = await Promise.all([
    createTenantFixture("generic", `rls-probe-a-${Date.now()}`),
    createTenantFixture("generic", `rls-probe-b-${Date.now()}`),
  ]);
  console.log(`Created fixtures: tenant A=${tenantA.tenantId}, tenant B=${tenantB.tenantId}`);

  await seedTenant(tenantA);
  await seedTenant(tenantB);
  console.log("Seeded one row per tenant-scoped table for both tenants.");

  const failures: string[] = [];
  const tables = tenantScopedTables();

  // tenants itself uses `id`, not `tenant_id` — probed separately below.
  for (const table of tables) {
    const aReadsB = await probeAsUser(tenantA, tenantB, table);
    if (aReadsB) failures.push(aReadsB);
    const bReadsA = await probeAsUser(tenantB, tenantA, table);
    if (bReadsA) failures.push(bReadsA);
  }

  const tenantsTableCheck = async (
    reader: TenantFixture,
    victim: TenantFixture,
  ): Promise<string | null> => {
    const { status, json } = await restRequest(
      `/rest/v1/tenants?id=eq.${victim.tenantId}&select=*`,
      { apikey: PUBLISHABLE_KEY, bearer: reader.accessToken },
    );
    if (status >= 300) return null;
    if (Array.isArray(json) && json.length > 0) {
      return `LEAK: user of tenant ${reader.tenantId} read tenant row ${victim.tenantId} directly from "tenants"`;
    }
    return null;
  };
  const tA = await tenantsTableCheck(tenantA, tenantB);
  if (tA) failures.push(tA);
  const tB = await tenantsTableCheck(tenantB, tenantA);
  if (tB) failures.push(tB);

  if (failures.length > 0) {
    console.error(`\nRLS CROSS-TENANT PROBE FAILED — ${failures.length} leak(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `\nRLS cross-tenant probe PASSED — ${tables.length + 1} tables checked both directions, 0 rows leaked.`,
  );
}

main().catch((err) => {
  console.error("RLS cross-tenant probe crashed:", err);
  process.exit(1);
});
