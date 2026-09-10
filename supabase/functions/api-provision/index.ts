// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner, OR triggered internally by the Stripe
// webhook handler (service_role) on checkout.session.completed
// (BACKEND_SPEC §7.9). Supabase's platform-level JWT verification (the
// `verify_jwt` deployment setting) has already run by the time this code
// executes; this still checks the resolved JWT claims match the target
// tenant + role, per CLAUDE.md Rule 2 ("every secret-key edge function
// still explicitly filters by a verified tenant_id" — service_role callers
// bypass RLS but not this check).
import type { CompilerAgentTemplate } from "../_shared/compiler/template-compiler.ts";
import { compileTemplate as compileRetellTemplate } from "../_shared/compiler/template-compiler.ts";
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { CompiledTemplateResult } from "./handler.ts";
import { runProvisioningSaga } from "./handler.ts";

const logger = createLogger({ fn: "api-provision" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// Passed to the compiler as every tool's webhook `url` (same convention as
// admin/index.ts's identical `deps.retell.toolWebhookUrl` wiring for the
// template-publish route).
const VOICE_TOOLS_WEBHOOK_URL = requireEnv("VOICE_TOOLS_WEBHOOK_URL");
// RETELL-VERIFY (VERIFY-7, resolved): `termination_uri` is a REQUIRED field
// on `/import-phone-number` (confirmed via retell-typescript-sdk) — this
// saga previously omitted it entirely, which would 4xx against the real
// API. One platform-level SIP trunk, same pattern as TWILIO_A2P_BRAND_SID.
const RETELL_SIP_TRUNK_TERMINATION_URI = requireEnv("RETELL_SIP_TRUNK_TERMINATION_URI");
// The `/voice-inbound` webhook is phone-number-scoped, not agent-scoped
// (RETELL-VERIFY, VERIFY-6 resolved) — wired onto the imported number here.
const RETELL_INBOUND_WEBHOOK_URL = requireEnv("RETELL_INBOUND_WEBHOOK_URL");
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
    retellSipTerminationUri: RETELL_SIP_TRUNK_TERMINATION_URI,
    retellInboundWebhookUrl: RETELL_INBOUND_WEBHOOK_URL,
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    async compileTemplate(tenantIdForCompile: string): Promise<CompiledTemplateResult | null> {
      const rows = await sql<Record<string, unknown>>`
        select at.* from public.agent_templates at
        join public.tenants t on t.vertical = at.vertical
        where t.id = ${tenantIdForCompile} and at.is_active
        order by at.version desc limit 1
      `;
      const row = rows[0];
      if (!row) return null;

      const template: CompilerAgentTemplate = {
        compile_target: row["compile_target"] as CompilerAgentTemplate["compile_target"],
        system_prompt: (row["system_prompt"] as string | null) ?? null,
        states: (row["states"] as CompilerAgentTemplate["states"]) ?? [],
        transitions: (row["transitions"] as CompilerAgentTemplate["transitions"]) ?? [],
        global_intents: (row["global_intents"] as CompilerAgentTemplate["global_intents"]) ?? [],
        tools: (row["tools"] as CompilerAgentTemplate["tools"]) ?? [],
        disclosure_line: row["disclosure_line"] as string,
      };
      const compiled = compileRetellTemplate(template, VOICE_TOOLS_WEBHOOK_URL);

      return {
        templateId: row["id"] as string,
        templateVersion: row["version"] as number,
        voiceId: row["voice_id"] as string,
        model: row["model"] as string,
        agentName: `heyloo-tenant-${tenantIdForCompile}`,
        disclosureVerified: compiled.disclosureVerified,
        flow: compiled.flow,
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
