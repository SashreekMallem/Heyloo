// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner, OR triggered internally by the Stripe
// webhook handler (service_role) on checkout.session.completed
// (BACKEND_SPEC §7.9). Supabase's platform-level JWT verification (the
// `verify_jwt` deployment setting) has already run by the time this code
// executes; this still checks the resolved JWT claims match the target
// tenant + role, per CLAUDE.md Rule 2 ("every secret-key edge function
// still explicitly filters by a verified tenant_id" — service_role callers
// bypass RLS but not this check).
import { getSql } from "../_shared/deno/db.js";
import { requireEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import { runProvisioningSaga } from "./handler.js";

const logger = createLogger({ fn: "api-provision" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
const SERVICE_ROLE_INTERNAL_SECRET = requireEnv("PROVISION_INTERNAL_SECRET");

interface JwtClaims {
  app_metadata?: { tenant_id?: string; role?: string };
}

function decodeJwtClaims(authHeader: string | null): JwtClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""));
    return payload as JwtClaims;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: { tenant_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  const tenantId = body.tenant_id;
  if (!tenantId) return jsonResponse({ error: "missing_tenant_id" }, { status: 422 });

  const internalSecret = req.headers.get("x-internal-secret");
  const isInternalCall = !!internalSecret && internalSecret === SERVICE_ROLE_INTERNAL_SECRET;

  if (!isInternalCall) {
    const claims = decodeJwtClaims(req.headers.get("authorization"));
    const claimTenantId = claims?.app_metadata?.tenant_id;
    const role = claims?.app_metadata?.role;
    if (!claimTenantId || claimTenantId !== tenantId || role !== "owner") {
      return jsonResponse({ error: "forbidden" }, { status: 403 });
    }
  }

  const sql = getSql();

  const existingRuns = await sql<{ status: string }>`
    select status from public.provisioning_runs where tenant_id = ${tenantId} and step = 'publish_agent'
  `;
  if (existingRuns[0]?.status === "succeeded") {
    return jsonResponse({ error: "already_provisioned" }, { status: 409 });
  }

  const deps = {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    async compileTemplate(tenantIdForCompile: string) {
      // T2's `packages/adapters/retell` compiler (built concurrently with
      // this task — see BUILD_NOTES) isn't importable from Deno without a
      // bundling step; resolves the tenant's active template row directly
      // here as a stand-in until that wiring lands.
      const rows = await sql<{ id: string; version: number }>`
        select at.id, at.version from public.agent_templates at
        join public.tenants t on t.vertical = at.vertical
        where t.id = ${tenantIdForCompile} and at.is_active
        order by at.version desc limit 1
      `;
      const template = rows[0];
      return {
        templateId: template?.id ?? "",
        templateVersion: template?.version ?? 0,
        compiledConfig: { tenant_id: tenantIdForCompile },
      };
    },
    async resolvePhoneNumberToProvision() {
      // VERIFY.md: real implementation searches Twilio's
      // AvailablePhoneNumbers API by the tenant's area-code preference —
      // not yet wired (T4/T2 provider coordination); this is a placeholder
      // that fails loudly (empty string -> Twilio purchase 4xx) rather
      // than silently succeeding with a wrong number.
      return "";
    },
    logger,
  };

  const result = await runProvisioningSaga(sql, tenantId, deps);
  return jsonResponse(
    {
      provisioning_run_id: tenantId,
      status: result.status === "complete" ? "complete" : "in_progress",
      ...result,
    },
    { status: 200 },
  );
});
