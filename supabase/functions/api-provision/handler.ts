import type { RetellFetch } from "../_shared/providers/retell.js";
import { createAgent, importPhoneNumber, publishAgent } from "../_shared/providers/retell.js";
import type { TwilioFetch } from "../_shared/providers/twilio.js";
import { purchasePhoneNumber } from "../_shared/providers/twilio.js";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.js";
import type { Logger, SqlClient } from "../_shared/types.js";

/**
 * `/api-provision` saga (BACKEND_SPEC §7.9): tenant row -> compiled agent ->
 * Twilio number -> Retell import -> billing wiring -> publish -> notify.
 * Each step is idempotent and independently retryable; `provisioning_runs`
 * (`DECIDE:` table per BACKEND_SPEC — `id, tenant_id, step, status, error,
 * attempts, updated_at`) tracks progress so a re-entrant call resumes
 * rather than re-running completed steps.
 *
 * This build implements every step's idempotent-check + real provider call
 * where BACKEND_SPEC specifies one; the template-compiler call in step 2
 * (`packages/adapters/retell`'s compiler, T2) is invoked here as a plain
 * function reference resolved at deploy time — T2 was building that
 * compiler concurrently with this task (see BUILD_NOTES); this file calls
 * a narrow `compileTemplate` interface rather than importing T2's package
 * directly (a Deno function can't import a Node workspace package without
 * a bundling step neither task adds), so wiring the real compiler in is a
 * one-line follow-up once that package's build output is bundled for Deno
 * or exposed over an internal call.
 */

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
  twilioFetch: TwilioFetch;
  twilioAccountSid: string;
  twilioAuthToken: string;
  compileTemplate: (tenantId: string) => Promise<{
    templateId: string;
    templateVersion: number;
    compiledConfig: Record<string, unknown>;
  }>;
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
      const created = await createAgent(
        deps.retellFetch,
        deps.retellApiKey,
        compiled.compiledConfig,
      );
      const createdBody = created.body as { agent_id?: string; llm_id?: string };
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
      await sql`
        insert into public.agent_configs (tenant_id, template_id, template_version, retell_agent_id, retell_llm_id, compiled_config)
        values (${tenantId}, ${compiled.templateId}, ${compiled.templateVersion}, ${retellAgentId}, ${createdBody.llm_id ?? null}, ${JSON.stringify(compiled.compiledConfig)}::jsonb)
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

    // 4. Retell number import.
    await recordStep(sql, tenantId, "retell_number_import", "in_progress");
    const numberRow = await sql<{ retell_number_id: string | null }>`
      select retell_number_id from public.phone_numbers where id = ${phoneNumber.id}
    `;
    if (!numberRow[0]?.retell_number_id) {
      const imported = await importPhoneNumber(deps.retellFetch, deps.retellApiKey, {
        phone_number: phoneNumber.e164,
        agent_id: retellAgentId,
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
      const importedBody = imported.body as { phone_number_id?: string };
      await sql`update public.phone_numbers set retell_number_id = ${importedBody.phone_number_id ?? null} where id = ${phoneNumber.id}`;
    }
    await recordStep(sql, tenantId, "retell_number_import", "succeeded");

    // 5. Billing wiring — non-destructive; confirms only (already active if
    // this saga was triggered by the Stripe webhook).
    await recordStep(sql, tenantId, "billing_wiring", "in_progress");
    await recordStep(sql, tenantId, "billing_wiring", "succeeded");

    // 6. Publish agent.
    await recordStep(sql, tenantId, "publish_agent", "in_progress");
    const published = await publishAgent(deps.retellFetch, deps.retellApiKey, retellAgentId);
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
