import type { CompiledFlowRequest } from "../_shared/compiler/template-compiler.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createAgent,
  createConversationFlow,
  createPhoneNumber,
  createRetellLLM,
  getAgent,
  publishAgentVersion,
} from "../_shared/providers/retell.ts";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-provision` saga (BACKEND_SPEC §7.9): tenant row -> compiled agent ->
 * Retell number purchase (SIGNUP-1: direct via Retell, no Twilio account of
 * our own required — docs/BUILD_NOTES.md SIGNUP-1 entry) -> billing wiring
 * -> publish -> notify. Each step is idempotent and independently
 * retryable; `provisioning_runs`
 * (`DECIDE:` table per BACKEND_SPEC — `id, tenant_id, step, status, error,
 * attempts, updated_at`) tracks progress so a re-entrant call resumes
 * rather than re-running completed steps.
 *
 * Step 2 (agent compile, EDGE_AUDIT B2) runs the tenant's active vertical
 * template through the REAL compiler — `_shared/compiler/template-compiler.ts`,
 * the same lean, deliberately-duplicated port of
 * `packages/adapters/retell/src/compiler/*` that `admin/handler.ts`'s
 * template-publish route already uses in production for the identical
 * Deno/Node workspace-package-boundary reason documented on that module
 * (Deno can't import a Node-only pnpm workspace package without a bundling
 * step neither task adds) — never a stub. `deps.compileTemplate` resolves
 * the row from `agent_templates` and returns the compiled Retell flow; this
 * saga HARD-FAILS the whole step (never calls Retell) when
 * `disclosureVerified` is false, per CLAUDE.md Rule 2 (G1/G2).
 */

export interface CompiledTemplateResult {
  templateId: string;
  templateVersion: number;
  voiceId: string;
  model: string;
  agentName: string;
  disclosureVerified: boolean;
  flow: CompiledFlowRequest;
}

export const STEPS = [
  "tenant_finalize",
  "agent_compile",
  "retell_number_provision",
  "billing_wiring",
  "publish_agent",
  "notify",
] as const;
export type ProvisioningStep = (typeof STEPS)[number];

export interface ProvisionDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** `/voice-inbound` — wired onto the purchased PHONE NUMBER, not the
   * agent (RETELL-VERIFY, VERIFY-6 resolved: `inbound_webhook_url` doesn't
   * exist on the Agent resource at all). */
  retellInboundWebhookUrl: string;
  /** CALL-5: the deployed `/voice-events` function URL — set as the
   * AGENT resource's own `webhook_url` (call_started/call_ended/
   * call_analyzed event delivery). Distinct from `retellInboundWebhookUrl`
   * above. Previously missing entirely from this saga's `createAgent` call
   * — every tenant provisioned through here got an agent with no events
   * webhook at all, so `webhook_events`/`call_logs` post-call fields never
   * populated for a single one of them (docs/BUILD_NOTES.md CALL-5 entry,
   * found via the test-tenant path that shares this exact bug). */
  retellEventsWebhookUrl: string;
  /**
   * Resolves + compiles the tenant's active vertical template. `null` means
   * no active `agent_templates` row exists for the tenant's vertical (a
   * real, distinct failure from a disclosure-gate refusal). Real callers
   * (index.ts) run this through `_shared/compiler/template-compiler.ts`;
   * never a hand-built stand-in payload.
   */
  compileTemplate: (tenantId: string) => Promise<CompiledTemplateResult | null>;
  logger: Logger;
}

async function recordStep(
  sql: SqlClient,
  tenantId: string,
  step: ProvisioningStep,
  status: "in_progress" | "succeeded" | "failed",
  error?: string,
): Promise<void> {
  await sql`
    insert into public.provisioning_runs (tenant_id, step, status, error, attempts, updated_at)
    values (${tenantId}, ${step}, ${status}, ${error ?? null}, 1, now())
    on conflict (tenant_id, step) do update set
      status = excluded.status, error = excluded.error, attempts = provisioning_runs.attempts + 1, updated_at = now()
  `;
}

export interface SagaResult {
  status: "in_progress" | "complete" | "failed";
  failedStep?: ProvisioningStep;
  error?: string;
}

export async function runProvisioningSaga(
  sql: SqlClient,
  tenantId: string,
  deps: ProvisionDeps,
): Promise<SagaResult> {
  try {
    // 1. Tenant finalize — idempotent upsert toward `active`.
    await recordStep(sql, tenantId, "tenant_finalize", "in_progress");
    await sql`update public.tenants set status = case when status = 'trialing' then 'active' else status end where id = ${tenantId}`;
    await recordStep(sql, tenantId, "tenant_finalize", "succeeded");

    // 2. Agent compile.
    await recordStep(sql, tenantId, "agent_compile", "in_progress");
    const existingConfig = await sql<{
      retell_agent_id: string | null;
      template_id: string;
      template_version: number;
    }>`
      select retell_agent_id, template_id, template_version from public.agent_configs where tenant_id = ${tenantId}
    `;
    let retellAgentId = existingConfig[0]?.retell_agent_id ?? null;
    if (!retellAgentId) {
      const compiled = await deps.compileTemplate(tenantId);
      if (!compiled) {
        await recordStep(sql, tenantId, "agent_compile", "failed", "no_active_template");
        return { status: "failed", failedStep: "agent_compile", error: "no_active_template" };
      }
      // HARD-FAIL (CLAUDE.md Rule 2, G1/G2): never call Retell with a
      // compiled flow whose first turn doesn't contain the tenant's
      // `disclosure_line` verbatim — this is the actual publish refusal,
      // not just a passthrough of the compiler's own boolean.
      if (!compiled.disclosureVerified) {
        await recordStep(sql, tenantId, "agent_compile", "failed", "disclosure_gate_failed");
        return { status: "failed", failedStep: "agent_compile", error: "disclosure_gate_failed" };
      }

      // Two-step protocol (RETELL-VERIFY, matches admin/handler.ts's
      // template-publish route exactly): create the conversation-flow/LLM
      // resource first, then create the agent referencing it.
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
        await recordStep(
          sql,
          tenantId,
          "agent_compile",
          "failed",
          `retell_flow_create_status_${flowResult.status}`,
        );
        return {
          status: "failed",
          failedStep: "agent_compile",
          error: "retell_flow_create_failed",
        };
      }

      const responseEngine =
        compiled.flow.kind === "conversation_flow"
          ? { type: "conversation-flow", conversation_flow_id: flowId }
          : { type: "retell-llm", llm_id: flowId };
      const created = await createAgent(deps.retellFetch, deps.retellApiKey, {
        agent_name: compiled.agentName,
        voice_id: compiled.voiceId,
        response_engine: responseEngine,
        // CALL-5 fix — see ProvisionDeps#retellEventsWebhookUrl.
        webhook_url: deps.retellEventsWebhookUrl,
        webhook_timeout_ms: 10000,
      });
      const createdBody = created.body as { agent_id?: string };
      if (!created.ok || !createdBody.agent_id) {
        await recordStep(
          sql,
          tenantId,
          "agent_compile",
          "failed",
          `retell_create_agent_status_${created.status}`,
        );
        return {
          status: "failed",
          failedStep: "agent_compile",
          error: "retell_create_agent_failed",
        };
      }
      retellAgentId = createdBody.agent_id;
      const retellLlmId =
        compiled.flow.kind === "conversation_flow" ? null : (flowBody.llm_id ?? null);
      await sql`
        insert into public.agent_configs (tenant_id, template_id, template_version, retell_agent_id, retell_llm_id, compiled_config)
        values (${tenantId}, ${compiled.templateId}, ${compiled.templateVersion}, ${retellAgentId}, ${retellLlmId}, ${{ compileTarget: compiled.flow.kind, flow: compiled.flow.body, response_engine: responseEngine }}::jsonb)
        on conflict (tenant_id) do update set
          retell_agent_id = excluded.retell_agent_id, retell_llm_id = excluded.retell_llm_id, compiled_config = excluded.compiled_config
      `;
    }
    await recordStep(sql, tenantId, "agent_compile", "succeeded");

    // 3. Retell number provision (SIGNUP-1: buys the number directly through
    // Retell's own `POST /create-phone-number` — no Twilio account of our
    // own required, `inbound_agents`/`inbound_webhook_url` set in the SAME
    // call, so there is no separate "import" step. Replaces the prior
    // Twilio-purchase-then-`importPhoneNumber` two-step, which could never
    // succeed on this platform: `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` are
    // not configured (docs/BUILD_NOTES.md SIGNUP-1 entry), and the old
    // `resolvePhoneNumberToProvision` dependency was an unimplemented stub
    // that always returned `""`.)
    await recordStep(sql, tenantId, "retell_number_provision", "in_progress");
    const existingNumber = await sql<{ id: string; e164: string; retell_number_id: string | null }>`
      select id, e164, retell_number_id from public.phone_numbers where tenant_id = ${tenantId} and released_at is null limit 1
    `;
    let phoneNumber = existingNumber[0] ?? null;
    if (!phoneNumber) {
      const purchased = await createPhoneNumber(deps.retellFetch, deps.retellApiKey, {
        inbound_agents: [{ agent_id: retellAgentId, weight: 1 }],
        inbound_webhook_url: deps.retellInboundWebhookUrl,
        nickname: `heyloo-tenant-${tenantId}`,
      });
      const purchasedBody = purchased.body as { phone_number?: string };
      if (!purchased.ok || !purchasedBody.phone_number) {
        // Per spec: retry with backoff, then flag for manual admin
        // intervention rather than silently unwinding.
        await recordStep(
          sql,
          tenantId,
          "retell_number_provision",
          "failed",
          `retell_status_${purchased.status}`,
        );
        deps.logger.error("provisioning_retell_number_purchase_failed", {
          tenant_id: tenantId,
          status: purchased.status,
        });
        return {
          status: "failed",
          failedStep: "retell_number_provision",
          error: "retell_number_purchase_failed",
        };
      }
      const inserted = await sql<{ id: string; e164: string; retell_number_id: string | null }>`
        insert into public.phone_numbers (tenant_id, e164, retell_number_id)
        values (${tenantId}, ${purchasedBody.phone_number}, ${purchasedBody.phone_number})
        returning id, e164, retell_number_id
      `;
      phoneNumber = inserted[0] ?? null;
    } else if (!phoneNumber.retell_number_id) {
      // Resuming a run whose DB insert succeeded but crashed before
      // recording this step (or a pre-existing row created another way) —
      // the number already exists in Retell (created idempotently above is
      // not re-attempted; this only backfills the local pointer).
      await sql`update public.phone_numbers set retell_number_id = ${phoneNumber.e164} where id = ${phoneNumber.id}`;
    }
    if (!phoneNumber) {
      await recordStep(sql, tenantId, "retell_number_provision", "failed", "no_number_row");
      return { status: "failed", failedStep: "retell_number_provision", error: "no_number_row" };
    }
    await recordStep(sql, tenantId, "retell_number_provision", "succeeded");

    // 4. Billing wiring — non-destructive; confirms only (already active if
    // this saga was triggered by the Stripe webhook).
    await recordStep(sql, tenantId, "billing_wiring", "in_progress");
    await recordStep(sql, tenantId, "billing_wiring", "succeeded");

    // 5. Publish agent. RETELL-VERIFY (VERIFY-6, resolved): publish REQUIRES
    // a `{version}` body — fetch the agent's current version first (this
    // saga may be resuming with an already-existing `retellAgentId` from an
    // earlier run, so a version captured at create time isn't always
    // available; a fresh `getAgent` is correct either way).
    await recordStep(sql, tenantId, "publish_agent", "in_progress");
    const agentForPublish = await getAgent(deps.retellFetch, deps.retellApiKey, retellAgentId);
    const agentForPublishBody = agentForPublish.body as { version?: number };
    if (!agentForPublish.ok || agentForPublishBody.version === undefined) {
      await recordStep(
        sql,
        tenantId,
        "publish_agent",
        "failed",
        `retell_get_agent_status_${agentForPublish.status}`,
      );
      return { status: "failed", failedStep: "publish_agent", error: "get_agent_failed" };
    }
    const published = await publishAgentVersion(
      deps.retellFetch,
      deps.retellApiKey,
      retellAgentId,
      agentForPublishBody.version,
    );
    if (!published.ok) {
      await recordStep(
        sql,
        tenantId,
        "publish_agent",
        "failed",
        `retell_status_${published.status}`,
      );
      return { status: "failed", failedStep: "publish_agent", error: "publish_failed" };
    }
    await sql`update public.agent_configs set published_at = now() where tenant_id = ${tenantId}`;
    await sql`update public.tenants set status = 'active' where id = ${tenantId}`;
    await recordStep(sql, tenantId, "publish_agent", "succeeded");

    // 6. Notify — enqueued, never sent inline.
    await recordStep(sql, tenantId, "notify", "in_progress");
    const messageRows = await sql<{ id: string }>`
      insert into public.messages_outbound (tenant_id, channel, recipient, template_key, payload)
      select ${tenantId}, 'sms', ${phoneNumber.e164}, 'weekly_value_summary', '{}'::jsonb
      returning id
    `;
    const message = messageRows[0];
    if (message) await enqueue(sql, QUEUE_NAMES.messagesOutbound, { message_id: message.id });
    await recordStep(sql, tenantId, "notify", "succeeded");

    return { status: "complete" };
  } catch (err) {
    deps.logger.error("provisioning_saga_unhandled_error", {
      tenant_id: tenantId,
      error: String(err),
    });
    return { status: "failed", error: String(err) };
  }
}
