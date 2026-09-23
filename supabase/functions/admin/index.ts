// Deno entrypoint (excluded from ../tsconfig.json). verify_jwt true — this
// function relies on Supabase's platform-level JWT verification to reject
// missing/invalid tokens BEFORE this code runs; the claims check below
// (platform_admin + AAL2) is the CLAUDE.md Rule 2 "check explicitly in
// code, not just implied by RLS" requirement (BACKEND_SPEC §7.7).

import type { AdminJwtClaims } from "../_shared/admin-auth.ts";
import { getSql } from "../_shared/deno/db.ts";
import { optionalEnv, optionalServiceRoleKey } from "../_shared/deno/env.ts";
import { createLogger } from "../_shared/logger.ts";
import { jsonResponse } from "../_shared/responses.ts";
import type { AdminDeps } from "./handler.ts";
import { routeAdminRequest } from "./handler.ts";

const logger = createLogger({ fn: "admin" });

// These are only required by specific route groups (templates publish;
// tenants impersonate) rather than every admin invocation — read as
// optional here and the handler degrades gracefully (a documented 501,
// never a crash at cold-start) when a given deploy hasn't set them yet,
// consistent with how narrowly-needed the underlying features are.
const RETELL_API_KEY = optionalEnv("RETELL_API_KEY");
const VOICE_TOOLS_WEBHOOK_URL = optionalEnv("VOICE_TOOLS_WEBHOOK_URL");
const SUPABASE_URL = optionalEnv("SUPABASE_URL");
const SB_SECRET_KEY = optionalServiceRoleKey();
const SMARTLEAD_API_KEY = optionalEnv("SMARTLEAD_API_KEY");
const OUTREACH_CAN_SPAM_FOOTER = optionalEnv("OUTREACH_CAN_SPAM_FOOTER");
const RESEND_API_KEY = optionalEnv("RESEND_API_KEY");
const RESEND_FROM_ADDRESS = optionalEnv("RESEND_FROM_ADDRESS");

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
  ...(SUPABASE_URL && SB_SECRET_KEY
    ? {
        supabaseAdmin: { fetchImpl: fetch, url: SUPABASE_URL, serviceRoleKey: SB_SECRET_KEY },
      }
    : {}),
  ...(SMARTLEAD_API_KEY && OUTREACH_CAN_SPAM_FOOTER
    ? {
        outreach: {
          smartleadFetchImpl: fetch,
          smartleadApiKey: SMARTLEAD_API_KEY,
          canSpamFooter: OUTREACH_CAN_SPAM_FOOTER,
        },
      }
    : {}),
  ...(RESEND_API_KEY && RESEND_FROM_ADDRESS
    ? { resend: { fetchImpl: fetch, apiKey: RESEND_API_KEY, fromAddress: RESEND_FROM_ADDRESS } }
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
      // QA-PORTAL root-cause fix (docs/BUILD_NOTES.md, docs/VERIFY.md):
      // live-confirmed against the REAL deployed function (every single
      // `admin-*` route 404'd, uniformly, regardless of which one) and
      // against the current supabase.com/docs/guides/functions/routing
      // guidance (WebFetch, this session) — Supabase's edge runtime
      // strips only the `/functions/v1/` infrastructure prefix before
      // invoking the function; the function's OWN name segment (`admin`)
      // stays on `req.url`. The old regex assumed the full
      // `/functions/v1/admin/` prefix was still present, so it never
      // matched anything live, silently no-opping `.replace()` and
      // leaving `ctx.path` as `/admin/admin-tenants` (etc.) — `segments()`
      // then split that into `["admin", "admin-tenants"]`, so `first` was
      // always the literal string `"admin"`, which matches none of
      // `routeAdminRequest`'s route names, so EVERY admin route fell
      // through to the final `404 {error: "not_found"}`. The whole admin
      // cockpit (tenants, queues, regression runs, alerts, everything)
      // was unreachable in production despite passing every unit test —
      // `index.test.ts` mocked the OLD, wrong prefix assumption too, so
      // nothing caught it. Stripping only the function's own leading path
      // segment (not a hardcoded literal) is robust to this regardless of
      // the function's slug.
      path: url.pathname.replace(/^\/[^/]+\//, ""),
      claims,
      body,
      adminUserId: claims?.sub ?? null,
      query: Object.fromEntries(url.searchParams.entries()),
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
