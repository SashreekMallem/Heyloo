/**
 * PARITY-1 (docs/BUILD_NOTES.md): republishes tenants through the real
 * saga's shared compile -> create-agent -> publish path
 * (`_shared/provisioning/compile-and-publish.ts`, called from
 * `api-provision`'s `action: "republish"`), so a compiler/template fix
 * that only ever reached tenants provisioned through
 * `api-admin-provision-test-tenant` + `force_recompile` (CALL-6..9's own
 * documented pattern) can also reach a tenant that went through the REAL
 * signup saga — without re-running Stripe checkout.
 *
 * `action: "republish"` is guarded server-side (`api-provision/handler.ts
 * #republishTenantAgent`) to `tenants.is_test = true` ONLY — this script
 * can never touch a real, billable tenant even if pointed at one by
 * mistake; a non-test tenant in the candidate list is always skipped and
 * reported, never sent.
 *
 * Dry-run by default (lists the candidate tenants and what would happen,
 * calls nothing). Pass `--apply` to actually POST the republish call.
 * `--tenant <slug>` narrows to exactly one tenant by slug — use this
 * rather than a fleet-wide `--apply` run; per this task's own instructions
 * this script is proven against `signup-1-auto` only, never run
 * fleet-wide.
 *
 * Talks to the live database via the same Supabase Management API raw-SQL
 * endpoint `scripts/sync-agent-templates.ts` already uses (read-only here
 * — SELECT only, never a write), and to the deployed `api-provision`
 * function directly over HTTPS for the actual republish call.
 * Dependency-free (plain Node `fetch`), erasable-TypeScript syntax only:
 *
 *   node --experimental-strip-types scripts/republish-fleet.ts --tenant signup-1-auto --apply
 *
 * Required env vars:
 *   SUPABASE_PROJECT_REF     the project ref (e.g. qulcubtwqsqgqpfgvorn)
 *   SUPABASE_ACCESS_TOKEN    a Supabase Management API personal access
 *                            token (account-level, never a project key) —
 *                            used only to list candidate tenants
 *   PROVISION_INTERNAL_SECRET  the same internal secret `api-provision`'s
 *                            `x-internal-secret` header check compares
 *                            against (`PROVISION_INTERNAL_SECRET` Supabase
 *                            secret on the project)
 *   SB_SECRET_KEY            the project's own secret API key — required
 *                            ONLY with `--apply`, to satisfy
 *                            `api-provision`'s `verify_jwt = true` platform
 *                            gateway check (same key
 *                            `webhooks-stripe/invoke-provisioning.ts` uses
 *                            as its `Authorization: Bearer` for this exact
 *                            call shape). A dry-run needs none of this.
 */

function env(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const tenantFlagIndex = args.indexOf("--tenant");
const TENANT_SLUG_FILTER =
  tenantFlagIndex >= 0 && args[tenantFlagIndex + 1] ? args[tenantFlagIndex + 1] : null;

const SUPABASE_PROJECT_REF = env("SUPABASE_PROJECT_REF") as string;
const SUPABASE_ACCESS_TOKEN = env("SUPABASE_ACCESS_TOKEN") as string;
// Only required once we're actually about to call the function.
const PROVISION_INTERNAL_SECRET = env("PROVISION_INTERNAL_SECRET", APPLY);
const SB_SECRET_KEY = env("SB_SECRET_KEY", APPLY);

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1";
const QUERY_URL = `${MANAGEMENT_API_BASE}/projects/${SUPABASE_PROJECT_REF}/database/query`;
const FUNCTIONS_BASE = `https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1`;

async function runQuery(query: string): Promise<unknown> {
  const res = await fetch(QUERY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Management API query failed (status ${res.status}): ${bodyText}`);
  }
  return bodyText ? JSON.parse(bodyText) : [];
}

interface CandidateTenant {
  id: string;
  slug: string;
  vertical: string;
  is_test: boolean;
  status: string;
  retell_agent_id: string | null;
}

function sqlStringLiteral(value: string): string {
  // Same dollar-quoting convention `sync-agent-templates.ts` uses — no
  // interpolated value here can break out of the literal.
  let tag = "q";
  while (value.includes(`$${tag}$`)) tag += Math.random().toString(36).slice(2, 6);
  return `$${tag}$${value}$${tag}$`;
}

async function listCandidates(): Promise<CandidateTenant[]> {
  const filter = TENANT_SLUG_FILTER ? `and t.slug = ${sqlStringLiteral(TENANT_SLUG_FILTER)}` : "";
  const query = `
    select t.id, t.slug, t.vertical, t.is_test, t.status, ac.retell_agent_id
    from public.tenants t
    left join public.agent_configs ac on ac.tenant_id = t.id
    where t.deleted_at is null and t.status = 'active' ${filter}
    order by t.slug
  `.trim();
  return (await runQuery(query)) as CandidateTenant[];
}

interface RepublishResult {
  slug: string;
  tenant_id: string;
  skipped: boolean;
  reason?: string;
  ok?: boolean;
  status?: number;
  body?: unknown;
}

async function republishOne(tenant: CandidateTenant): Promise<RepublishResult> {
  if (!tenant.is_test) {
    return {
      slug: tenant.slug,
      tenant_id: tenant.id,
      skipped: true,
      reason: "not is_test — real/billable tenants are never republished by this script",
    };
  }
  if (!tenant.retell_agent_id) {
    return {
      slug: tenant.slug,
      tenant_id: tenant.id,
      skipped: true,
      reason: "no agent_configs row yet — never provisioned",
    };
  }
  if (!APPLY) {
    return {
      slug: tenant.slug,
      tenant_id: tenant.id,
      skipped: true,
      reason: "dry-run (pass --apply to actually republish)",
    };
  }

  const res = await fetch(`${FUNCTIONS_BASE}/api-provision`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SB_SECRET_KEY}`,
      "x-internal-secret": PROVISION_INTERNAL_SECRET as string,
    },
    body: JSON.stringify({ action: "republish", tenant_id: tenant.id }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    slug: tenant.slug,
    tenant_id: tenant.id,
    skipped: false,
    ok: res.ok,
    status: res.status,
    body,
  };
}

async function main(): Promise<void> {
  const candidates = await listCandidates();
  console.log(
    `${candidates.length} candidate tenant(s) found` +
      (TENANT_SLUG_FILTER ? ` (--tenant ${TENANT_SLUG_FILTER})` : "") +
      ` on project ${SUPABASE_PROJECT_REF}. Mode: ${APPLY ? "APPLY (live)" : "DRY-RUN"}.`,
  );
  if (candidates.length === 0) return;

  const results: RepublishResult[] = [];
  for (const tenant of candidates) {
    results.push(await republishOne(tenant));
  }

  console.log("");
  for (const r of results) {
    if (r.skipped) {
      console.log(`SKIP    ${r.slug.padEnd(24)} ${r.reason}`);
    } else {
      console.log(
        `${r.ok ? "OK  " : "FAIL"}    ${r.slug.padEnd(24)} status=${r.status} body=${JSON.stringify(r.body)}`,
      );
    }
  }

  const failed = results.filter((r) => !r.skipped && !r.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} republish call(s) failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});
