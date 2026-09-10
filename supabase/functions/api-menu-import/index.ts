// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; this function
// additionally checks the JWT's own app_metadata carries a real tenant
// membership (never trusts an unauthenticated caller, CLAUDE.md Rule 2).
// CONTRACT (docs/audit/FIX_REQUESTS.md, Cluster E entry): the dashboard's
// own proxy (`apps/web/src/app/api/tenant/offerings/import/route.ts`)
// forwards the caller's session bearer token and sends `{raw_text}` — no
// `tenant_id` in the body at all, so there is nothing to cross-check a
// body value against; the JWT's own tenant membership is the entire scope.
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { MenuImportRequestSchema } from "../_shared/schemas/menu-import.ts";
import { importMenu } from "./handler.ts";

const logger = createLogger({ fn: "api-menu-import" });
const ANTHROPIC_API_KEY = requireEnv("ANTHROPIC_API_KEY");
const ANTHROPIC_MENU_IMPORT_MODEL = optionalEnv("ANTHROPIC_MENU_IMPORT_MODEL") ?? "claude-sonnet-5";

interface JwtClaims {
  app_metadata?: { tenant_id?: string; role?: string };
}

function decodeJwtClaims(authHeader: string | null): JwtClaims | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    return JSON.parse(atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "")) as JwtClaims;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, { status: 405 });
  }

  const claims = decodeJwtClaims(req.headers.get("authorization"));
  if (!claims?.app_metadata?.tenant_id || !claims.app_metadata.role) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = MenuImportRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request", issues: parsed.error.issues }, { status: 422 });
  }

  // No database access here at all — importMenu never writes anything
  // (candidates only, never auto-published; the confirm/edit/publish step
  // is Cluster E's dashboard UI + its own tenant-scoped offerings insert).
  const result = await importMenu(parsed.data, {
    anthropicFetch: fetch,
    anthropicApiKey: ANTHROPIC_API_KEY,
    anthropicModel: ANTHROPIC_MENU_IMPORT_MODEL,
    urlFetch: async (url) => {
      const res = await fetch(url, { headers: { "user-agent": "Heyloo-MenuImport/1.0" } });
      const text = await res.text().catch(() => "");
      return { ok: res.ok, status: res.status, text };
    },
    logger,
  });

  return jsonResponse(result.body, { status: result.status });
});
