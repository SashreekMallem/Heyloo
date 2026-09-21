// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true —
// authenticated tenant owner, OR triggered internally by the Stripe
// webhook handler (service_role) on checkout.session.completed
// (BACKEND_SPEC §7.9). Supabase's platform-level JWT verification (the
// `verify_jwt` deployment setting) has already run by the time this code
// executes; this still checks the resolved JWT claims match the target
// tenant + role, per CLAUDE.md Rule 2 ("every secret-key edge function
// still explicitly filters by a verified tenant_id" — service_role callers
// bypass RLS but not this check).
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { ProvisionDeps } from "./handler.ts";
import { republishTenantAgent, runProvisioningSaga } from "./handler.ts";

const logger = createLogger({ fn: "api-provision" });
const RETELL_API_KEY = requireEnv("RETELL_API_KEY");
// Passed to the compiler as every tool's webhook `url` (same convention as
// admin/index.ts's identical `deps.retell.toolWebhookUrl` wiring for the
// template-publish route).
const VOICE_TOOLS_WEBHOOK_URL = requireEnv("VOICE_TOOLS_WEBHOOK_URL");
// The `/voice-inbound` webhook is phone-number-scoped, not agent-scoped
// (RETELL-VERIFY, VERIFY-6 resolved) — wired onto the purchased number here.
const RETELL_INBOUND_WEBHOOK_URL = requireEnv("RETELL_INBOUND_WEBHOOK_URL");
// CALL-5: the deployed `/voice-events` function URL — see
// `_shared/provisioning/compile-and-publish.ts`'s
// CompileAndPublishDeps#eventsWebhookUrl doc comment.
const VOICE_EVENTS_WEBHOOK_URL = requireEnv("VOICE_EVENTS_WEBHOOK_URL");
// SIGNUP-1: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/RETELL_SIP_TRUNK_TERMINATION_URI
// are deliberately NOT required here any more — this platform has no Twilio
// account configured (docs/BUILD_NOTES.md SIGNUP-1 entry), and the number
// purchase now goes straight through Retell's own `/create-phone-number`
// (handler.ts). Before this fix, EVERY invocation of this function failed
// to boot at all (Deno throws on `requireEnv` at module load, before
// `Deno.serve` ever runs) because those three secrets were never set.
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

  let body: { tenant_id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }
  const tenantId = body.tenant_id;
  if (!tenantId) return jsonResponse({ error: "missing_tenant_id" }, { status: 422 });

  const internalSecret = req.headers.get("x-internal-secret");
  const isInternalCall = !!internalSecret && internalSecret === SERVICE_ROLE_INTERNAL_SECRET;

  const deps: ProvisionDeps = {
    retellFetch: fetch,
    retellApiKey: RETELL_API_KEY,
    retellInboundWebhookUrl: RETELL_INBOUND_WEBHOOK_URL,
    voiceToolsWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
    eventsWebhookUrl: VOICE_EVENTS_WEBHOOK_URL,
    logger,
  };

  // PARITY-1: `action: "republish"` — internal-secret-only, and further
  // gated inside `republishTenantAgent` on `tenants.is_test = true` (never
  // reaches a real, billable tenant). Re-provisions an EXISTING test
  // tenant through the real saga's own compile/publish path so it picks up
  // whatever compiler/template fixes have landed since it was first
  // provisioned, without going through Stripe/checkout again.
  if (body.action === "republish") {
    if (!isInternalCall) return jsonResponse({ error: "forbidden" }, { status: 403 });
    const sql = getSql();
    const result = await republishTenantAgent(sql, tenantId, deps);
    return jsonResponse(result.body, { status: result.status });
  }

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
