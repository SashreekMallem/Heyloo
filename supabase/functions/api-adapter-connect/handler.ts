import { refreshEzyVetToken } from "../_shared/providers/ezyvet.js";
import { validateShopmonkeyApiKey } from "../_shared/providers/shopmonkey.js";
import type { Logger, SqlClient } from "../_shared/types.js";
import type { AdapterConnectRequest } from "./schema.js";
import { AdapterConnectRequestSchema } from "./schema.js";
import { signOAuthState, verifyOAuthState } from "./state.js";

/**
 * `/api-adapter-connect` (BACKEND_SPEC §7.6, task item 3): tenant-facing
 * connect flow for the four T7 adapters — OAuth initiate/callback for
 * Square/Google Calendar, paste-key validation for Shopmonkey/ezyVet.
 * Writes/updates a single `adapter_connections` row per tenant+provider
 * (unique constraint, so a reconnect is an upsert, never a duplicate row —
 * "reauthorize-updates-not-duplicates", the salvaged UX rule SYSTEM_DESIGN
 * §14 calls out).
 */
export interface AdapterConnectDeps {
  fetchImpl: typeof fetch;
  stateSecret: string;
  nonce: () => string;
  square: { clientId: string; clientSecret: string; redirectUri: string };
  googleCalendar: { clientId: string; clientSecret: string; redirectUri: string };
  ezyvet: { clientId: string; clientSecret: string; partnerId: string };
  logger: Logger;
}

export type AdapterConnectResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

interface MembershipRow {
  tenant_id: string;
  role: string;
}

async function resolveOwnerOrAdminTenant(
  sql: SqlClient,
  userId: string,
): Promise<MembershipRow | null> {
  const rows = await sql<MembershipRow>`
    select tenant_id, role from public.memberships
    where user_id = ${userId} and role in ('owner', 'admin')
    limit 1
  `;
  return rows[0] ?? null;
}

async function upsertConnection(
  sql: SqlClient,
  params: {
    tenantId: string;
    provider: string;
    authMode: string;
    accessToken: string;
    refreshToken?: string | undefined;
    expiresAt?: string | undefined;
    providerAccountId?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    connectedBy: string;
  },
): Promise<void> {
  await sql`
    insert into public.adapter_connections
      (tenant_id, provider, status, auth_mode, access_token, refresh_token, expires_at,
       provider_account_id, metadata, connected_by, last_refreshed_at)
    values
      (${params.tenantId}, ${params.provider}, 'connected', ${params.authMode}, ${params.accessToken},
       ${params.refreshToken ?? null}, ${params.expiresAt ?? null}, ${params.providerAccountId ?? null},
       ${JSON.stringify(params.metadata ?? {})}::jsonb, ${params.connectedBy}, now())
    on conflict (tenant_id, provider) do update set
      status = 'connected',
      auth_mode = excluded.auth_mode,
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, public.adapter_connections.refresh_token),
      expires_at = excluded.expires_at,
      provider_account_id = coalesce(excluded.provider_account_id, public.adapter_connections.provider_account_id),
      metadata = public.adapter_connections.metadata || excluded.metadata,
      disconnected_at = null,
      last_error = null,
      last_refreshed_at = now()
  `;
}

export async function handleAdapterConnect(
  sql: SqlClient,
  userId: string,
  rawBody: unknown,
  deps: AdapterConnectDeps,
): Promise<AdapterConnectResult> {
  const parsed = AdapterConnectRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { ok: false, status: 400, error: "invalid_request" };
  }
  const req: AdapterConnectRequest = parsed.data;

  const membership = await resolveOwnerOrAdminTenant(sql, userId);
  if (!membership) {
    return { ok: false, status: 403, error: "not_a_tenant_owner_or_admin" };
  }
  const tenantId = membership.tenant_id;

  switch (req.action) {
    case "initiate": {
      const state = await signOAuthState(deps.stateSecret, {
        tenantId,
        provider: req.provider,
        nonce: deps.nonce(),
      });
      if (req.provider === "square") {
        const url = new URL("https://connect.squareup.com/oauth2/authorize");
        url.searchParams.set("client_id", deps.square.clientId);
        url.searchParams.set(
          "scope",
          "APPOINTMENTS_ALL_READ APPOINTMENTS_ALL_WRITE MERCHANT_PROFILE_READ",
        );
        url.searchParams.set("session", "false");
        url.searchParams.set("state", state);
        return { ok: true, status: 200, body: { authorize_url: url.toString(), state } };
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", deps.googleCalendar.clientId);
      url.searchParams.set("redirect_uri", deps.googleCalendar.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "https://www.googleapis.com/auth/calendar");
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return { ok: true, status: 200, body: { authorize_url: url.toString(), state } };
    }

    case "callback": {
      const verification = await verifyOAuthState(deps.stateSecret, req.state);
      if (!verification.valid) {
        deps.logger.warn("adapter_connect_state_rejected", {
          reason: verification.reason,
          provider: req.provider,
        });
        return { ok: false, status: 401, error: `invalid_state:${verification.reason}` };
      }
      if (
        verification.payload.tenantId !== tenantId ||
        verification.payload.provider !== req.provider
      ) {
        deps.logger.warn("adapter_connect_state_mismatch", { provider: req.provider });
        return { ok: false, status: 401, error: "state_tenant_mismatch" };
      }

      if (req.provider === "square") {
        const token = await deps.fetchImpl("https://connect.squareup.com/oauth2/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_id: deps.square.clientId,
            client_secret: deps.square.clientSecret,
            code: req.code,
            grant_type: "authorization_code",
          }),
        });
        const body = (await token.json().catch(() => undefined)) as
          | {
              access_token: string;
              refresh_token: string;
              expires_at?: string;
              merchant_id?: string;
            }
          | undefined;
        if (!token.ok || !body)
          return { ok: false, status: 502, error: "square_token_exchange_failed" };

        await upsertConnection(sql, {
          tenantId,
          provider: "square",
          authMode: "oauth2_authorization_code",
          accessToken: body.access_token,
          refreshToken: body.refresh_token,
          expiresAt: body.expires_at,
          providerAccountId: body.merchant_id,
          connectedBy: userId,
        });
        return { ok: true, status: 200, body: { connected: true, provider: "square" } };
      }

      const token = await deps.fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: deps.googleCalendar.clientId,
          client_secret: deps.googleCalendar.clientSecret,
          code: req.code,
          redirect_uri: deps.googleCalendar.redirectUri,
          grant_type: "authorization_code",
        }).toString(),
      });
      const body = (await token.json().catch(() => undefined)) as
        | { access_token: string; refresh_token?: string; expires_in?: number }
        | undefined;
      if (!token.ok || !body)
        return { ok: false, status: 502, error: "google_token_exchange_failed" };

      await upsertConnection(sql, {
        tenantId,
        provider: "google_calendar",
        authMode: "oauth2_authorization_code",
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: body.expires_in
          ? new Date(Date.now() + body.expires_in * 1000).toISOString()
          : undefined,
        metadata: { calendarId: "primary" },
        connectedBy: userId,
      });
      return { ok: true, status: 200, body: { connected: true, provider: "google_calendar" } };
    }

    case "paste_key": {
      if (req.provider === "shopmonkey") {
        const validated = await validateShopmonkeyApiKey(deps.fetchImpl, req.api_key);
        if (!validated.ok) {
          return { ok: false, status: 401, error: "shopmonkey_api_key_invalid" };
        }
        await upsertConnection(sql, {
          tenantId,
          provider: "shopmonkey",
          authMode: "api_key",
          accessToken: req.api_key,
          connectedBy: userId,
        });
        return { ok: true, status: 200, body: { connected: true, provider: "shopmonkey" } };
      }

      // ezyvet: no per-tenant secret from the tenant — our own partner
      // client-credentials mint a token scoped to whichever practice
      // database granted us access at `base_url`; success here IS the
      // proof the practice completed the partner-authorization step on
      // their end (API_AND_FLOWS.md A.6).
      const refreshed = await refreshEzyVetToken(deps.fetchImpl, req.base_url, deps.ezyvet);
      if (!refreshed.ok) {
        return { ok: false, status: 401, error: "ezyvet_practice_not_authorized" };
      }
      const body = refreshed.body as { access_token: string; expires_in?: number };
      await upsertConnection(sql, {
        tenantId,
        provider: "ezyvet",
        authMode: "oauth2_client_credentials",
        accessToken: body.access_token,
        expiresAt: body.expires_in
          ? new Date(Date.now() + body.expires_in * 1000).toISOString()
          : undefined,
        metadata: { baseUrl: req.base_url },
        connectedBy: userId,
      });
      return { ok: true, status: 200, body: { connected: true, provider: "ezyvet" } };
    }

    case "disconnect": {
      await sql`
        update public.adapter_connections
        set status = 'disconnected', disconnected_at = now(), last_error = 'tenant-initiated disconnect'
        where tenant_id = ${tenantId} and provider = ${req.provider}
      `;
      return { ok: true, status: 200, body: { disconnected: true, provider: req.provider } };
    }
  }
}
