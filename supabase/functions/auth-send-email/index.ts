// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt = false in
// supabase/config.toml: Supabase Auth calls this hook with no user JWT, and
// every request is authenticated by the Standard Webhooks signature over the
// RAW body (SEND_EMAIL_HOOK_SECRET, fail closed) inside handler.ts.
//
// Turn it on for the live project with `scripts/enable-auth-email-hook.ts`
// (docs/SETUP_EMAIL_MICROSOFT.md); until then Supabase's built-in mailer
// keeps sending, and this function is simply never called.

import { optionalEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { buildMessagingRegistryFromEnv } from "../_shared/providers/messaging/registry.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { handleAuthSendEmail } from "./handler.ts";

const logger = createLogger({ fn: "auth-send-email" });
// Module scope: the registry (and the Graph adapter's token cache) live as
// long as the isolate, keeping the token round trip off the hook's 5 s budget.
const REGISTRY = buildMessagingRegistryFromEnv((name) => Deno.env.get(name), fetch);

Deno.serve(async (req: Request) => {
  const response = await handleAuthSendEmail(
    {
      // Read per request so a rotated secret is picked up without a redeploy.
      hookSecret: optionalEnv("SEND_EMAIL_HOOK_SECRET"),
      registry: REGISTRY,
      logger,
      now: () => new Date(),
    },
    {
      method: req.method,
      rawBody: await req.text(),
      header: (name) => req.headers.get(name),
    },
  );
  return jsonResponse(response.body, {
    status: response.status,
    ...(response.headers ? { headers: response.headers } : {}),
  });
});
