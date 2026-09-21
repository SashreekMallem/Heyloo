// Deno entrypoint (excluded from ../tsconfig.json). Invoked by the
// pg_cron "Queue worker poll" job (BACKEND_SPEC §8, every minute) via
// pg_net.http_post — verify_jwt false, auth is a shared cron secret header
// (this function is never meant to be internet-facing-useful; the secret
// just keeps it from being invoked by anything other than the cron job).

import { timingSafeEqual } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { missingEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { runOutboundWorker, sweepNotConfiguredOutbound } from "./handler.ts";

const logger = createLogger({ fn: "worker-messages-outbound" });
const CRON_SECRET = requireEnv("CRON_INVOKE_SECRET");
// OPS-1 pattern (docs/BUILD_NOTES.md): Twilio/Resend are OPTIONAL
// integrations not yet provisioned on every deploy (`worker-tick` already
// skips this same leg the same way, per its own OUTBOUND_MISSING check) —
// checked inside the handler, after the cron-secret auth check, never at
// module scope, so a deploy with neither configured returns an explicit
// `skipped: "not_configured"` 200 instead of crashing cold start.
const OUTBOUND_MISSING = missingEnv([
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "RESEND_API_KEY",
  "RESEND_FROM_ADDRESS",
]);

Deno.serve(async (req: Request) => {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, CRON_SECRET)) {
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  if (OUTBOUND_MISSING.length > 0) {
    logger.warn("job_skipped_not_configured", { missing: OUTBOUND_MISSING });
    // OPS-8: still runs the bounded, read_ct-free stale sweep (handler.ts's
    // `sweepNotConfiguredOutbound`) so a manual invoke of this endpoint
    // behaves identically to worker-tick's own not-configured leg.
    const parked = await sweepNotConfiguredOutbound(getSql());
    return jsonResponse(
      { skipped: "not_configured", missing: OUTBOUND_MISSING, parked },
      { status: 200 },
    );
  }

  const TWILIO_ACCOUNT_SID = requireEnv("TWILIO_ACCOUNT_SID");
  const TWILIO_AUTH_TOKEN = requireEnv("TWILIO_AUTH_TOKEN");
  const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
  const RESEND_FROM_ADDRESS = requireEnv("RESEND_FROM_ADDRESS");

  const sql = getSql();
  const deps = {
    twilioFetch: fetch,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    async twilioFromNumber(tenantId: string): Promise<string | null> {
      const rows = await sql<{ e164: string }>`
        select e164 from public.phone_numbers where tenant_id = ${tenantId} and released_at is null and is_primary limit 1
      `;
      return rows[0]?.e164 ?? null;
    },
    resendFetch: fetch,
    resendApiKey: RESEND_API_KEY,
    resendFromAddress: RESEND_FROM_ADDRESS,
    async fallbackTenantEmail(tenantId: string): Promise<string | null> {
      const rows = await sql<{ email: string }>`
        select u.email from public.memberships m
        join auth.users u on u.id = m.user_id
        where m.tenant_id = ${tenantId} and m.role = 'owner'
        limit 1
      `;
      return rows[0]?.email ?? null;
    },
    logger,
  };

  const result = await runOutboundWorker(sql, deps);
  return jsonResponse(result);
});
