/**
 * `_shared/provisioning/compile-and-publish.ts` (PARITY-1, docs/BUILD_NOTES.md):
 * the single compile -> create/update agent -> publish path both
 * `api-provision` (the real customer saga) and
 * `api-admin-provision-test-tenant` (the internal test-tenant path) call.
 *
 * Before this task the two functions independently duplicated this exact
 * sequence (CALL-1 wrote the test-tenant copy, SIGNUP-1 wrote/fixed the
 * real-saga copy) — every CALL-5/6/7/8/9 fix had to be applied to the
 * test-tenant path by hand and never reliably reached the real one (the
 * real saga's own `webhook_url` omission, found by CALL-5 via the SHARED
 * bug class, is the concrete example: fixed in one file, silently still
 * broken in the other, for days). Extracting this module means a future
 * fix here reaches both callers by construction — there is no second copy
 * left to fall out of sync.
 *
 * Retell has no in-place edit path once an agent has ANY version history
 * (RETELL-VERIFIED live 2026-09-20, `api-admin-provision-test-tenant/
 * handler.ts`'s own `compileAndCreateAgent` doc comment has the full
 * evidence) — `compileAndCreateAgent` below always creates a BRAND NEW
 * Retell agent from the tenant's current template. Callers that already
 * have a working agent (first-provision skip, or an explicit recompile)
 * decide for themselves whether to call it again; this module never
 * decides that policy, it only performs the compile+create+publish
 * mechanics once asked.
 */

import {
  AGENT_TEMPLATE_SEEDS,
  DEFAULT_TEMPLATE_MODEL,
  DEFAULT_TEMPLATE_VOICE_ID,
} from "../agent-template-seeds.ts";
import type {
  CompiledFlowRequest,
  CompilerAgentTemplate,
  PostCallAnalysisDataField,
} from "../compiler/template-compiler.ts";
import { compileTemplate as compileRetellTemplate } from "../compiler/template-compiler.ts";
import { resolveRetellAgentLanguage } from "../inbound-dynamic-variables.ts";
import type { RetellFetch } from "../providers/retell.ts";
import {
  createAgent,
  createConversationFlow,
  createRetellLLM,
  getAgent,
  publishAgentVersion,
} from "../providers/retell.ts";
import type { Logger, SqlClient } from "../types.ts";
import type { Vertical } from "../vertical-defaults.ts";

export interface CompileAndPublishDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** Passed to the compiler as every tool's webhook `url` (`/voice/tools`). */
  voiceToolsWebhookUrl: string;
  /** The deployed `/voice-events` function URL — set as the Retell AGENT
   * resource's own `webhook_url` (call_started/call_ended/call_analyzed
   * event delivery, CALL-5). Distinct from `voiceToolsWebhookUrl` (custom
   * tool calls) and from a phone number's own `inbound_webhook_url`
   * (`/voice-inbound`, set separately by whichever caller attaches the
   * number — this module never touches phone numbers). */
  eventsWebhookUrl: string;
  logger: Logger;
}

export interface CompiledTemplateResult {
  templateId: string;
  templateVersion: number;
  voiceId: string;
  model: string;
  agentName: string;
  /** QA-HOT (docs/BUILD_NOTES.md): Retell's agent-level `language` field
   * (STT locale + default TTS voice), resolved from this tenant's
   * `tenants.language_config.primary` via
   * `resolveRetellAgentLanguage` — see that function's own doc comment
   * for why this is a SEPARATE thing from the compiled prompt's
   * `{{language}}` dynamic-variable instruction. */
  language: string;
  disclosureVerified: boolean;
  flow: CompiledFlowRequest;
  /** ANALYSIS-1 (docs/BUILD_NOTES.md): the template's dead per-state
   * `extraction[]` declarations, actually compiled into Retell's real
   * `post_call_analysis_data` shape now — see
   * `_shared/compiler/template-compiler.ts#buildPostCallAnalysisData`. */
  postCallAnalysisData: PostCallAnalysisDataField[];
}

/**
 * Seeds ONE active `agent_templates` row for `vertical` from
 * `agent-template-seeds.ts` when none exists yet (CALL-1: the live
 * project's `agent_templates` table has no seed/sync script wiring
 * `packages/templates`' registry into a hosted project). Idempotent: a
 * concurrent/second call racing this insert is caught by the
 * `(vertical, version)` unique constraint. `forceReseed` re-applies the
 * seed content over an already-seeded row (CALL-2) — used by the
 * test-tenant path's `force_recompile`; the real saga never sets it (a
 * real tenant's template content is what an admin published, never
 * silently overwritten by the built-in seed).
 */
export async function ensureTemplateSeeded(
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

/**
 * Resolves the tenant's active vertical template and runs it through the
 * shared compiler. PUBLISH-1 (docs/BUILD_NOTES.md): no longer reads
 * `agent_configs.transfer_number` here — the compiled flow always
 * references the live `{{transfer_number}}` dynamic variable now (see
 * `template-compiler.ts`'s own doc comments), resolved by Retell per call,
 * so a tenant's transfer number (G6 — tenant-config-only, still) never
 * needs to be baked in at compile time. `null` means no active
 * `agent_templates` row exists for `vertical` even after
 * `ensureTemplateSeeded` ran (should not happen in practice, defensive).
 */
export async function compileTenantTemplate(
  sql: SqlClient,
  tenantId: string,
  vertical: Vertical,
  deps: Pick<CompileAndPublishDeps, "voiceToolsWebhookUrl">,
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

  // QA-HOT: one extra indexed read (provisioning path, not the hot
  // `/voice/tools` path — no latency-budget concern), scoped to this exact
  // tenant only (CLAUDE.md Rule 2).
  const languageRows = await sql<{ language_primary: string }>`
    select coalesce(language_config ->> 'primary', 'en') as language_primary
    from public.tenants where id = ${tenantId}
  `;
  const language = resolveRetellAgentLanguage(languageRows[0]?.language_primary ?? "en");

  const template: CompilerAgentTemplate = {
    compile_target: row["compile_target"] as CompilerAgentTemplate["compile_target"],
    system_prompt: (row["system_prompt"] as string | null) ?? null,
    states: (row["states"] as CompilerAgentTemplate["states"]) ?? [],
    transitions: (row["transitions"] as CompilerAgentTemplate["transitions"]) ?? [],
    global_intents: (row["global_intents"] as CompilerAgentTemplate["global_intents"]) ?? [],
    tools: (row["tools"] as CompilerAgentTemplate["tools"]) ?? [],
    disclosure_line: row["disclosure_line"] as string,
  };

  // PUBLISH-1 (docs/BUILD_NOTES.md): no `agent_configs.transfer_number`
  // lookup needed here any more — the compiled flow now ALWAYS references
  // the live `{{transfer_number}}` dynamic variable (resolved by Retell
  // per call, from `_shared/inbound-dynamic-variables.ts`), never a
  // literal baked in at compile time. This is exactly what makes a
  // tenant's transfer-number change take effect on the next call without
  // a republish (ONBOARD-1's live-observed gap).
  const compiled = compileRetellTemplate(template, deps.voiceToolsWebhookUrl);

  return {
    templateId: row["id"] as string,
    templateVersion: row["version"] as number,
    voiceId: row["voice_id"] as string,
    model: row["model"] as string,
    // Single, canonical agent-name convention (PARITY-1 — previously
    // `heyloo-tenant-*` from the real saga vs `heyloo-test-tenant-*` from
    // the admin path; cosmetic-only, Retell's internal label, never
    // spoken, but a real difference the diff table flagged). A tenant is
    // a tenant regardless of `is_test`.
    agentName: `heyloo-tenant-${tenantId}`,
    language,
    disclosureVerified: compiled.disclosureVerified,
    flow: compiled.flow,
    postCallAnalysisData: compiled.postCallAnalysisData,
  };
}

export type CompileAndCreateOutcome =
  | { ok: true; agentId: string; templateId: string; templateVersion: number }
  | { ok: false; status: number; error: string };

/**
 * Compiles the tenant's current template and creates a BRAND-NEW Retell
 * agent from it (new `agent_id`), upserting `agent_configs`. HARD-FAILS
 * (never calls Retell) when the compiled flow's first turn doesn't contain
 * `disclosure_line` verbatim (CLAUDE.md Rule 2, G1/G2).
 */
export async function compileAndCreateAgent(
  sql: SqlClient,
  tenantId: string,
  vertical: Vertical,
  deps: CompileAndPublishDeps,
  forceReseed = false,
): Promise<CompileAndCreateOutcome> {
  const compiled = await compileTenantTemplate(sql, tenantId, vertical, deps, forceReseed);
  if (!compiled) {
    deps.logger.error("compile_and_publish_no_active_template", { tenant_id: tenantId, vertical });
    return { ok: false, status: 422, error: "no_active_template_for_vertical" };
  }
  if (!compiled.disclosureVerified) {
    deps.logger.error("compile_and_publish_disclosure_gate_failed", { tenant_id: tenantId });
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
    deps.logger.error("compile_and_publish_flow_create_failed", {
      tenant_id: tenantId,
      status: flowResult.status,
      body: JSON.stringify(flowResult.body).slice(0, 1000),
    });
    return { ok: false, status: 502, error: "retell_flow_create_failed" };
  }

  const responseEngine =
    compiled.flow.kind === "conversation_flow"
      ? { type: "conversation-flow" as const, conversation_flow_id: flowId }
      : { type: "retell-llm" as const, llm_id: flowId };
  const created = await createAgent(deps.retellFetch, deps.retellApiKey, {
    agent_name: compiled.agentName,
    voice_id: compiled.voiceId,
    response_engine: responseEngine,
    webhook_url: deps.eventsWebhookUrl,
    webhook_timeout_ms: 10000,
    // QA-HOT (docs/BUILD_NOTES.md): previously never sent at all — every
    // agent, regardless of the tenant's own `tenants.language_config`,
    // silently got Retell's `en-US` default (RETELL-VERIFIED,
    // docs.retellai.com/api-references/create-agent) for STT/TTS, so a
    // Spanish-configured tenant's caller speech was transcribed as if it
    // were English. `compiled.language` is resolved from that tenant's own
    // config just above.
    language: compiled.language,
    // ANALYSIS-1 (docs/BUILD_NOTES.md): every agent, real or test, gets its
    // template's post-call extraction schema by construction — previously
    // never sent to Retell at all (SELFCALL-1's own live-observed gap:
    // `call_analysis.custom_analysis_data` came back `{}` on two real
    // calls). Omitted entirely (not `[]`) when a template declares none,
    // matching `post_call_analysis_data`'s own nullable/optional field
    // (RETELL-VERIFIED, docs.retellai.com/api-references/create-agent).
    ...(compiled.postCallAnalysisData.length > 0
      ? {
          post_call_analysis_data: compiled.postCallAnalysisData,
          // RETELL-VERIFIED: a documented member of the `NullableLLMModel`
          // enum on this same field — reuses the template's own compiled
          // model rather than Retell's platform default so a tenant's
          // template `model` override also governs analysis quality/cost.
          post_call_analysis_model: compiled.model,
        }
      : {}),
  });
  const createdBody = created.body as { agent_id?: string };
  if (!created.ok || !createdBody.agent_id) {
    deps.logger.error("compile_and_publish_create_agent_failed", {
      tenant_id: tenantId,
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
      ${tenantId}, ${compiled.templateId}, ${compiled.templateVersion}, ${agentId}, ${retellLlmId},
      ${{ compileTarget: compiled.flow.kind, flow: compiled.flow.body, response_engine: responseEngine }}::jsonb
    )
    on conflict (tenant_id) do update set
      retell_agent_id = excluded.retell_agent_id, retell_llm_id = excluded.retell_llm_id,
      compiled_config = excluded.compiled_config, template_id = excluded.template_id,
      template_version = excluded.template_version, published_at = null
  `;
  return {
    ok: true,
    agentId,
    templateId: compiled.templateId,
    templateVersion: compiled.templateVersion,
  };
}

export type PublishAgentOutcome = { ok: true } | { ok: false; status: number; error: string };

/**
 * `GET /get-agent/{id}` -> `POST /publish-agent-version` (RETELL-VERIFY,
 * VERIFY-6: publish REQUIRES a `{version}` body, always freshly read —
 * never assumed from create-time, since this may be resuming with an
 * already-existing agent id). Updates `agent_configs.published_at` +
 * flips `tenants.status` to `active` on success.
 */
export async function publishTenantAgent(
  sql: SqlClient,
  tenantId: string,
  agentId: string,
  deps: Pick<CompileAndPublishDeps, "retellFetch" | "retellApiKey" | "logger">,
): Promise<PublishAgentOutcome> {
  const agentForPublish = await getAgent(deps.retellFetch, deps.retellApiKey, agentId);
  const agentForPublishBody = agentForPublish.body as { version?: number };
  if (!agentForPublish.ok || agentForPublishBody.version === undefined) {
    deps.logger.error("compile_and_publish_get_agent_failed", {
      tenant_id: tenantId,
      status: agentForPublish.status,
    });
    return { ok: false, status: 502, error: "retell_get_agent_failed" };
  }
  const published = await publishAgentVersion(
    deps.retellFetch,
    deps.retellApiKey,
    agentId,
    agentForPublishBody.version,
  );
  if (!published.ok) {
    deps.logger.error("compile_and_publish_publish_failed", {
      tenant_id: tenantId,
      status: published.status,
      body: JSON.stringify(published.body).slice(0, 500),
    });
    return { ok: false, status: 502, error: "retell_publish_agent_failed" };
  }
  await sql`update public.agent_configs set published_at = now() where tenant_id = ${tenantId}`;
  await sql`update public.tenants set status = case when status = 'trialing' then 'active' else status end where id = ${tenantId}`;
  return { ok: true };
}

export type CompileCreateAndPublishOutcome =
  | { ok: true; agentId: string; templateId: string; templateVersion: number }
  | { ok: false; status: number; error: string };

/**
 * Convenience wrapper: `compileAndCreateAgent` then `publishTenantAgent` in
 * one call. Both `api-provision` (real saga) and
 * `api-admin-provision-test-tenant` (first provision, and any recompile)
 * call this same function — see this module's header.
 */
export async function compileCreateAndPublish(
  sql: SqlClient,
  tenantId: string,
  vertical: Vertical,
  deps: CompileAndPublishDeps,
  forceReseed = false,
): Promise<CompileCreateAndPublishOutcome> {
  const created = await compileAndCreateAgent(sql, tenantId, vertical, deps, forceReseed);
  if (!created.ok) return created;
  const published = await publishTenantAgent(sql, tenantId, created.agentId, deps);
  if (!published.ok) return published;
  return {
    ok: true,
    agentId: created.agentId,
    templateId: created.templateId,
    templateVersion: created.templateVersion,
  };
}
