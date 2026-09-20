import {
  AGENT_TEMPLATE_SEEDS,
  DEFAULT_TEMPLATE_MODEL,
  DEFAULT_TEMPLATE_VOICE_ID,
} from "../_shared/agent-template-seeds.ts";
import type { CompilerAgentTemplate } from "../_shared/compiler/template-compiler.ts";
import { compileTemplate as compileRetellTemplate } from "../_shared/compiler/template-compiler.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createAgent,
  createConversationFlow,
  createRetellLLM,
  getAgent,
  publishAgentVersion,
} from "../_shared/providers/retell.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { Vertical } from "../_shared/vertical-defaults.ts";
import { VERTICAL_DEFAULTS } from "../_shared/vertical-defaults.ts";

/**
 * `api-admin-provision-test-tenant` (CALL-1, docs/BUILD_PLAN.md task 1):
 * internal-only tenant provisioning for the first live-call proof, with NO
 * Twilio call anywhere in this file. Mirrors `api-provision/handler.ts`'s
 * "tenant_finalize" + "agent_compile" steps (same compiled-flow ->
 * create-conversation-flow/create-retell-llm -> create-agent sequence, same
 * disclosure hard-fail per CLAUDE.md Rule 2 G1/G2) but creates the tenant
 * row itself (that saga assumes one already exists, created by
 * `/api-checkout` before Stripe checkout — this path has no checkout) and
 * seeds platform-sensible per-vertical defaults (business hours, one
 * resource, a few offerings) the same shape `supabase/seed/seed.sql`
 * establishes for local-dev demo tenants, via `_shared/vertical-defaults.ts`.
 * Idempotent on `slug`: a second call with the same slug reuses the
 * existing tenant row and agent (never re-seeds resources/offerings, never
 * recreates a Retell agent that already exists).
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
}

export interface ProvisionTestTenantResult {
  status: number;
  body: { tenant_id: string; agent_id: string } | { error: string };
}

export interface CompiledTemplateResult {
  templateId: string;
  templateVersion: number;
  voiceId: string;
  model: string;
  agentName: string;
  disclosureVerified: boolean;
  flow: ReturnType<typeof compileRetellTemplate>["flow"];
}

export interface ProvisionTestTenantDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  voiceToolsWebhookUrl: string;
  logger: Logger;
}

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
  return {
    ok: true,
    data: {
      vertical: b["vertical"] as Vertical,
      name,
      slug,
      owner_email: ownerEmail,
      ...(ownerPhone ? { owner_phone_e164: ownerPhone } : {}),
      ...(forceRecompile ? { force_recompile: true } : {}),
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

/**
 * CALL-1 gap fix (docs/BUILD_NOTES.md): seeds ONE active `agent_templates`
 * row for `vertical` from `_shared/agent-template-seeds.ts` when none
 * exists yet — the live project's `agent_templates` table was found
 * completely empty (no seed/sync script wires `packages/templates`'
 * registry into a real, hosted Supabase project; `supabase/seed/seed.sql`
 * only ever runs against local dev via `supabase db reset`). Idempotent:
 * a concurrent/second call that races this insert is caught by the
 * `(vertical, version)` unique constraint and falls through to re-reading
 * the row a second insert would have raced.
 */
async function ensureTemplateSeeded(
  sql: SqlClient,
  vertical: Vertical,
  forceReseed = false,
): Promise<void> {
  const existing = await sql<{ id: string; tools_ok: boolean }>`
    select id, jsonb_typeof(tools) = 'array' as tools_ok
    from public.agent_templates where vertical = ${vertical} and is_active limit 1
  `;
  const seed = AGENT_TEMPLATE_SEEDS[vertical];
  if (existing[0]?.tools_ok && !forceReseed) return;

  // Self-heals a row written before the CALL-1 fix below existed (see
  // `ensureTenant`'s matching comment — docs/BUILD_NOTES.md CALL-1 entry).
  // CALL-2: also re-runs on `force_recompile` (`forceReseed`) so a fixed
  // `_shared/agent-template-seeds.ts` (e.g. this task's own `create_booking.
  // resource_id` tool-description fix, docs/BUILD_NOTES.md CALL-2) reaches
  // an already-seeded vertical instead of the lazy insert-once-per-vertical
  // convention silently keeping the old content forever.
  if (existing[0]) {
    await sql`
      update public.agent_templates set
        system_prompt = ${seed.content.system_prompt},
        states = ${seed.content.states}::jsonb,
        transitions = ${seed.content.transitions}::jsonb,
        global_intents = ${seed.content.global_intents}::jsonb,
        tools = ${seed.content.tools}::jsonb,
        disclosure_line = ${seed.content.disclosure_line}
      where id = ${existing[0].id}
    `;
    return;
  }

  await sql`
    insert into public.agent_templates
      (vertical, name, version, compile_target, system_prompt, states, transitions, global_intents, tools, voice_id, model, disclosure_line, is_active)
    values (
      ${vertical}, ${seed.name}, 1, ${seed.content.compile_target}, ${seed.content.system_prompt},
      ${seed.content.states}::jsonb, ${seed.content.transitions}::jsonb,
      ${seed.content.global_intents}::jsonb, ${seed.content.tools}::jsonb,
      ${DEFAULT_TEMPLATE_VOICE_ID}, ${DEFAULT_TEMPLATE_MODEL}, ${seed.content.disclosure_line}, true
    )
    on conflict (vertical, version) do nothing
  `;
}

async function compileTemplateForTenant(
  sql: SqlClient,
  tenantId: string,
  vertical: Vertical,
  voiceToolsWebhookUrl: string,
  forceReseed = false,
): Promise<CompiledTemplateResult | null> {
  await ensureTemplateSeeded(sql, vertical, forceReseed);

  const rows = await sql<Record<string, unknown>>`
    select at.* from public.agent_templates at
    where at.vertical = ${vertical} and at.is_active
    order by at.version desc limit 1
  `;
  const row = rows[0];
  if (!row) return null;

  const template: CompilerAgentTemplate = {
    compile_target: row["compile_target"] as CompilerAgentTemplate["compile_target"],
    system_prompt: (row["system_prompt"] as string | null) ?? null,
    states: (row["states"] as CompilerAgentTemplate["states"]) ?? [],
    transitions: (row["transitions"] as CompilerAgentTemplate["transitions"]) ?? [],
    global_intents: (row["global_intents"] as CompilerAgentTemplate["global_intents"]) ?? [],
    tools: (row["tools"] as CompilerAgentTemplate["tools"]) ?? [],
    disclosure_line: row["disclosure_line"] as string,
  };
  const compiled = compileRetellTemplate(template, voiceToolsWebhookUrl);

  return {
    templateId: row["id"] as string,
    templateVersion: row["version"] as number,
    voiceId: row["voice_id"] as string,
    model: row["model"] as string,
    agentName: `heyloo-test-tenant-${tenantId}`,
    disclosureVerified: compiled.disclosureVerified,
    flow: compiled.flow,
  };
}

type CompileAndCreateOutcome =
  | { ok: true; agentId: string }
  | { ok: false; status: number; error: string };

/**
 * CALL-2 (docs/BUILD_NOTES.md): compiles the tenant's current template and
 * creates a BRAND-NEW Retell agent (new `agent_id`) from it, upserting
 * `agent_configs`. Shared by the first-ever provision AND
 * `force_recompile` — RETELL-VERIFIED live 2026-09-20 that there is no
 * in-place edit path once an agent has ANY version history:
 * `update-conversation-flow` 400s once a currently-published agent
 * version references that flow (`"Cannot update published conversation
 * flow"`), `update-agent` 422s the same way for the agent resource itself
 * once published (`"Cannot update published agent other than version
 * title"`), and even branching a fresh DRAFT first via `create-agent-
 * version` still 400s on the `response_engine` field specifically
 * (`"Cannot update response engine after agent versions have been
 * created"`) — Retell permanently binds an `agent_id` to its original
 * flow/llm resource. A brand-new `create-agent` call has none of these
 * restrictions, so that's the only reliable way to push a compiler/
 * template fix: a fresh agent, republished, with the OLD agent_id/flow
 * left orphaned (harmless — never referenced again) rather than reused.
 * The caller (a human, or `api-admin-attach-retell-number`) still needs
 * to re-point the tenant's phone number at the new `agent_id` afterward —
 * this function only replaces `agent_configs.retell_agent_id`, it never
 * touches `phone_numbers`.
 */
async function compileAndCreateAgent(
  sql: SqlClient,
  tenant: { id: string; vertical: Vertical },
  deps: ProvisionTestTenantDeps,
  forceReseed = false,
): Promise<CompileAndCreateOutcome> {
  const compiled = await compileTemplateForTenant(
    sql,
    tenant.id,
    tenant.vertical,
    deps.voiceToolsWebhookUrl,
    forceReseed,
  );
  if (!compiled) {
    deps.logger.error("provision_test_tenant_no_active_template", { vertical: tenant.vertical });
    return { ok: false, status: 422, error: "no_active_template_for_vertical" };
  }
  // HARD-FAIL (CLAUDE.md Rule 2, G1/G2): never call Retell with a compiled
  // flow whose first turn doesn't contain the disclosure line verbatim.
  if (!compiled.disclosureVerified) {
    deps.logger.error("provision_test_tenant_disclosure_gate_failed", { tenant_id: tenant.id });
    return { ok: false, status: 422, error: "disclosure_gate_failed" };
  }

  const flowPayload =
    compiled.flow.kind === "conversation_flow"
      ? { ...compiled.flow.body, model_choice: { model: compiled.model, type: "cascading" } }
      : { ...compiled.flow.body, model: compiled.model };
  const flowResult =
    compiled.flow.kind === "conversation_flow"
      ? await createConversationFlow(deps.retellFetch, deps.retellApiKey, flowPayload)
      : await createRetellLLM(deps.retellFetch, deps.retellApiKey, flowPayload);
  const flowBody = flowResult.body as { conversation_flow_id?: string; llm_id?: string };
  const flowId = flowBody.conversation_flow_id ?? flowBody.llm_id;
  if (!flowResult.ok || !flowId) {
    deps.logger.error("provision_test_tenant_flow_create_failed", {
      tenant_id: tenant.id,
      status: flowResult.status,
      body: JSON.stringify(flowResult.body).slice(0, 1000),
    });
    return { ok: false, status: 502, error: "retell_flow_create_failed" };
  }

  const responseEngine =
    compiled.flow.kind === "conversation_flow"
      ? { type: "conversation-flow", conversation_flow_id: flowId }
      : { type: "retell-llm", llm_id: flowId };
  const created = await createAgent(deps.retellFetch, deps.retellApiKey, {
    agent_name: compiled.agentName,
    voice_id: compiled.voiceId,
    response_engine: responseEngine,
  });
  const createdBody = created.body as { agent_id?: string };
  if (!created.ok || !createdBody.agent_id) {
    deps.logger.error("provision_test_tenant_create_agent_failed", {
      tenant_id: tenant.id,
      status: created.status,
      body: JSON.stringify(created.body).slice(0, 1000),
    });
    return { ok: false, status: 502, error: "retell_create_agent_failed" };
  }
  const agentId = createdBody.agent_id;
  const retellLlmId = compiled.flow.kind === "conversation_flow" ? null : (flowBody.llm_id ?? null);
  await sql`
    insert into public.agent_configs (tenant_id, template_id, template_version, retell_agent_id, retell_llm_id, compiled_config)
    values (
      ${tenant.id}, ${compiled.templateId}, ${compiled.templateVersion}, ${agentId}, ${retellLlmId},
      ${{ compileTarget: compiled.flow.kind, flow: compiled.flow.body, response_engine: responseEngine }}::jsonb
    )
    on conflict (tenant_id) do update set
      retell_agent_id = excluded.retell_agent_id, retell_llm_id = excluded.retell_llm_id,
      compiled_config = excluded.compiled_config, template_id = excluded.template_id,
      template_version = excluded.template_version, published_at = null
  `;
  return { ok: true, agentId };
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
  // draft is unreliable. `api-provision/handler.ts`'s saga already does
  // this same getAgent -> publishAgentVersion two-step (RETELL-VERIFY,
  // VERIFY-6: publish requires a fresh `{version}` read, never assumed);
  // mirrored here rather than shared for the same reason the rest of this
  // file duplicates that saga's agent-compile step (no Twilio dependency).
  if (needsPublish && agentId) {
    const agentForPublish = await getAgent(deps.retellFetch, deps.retellApiKey, agentId);
    const agentForPublishBody = agentForPublish.body as { version?: number };
    if (!agentForPublish.ok || agentForPublishBody.version === undefined) {
      deps.logger.error("provision_test_tenant_get_agent_failed", {
        tenant_id: tenant.id,
        status: agentForPublish.status,
      });
      return { status: 502, body: { error: "retell_get_agent_failed" } };
    }
    const published = await publishAgentVersion(
      deps.retellFetch,
      deps.retellApiKey,
      agentId,
      agentForPublishBody.version,
    );
    if (!published.ok) {
      deps.logger.error("provision_test_tenant_publish_failed", {
        tenant_id: tenant.id,
        status: published.status,
        body: JSON.stringify(published.body).slice(0, 500),
      });
      return { status: 502, body: { error: "retell_publish_agent_failed" } };
    }
    await sql`update public.agent_configs set published_at = now() where tenant_id = ${tenant.id}`;
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
