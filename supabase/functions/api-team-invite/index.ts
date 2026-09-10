// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt: true —
// Supabase verifies the bearer JWT before this code runs; tenant_id AND
// the caller's own user id come ONLY from the JWT (CLAUDE.md Rule 2) —
// this function additionally re-verifies the caller's `memberships.role`
// is 'owner' itself (handler.ts) before writing anything, since it runs
// as service role (bypasses RLS).
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, requireEnv } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import { TeamInviteRequestSchema } from "../_shared/schemas/team-invite.ts";
import { handleTeamInvite } from "./handler.ts";

const logger = createLogger({ fn: "api-team-invite" });
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SB_SECRET_KEY = requireEnv("SB_SECRET_KEY");
const APP_BASE_URL = optionalEnv("APP_BASE_URL") ?? "https://heyloo.app";

interface JwtClaims {
  sub?: string;
  app_metadata?: { tenant_id?: string };
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
  if (!claims?.app_metadata?.tenant_id || !claims.sub) {
    return jsonResponse({ error: "forbidden" }, { status: 403 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = TeamInviteRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonResponse({ error: "invalid_request", issues: parsed.error.issues }, { status: 422 });
  }

  const sql = getSql();
  const result = await handleTeamInvite(
    sql,
    claims.app_metadata.tenant_id,
    claims.sub,
    parsed.data,
    {
      supabaseAdmin: { fetchImpl: fetch, url: SUPABASE_URL, serviceRoleKey: SB_SECRET_KEY },
      logger,
      redirectTo: `${APP_BASE_URL.replace(/\/+$/, "")}/dashboard`,
    },
  );

  return jsonResponse(result.body, { status: result.status });
});
