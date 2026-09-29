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

import { publicCorsHeaders } from "../_shared/cors.ts";
import { checkEncryptionKey } from "../_shared/crypto.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { IntakeSubmitBodySchema } from "../_shared/schemas/intake.ts";
import { getIntakeStatus, submitIntake } from "./handler.ts";

const logger = createLogger({ fn: "api-intake" });
// QA-1 BE-02/F-05: the key is read + shape-checked lazily on the POST path
// (never `requireEnv` at module scope: a missing/misshapen key must not take
// GET status lookups down, and must answer a clean 503 naming the key, before
// any DB work, instead of a 500 from `encryptSecret` mid-submit). Accepts
// base64-of-32-bytes or 64 hex chars (`_shared/crypto.ts`).
const INTAKE_KEY_LABEL = "intake_encryption_key";

Deno.serve(async (req: Request) => {
  const cors = publicCorsHeaders(req);
  const respond = (body: unknown, status: number) => jsonResponse(body, { status, headers: cors });

  // F-05: the browser preflight (POST with content-type + apikey headers) was
  // answered 405 without Access-Control-Allow-Origin, so no browser submit
  // could ever reach this function.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const url = new URL(req.url);
  const token = url.pathname.replace(/^\/[^/]+\//, "");
  if (!token) return respond({ valid: false }, 404);

  if (req.method === "GET") {
    const result = await getIntakeStatus(getSql(), token);
    return respond(result.body, result.status);
  }

  if (req.method === "POST") {
    const intakeEncryptionKey = optionalEnv("INTAKE_ENCRYPTION_KEY");
    const keyProblem = checkEncryptionKey(intakeEncryptionKey, INTAKE_KEY_LABEL);
    if (keyProblem || !intakeEncryptionKey) {
      // Fail closed, loudly, with the key NAME (never its value).
      logger.error("api_intake_not_configured", {
        reason: keyProblem,
        env: "INTAKE_ENCRYPTION_KEY",
      });
      return respond({ ok: false, error: "not_configured" }, 503);
    }
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return respond({ ok: false, error: "invalid" }, 200);
    }
    const parsed = IntakeSubmitBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return respond({ ok: false, error: "invalid" }, 200);
    }
    const result = await submitIntake(getSql(), token, parsed.data, {
      intakeEncryptionKey,
      logger,
    });
    return respond(result.body, result.status);
  }

  return respond({ error: "method_not_allowed" }, 405);
});
