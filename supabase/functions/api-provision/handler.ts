import type { RetellFetch } from "../_shared/providers/retell.ts";
import { createPhoneNumber, updatePhoneNumber } from "../_shared/providers/retell.ts";
import {
  type CompileAndPublishDeps,
  compileAndCreateAgent,
  compileCreateAndPublish,
  publishTenantAgent,
} from "../_shared/provisioning/compile-and-publish.ts";
import { enqueue, QUEUE_NAMES } from "../_shared/queue.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { Vertical } from "../_shared/vertical-defaults.ts";

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
 * PARITY-1 (docs/BUILD_NOTES.md): the compile -> create-agent -> publish
 * mechanics (step 2 + step 5 below) now delegate to
 * `_shared/provisioning/compile-and-publish.ts` — the SAME module
 * `api-admin-provision-test-tenant/handler.ts` calls — instead of an
 * independently duplicated copy. A fix there reaches both callers by
 * construction; this file only owns the parts genuinely specific to the
 * real saga (tenant-row lifecycle, number purchase, billing, notify).
 */

export const STEPS = [
  "tenant_finalize",
  "agent_compile",
  "retell_number_provision",
  "billing_wiring",
  "publish_agent",
  "notify",
] as const;
export type ProvisioningStep = (typeof STEPS)[number];

export interface ProvisionDeps extends CompileAndPublishDeps {
  retellFetch: RetellFetch;
  retellApiKey: string;
  /** `/voice-inbound` — wired onto the purchased PHONE NUMBER, not the
   * agent (RETELL-VERIFY, VERIFY-6 resolved: `inbound_webhook_url` doesn't
   * exist on the Agent resource at all). */
  retellInboundWebhookUrl: string;
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

    // 2. Agent compile — shared module (PARITY-1).
    await recordStep(sql, tenantId, "agent_compile", "in_progress");
    const existingConfig = await sql<{ retell_agent_id: string | null }>`
      select retell_agent_id from public.agent_configs where tenant_id = ${tenantId}
    `;
    let retellAgentId = existingConfig[0]?.retell_agent_id ?? null;
    if (!retellAgentId) {
      const tenantRows = await sql<{ vertical: Vertical }>`
        select vertical from public.tenants where id = ${tenantId}
      `;
      const vertical = tenantRows[0]?.vertical;
      if (!vertical) {
        await recordStep(sql, tenantId, "agent_compile", "failed", "tenant_not_found");
        return { status: "failed", failedStep: "agent_compile", error: "tenant_not_found" };
      }
      // Real tenants never auto-reseed their template content — only the
      // test-tenant path's explicit `force_recompile` does that.
      const created = await compileCreateAndPublishAgentOnly(sql, tenantId, vertical, deps);
      if (!created.ok) {
        await recordStep(sql, tenantId, "agent_compile", "failed", created.error);
        return { status: "failed", failedStep: "agent_compile", error: created.error };
      }
      retellAgentId = created.agentId;
    }
    await recordStep(sql, tenantId, "agent_compile", "succeeded");

    // 3. Retell number provision (SIGNUP-1: buys the number directly through
    // Retell's own `POST /create-phone-number` — no Twilio account of our
    // own required, `inbound_agents`/`inbound_webhook_url` set in the SAME
    // call, so there is no separate "import" step).
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

    // 5. Publish agent — shared module (PARITY-1).
    await recordStep(sql, tenantId, "publish_agent", "in_progress");
    const published = await publishTenantAgent(sql, tenantId, retellAgentId, deps);
    if (!published.ok) {
      await recordStep(sql, tenantId, "publish_agent", "failed", published.error);
      return { status: "failed", failedStep: "publish_agent", error: published.error };
    }
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

/** Thin wrapper: only the compile+create half of `compileCreateAndPublish`
 * (the saga publishes separately as its own tracked step 5, so it never
 * calls the combined helper directly — this keeps `agent_compile` and
 * `publish_agent` as two independently-retryable `provisioning_runs` rows,
 * matching this saga's existing step contract). */
async function compileCreateAndPublishAgentOnly(
  sql: SqlClient,
  tenantId: string,
  vertical: Vertical,
  deps: ProvisionDeps,
): Promise<{ ok: true; agentId: string } | { ok: false; error: string }> {
  const created = await compileAndCreateAgent(sql, tenantId, vertical, deps, false);
  if (!created.ok) return { ok: false, error: created.error };
  return { ok: true, agentId: created.agentId };
}

export type RepublishResult =
  | { status: 200; body: { tenant_id: string; agent_id: string } }
  | { status: number; body: { error: string } };

/**
 * PARITY-1 deliverable 3: re-provisioning path for an EXISTING real tenant
 * — guarded (index.ts) by `x-internal-secret` AND `tenants.is_test = true`,
 * so this can never be pointed at a paying customer's tenant. Compiles the
 * tenant's CURRENT template (whatever compiler/template fixes have landed
 * since the tenant was first provisioned) into a brand-new Retell agent
 * (Retell has no in-place edit path once an agent has version history —
 * see this module's own header and `compile-and-publish.ts`'s), publishes
 * it, then re-points the tenant's EXISTING phone number's `inbound_agents`
 * ONLY at the new agent — `outbound_agents` is never included in the PATCH
 * body, so a concurrent SELFCALL-1 run using this same number as an
 * outbound caller is untouched (`updatePhoneNumber` is a partial PATCH,
 * confirmed by `_shared/providers/retell.ts`'s own signature/doc comment).
 */
export async function republishTenantAgent(
  sql: SqlClient,
  tenantId: string,
  deps: ProvisionDeps,
): Promise<RepublishResult> {
  const tenantRows = await sql<{ vertical: Vertical; is_test: boolean }>`
    select vertical, is_test from public.tenants where id = ${tenantId} and deleted_at is null
  `;
  const tenant = tenantRows[0];
  if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };
  if (!tenant.is_test) return { status: 403, body: { error: "not_a_test_tenant" } };

  const configRows = await sql<{ retell_agent_id: string | null }>`
    select retell_agent_id from public.agent_configs where tenant_id = ${tenantId}
  `;
  if (!configRows[0]?.retell_agent_id) {
    return { status: 422, body: { error: "tenant_not_provisioned_yet" } };
  }

  const published = await compileCreateAndPublish(sql, tenantId, tenant.vertical, deps, false);
  if (!published.ok) {
    return { status: published.status, body: { error: published.error } };
  }

  const numberRows = await sql<{ e164: string }>`
    select e164 from public.phone_numbers
    where tenant_id = ${tenantId} and released_at is null
    order by is_primary desc, created_at asc limit 1
  `;
  const number = numberRows[0];
  if (number) {
    const updated = await updatePhoneNumber(deps.retellFetch, deps.retellApiKey, number.e164, {
      inbound_agents: [{ agent_id: published.agentId, weight: 1 }],
      inbound_webhook_url: deps.retellInboundWebhookUrl,
    });
    if (!updated.ok) {
      deps.logger.error("republish_tenant_agent_number_repoint_failed", {
        tenant_id: tenantId,
        status: updated.status,
      });
      return { status: 502, body: { error: "retell_update_phone_number_failed" } };
    }
  }

  return { status: 200, body: { tenant_id: tenantId, agent_id: published.agentId } };
}
