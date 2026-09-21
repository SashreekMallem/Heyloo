import { deleteAgent } from "../_shared/providers/retell.ts";
import {
  type CompileAndPublishDeps,
  publishTenantAgent,
  compileAndCreateAgent as sharedCompileAndCreateAgent,
} from "../_shared/provisioning/compile-and-publish.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { Vertical } from "../_shared/vertical-defaults.ts";
import { VERTICAL_DEFAULTS } from "../_shared/vertical-defaults.ts";

/**
 * `api-admin-provision-test-tenant` (CALL-1, docs/BUILD_PLAN.md task 1):
 * internal-only tenant provisioning for the first live-call proof, with NO
 * Twilio call anywhere in this file. Its compile -> create-agent -> publish
 * mechanics (PARITY-1, docs/BUILD_NOTES.md) now delegate to
 * `_shared/provisioning/compile-and-publish.ts` — the SAME module
 * `api-provision/handler.ts`'s real saga calls — so a fix there reaches
 * both by construction. This file keeps only what's genuinely test-only:
 * it creates the tenant row itself (the real saga assumes one already
 * exists, created by `/api-checkout` before Stripe checkout — this path
 * has no checkout), seeds platform-sensible per-vertical defaults
 * (business hours, one resource, a few offerings, via
 * `_shared/vertical-defaults.ts`), and offers `force_recompile`/
 * `cleanup_superseded_agent` for iterating on template/compiler fixes
 * without a real Stripe-driven signup. Idempotent on `slug`: a second call
 * with the same slug reuses the existing tenant row and agent (never
 * re-seeds resources/offerings, never recreates a Retell agent that
 * already exists, unless `force_recompile` is set).
 */

export interface ProvisionTestTenantRequest {
  vertical: Vertical;
  name: string;
  slug: string;
  owner_email: string;
  owner_phone_e164?: string;
  /** CALL-2: opt-in only — default (unset/false) preserves the original,
   * tested "idempotent on slug: never touches Retell once the agent
   * already exists" contract. When true, an already-provisioned tenant's
   * template is recompiled and pushed to its EXISTING conversation_flow_id
   * (`update-conversation-flow`) + republished, so a compiler/template fix
   * reaches a tenant that was provisioned before the fix landed, without
   * deleting and recreating it (which would also churn its phone-number
   * attachment/agent_id). */
  force_recompile?: boolean;
  /** CALL-7 (docs/BUILD_PLAN.md task 4 — "do not accumulate Retell
   * agents"): opt-in, only meaningful together with `force_recompile`.
   * Default false PRESERVES the CALL-2-established behavior every prior
   * caller/task relies on ("old orphaned flow/agent resources are
   * harmless, not cleaned up"). When true, the OLD `retell_agent_id` this
   * force_recompile is about to supersede is deleted via Retell's
   * `DELETE /delete-agent/{id}` (`_shared/providers/retell.ts#deleteAgent`)
   * right after the new agent is created and republished — never before
   * (never leaves the tenant with zero working agents if the new
   * create/publish step fails). A delete failure is logged, never fails
   * the request — the new agent is already live and correct either way;
   * a leftover orphaned old agent is the same harmless state this flag
   * exists to normally avoid, not a regression. Only ever deletes an
   * agent id this same tenant's own `agent_configs` row had on file, so
   * it can never target an agent this codebase didn't create. */
  cleanup_superseded_agent?: boolean;
}

export interface ProvisionTestTenantResult {
  status: number;
  body: { tenant_id: string; agent_id: string } | { error: string };
}

export type ProvisionTestTenantDeps = CompileAndPublishDeps;

const VERTICALS: readonly Vertical[] = [
  "auto",
  "vet",
  "legal",
  "dental",
  "real_estate",
  "motel",
  "restaurant",
  "generic",
];

function isVertical(value: unknown): value is Vertical {
  return typeof value === "string" && (VERTICALS as readonly string[]).includes(value);
}

export function validateRequest(
  body: unknown,
): { ok: true; data: ProvisionTestTenantRequest } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (!isVertical(b["vertical"])) return { ok: false, error: "invalid_vertical" };
  const name = b["name"];
  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, error: "invalid_name" };
  }
  const slug = b["slug"];
  if (typeof slug !== "string" || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return { ok: false, error: "invalid_slug" };
  }
  const ownerEmail = b["owner_email"];
  if (typeof ownerEmail !== "string" || !ownerEmail.includes("@")) {
    return { ok: false, error: "invalid_owner_email" };
  }
  const ownerPhone = b["owner_phone_e164"];
  if (ownerPhone !== undefined && typeof ownerPhone !== "string") {
    return { ok: false, error: "invalid_owner_phone_e164" };
  }
  const forceRecompile = b["force_recompile"];
  if (forceRecompile !== undefined && typeof forceRecompile !== "boolean") {
    return { ok: false, error: "invalid_force_recompile" };
  }
  const cleanupSupersededAgent = b["cleanup_superseded_agent"];
  if (cleanupSupersededAgent !== undefined && typeof cleanupSupersededAgent !== "boolean") {
    return { ok: false, error: "invalid_cleanup_superseded_agent" };
  }
  return {
    ok: true,
    data: {
      vertical: b["vertical"] as Vertical,
      name,
      slug,
      owner_email: ownerEmail,
      ...(ownerPhone ? { owner_phone_e164: ownerPhone } : {}),
      ...(forceRecompile ? { force_recompile: true } : {}),
      ...(cleanupSupersededAgent ? { cleanup_superseded_agent: true } : {}),
    },
  };
}

async function ensureTenant(
  sql: SqlClient,
  req: ProvisionTestTenantRequest,
): Promise<{ id: string; vertical: Vertical; created: boolean }> {
  const defaults = VERTICAL_DEFAULTS[req.vertical];
  const existing = await sql<{ id: string; vertical: Vertical; business_hours_ok: boolean }>`
    select id, vertical, jsonb_typeof(business_hours) = 'object' as business_hours_ok
    from public.tenants where slug = ${req.slug} and deleted_at is null
  `;
  if (existing[0]) {
    if (req.owner_phone_e164) {
      await sql`update public.tenants set owner_test_phone = ${req.owner_phone_e164} where id = ${existing[0].id}`;
    }
    // Self-heals a row written before the CALL-1 fix below existed (an
    // earlier bug in this same handler double-JSON-encoded every jsonb
    // column it wrote — see this function's own INSERT below and
    // `ensureTemplateSeeded`'s matching self-heal — docs/BUILD_NOTES.md
    // CALL-1 entry). No-op on an already-healthy row.
    if (!existing[0].business_hours_ok) {
      await sql`update public.tenants set business_hours = ${defaults.business_hours}::jsonb where id = ${existing[0].id}`;
      const resourceRows = await sql<{ id: string }>`
        select id from public.resources where tenant_id = ${existing[0].id}
      `;
      for (const r of resourceRows) {
        await sql`select public.fn_regenerate_availability_slots(${existing[0].id}, ${r.id})`;
      }
    }
    return { id: existing[0].id, vertical: existing[0].vertical, created: false };
  }

  const inserted = await sql<{ id: string }>`
    insert into public.tenants (name, slug, vertical, business_type, timezone, business_hours, owner_test_phone)
    values (
      ${req.name}, ${req.slug}, ${req.vertical}, ${defaults.business_type}, ${defaults.timezone},
      ${defaults.business_hours}::jsonb, ${req.owner_phone_e164 ?? null}
    )
    returning id
  `;
  const row = inserted[0];
  if (!row) throw new Error("tenant_insert_failed");
  const tenantId = row.id;

  const resourceIds: string[] = [];
  for (const resource of defaults.resources) {
    const inserted_resource = await sql<{ id: string }>`
      insert into public.resources (tenant_id, type, name, capacity, metadata)
      values (
        ${tenantId}, ${resource.type}, ${resource.name}, ${resource.capacity ?? 1},
        ${resource.metadata ?? {}}::jsonb
      )
      returning id
    `;
    const resourceRow = inserted_resource[0];
    if (resourceRow) resourceIds.push(resourceRow.id);
  }

  for (const offering of defaults.offerings) {
    await sql`
      insert into public.offerings (tenant_id, name, category, duration_minutes, price_cents, resource_type_required)
      values (
        ${tenantId}, ${offering.name}, ${offering.category ?? null}, ${offering.duration_minutes ?? null},
        ${offering.price_cents ?? null}, ${offering.resource_type_required ?? null}
      )
    `;
  }

  for (const resourceId of resourceIds) {
    await sql`select public.fn_regenerate_availability_slots(${tenantId}, ${resourceId})`;
  }

  return { id: tenantId, vertical: req.vertical, created: true };
}

type CompileAndCreateOutcome =
  | { ok: true; agentId: string }
  | { ok: false; status: number; error: string };

/**
 * CALL-2 (docs/BUILD_NOTES.md): compiles the tenant's current template and
 * creates a BRAND-NEW Retell agent (new `agent_id`) from it, upserting
 * `agent_configs`. Shared by the first-ever provision AND
 * `force_recompile` — RETELL-VERIFIED live 2026-09-20 that there is no
 * in-place edit path once an agent has ANY version history (see
 * `_shared/provisioning/compile-and-publish.ts`'s own header for the full
 * evidence). PARITY-1: the actual compile/create mechanics now live in
 * that shared module (`sharedCompileAndCreateAgent`); this wrapper only
 * adapts its result shape and error logging to this file's own
 * conventions. The caller (a human, or `api-admin-attach-retell-number`)
 * still needs to re-point the tenant's phone number at the new `agent_id`
 * afterward — this function only replaces `agent_configs.retell_agent_id`,
 * it never touches `phone_numbers`.
 */
async function compileAndCreateAgent(
  sql: SqlClient,
  tenant: { id: string; vertical: Vertical },
  deps: ProvisionTestTenantDeps,
  forceReseed = false,
): Promise<CompileAndCreateOutcome> {
  const outcome = await sharedCompileAndCreateAgent(
    sql,
    tenant.id,
    tenant.vertical,
    deps,
    forceReseed,
  );
  if (!outcome.ok) {
    deps.logger.error("provision_test_tenant_compile_and_create_failed", {
      tenant_id: tenant.id,
      status: outcome.status,
      error: outcome.error,
    });
    return { ok: false, status: outcome.status, error: outcome.error };
  }
  return { ok: true, agentId: outcome.agentId };
}

export async function provisionTestTenant(
  sql: SqlClient,
  rawBody: unknown,
  deps: ProvisionTestTenantDeps,
): Promise<ProvisionTestTenantResult> {
  const parsed = validateRequest(rawBody);
  if (!parsed.ok) return { status: 422, body: { error: parsed.error } };
  const req = parsed.data;

  const tenant = await ensureTenant(sql, req);

  const existingConfig = await sql<{ retell_agent_id: string | null; published_at: string | null }>`
    select retell_agent_id, published_at from public.agent_configs where tenant_id = ${tenant.id}
  `;
  let agentId = existingConfig[0]?.retell_agent_id ?? null;
  let needsPublish = !existingConfig[0]?.published_at;
  // CALL-7: the agent `force_recompile` is about to supersede (if any) —
  // captured BEFORE compileAndCreateAgent overwrites agent_configs, so a
  // later opt-in cleanup deletes the exact id this tenant's own row had on
  // file, never a guess. Null on a first-ever provision (nothing to clean
  // up) or when force_recompile isn't set (agentId is simply reused as-is).
  const supersededAgentId = req.force_recompile ? agentId : null;

  const isFirstProvision = !agentId;
  if (isFirstProvision || req.force_recompile) {
    const outcome = await compileAndCreateAgent(sql, tenant, deps, req.force_recompile === true);
    if (!outcome.ok) {
      if (isFirstProvision) {
        return { status: outcome.status, body: { error: outcome.error } };
      }
      // force_recompile on an already-working tenant: log and keep the
      // existing agent rather than failing the whole request.
      deps.logger.warn("provision_test_tenant_force_recompile_skipped", {
        tenant_id: tenant.id,
        reason: outcome.error,
      });
    } else {
      agentId = outcome.agentId;
      needsPublish = true;
    }
  }

  // CALL-1 gap fix (docs/BUILD_NOTES.md): a freshly `create-agent`'d Retell
  // agent is an unpublished DRAFT — the Chat API refuses to start a session
  // against one ("Cannot start a chat session with selected agent.", a real
  // live 422 this fix resolves) and phone/batch-test behavior against a
  // draft is unreliable. PARITY-1: `publishTenantAgent` (`_shared/
  // provisioning/compile-and-publish.ts`) is the SAME getAgent ->
  // publishAgentVersion step `api-provision/handler.ts`'s real saga calls.
  if (needsPublish && agentId) {
    const published = await publishTenantAgent(sql, tenant.id, agentId, deps);
    if (!published.ok) {
      deps.logger.error("provision_test_tenant_publish_failed", {
        tenant_id: tenant.id,
        status: published.status,
        error: published.error,
      });
      return { status: published.status, body: { error: published.error } };
    }
  }

  // CALL-7: only reached once the NEW agent (agentId, possibly just
  // recompiled above) is created and, if needed, published — so this
  // tenant always has a working agent on file before its old one is ever
  // deleted. `supersededAgentId` is only non-null on a force_recompile
  // that actually replaced the id (never on a first provision, never when
  // force_recompile's own compile step failed and fell back to the
  // existing agent — see compileAndCreateAgent's "skipped" branch above,
  // which leaves `agentId` unchanged from `existingConfig`).
  if (req.cleanup_superseded_agent && supersededAgentId && supersededAgentId !== agentId) {
    const deleted = await deleteAgent(deps.retellFetch, deps.retellApiKey, supersededAgentId);
    if (!deleted.ok) {
      deps.logger.warn("provision_test_tenant_cleanup_superseded_agent_failed", {
        tenant_id: tenant.id,
        superseded_agent_id: supersededAgentId,
        status: deleted.status,
      });
    } else {
      deps.logger.info("provision_test_tenant_cleanup_superseded_agent_deleted", {
        tenant_id: tenant.id,
        superseded_agent_id: supersededAgentId,
      });
    }
  }

  await sql`update public.tenants set status = case when status = 'trialing' then 'active' else status end where id = ${tenant.id}`;

  // Only reachable null if this was a force_recompile on a tenant that
  // somehow had no prior agent AND compileAndCreateAgent's outcome was
  // (impossibly) ok:false without an early return — defensive, not a real
  // path (isFirstProvision already return{}s on failure above).
  if (!agentId) {
    deps.logger.error("provision_test_tenant_no_agent_id_at_completion", { tenant_id: tenant.id });
    return { status: 502, body: { error: "no_agent_id" } };
  }

  return { status: 200, body: { tenant_id: tenant.id, agent_id: agentId } };
}
