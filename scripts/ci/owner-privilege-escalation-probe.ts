/**
 * Same-tenant privilege-escalation probe (SEC-2, CLAUDE.md Rule 2).
 *
 * The sibling rls-cross-tenant-probe.ts proves tenant A cannot touch tenant
 * B. This one proves a tenant OWNER cannot escalate on their OWN rows: RLS
 * only scopes rows, so without column-level grants an owner could PATCH
 * tenants.status / plan_code / stripe_* / is_test, agent_configs.
 * compiled_config / retell_agent_id, or (as a referral partner)
 * referral_partners.rate_bps through PostgREST
 * (supabase/migrations/20260929160000_lock_owner_writes_to_editable_columns.sql).
 *
 * For each guarded table it authenticates through a real GoTrue sign-in (so
 * custom_access_token_hook stamps real claims) and:
 *   1. Reads the row with the secret key and, for EVERY column that is not
 *      on the owner-editable allow-list below, PATCHes that column to its
 *      own current value as the owner. PostgREST must answer 403 with
 *      Postgres code 42501 (insufficient_privilege). Columns are taken from
 *      the live row, so a column added later is guarded automatically.
 *   2. PATCHes each allow-listed column with a sample value and requires a
 *      2xx that changed exactly one row (the portal write still works).
 *   3. Confirms INSERT / DELETE are rejected where the portal never does
 *      them.
 * Exits non-zero, naming every violation, on any failure. The same
 * assertions are also run in SQL by supabase/tests/owner_column_grants.sql.
 *
 * Dependency-free (Node fetch only), erasable TypeScript, run with
 * `node --experimental-strip-types scripts/ci/owner-privilege-escalation-probe.ts`.
 * Env: SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY (legacy
 * SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY names accepted), as in the
 * sibling probe. Keep the allow-lists in sync with the migration.
 */

function env(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const v = process.env[key];
    if (v) return v;
  }
  console.error(`Missing required env var ${name} (also checked: ${fallbacks.join(", ")})`);
  process.exit(1);
}

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");
const PUBLISHABLE_KEY = env("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");

interface Resp {
  status: number;
  json: unknown;
}

async function rest(
  path: string,
  opts: { method?: string; bearer: string; apikey: string; body?: unknown; prefer?: string },
): Promise<Resp> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      apikey: opts.apikey,
      Authorization: `Bearer ${opts.bearer}`,
      "Content-Type": "application/json",
      ...(opts.prefer ? { Prefer: opts.prefer } : {}),
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

const asService = (path: string, method = "GET", body?: unknown, prefer?: string) =>
  rest(path, { method, bearer: SERVICE_KEY, apikey: SERVICE_KEY, body, prefer });

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}Aa1!`;
}

async function insertReturning(table: string, row: Record<string, unknown>): Promise<string> {
  const r = await asService(`/rest/v1/${table}`, "POST", row, "return=representation");
  if (r.status >= 300 || !Array.isArray(r.json) || r.json.length === 0) {
    throw new Error(`seed insert into ${table} failed (${r.status}): ${JSON.stringify(r.json)}`);
  }
  return (r.json[0] as { id: string }).id;
}

async function createUserWithToken(
  label: string,
): Promise<{ userId: string; signIn: () => Promise<string> }> {
  const email = `sec2-${label}-${Date.now()}@heyloo-ci.local`;
  const password = randomPassword();
  const created = await rest("/auth/v1/admin/users", {
    method: "POST",
    bearer: SERVICE_KEY,
    apikey: SERVICE_KEY,
    body: { email, password, email_confirm: true },
  });
  const body = created.json as { id?: string; user?: { id?: string } };
  const userId = body.id ?? body.user?.id;
  if (created.status >= 300 || !userId) {
    throw new Error(
      `create auth user ${label} failed (${created.status}): ${JSON.stringify(created.json)}`,
    );
  }
  const signIn = async (): Promise<string> => {
    const r = await rest("/auth/v1/token?grant_type=password", {
      method: "POST",
      bearer: PUBLISHABLE_KEY,
      apikey: PUBLISHABLE_KEY,
      body: { email, password },
    });
    const token = (r.json as { access_token?: string }).access_token;
    if (r.status >= 300 || !token) {
      throw new Error(`sign-in ${label} failed (${r.status}): ${JSON.stringify(r.json)}`);
    }
    return token;
  };
  return { userId, signIn };
}

const failures: string[] = [];
let assertions = 0;

/** PATCH one column as `token`; the caller states whether it must be denied. */
async function patchColumn(
  table: string,
  filter: string,
  column: string,
  value: unknown,
  token: string,
  expect: "denied" | "allowed",
): Promise<void> {
  assertions += 1;
  const r = await rest(`/rest/v1/${table}?${filter}`, {
    method: "PATCH",
    bearer: token,
    apikey: PUBLISHABLE_KEY,
    body: { [column]: value },
    prefer: "return=representation",
  });
  if (expect === "denied") {
    const code = (r.json as { code?: string } | null)?.code;
    if (r.status >= 200 && r.status < 300) {
      failures.push(
        `ESCALATION: owner PATCHed ${table}.${column} (status ${r.status}) — column must not be writable by authenticated`,
      );
    } else if (code !== "42501") {
      failures.push(
        `${table}.${column}: rejected with ${r.status}/${code ?? "?"} but expected 403/42501 (insufficient_privilege): ${JSON.stringify(r.json)}`,
      );
    }
  } else {
    const rows = Array.isArray(r.json) ? r.json.length : -1;
    if (r.status < 200 || r.status >= 300 || rows !== 1) {
      failures.push(
        `REGRESSION: portal write ${table}.${column} failed or changed ${rows} rows (status ${r.status}): ${JSON.stringify(r.json)}`,
      );
    }
  }
}

async function expectRejected(
  label: string,
  path: string,
  method: string,
  body: unknown,
  token: string,
): Promise<void> {
  assertions += 1;
  const r = await rest(path, {
    method,
    bearer: token,
    apikey: PUBLISHABLE_KEY,
    body,
    prefer: "return=minimal",
  });
  if (r.status >= 200 && r.status < 300) {
    failures.push(`ESCALATION: ${label} was ACCEPTED (status ${r.status})`);
  }
}

async function checkTable(
  table: string,
  filter: string,
  allowed: Record<string, unknown>,
  token: string,
): Promise<void> {
  const row = await asService(`/rest/v1/${table}?${filter}&select=*`);
  const rows = row.json as Record<string, unknown>[];
  if (row.status >= 300 || !Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`could not read ${table} fixture (${row.status}): ${JSON.stringify(row.json)}`);
  }
  const current = rows[0] as Record<string, unknown>;
  for (const column of Object.keys(current)) {
    if (column in allowed) continue;
    await patchColumn(table, filter, column, current[column], token, "denied");
  }
  for (const [column, value] of Object.entries(allowed)) {
    if (!(column in current)) {
      failures.push(
        `${table}.${column} is on the probe's allow-list but does not exist — update the probe/migration`,
      );
      continue;
    }
    await patchColumn(table, filter, column, value, token, "allowed");
  }
}

async function main(): Promise<void> {
  console.log(`Owner privilege-escalation probe against ${SUPABASE_URL}`);
  const stamp = Date.now();

  // --- fixtures (service role) -----------------------------------------
  const tenantId = await insertReturning("tenants", {
    name: `SEC-2 probe ${stamp}`,
    slug: `sec2-probe-${stamp}`,
    vertical: "generic",
    timezone: "America/New_York",
    business_hours: {},
  });
  // (vertical, version) is unique and the seed may already ship generic v1.
  const templateVersion = 900000 + Math.floor(Math.random() * 90000);
  const templateId = await insertReturning("agent_templates", {
    vertical: "generic",
    name: `sec2-${stamp}`,
    version: templateVersion,
    compile_target: "single_prompt",
    voice_id: "probe",
    model: "probe",
    disclosure_line: "AI + recorded",
  });
  const configId = await insertReturning("agent_configs", {
    tenant_id: tenantId,
    template_id: templateId,
    template_version: templateVersion,
  });
  const conversationId = await insertReturning("text_conversations", {
    tenant_id: tenantId,
    channel: "sms",
  });

  const owner = await createUserWithToken("owner");
  await insertReturning("memberships", {
    tenant_id: tenantId,
    user_id: owner.userId,
    role: "owner",
  });
  const ownerToken = await owner.signIn();

  const partnerUser = await createUserWithToken("partner");
  const partnerId = await insertReturning("referral_partners", {
    user_id: partnerUser.userId,
    name: "SEC-2 partner",
    email: `sec2-partner-${stamp}@heyloo-ci.local`,
  });
  const partnerToken = await partnerUser.signIn();

  // --- tenants -----------------------------------------------------------
  await checkTable(
    "tenants",
    `id=eq.${tenantId}`,
    {
      name: "Renamed by owner",
      timezone: "America/Chicago",
      business_hours: {},
      hours_exceptions: [],
      language_config: { primary: "en", bilingual: false },
      owner_test_phone: "+15555550100",
      business_phone: "+15555550101",
      website_url: "https://example.com",
      manual_mode: false,
      manual_mode_enabled_at: null,
      voice_reminders_enabled: true,
      review_request_enabled: false,
      review_url: "https://example.com/review",
      avg_transaction_value_cents: 12345,
      policies_reviewed_at: new Date().toISOString(),
      text_agent_enabled: false,
      text_agent_persona: { tone: "friendly" },
      quiet_hours: { enabled: false },
      widget_enabled: false,
      widget_settings: {},
      widget_public_key: `pk_sec2_${stamp}`,
      booking_min_notice_minutes: 30,
      booking_horizon_days: 21,
    },
    ownerToken,
  );
  // LAUNCH-forwarding: the forwarding test dials business_phone and it becomes
  // the transfer destination, so only E.164 may be stored, whatever the client.
  await expectRejected(
    "owner PATCH of tenants.business_phone to a non-E.164 value",
    `/rest/v1/tenants?id=eq.${tenantId}`,
    "PATCH",
    { business_phone: "12345" },
    ownerToken,
  );
  // SEC-2 review: an unknown zone would abort fn_cron_usage_rollup for every
  // tenant, so the database (not just the portal route) must refuse it.
  await expectRejected(
    "owner PATCH of tenants.timezone to an unknown zone",
    `/rest/v1/tenants?id=eq.${tenantId}`,
    "PATCH",
    { timezone: "Mars/Phobos" },
    ownerToken,
  );
  await expectRejected(
    "owner INSERT into tenants",
    "/rest/v1/tenants",
    "POST",
    { name: "x", slug: `sec2-x-${stamp}`, vertical: "generic" },
    ownerToken,
  );
  await expectRejected(
    "owner DELETE of tenants row",
    `/rest/v1/tenants?id=eq.${tenantId}`,
    "DELETE",
    undefined,
    ownerToken,
  );

  // --- agent_configs -----------------------------------------------------
  await checkTable(
    "agent_configs",
    `id=eq.${configId}`,
    {
      assistant_name: "Sam",
      special_instructions: "Be brief.",
      transfer_number: "+15555550101",
      dynamic_variable_overrides: { faq_items: [] },
    },
    ownerToken,
  );
  await expectRejected(
    "owner INSERT into agent_configs",
    "/rest/v1/agent_configs",
    "POST",
    { tenant_id: tenantId, template_id: templateId, template_version: templateVersion },
    ownerToken,
  );

  // --- referral_partners -------------------------------------------------
  await checkTable(
    "referral_partners",
    `id=eq.${partnerId}`,
    {
      paypal_email: "partner@example.com",
      payout_method: "paypal",
      ftc_acknowledged_at: new Date().toISOString(),
      ftc_acknowledged_version: "v1",
    },
    partnerToken,
  );

  // --- memberships -------------------------------------------------------
  const membership = await asService(`/rest/v1/memberships?tenant_id=eq.${tenantId}&select=id`);
  const membershipId = (membership.json as { id: string }[])[0]?.id;
  await checkTable(
    "memberships",
    `id=eq.${membershipId}`,
    { last_seen_notifications_at: new Date().toISOString() },
    ownerToken,
  );
  await expectRejected(
    "owner INSERT of a membership for another user",
    "/rest/v1/memberships",
    "POST",
    { tenant_id: tenantId, user_id: partnerUser.userId, role: "owner" },
    ownerToken,
  );

  // --- text_conversations ------------------------------------------------
  await checkTable(
    "text_conversations",
    `id=eq.${conversationId}`,
    { status: "human" },
    ownerToken,
  );

  // --- customers (SEC-2 review): only `metadata` (the notes write) ----------
  const customerId = await insertReturning("customers", {
    tenant_id: tenantId,
    phone_e164: `+1555${String(stamp).slice(-7)}`,
    sms_opt_out: true,
  });
  await checkTable("customers", `id=eq.${customerId}`, { metadata: { notes: [] } }, ownerToken);
  await expectRejected(
    "owner INSERT into customers",
    "/rest/v1/customers",
    "POST",
    { tenant_id: tenantId, phone_e164: "+15555550177" },
    ownerToken,
  );
  await expectRejected(
    "owner DELETE of a customers row",
    `/rest/v1/customers?id=eq.${customerId}`,
    "DELETE",
    undefined,
    ownerToken,
  );

  // --- cleanup (best effort; the local stack is discarded after CI) ------
  await asService(`/rest/v1/customers?id=eq.${customerId}`, "DELETE");
  await asService(`/rest/v1/text_conversations?id=eq.${conversationId}`, "DELETE");
  await asService(`/rest/v1/agent_configs?id=eq.${configId}`, "DELETE");

  console.log(`Ran ${assertions} assertions.`);
  if (failures.length > 0) {
    console.error(`\nOwner privilege-escalation probe FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Owner privilege-escalation probe passed.");
}

main().catch((err) => {
  console.error("Probe crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
