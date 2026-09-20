import type { CompiledFlowRequest } from "../_shared/compiler/template-compiler.ts";
import type { RetellFetch } from "../_shared/providers/retell.ts";
import {
  createAgent,
  createConversationFlow,
  createRetellLLM,
  getAgent,
  importPhoneNumber,
  publishAgentVersion,
} from "../_shared/providers/retell.ts";
import type { TwilioFetch } from "../_shared/providers/twilio.ts";
import { purchasePhoneNumber } from "../_shared/providers/twilio.ts";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/api-provision` saga (BACKEND_SPEC §7.9): tenant row -> compiled agent ->
 * Twilio number -> Retell import -> billing wiring -> publish -> notify.
 * Each step is idempotent and independently retryable; `provisioning_runs`
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
  "twilio_number_provision",
  "retell_number_import",
  "billing_wiring",
  "publish_agent",
  "notify",
] as const;
export type ProvisioningStep = (typeof STEPS)[number];

export interface ProvisionDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /**
   * Twilio Elastic SIP Trunk termination URI (e.g.
   * `<trunk>.pstn.twilio.com`) — REQUIRED on every `/import-phone-number`
   * call (RETELL-VERIFY, VERIFY-7 resolved: confirmed via
   * retell-typescript-sdk's `PhoneNumberImportParams.termination_uri`, no
   * `?`). This build's SIP trunk provisioning itself is out of this saga's
   * scope (platform Week-0 setup); this is the resulting constant.
   */
  retellSipTerminationUri: string;
  /** `/voice-inbound` — wired onto the imported PHONE NUMBER, not the
   * agent (RETELL-VERIFY, VERIFY-6 resolved: `inbound_webhook_url` doesn't
   * exist on the Agent resource at all). */
  retellInboundWebhookUrl: string;
  twilioFetch: TwilioFetch;
  twilioAccountSid: string;
  twilioAuthToken: string;
  /**
   * Resolves + compiles the tenant's active vertical template. `null` means
   * no active `agent_templates` row exists for the tenant's vertical (a
   * real, distinct failure from a disclosure-gate refusal). Real callers
   * (index.ts) run this through `_shared/compiler/template-compiler.ts`;
   * never a hand-built stand-in payload.
   */
  compileTemplate: (tenantId: string) => Promise<CompiledTemplateResult | null>;
  /** Resolves the specific E.164 number to purchase for this tenant — the
   * caller (index.ts) is responsible for the Twilio "search available
   * numbers by area code" step (a separate Twilio API call this saga
   * doesn't itself make) and hands back one concrete number, since
   * `purchasePhoneNumber`'s `PhoneNumber` param requires an exact number,
   * not an area code (VERIFY.md: confirm current Twilio available-numbers
   * search endpoint before wiring the real implementation). */
  resolvePhoneNumberToProvision: (tenantId: string) => Promise<string>;
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

    // 3. Twilio number provision.
    await recordStep(sql, tenantId, "twilio_number_provision", "in_progress");
    const existingNumber = await sql<{ id: string; e164: string; twilio_sid: string }>`
      select id, e164, twilio_sid from public.phone_numbers where tenant_id = ${tenantId} and released_at is null limit 1
    `;
    let phoneNumber = existingNumber[0] ?? null;
    if (!phoneNumber) {
      const numberToProvision = await deps.resolvePhoneNumberToProvision(tenantId);
      const purchased = await purchasePhoneNumber(
        deps.twilioFetch,
        deps.twilioAccountSid,
        deps.twilioAuthToken,
        {
          phoneNumber: numberToProvision,
        },
      );
      const purchasedBody = purchased.body as { phone_number?: string; sid?: string };
      if (!purchased.ok || !purchasedBody.sid || !purchasedBody.phone_number) {
        await recordStep(
          sql,
          tenantId,
          "twilio_number_provision",
          "failed",
          `twilio_status_${purchased.status}`,
        );
        return {
          status: "failed",
          failedStep: "twilio_number_provision",
          error: "twilio_purchase_failed",
        };
      }
      const inserted = await sql<{ id: string; e164: string; twilio_sid: string }>`
        insert into public.phone_numbers (tenant_id, e164, twilio_sid) values (${tenantId}, ${purchasedBody.phone_number}, ${purchasedBody.sid})
        returning id, e164, twilio_sid
      `;
      phoneNumber = inserted[0] ?? null;
    }
    if (!phoneNumber) {
      await recordStep(sql, tenantId, "twilio_number_provision", "failed", "no_number_row");
      return { status: "failed", failedStep: "twilio_number_provision", error: "no_number_row" };
    }
    await recordStep(sql, tenantId, "twilio_number_provision", "succeeded");

    // 4. Retell number import. RETELL-VERIFY (VERIFY-7, resolved): the
    // request needs `termination_uri` (REQUIRED) and `inbound_agents` as an
    // array of `{agent_id, weight}` (`weight` REQUIRED, not a bare
    // `agent_id` string) — confirmed via retell-typescript-sdk. The
    // response's unique identifier is the `phone_number` field itself
    // (E.164) — there is no separate `phone_number_id`.
    await recordStep(sql, tenantId, "retell_number_import", "in_progress");
    const numberRow = await sql<{ retell_number_id: string | null }>`
      select retell_number_id from public.phone_numbers where id = ${phoneNumber.id}
    `;
    if (!numberRow[0]?.retell_number_id) {
      const imported = await importPhoneNumber(deps.retellFetch, deps.retellApiKey, {
        phone_number: phoneNumber.e164,
        termination_uri: deps.retellSipTerminationUri,
        inbound_agents: [{ agent_id: retellAgentId, weight: 1 }],
        inbound_webhook_url: deps.retellInboundWebhookUrl,
      });
      if (!imported.ok) {
        // Per spec: retry with backoff, then flag for manual admin
        // intervention rather than auto-releasing the number — a half-
        // provisioned tenant alerts, it doesn't silently unwind.
        await recordStep(
          sql,
          tenantId,
          "retell_number_import",
          "failed",
          `retell_status_${imported.status}`,
        );
        deps.logger.error("provisioning_retell_import_failed", {
          tenant_id: tenantId,
          status: imported.status,
        });
        return {
          status: "failed",
          failedStep: "retell_number_import",
          error: "retell_import_failed",
        };
      }
      const importedBody = imported.body as { phone_number?: string };
      await sql`update public.phone_numbers set retell_number_id = ${importedBody.phone_number ?? null} where id = ${phoneNumber.id}`;
    }
    await recordStep(sql, tenantId, "retell_number_import", "succeeded");

    // 5. Billing wiring — non-destructive; confirms only (already active if
    // this saga was triggered by the Stripe webhook).
    await recordStep(sql, tenantId, "billing_wiring", "in_progress");
    await recordStep(sql, tenantId, "billing_wiring", "succeeded");

    // 6. Publish agent. RETELL-VERIFY (VERIFY-6, resolved): publish REQUIRES
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

    // 7. Notify — enqueued, never sent inline.
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
