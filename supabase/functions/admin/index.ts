// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true — this
// function relies on Supabase's platform-level JWT verification to reject
// missing/invalid tokens BEFORE this code runs; the claims check below
// (platform_admin + AAL2) is the CLAUDE.md Rule 2 "check explicitly in
// code, not just implied by RLS" requirement (BACKEND_SPEC §7.7).

import type { AdminJwtClaims } from "../_shared/admin-auth.js";
import { getSql } from "../_shared/deno/db.js";
import { optionalEnv } from "../_shared/deno/env.js";
import { createLogger } from "../_shared/logger.js";
import { jsonResponse } from "../_shared/responses.js";
import type { AdminDeps } from "./handler.js";
import { routeAdminRequest } from "./handler.js";

const logger = createLogger({ fn: "admin" });

// These are only required by specific route groups (templates publish;
// tenants impersonate) rather than every admin invocation — read as
// optional here and the handler degrades gracefully (a documented 501,
// never a crash at cold-start) when a given deploy hasn't set them yet,
// consistent with how narrowly-needed the underlying features are.
const RETELL_API_KEY = optionalEnv("RETELL_API_KEY");
const VOICE_TOOLS_WEBHOOK_URL = optionalEnv("VOICE_TOOLS_WEBHOOK_URL");
const SUPABASE_URL = optionalEnv("SUPABASE_URL");
const SUPABASE_SECRET_KEY = optionalEnv("SUPABASE_SECRET_KEY");

const adminDeps: AdminDeps = {
  ...(RETELL_API_KEY && VOICE_TOOLS_WEBHOOK_URL
    ? {
        retell: {
          fetchImpl: fetch,
          apiKey: RETELL_API_KEY,
          toolWebhookUrl: VOICE_TOOLS_WEBHOOK_URL,
        },
      }
    : {}),
  ...(SUPABASE_URL && SUPABASE_SECRET_KEY
    ? {
        supabaseAdmin: { fetchImpl: fetch, url: SUPABASE_URL, serviceRoleKey: SUPABASE_SECRET_KEY },
      }
    : {}),
};

interface FullJwtPayload extends AdminJwtClaims {
  sub?: string;
}

function decodeJwtPayload(authHeader: string | null): FullJwtPayload | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const parts = authHeader.slice("Bearer ".length).split(".");
    return JSON.parse(
      atob(parts[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? ""),
    ) as FullJwtPayload;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const claims = decodeJwtPayload(req.headers.get("authorization"));
  const url = new URL(req.url);

  let body: unknown;
  if (req.method === "PATCH" || req.method === "POST") {
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
  }

  const sql = getSql();
  const result = await routeAdminRequest(
    sql,
    {
      method: req.method,
      path: url.pathname.replace(/^\/functions\/v1\//, ""),
      claims,
      body,
      adminUserId: claims?.sub ?? null,
      ...(req.headers.get("x-forwarded-for")
        ? { ipAddress: req.headers.get("x-forwarded-for") as string }
        : {}),
      ...(req.headers.get("user-agent")
        ? { userAgent: req.headers.get("user-agent") as string }
        : {}),
    },
    logger,
    adminDeps,
  );

  return jsonResponse(result.body, { status: result.status });
});
