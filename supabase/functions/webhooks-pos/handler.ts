import type { Logger, SqlClient } from "../_shared/types.ts";

/**
 * `/webhooks-pos/{provider}` adapter-dispatch shell + shared side effects
 * (BACKEND_SPEC §7.6, T7). `index.ts` verifies the per-provider signature
 * scheme and normalizes the payload into the canonical `{type, external_id,
 * changes}` shape BEFORE calling this — this file implements the "Shared
 * side effects across all adapters" BACKEND_SPEC §7.6 describes, generalized
 * from T3's original Square-only version:
 *
 * - `auth_revoked`: resolve which tenant this event belongs to (via
 *   `adapter_connections.provider_account_id`, the merchant/practice/shop id
 *   captured at connect time — the webhook payload itself carries no
 *   tenant_id, only a provider-side account id) and mark that connection
 *   `disconnected` — never silently drop a push after a revocation (salvaged
 *   pattern, SYSTEM_DESIGN §14).
 * - `booking_changed`/`order_changed`: BACKEND_SPEC §7.6's conflict-handling
 *   requirement, generalized from the Airtable one-way-push precedent
 *   (`airtable_sync_state`, §10.3): if `adapter_sync_state` already has a row
 *   for this provider+external_id (i.e. WE pushed this booking/order
 *   ourselves), an external change notification for it means the connected
 *   system's own staff edited/cancelled something we already synced —
 *   flagged `sync_conflict` rather than silently assumed reconciled. An
 *   external_id with NO matching row is a booking/order that exists on the
 *   provider side but was never pushed by Heyloo (created directly in the
 *   provider's own UI) — recorded for visibility, not a conflict.
 */
export async function processPosWebhook(
  sql: SqlClient,
  provider: string,
  canonical: { type: string; external_id: string | null; changes: Record<string, unknown> },
  logger: Logger,
): Promise<void> {
  switch (canonical.type) {
    case "auth_revoked": {
      if (!canonical.external_id) {
        logger.error("pos_adapter_auth_revoked_no_external_id", { provider });
        return;
      }
      const rows = await sql<{ tenant_id: string }>`
        update public.adapter_connections
        set status = 'disconnected',
            disconnected_at = now(),
            last_error = 'auth_revoked webhook received'
        where provider = ${provider}
          and provider_account_id = ${canonical.external_id}
          and status <> 'disconnected'
        returning tenant_id
      `;
      if (rows.length === 0) {
        logger.warn("pos_adapter_auth_revoked_no_matching_connection", {
          provider,
          external_id: canonical.external_id,
        });
        return;
      }
      logger.error("pos_adapter_auth_revoked", {
        provider,
        external_id: canonical.external_id,
        tenant_id: rows[0]?.tenant_id,
      });
      return;
    }
    case "booking_changed":
    case "order_changed": {
      if (!canonical.external_id) {
        logger.info("pos_adapter_change_recorded_no_external_id", {
          provider,
          type: canonical.type,
        });
        return;
      }
      const rows = await sql<{
        tenant_id: string;
        entity_type: string;
        entity_id: string;
        sync_conflict: boolean;
      }>`
        select tenant_id, entity_type, entity_id, sync_conflict
        from public.adapter_sync_state
        where provider = ${provider} and external_id = ${canonical.external_id}
        limit 1
      `;
      const match = rows[0];
      if (!match) {
        logger.info("pos_adapter_external_change_unmapped", {
          provider,
          type: canonical.type,
          external_id: canonical.external_id,
        });
        return;
      }
      if (!match.sync_conflict) {
        await sql`
          update public.adapter_sync_state
          set sync_conflict = true
          where provider = ${provider}
            and tenant_id = ${match.tenant_id}
            and entity_type = ${match.entity_type}
            and entity_id = ${match.entity_id}
        `;
      }
      logger.info("pos_adapter_change_recorded", {
        provider,
        type: canonical.type,
        external_id: canonical.external_id,
        tenant_id: match.tenant_id,
        flagged_conflict: !match.sync_conflict,
      });
      return;
    }
    default:
      logger.debug("pos_adapter_unknown_event", { provider });
  }
}
