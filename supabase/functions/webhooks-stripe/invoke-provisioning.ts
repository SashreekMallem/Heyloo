import type { StripeEventDeps } from "./handler.ts";

export interface InvokeProvisioningConfig {
  supabaseUrl: string;
  /** Gateway-level auth for `api-provision` (`verify_jwt = true` in
   * config.toml — Supabase's platform gateway rejects any request missing a
   * valid `Authorization: Bearer <jwt>` header with 401 BEFORE the function
   * code runs, per Supabase's documented `verify_jwt` behavior; the
   * function's own `x-internal-secret` check below never even executes
   * without this). Same `SB_SECRET_KEY` service-role token used by
   * `scripts/e2e-backend.ts`'s `callFunction` and by
   * `worker-recording-fetch`/`job-retention-sweep`'s internal calls. */
  serviceRoleKey: string;
  /** In-function authorization (tenant_id trust) — defense-in-depth per
   * `api-provision/index.ts`'s own `isInternalCall` check; kept in addition
   * to, never instead of, the gateway-level Authorization header above. */
  internalSecret: string;
  fetchImpl?: typeof fetch;
}

/** Fires `/api-provision`'s internal-secret path (BACKEND_SPEC §7.9). Two
 * layers of auth are required on every call: the `Authorization` bearer
 * token to clear Supabase's platform `verify_jwt = true` gateway on
 * `api-provision`, and the `x-internal-secret` header/`{tenant_id}` body
 * that `api-provision/index.ts` itself parses to trust this as an internal
 * (non-owner-JWT) call. A 409 means the saga's own idempotent guard already
 * found this tenant fully provisioned, which is a success outcome here, not
 * a failure to record. */
export function createInvokeProvisioning(
  config: InvokeProvisioningConfig,
): StripeEventDeps["invokeProvisioning"] {
  const doFetch = config.fetchImpl ?? fetch;
  return async (tenantId) => {
    try {
      const res = await doFetch(`${config.supabaseUrl}/functions/v1/api-provision`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.serviceRoleKey}`,
          "x-internal-secret": config.internalSecret,
        },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      if (res.ok || res.status === 409) return { ok: true, status: res.status };
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text.slice(0, 500) };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  };
}
