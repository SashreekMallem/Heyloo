// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: false — a
// PUBLIC endpoint (the tenant's patient opens the SMS link, no Heyloo
// account of their own; Supabase's platform `apikey` header gate is the
// only thing checked before this code runs, per the caller's own
// `supabaseBrowserClient.functions.invoke()` usage — docs/audit/
// FIX_REQUESTS.md). The single-use token IS the entire auth boundary
// beyond that (CLAUDE.md Rule 2 "fail closed") — see handler.ts's header.
//
// Routing: the token is the ENTIRE remaining path segment after the
// function name (`GET/POST /functions/v1/api-intake/{token}`). FOLLOWUP-1
// (docs/BUILD_NOTES.md QA-PORTAL/FOLLOWUP-1): this had the identical
// URL-prefix bug `admin/index.ts` was fixed for under QA-PORTAL — Supabase's
// edge runtime strips only the `/functions/v1/` infrastructure prefix
// before invoking the function, so `req.url`'s pathname is actually
// `/api-intake/{token}`, NOT `/functions/v1/api-intake/{token}`. The old
// regex only matched the fictional latter shape, so `.replace()` silently
// no-opped and `token` became `api-intake/{realToken}` (the function's own
// name segment still glued onto the front) for every real request — never
// resolving to a real `intake_tokens.token_hash`, so every intake link
// 404'd in production. Fixed the same way as `admin/index.ts`: strip only
// the function's own leading path segment, not a hardcoded literal prefix.
import { getSql } from "../_shared/deno/db.ts";
import { requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { IntakeSubmitBodySchema } from "../_shared/schemas/intake.ts";
import { getIntakeStatus, submitIntake } from "./handler.ts";

const logger = createLogger({ fn: "api-intake" });
const INTAKE_ENCRYPTION_KEY = requireEnv("INTAKE_ENCRYPTION_KEY");

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const token = url.pathname.replace(/^\/[^/]+\//, "");
  if (!token) return jsonResponse({ valid: false }, { status: 404 });

  const sql = getSql();

  if (req.method === "GET") {
    const result = await getIntakeStatus(sql, token);
    return jsonResponse(result.body, { status: result.status });
  }

  if (req.method === "POST") {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid" }, { status: 200 });
    }
    const parsed = IntakeSubmitBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonResponse({ ok: false, error: "invalid" }, { status: 200 });
    }
    const result = await submitIntake(sql, token, parsed.data, {
      intakeEncryptionKey: INTAKE_ENCRYPTION_KEY,
      logger,
    });
    return jsonResponse(result.body, { status: result.status });
  }

  return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
});
