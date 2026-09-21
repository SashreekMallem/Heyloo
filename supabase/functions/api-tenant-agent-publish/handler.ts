import { deleteAgent, updatePhoneNumber } from "../_shared/providers/retell.ts";
import type { CompileAndPublishDeps } from "../_shared/provisioning/compile-and-publish.ts";
import { compileCreateAndPublish } from "../_shared/provisioning/compile-and-publish.ts";
import type { SqlClient } from "../_shared/types.ts";
import type { Vertical } from "../_shared/vertical-defaults.ts";

/**
 * `/api-tenant-agent-publish` (PUBLISH-1, docs/BUILD_NOTES.md): the
 * owner-facing "Publish changes" action ONBOARD-1 found missing entirely —
 * before this, the only republish mechanism was `api-provision`'s
 * `action: "republish"`, which is `x-internal-secret`-only AND gated to
 * `tenants.is_test = true` (PARITY-1, deliberately: it must never reach a
 * real, billable tenant via that internal path). This function is the
 * real-tenant counterpart: reachable by the tenant's OWNER/ADMIN's own
 * JWT, `tenant_id` taken from the verified JWT claims only (never a body
 * param — CLAUDE.md Rule 2, this function takes no body at all, same
 * shape as `api-tenant-test-call`), and NOT gated to `is_test` (a real
 * tenant republishing their own agent is exactly the point).
 *
 * Compiles the tenant's CURRENT template/config (including — PUBLISH-1 —
 * a transfer-number change, though that alone no longer needs a republish
 * at all, since the compiled flow now reads it live via the
 * `{{transfer_number}}` dynamic variable; a republish is still needed for
 * anything the compiler bakes in as a literal, e.g. a template content
 * change or a vertical/assistant-name-driven prompt edit) into a
 * BRAND-NEW Retell agent (Retell has no in-place edit path once an agent
 * has version history — `compile-and-publish.ts`'s own doc comment),
 * publishes it, re-points the tenant's EXISTING phone number's
 * `inbound_agents` ONLY (never `outbound_agents` — same partial-PATCH
 * shape `api-provision#republishTenantAgent` already established, so a
 * concurrent outbound use of this tenant's own number, if any, is
 * untouched), and — CALL-2/CALL-7's `cleanup_superseded_agent` semantics,
 * kept here too — best-effort deletes the OLD agent once the new one is
 * confirmed working, so a tenant's Retell account doesn't accumulate
 * orphaned agents across repeated publishes.
 */
export interface PublishAgentDeps extends CompileAndPublishDeps {
  /** `/voice-inbound` — wired onto the phone number (not the agent), same
   * as `api-provision`'s own `retellInboundWebhookUrl`. */
  retellInboundWebhookUrl: string;
}

export type PublishAgentResult =
  | {
      status: 200;
      body: { tenant_id: string; agent_id: string; published_at: string | null };
    }
  | { status: 404; body: { error: "tenant_not_found" } }
  // The broad `{status: number; body: {error: string}}` shape below covers
  // every error `compileCreateAndPublish` itself can return (422
  // no_active_template_for_vertical/disclosure_gate_failed, 502
  // retell_flow_create_failed/retell_create_agent_failed/
  // retell_get_agent_failed/retell_publish_agent_failed — see
  // `compile-and-publish.ts`'s own `CompileCreateAndPublishOutcome`) plus
  // this function's own 502 retell_update_phone_number_failed — mirrors
  // `api-provision`'s own `RepublishResult` convention exactly.
  | { status: number; body: { error: string } };

export async function handlePublishAgent(
  sql: SqlClient,
  tenantId: string,
  deps: PublishAgentDeps,
): Promise<PublishAgentResult> {
  const tenantRows = await sql<{ vertical: Vertical }>`
    select vertical from public.tenants where id = ${tenantId} and deleted_at is null
  `;
  const tenant = tenantRows[0];
  if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };

  // Captured BEFORE compiling the new agent — `cleanup_superseded_agent`
  // below only ever deletes the id this tenant's OWN prior config row
  // held, never a guess (CALL-7's established rule, mirrored from
  // `api-admin-provision-test-tenant/handler.ts`).
  const priorConfigRows = await sql<{ retell_agent_id: string | null }>`
    select retell_agent_id from public.agent_configs where tenant_id = ${tenantId}
  `;
  const supersededAgentId = priorConfigRows[0]?.retell_agent_id ?? null;

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
      deps.logger.error("tenant_agent_publish_number_repoint_failed", {
        tenant_id: tenantId,
        status: updated.status,
      });
      return { status: 502, body: { error: "retell_update_phone_number_failed" } };
    }
  }

  // cleanup_superseded_agent (CALL-2/CALL-7): only reached once the NEW
  // agent is created and published, so the tenant always has a working
  // agent on file before its old one is ever deleted. Best-effort — a
  // failed delete never fails this publish (the tenant's number and
  // `agent_configs` row already point at the new agent by this point).
  if (supersededAgentId && supersededAgentId !== published.agentId) {
    const deleted = await deleteAgent(deps.retellFetch, deps.retellApiKey, supersededAgentId);
    if (!deleted.ok) {
      deps.logger.warn("tenant_agent_publish_cleanup_superseded_agent_failed", {
        tenant_id: tenantId,
        superseded_agent_id: supersededAgentId,
        status: deleted.status,
      });
    } else {
      deps.logger.info("tenant_agent_publish_cleanup_superseded_agent_deleted", {
        tenant_id: tenantId,
        superseded_agent_id: supersededAgentId,
      });
    }
  }

  const configRows = await sql<{ published_at: string | null }>`
    select published_at from public.agent_configs where tenant_id = ${tenantId}
  `;

  deps.logger.info("tenant_agent_published", { tenant_id: tenantId, agent_id: published.agentId });

  return {
    status: 200,
    body: {
      tenant_id: tenantId,
      agent_id: published.agentId,
      published_at: configRows[0]?.published_at ?? null,
    },
  };
}
