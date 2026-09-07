import type { CanonicalPosWebhookEvent } from "../_shared/providers/square.js";
import type { Logger } from "../_shared/types.js";

/**
 * `/webhooks-pos/{provider}` adapter-dispatch shell (BACKEND_SPEC §7.6).
 * This task's scope is the dispatch shell + Square's `handleWebhook`
 * verify+normalize step (per this task's own instructions — "real adapters
 * come in Wave 3"); the full `IntegrationAdapter` interface
 * (`syncCatalog`/`pushBooking`/`pushOrder`/`checkAvailability`/
 * `refreshAuth`) and a real `tenant_integrations`-shaped connection-state
 * table are Wave-3/T7 scope (packages/adapters/README.md) — not invented
 * here. The shared side effects below (BACKEND_SPEC §7.6 "Shared side
 * effects across all adapters") are therefore intentionally minimal: an
 * `auth_revoked` event is logged as a compliance-visible event (a real
 * dashboard banner needs the connection-state table T7 adds); a
 * booking/order change is recorded for later reconciliation once the real
 * adapter sync logic lands, never silently dropped.
 */
export function processPosWebhook(
  provider: string,
  canonical: CanonicalPosWebhookEvent,
  logger: Logger,
): void {
  switch (canonical.type) {
    case "auth_revoked":
      logger.error("pos_adapter_auth_revoked", { provider, external_id: canonical.external_id });
      // T7 TODO: flip a `tenant_integrations.status = 'disconnected'` row
      // and fire the dashboard banner + notification once that table exists.
      return;
    case "booking_changed":
    case "order_changed":
      logger.info("pos_adapter_change_recorded", {
        provider,
        type: canonical.type,
        external_id: canonical.external_id,
      });
      // T7 TODO: map `canonical.external_id`/`changes` onto the matching
      // Heyloo booking/order via the adapter's own external-id column once
      // that mapping exists; for now the raw event is preserved verbatim in
      // `webhook_events` (index.ts's dedup insert) so nothing is lost.
      return;
    default:
      logger.debug("pos_adapter_unknown_event", { provider });
  }
}
