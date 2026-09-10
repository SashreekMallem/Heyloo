import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto/adapter-token";
import { createSupabaseServiceRoleServerClient } from "@/lib/supabase/service-role";
import {
  AIRTABLE_BASES_URL,
  AIRTABLE_STATE_COOKIE,
  AIRTABLE_TOKEN_URL,
  AirtableBasesResponseSchema,
  AirtableTablesResponseSchema,
  AirtableTokenResponseSchema,
  airtableOAuthConfig,
  airtableTablesUrl,
  decodeOAuthState,
  popupResultHtml,
  untypedTable,
} from "../shared";

export const runtime = "nodejs";

function html(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "content-type": "text/html" } });
}

/**
 * Airtable OAuth callback (FRONTEND_SPEC.md §6.8). Exchanges the auth code
 * for tokens, lists the connected bases (auto-connect the one base;
 * multi-base picker UI is a follow-up — flagged in docs/BUILD_NOTES.md,
 * not built here), auto-picks that base's first table via the Meta API
 * (`airtableTablesUrl`; a real table picker is the same follow-up), and
 * persists an `adapter_connections` row whose `metadata.baseId`/
 * `metadata.tableIdOrName` are exactly what `worker-adapter-push/handler.ts`'s
 * `pushToAirtable` reads to actually push a booking/order (REPAIR-2026-09,
 * docs/audit/FIX_REQUESTS.md — without these two keys every real push
 * silently no-oped via `adapter_push_missing_metadata`).
 *
 * `access_token`/`refresh_token` are encrypted at rest via
 * `encryptSecret` (DB_AUDIT DB-H2, docs/audit/FIX_REQUESTS.md — cluster E's
 * own `_shared/crypto.ts` fix could not reach this route's ownership) —
 * fails closed (never writes plaintext) if `ADAPTER_TOKEN_ENCRYPTION_KEY`
 * is unset. `worker-adapter-push`'s `decryptSecret` reads this same
 * versioned format.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  const cookieStore = await cookies();
  const stashed = decodeOAuthState(cookieStore.get(AIRTABLE_STATE_COOKIE)?.value);

  if (oauthError) {
    return html(popupResultHtml({ ok: false, error: `airtable_oauth_error:${oauthError}` }));
  }
  if (!code || !state || !stashed || stashed.state !== state) {
    return html(popupResultHtml({ ok: false, error: "invalid_oauth_state" }), 400);
  }

  const config = airtableOAuthConfig();
  if (!config) {
    return html(popupResultHtml({ ok: false, error: "airtable_oauth_not_configured" }), 501);
  }

  const tokenParams = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    code_verifier: stashed.verifier,
  });
  const tokenHeaders: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (config.clientSecret) {
    tokenHeaders["authorization"] =
      `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }

  const tokenRes = await fetch(AIRTABLE_TOKEN_URL, {
    method: "POST",
    headers: tokenHeaders,
    body: tokenParams.toString(),
  });
  if (!tokenRes.ok) {
    return html(popupResultHtml({ ok: false, error: "airtable_token_exchange_failed" }), 502);
  }
  const tokenParsed = AirtableTokenResponseSchema.safeParse(await tokenRes.json());
  if (!tokenParsed.success) {
    return html(popupResultHtml({ ok: false, error: "airtable_token_response_invalid" }), 502);
  }
  const token = tokenParsed.data;

  const basesRes = await fetch(AIRTABLE_BASES_URL, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  let providerAccountId: string | null = null;
  let baseName: string | null = null;
  if (basesRes.ok) {
    const basesParsed = AirtableBasesResponseSchema.safeParse(await basesRes.json());
    if (basesParsed.success && basesParsed.data.bases[0]) {
      providerAccountId = basesParsed.data.bases[0].id;
      baseName = basesParsed.data.bases[0].name;
    }
  }

  // Auto-pick the connected base's first table as the push target —
  // `worker-adapter-push/handler.ts`'s `pushToAirtable` reads
  // `metadata.baseId`/`metadata.tableIdOrName`; without both, every push
  // for this tenant no-ops (`adapter_push_missing_metadata`). A real
  // multi-table picker UI is a follow-up (docs/BUILD_NOTES.md).
  let tableIdOrName: string | null = null;
  if (providerAccountId) {
    const tablesRes = await fetch(airtableTablesUrl(providerAccountId), {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (tablesRes.ok) {
      const tablesParsed = AirtableTablesResponseSchema.safeParse(await tablesRes.json());
      if (tablesParsed.success && tablesParsed.data.tables[0]) {
        tableIdOrName = tablesParsed.data.tables[0].id;
      }
    }
  }

  const tokenEncryptionKey = process.env["ADAPTER_TOKEN_ENCRYPTION_KEY"];
  if (!tokenEncryptionKey) {
    // Fail closed (CLAUDE.md Rule 2) — never write a plaintext token.
    return html(
      popupResultHtml({ ok: false, error: "adapter_token_encryption_not_configured" }),
      501,
    );
  }

  const service = createSupabaseServiceRoleServerClient();
  const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
  const encryptedAccessToken = await encryptSecret(token.access_token, tokenEncryptionKey);
  const encryptedRefreshToken = token.refresh_token
    ? await encryptSecret(token.refresh_token, tokenEncryptionKey)
    : null;
  const { error } = await untypedTable(service, "adapter_connections").upsert(
    {
      tenant_id: stashed.tenantId,
      provider: "airtable",
      status: "connected",
      auth_mode: "oauth2_authorization_code",
      access_token: encryptedAccessToken,
      refresh_token: encryptedRefreshToken,
      expires_at: expiresAt,
      provider_account_id: providerAccountId,
      metadata: {
        ...(baseName ? { base_name: baseName } : {}),
        ...(providerAccountId ? { baseId: providerAccountId } : {}),
        ...(tableIdOrName ? { tableIdOrName } : {}),
      },
      disconnected_at: null,
      last_error: null,
      last_refreshed_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,provider" },
  );

  const response = html(
    popupResultHtml(error ? { ok: false, error: "airtable_connection_save_failed" } : { ok: true }),
    error ? 502 : 200,
  );
  response.cookies.delete(AIRTABLE_STATE_COOKIE);
  return response;
}
