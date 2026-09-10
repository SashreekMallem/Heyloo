/**
 * Single source of truth for the tenant realtime broadcast channel/topic
 * name. MUST equal the backend's topic string exactly (Supabase Realtime
 * requires an exact match to authorize a private channel subscription):
 *
 *   - `fn_broadcast_tenant_update()` broadcasts to `'tenant:' || tenant_id`
 *     (supabase/migrations/20260907131400_functions_triggers.sql).
 *   - The `tenant_channel_broadcast_select` RLS policy on `realtime.messages`
 *     authorizes selects where `topic = 'tenant:' || fn_jwt_tenant_id()`
 *     (supabase/migrations/20260907131500_rls.sql).
 *
 * Exported so every other place that needs this channel name (cluster D's
 * per-customer/messages views, the signup provisioning step) imports this
 * helper instead of re-deriving the string — see docs/audit/FIX_REQUESTS.md
 * for the cross-cluster contract.
 */
export function getTenantRealtimeChannelName(tenantId: string): string {
  return `tenant:${tenantId}`;
}
