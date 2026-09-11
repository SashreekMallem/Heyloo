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
 * Also probes every admin-only VIEW (v_tenant_margin, v_call_cost_vs_
 * billed, v_usage_alerts, v_referral_pnl) as both anon and an authenticated
 * tenant member, asserting neither ever gets a 2xx response carrying rows
 * back (DB_AUDIT.md DB-B1 — a view without `security_invoker` silently
 * bypasses the underlying tables' RLS, which base-table probing alone can
 * never catch since it never queries the view itself).
 *
 * Also probes the bookings/orders WRITE-path RLS hardening (DB_AUDIT.md
 * DB-H1, fixed in supabase/migrations/20260910090000_view_security_and_
 * write_rls_hardening.sql): as an authenticated member of tenant A, attempts
 * an INSERT (and, separately, an UPDATE of an existing tenant-A row) whose
 * own `tenant_id` is genuinely tenant A's but whose `resource_id`/
 * `offering_id`/`customer_id` (or, for orders, an `items[].offering_id`)
 * points at a row actually owned by tenant B. `tenant_id = fn_jwt_tenant_id()`
 * alone can never catch this — it only constrains the row's own tenant_id
 * column — so this exercises the EXISTS-based WITH CHECK ownership guards
 * added by that migration specifically, which the SELECT-only probing above
 * cannot reach. Every case must be rejected (a non-2xx status); a 2xx
 * response is a DB-H1 regression.
 *
 * Also probes the impersonation server-enforced boundary (repair task:
 * "Impersonation end-to-end ... read-only/edit toggle enforced",
 * supabase/migrations/20260910110000_impersonation_claim.sql): seeds a real
 * `impersonation_sessions` row (`edit_enabled: false`) for tenant A's own
 * seeded user, re-authenticates as that user (a fresh password grant so
 * `custom_access_token_hook` actually runs again and stamps the new
 * `impersonated_by`/`impersonation_edit_enabled` claims), and attempts a
 * bookings INSERT — this must be REJECTED even though the session's
 * tenant_id/role claims are otherwise perfectly valid for that tenant, since
 * this is exactly the case FRONTEND_AUDIT.md's original gap named ("the
 * impersonated session carries the same claims as the owner's normal
 * login"). Then flips `edit_enabled` to true, re-authenticates again, and
 * the identical write must now be ACCEPTED — proving the RLS check reads
 * the live claim rather than always denying impersonated sessions outright.
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
  password: string;
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

  return { tenantId, userId, email, password, accessToken };
}

/** Fresh password grant for a fixture already created by createTenantFixture
 * — used by the impersonation probe to force `custom_access_token_hook` to
 * re-run and pick up an `impersonation_sessions` change made in between. */
async function reSignIn(fixture: TenantFixture): Promise<string> {
  const signIn = await restRequest("/auth/v1/token?grant_type=password", {
    method: "POST",
    apikey: PUBLISHABLE_KEY,
    bearer: PUBLISHABLE_KEY,
    body: { email: fixture.email, password: fixture.password },
  });
  if (signIn.status >= 300) {
    throw new Error(
      `Re-sign-in failed for ${fixture.email} (${signIn.status}): ${JSON.stringify(signIn.json)}`,
    );
  }
  const accessToken = (signIn.json as { access_token?: string }).access_token;
  if (!accessToken) {
    throw new Error(`Re-sign-in response for ${fixture.email} had no access_token`);
  }
  return accessToken;
}

function cryptoRandomPassword(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}Aa1!`;
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
    {
      // Channels (BACKEND_SPEC §13, 20260911120000_text_conversations.sql —
      // Cluster T's text-agent engine schema, per docs/audit/
      // CHANNELS_REQUESTS.md item 1's resolution). text_conversation_
      // messages depends on a conversation_id FK so it can't be a plain
      // entry here — it's seeded/probed separately in seedTenant()/main()
      // below, same pattern customer_addresses/waitlist_entries already
      // use for their customer_id dependency.
      table: "text_conversations",
      tenantColumn: "tenant_id",
      row: (t, u) => ({ tenant_id: t, phone_e164: `+1555${u}`, channel: "sms" }),
    },
  ];
}

// Additional ids fetched after seeding, used only by the DB-H1 write-path
// probes below (probeWriteRejected / writeProbeCases) to build cross-tenant
// resource_id/offering_id/customer_id references. Every field is required —
// seedTenant throws if any expected row is missing rather than letting a
// write probe silently no-op against an empty/undefined id.
interface WriteProbeFixture {
  resourceId: string;
  offeringId: string;
  customerId: string;
  bookingId: string;
  orderId: string;
}

type SeededTenant = TenantFixture & WriteProbeFixture;

async function fetchOneId(table: string, tenantId: string): Promise<string | null> {
  const { json } = await restRequest(
    `/rest/v1/${table}?tenant_id=eq.${tenantId}&select=id&limit=1`,
    { apikey: SERVICE_KEY, bearer: SERVICE_KEY },
  );
  return Array.isArray(json) && json.length > 0 ? (json[0] as { id: string }).id : null;
}

async function seedTenant(tenant: TenantFixture): Promise<WriteProbeFixture> {
  for (const spec of tenantScopedTables()) {
    // A short random suffix keeps unique columns (e164, retell_call_id, ...)
    // collision-free across the two fixtures and across repeated CI runs.
    const unique = tenant.tenantId.replace(/-/g, "").slice(0, 12);
    await serviceInsert(spec.table, spec.row(tenant.tenantId, unique));
  }

  // customer_addresses and waitlist_entries need a customer_id FK — fetch
  // the customer row just seeded above via the service client.
  const customerId = await fetchOneId("customers", tenant.tenantId);
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

  // text_conversation_messages needs a text_conversations row (seeded
  // above via tenantScopedTables()) to reference via conversation_id.
  // (Was `text_messages` — that table was Cluster S's own text_
  // conversations/text_messages design, superseded by Cluster T's
  // text-agent engine; see docs/audit/CHANNELS_REQUESTS.md item 1 and
  // 20260911100000_channels_text_conversations.sql's updated header.)
  const conversationId = await fetchOneId("text_conversations", tenant.tenantId);
  if (conversationId) {
    await serviceInsert("text_conversation_messages", {
      tenant_id: tenant.tenantId,
      conversation_id: conversationId,
      author: "ai",
      body: "probe",
    });
  }

  // resources row -> a bookings row needs resource_id.
  const resourceId = await fetchOneId("resources", tenant.tenantId);
  let bookingId: string | null = null;
  let orderId: string | null = null;
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
    bookingId = await fetchOneId("bookings", tenant.tenantId);
    orderId = await fetchOneId("orders", tenant.tenantId);
  }

  // offerings is already seeded once per tenant via tenantScopedTables()
  // above (DB_AUDIT.md DB-H1 needs a real cross-tenant offering_id to probe
  // with, both directly on bookings and embedded in orders.items[]).
  const offeringId = await fetchOneId("offerings", tenant.tenantId);

  if (!resourceId || !offeringId || !customerId || !bookingId || !orderId) {
    throw new Error(
      `seedTenant(${tenant.tenantId}) could not resolve every DB-H1 write-probe fixture id ` +
        `(resourceId=${resourceId}, offeringId=${offeringId}, customerId=${customerId}, ` +
        `bookingId=${bookingId}, orderId=${orderId})`,
    );
  }

  return { resourceId, offeringId, customerId, bookingId, orderId };
}

// DB_AUDIT.md DB-B1: these four views previously leaked every tenant's
// revenue/cost/margin/referral-commission data to anon and authenticated
// (owner-privileges view bypassing the underlying tables' RLS entirely —
// see supabase/migrations/20260910090000_view_security_and_write_rls_
// hardening.sql). Admin-cockpit-only: neither anon nor an authenticated
// tenant member should ever get a 2xx response carrying rows back, however
// many rows exist in the underlying tables — a rejected query (401/403,
// the expected post-fix shape since these views are now revoked from both
// roles entirely) or an empty 2xx are both acceptable; only a 2xx with rows
// is a regression of DB-B1.
const ADMIN_ONLY_VIEWS = [
  "v_tenant_margin",
  "v_call_cost_vs_billed",
  "v_usage_alerts",
  "v_referral_pnl",
];

async function probeViewLeak(
  roleLabel: string,
  apikey: string,
  bearer: string,
  view: string,
): Promise<string | null> {
  const { status, json } = await restRequest(`/rest/v1/${view}?select=*`, { apikey, bearer });
  if (status >= 300) return null;
  if (Array.isArray(json) && json.length > 0) {
    return `LEAK: ${roleLabel} read ${json.length} row(s) from admin-only view "${view}" (DB_AUDIT.md DB-B1 regression)`;
  }
  return null;
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

// DB_AUDIT.md DB-H1 write-path probes (supabase/migrations/20260910090000_
// view_security_and_write_rls_hardening.sql). Each case is issued as the
// ATTACKER tenant's own authenticated user, with the row's own tenant_id set
// correctly to the attacker's tenant — the only cross-tenant thing in the
// request body is a resource_id/offering_id/customer_id/items[].offering_id
// that resolves to a row owned by the VICTIM tenant. Every case must be
// rejected; a 2xx response means the WITH CHECK ownership guard regressed.
interface WriteProbeCase {
  label: string;
  method: "POST" | "PATCH";
  path: (attacker: SeededTenant) => string;
  body: (attacker: SeededTenant, victim: SeededTenant) => Record<string, unknown>;
}

function writeProbeCases(): WriteProbeCase[] {
  return [
    {
      label: "bookings insert: resource_id points at victim tenant",
      method: "POST",
      path: () => "/rest/v1/bookings",
      body: (attacker, victim) => ({
        tenant_id: attacker.tenantId,
        resource_id: victim.resourceId,
        start_at: "2026-02-01T10:00:00Z",
        end_at: "2026-02-01T11:00:00Z",
      }),
    },
    {
      label: "bookings insert: offering_id points at victim tenant",
      method: "POST",
      path: () => "/rest/v1/bookings",
      body: (attacker, victim) => ({
        tenant_id: attacker.tenantId,
        resource_id: attacker.resourceId,
        offering_id: victim.offeringId,
        start_at: "2026-02-01T12:00:00Z",
        end_at: "2026-02-01T13:00:00Z",
      }),
    },
    {
      label: "bookings insert: customer_id points at victim tenant",
      method: "POST",
      path: () => "/rest/v1/bookings",
      body: (attacker, victim) => ({
        tenant_id: attacker.tenantId,
        resource_id: attacker.resourceId,
        customer_id: victim.customerId,
        start_at: "2026-02-01T14:00:00Z",
        end_at: "2026-02-01T15:00:00Z",
      }),
    },
    {
      label: "orders insert: customer_id points at victim tenant",
      method: "POST",
      path: () => "/rest/v1/orders",
      body: (attacker, victim) => ({
        tenant_id: attacker.tenantId,
        customer_id: victim.customerId,
        items: [{ name: "probe", qty: 1 }],
        fulfillment_type: "pickup",
        subtotal_cents: 100,
        total_cents: 100,
        idempotency_key: `write-probe-customer-${attacker.tenantId}`,
      }),
    },
    {
      label: "orders insert: items[].offering_id points at victim tenant",
      method: "POST",
      path: () => "/rest/v1/orders",
      body: (attacker, victim) => ({
        tenant_id: attacker.tenantId,
        items: [{ offering_id: victim.offeringId, name: "probe", qty: 1 }],
        fulfillment_type: "pickup",
        subtotal_cents: 100,
        total_cents: 100,
        idempotency_key: `write-probe-offering-${attacker.tenantId}`,
      }),
    },
    {
      label: "bookings update: repoints resource_id at victim tenant",
      method: "PATCH",
      path: (attacker) => `/rest/v1/bookings?id=eq.${attacker.bookingId}`,
      body: (_attacker, victim) => ({ resource_id: victim.resourceId }),
    },
    {
      label: "bookings update: repoints offering_id at victim tenant",
      method: "PATCH",
      path: (attacker) => `/rest/v1/bookings?id=eq.${attacker.bookingId}`,
      body: (_attacker, victim) => ({ offering_id: victim.offeringId }),
    },
    {
      label: "bookings update: repoints customer_id at victim tenant",
      method: "PATCH",
      path: (attacker) => `/rest/v1/bookings?id=eq.${attacker.bookingId}`,
      body: (_attacker, victim) => ({ customer_id: victim.customerId }),
    },
    {
      label: "orders update: repoints customer_id at victim tenant",
      method: "PATCH",
      path: (attacker) => `/rest/v1/orders?id=eq.${attacker.orderId}`,
      body: (_attacker, victim) => ({ customer_id: victim.customerId }),
    },
    {
      label: "orders update: repoints items[].offering_id at victim tenant",
      method: "PATCH",
      path: (attacker) => `/rest/v1/orders?id=eq.${attacker.orderId}`,
      body: (_attacker, victim) => ({
        items: [{ offering_id: victim.offeringId, name: "probe", qty: 1 }],
      }),
    },
  ];
}

async function probeWriteRejected(
  attacker: SeededTenant,
  victim: SeededTenant,
  testCase: WriteProbeCase,
): Promise<string | null> {
  const { status, json } = await restRequest(testCase.path(attacker), {
    method: testCase.method,
    apikey: PUBLISHABLE_KEY,
    bearer: attacker.accessToken,
    body: testCase.body(attacker, victim),
    extraHeaders: { Prefer: "return=minimal" },
  });
  if (status >= 200 && status < 300) {
    return (
      `DB-H1 REGRESSION: tenant ${attacker.tenantId} ${testCase.method} "${testCase.label}" ` +
      `(victim tenant ${victim.tenantId}) was ACCEPTED (status ${status}) — the WITH CHECK ` +
      `ownership guard failed to reject a cross-tenant reference. Response: ${JSON.stringify(json)}`
    );
  }
  return null;
}

// Impersonation server-enforced boundary (see this file's header comment).
// `adminUserId` only needs to satisfy impersonation_sessions.admin_user_id's
// FK to auth.users — the OTHER seeded tenant's own user id is a convenient
// already-existing real user, not otherwise meaningful to this probe.
async function probeImpersonationEnforcement(
  tenant: SeededTenant,
  adminUserId: string,
): Promise<string[]> {
  const failures: string[] = [];
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

  await serviceInsert("impersonation_sessions", {
    tenant_id: tenant.tenantId,
    admin_user_id: adminUserId,
    target_user_id: tenant.userId,
    edit_enabled: false,
    reason: "ci-probe",
    expires_at: expiresAt,
  });

  const readOnlyToken = await reSignIn(tenant);
  const readOnlyAttempt = await restRequest("/rest/v1/bookings", {
    method: "POST",
    apikey: PUBLISHABLE_KEY,
    bearer: readOnlyToken,
    body: {
      tenant_id: tenant.tenantId,
      resource_id: tenant.resourceId,
      start_at: "2026-03-01T10:00:00Z",
      end_at: "2026-03-01T11:00:00Z",
    },
    extraHeaders: { Prefer: "return=minimal" },
  });
  if (readOnlyAttempt.status >= 200 && readOnlyAttempt.status < 300) {
    failures.push(
      `IMPERSONATION REGRESSION: a read-only impersonated session for tenant ${tenant.tenantId} ` +
        `was able to INSERT a booking (status ${readOnlyAttempt.status}) — the ` +
        `"not fn_jwt_is_impersonating() or fn_jwt_impersonation_edit_enabled()" WITH CHECK guard failed.`,
    );
  }

  const editEnable = await restRequest(
    `/rest/v1/impersonation_sessions?tenant_id=eq.${tenant.tenantId}&admin_user_id=eq.${adminUserId}&ended_at=is.null`,
    {
      method: "PATCH",
      apikey: SERVICE_KEY,
      bearer: SERVICE_KEY,
      body: { edit_enabled: true },
      extraHeaders: { Prefer: "return=minimal" },
    },
  );
  if (editEnable.status >= 300) {
    throw new Error(
      `Failed to flip edit_enabled=true on the CI probe's impersonation_sessions row ` +
        `(${editEnable.status}): ${JSON.stringify(editEnable.json)}`,
    );
  }

  const editEnabledToken = await reSignIn(tenant);
  const editEnabledAttempt = await restRequest("/rest/v1/bookings", {
    method: "POST",
    apikey: PUBLISHABLE_KEY,
    bearer: editEnabledToken,
    body: {
      tenant_id: tenant.tenantId,
      resource_id: tenant.resourceId,
      start_at: "2026-03-01T12:00:00Z",
      end_at: "2026-03-01T13:00:00Z",
    },
    extraHeaders: { Prefer: "return=minimal" },
  });
  if (editEnabledAttempt.status < 200 || editEnabledAttempt.status >= 300) {
    failures.push(
      `IMPERSONATION REGRESSION: an edit-enabled impersonated session for tenant ${tenant.tenantId} ` +
        `was REJECTED inserting a booking (status ${editEnabledAttempt.status}): ` +
        `${JSON.stringify(editEnabledAttempt.json)}`,
    );
  }

  // Tidy up so this fixture's session can't outlive the CI run in spirit,
  // even though the local `supabase start` database is thrown away after —
  // mirrors what the real impersonate-end route does.
  await restRequest(
    `/rest/v1/impersonation_sessions?tenant_id=eq.${tenant.tenantId}&admin_user_id=eq.${adminUserId}&ended_at=is.null`,
    {
      method: "PATCH",
      apikey: SERVICE_KEY,
      bearer: SERVICE_KEY,
      body: { ended_at: new Date().toISOString() },
      extraHeaders: { Prefer: "return=minimal" },
    },
  );

  return failures;
}

async function main(): Promise<void> {
  console.log(`RLS cross-tenant probe against ${SUPABASE_URL}`);

  const [tenantA, tenantB] = await Promise.all([
    createTenantFixture("generic", `rls-probe-a-${Date.now()}`),
    createTenantFixture("generic", `rls-probe-b-${Date.now()}`),
  ]);
  console.log(`Created fixtures: tenant A=${tenantA.tenantId}, tenant B=${tenantB.tenantId}`);

  const seedFixtureA = await seedTenant(tenantA);
  const seedFixtureB = await seedTenant(tenantB);
  const seededTenantA: SeededTenant = { ...tenantA, ...seedFixtureA };
  const seededTenantB: SeededTenant = { ...tenantB, ...seedFixtureB };
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

  // text_conversation_messages (dependent on text_conversations, seeded
  // separately in seedTenant() above) — probed here the same way every
  // plain tenantScopedTables() entry is, via the same probeAsUser()
  // helper; row() is never called for a probe, only for seeding, so a
  // no-op stub is fine.
  const textMessagesTable: TenantScopedTable = {
    table: "text_conversation_messages",
    tenantColumn: "tenant_id",
    row: () => ({}),
  };
  const aReadsBMsgs = await probeAsUser(tenantA, tenantB, textMessagesTable);
  if (aReadsBMsgs) failures.push(aReadsBMsgs);
  const bReadsAMsgs = await probeAsUser(tenantB, tenantA, textMessagesTable);
  if (bReadsAMsgs) failures.push(bReadsAMsgs);

  // DB_AUDIT.md DB-H1 — write-path WITH CHECK ownership guards on
  // bookings/orders (see writeProbeCases()/probeWriteRejected() above).
  const writeCases = writeProbeCases();
  for (const testCase of writeCases) {
    const aWritesB = await probeWriteRejected(seededTenantA, seededTenantB, testCase);
    if (aWritesB) failures.push(aWritesB);
    const bWritesA = await probeWriteRejected(seededTenantB, seededTenantA, testCase);
    if (bWritesA) failures.push(bWritesA);
  }

  // Impersonation server-enforced boundary (see this file's header comment).
  const impersonationFailures = await probeImpersonationEnforcement(
    seededTenantA,
    seededTenantB.userId,
  );
  failures.push(...impersonationFailures);

  for (const view of ADMIN_ONLY_VIEWS) {
    // anon: no session at all — the publishable key used as both apikey
    // and bearer, exactly what an unauthenticated request with only the
    // public key on the page looks like.
    const anonLeak = await probeViewLeak("anon", PUBLISHABLE_KEY, PUBLISHABLE_KEY, view);
    if (anonLeak) failures.push(anonLeak);
    // authenticated: a real signed-in tenant member's own session — these
    // views are admin-cockpit-only, so even a tenant reading back its own
    // margin/cost data would be wrong (BACKEND_SPEC §5 margin secrecy),
    // let alone another tenant's.
    const authLeak = await probeViewLeak(
      `authenticated tenant ${tenantA.tenantId}`,
      PUBLISHABLE_KEY,
      tenantA.accessToken,
      view,
    );
    if (authLeak) failures.push(authLeak);
  }

  if (failures.length > 0) {
    console.error(`\nRLS CROSS-TENANT PROBE FAILED — ${failures.length} leak(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  console.log(
    `\nRLS cross-tenant probe PASSED — ${tables.length + 1} tables checked both directions ` +
      `(+ text_conversation_messages, a dependent table checked separately), ` +
      `${ADMIN_ONLY_VIEWS.length} admin-only views checked as anon + authenticated, ` +
      `${writeCases.length} DB-H1 write-path cases checked both directions, 0 rows leaked, ` +
      `0 cross-tenant writes accepted, impersonation read-only/edit-enabled boundary enforced.`,
  );
}

main().catch((err) => {
  console.error("RLS cross-tenant probe crashed:", err);
  process.exit(1);
});
