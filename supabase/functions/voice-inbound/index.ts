// Deno entrypoint (excluded from ../tsconfig.json — see
// supabase/functions/BUILD_NOTES.md). Thin glue only: HMAC verify -> Zod
// parse -> handler.ts (portable, unit tested) -> JSON response. verify_jwt
// is set to false for this function in supabase/config.toml — Retell calls
// this directly and auth is the HMAC signature checked below, never
// Supabase JWT (BACKEND_SPEC §7.1).

import { getSql } from "../_shared/deno/db.ts";
import { requireRetellWebhookKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { verifyRetellSignature } from "../_shared/retell-signature.ts";
import { VoiceInboundRequestSchema } from "../_shared/schemas/voice-inbound.ts";
import { handleVoiceInbound } from "./handler.ts";

const logger = createLogger({ fn: "voice-inbound" });
const RETELL_WEBHOOK_SIGNING_SECRET = requireRetellWebhookKey();

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const rawBody = await req.text();
  const verification = await verifyRetellSignature({
    rawBody,
    header: req.headers.get("x-retell-signature"),
    secret: RETELL_WEBHOOK_SIGNING_SECRET,
    now: new Date(),
  });

  if (!verification.valid) {
    logger.warn("voice_inbound_signature_rejected", { reason: verification.reason });
    return jsonResponse({ error: "unauthorized" }, { status: 401 });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = VoiceInboundRequestSchema.safeParse(parsedBody);
  if (!parsed.success) {
    logger.warn("voice_inbound_bad_request", { issues: parsed.error.issues });
    return jsonResponse({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await handleVoiceInbound({ sql: getSql(), request: parsed.data, logger });
    return jsonResponse(result.body, { status: result.status });
  } catch (err) {
    // A DB error here falls back to Retell's own retry/timeout path — kept
    // trivial and fast per BACKEND_SPEC §7.1, never a slow retry loop of
    // our own.
    logger.error("voice_inbound_error", { error: String(err) });
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  }
});
