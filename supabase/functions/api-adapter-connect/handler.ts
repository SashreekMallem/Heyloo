import { stopChannelBestEffort } from "../_shared/calendar/watch.ts";
import { checkEncryptionKey, decryptSecret, encryptSecret } from "../_shared/crypto.ts";
import {
  exchangeGoogleAuthCode,
  GOOGLE_CALENDAR_OAUTH_SCOPES,
  missingGoogleCalendarPermissions,
  refreshGoogleAccessToken,
} from "../_shared/providers/google-calendar.ts";
import { validateShopmonkeyApiKey } from "../_shared/providers/shopmonkey.ts";
import type { Logger, SqlClient } from "../_shared/types.ts";
import type { AdapterConnectRequest } from "./schema.ts";
import { AdapterConnectRequestSchema } from "./schema.ts";
import { signOAuthState, verifyOAuthState } from "./state.ts";

/**
 * `/api-adapter-connect` (BACKEND_SPEC §7.6, task item 3): tenant-facing
 * connect flow for the four T7 adapters — OAuth initiate/callback for
 * Square/Google Calendar, paste-key validation for Shopmonkey. ezyVet
 * paste-key is refused (CONNECT-SAFE-1); its disconnect still works.
 * Writes/updates a single `adapter_connections` row per tenant+provider
 * (unique constraint, so a reconnect is an upsert, never a duplicate row —
 * "reauthorize-updates-not-duplicates", the salvaged UX rule SYSTEM_DESIGN
 * §14 calls out).
 */
export interface AdapterConnectDeps {
  fetchImpl: typeof fetch;
  nonce: () => string;
  // QA-1 BE-04: every secret below is OPTIONAL at the type level. `index.ts`
  // used to `requireEnv` all of them at module scope, so ONE unset provider
  // secret crashed the whole function (WORKER_ERROR 500) and no integration
  // could connect. Each action now checks only what it needs, AFTER auth, and
  // answers 503 `not_configured` when that is missing.
  stateSecret?: string | undefined;
  square?: { clientId: string; clientSecret: string; redirectUri: string } | undefined;
  googleCalendar?: { clientId: string; clientSecret: string; redirectUri: string } | undefined;
  // DB-H2: AES-256-GCM key `access_token`/`refresh_token` are encrypted
  // with before ever reaching `adapter_connections` — see `_shared/crypto.ts`.
  tokenEncryptionKey?: string | undefined;
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
    tokenEncryptionKey: string;
    /** CAL-1b (Google Calendar): ask the sync leg for one busy-time read now
     * and a fresh push channel right away (`watch_expires_at = null`, the
     * channel backoff cleared; a channel from before the reconnect, possibly
     * another Google account's, is replaced and stopped). */
    requestCalendarSync?: boolean;
  },
): Promise<void> {
  const requestSync = params.requestCalendarSync === true;
  const encryptedAccessToken = await encryptSecret(params.accessToken, params.tokenEncryptionKey);
  const encryptedRefreshToken = params.refreshToken
    ? await encryptSecret(params.refreshToken, params.tokenEncryptionKey)
    : undefined;
  await sql`
    insert into public.adapter_connections
      (tenant_id, provider, status, auth_mode, access_token, refresh_token, expires_at,
       provider_account_id, metadata, connected_by, last_refreshed_at, busy_sync_requested_at)
    values
      (${params.tenantId}, ${params.provider}, 'connected', ${params.authMode}, ${encryptedAccessToken},
       ${encryptedRefreshToken ?? null}, ${params.expiresAt ?? null}, ${params.providerAccountId ?? null},
       ${params.metadata ?? {}}::jsonb, ${params.connectedBy}, now(),
       case when ${requestSync}::boolean then now() end)
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
      last_refreshed_at = now(),
      busy_sync_requested_at = coalesce(excluded.busy_sync_requested_at,
        public.adapter_connections.busy_sync_requested_at),
      busy_sync_attempted_at = null,
      busy_sync_failures = 0,
      busy_sync_failing_since = null,
      watch_expires_at = case when ${requestSync}::boolean then null
        else public.adapter_connections.watch_expires_at end,
      watch_failures = case when ${requestSync}::boolean then 0
        else public.adapter_connections.watch_failures end,
      watch_retry_at = case when ${requestSync}::boolean then null
        else public.adapter_connections.watch_retry_at end
  `;
}

interface DisconnectedChannelRow {
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | Date | null;
}

/** A stored access token this close to expiry is refreshed before use. */
const ACCESS_TOKEN_SAFETY_MS = 60_000;
/** Per Google call on the owner's disconnect (the request waits for it). */
const DISCONNECT_GOOGLE_TIMEOUT_MS = 4_000;

/**
 * CAL-1b: `channels.stop` for the push channel of a Google connection the
 * owner just disconnected (the row is already disconnected and its channel
 * forgotten, so nothing here can leave it half-done). Best effort: never
 * throws; the stored access token is used while valid, else one refresh
 * (not stored — the connection is off). Skipped when the token key or the
 * Google client is not configured; the channel then runs out by itself
 * (at most 7 days) and its notifications are refused.
 */
async function stopDisconnectedChannel(
  deps: AdapterConnectDeps,
  tenantId: string,
  row: DisconnectedChannelRow & { watch_channel_id: string; watch_resource_id: string },
): Promise<void> {
  const context = { tenant_id: tenantId, provider: "google_calendar" };
  const key = deps.tokenEncryptionKey;
  if (!key || checkEncryptionKey(key) !== null) {
    deps.logger.warn("adapter_disconnect_channel_not_stopped", { ...context, reason: "no_key" });
    return;
  }
  try {
    const expiresMs =
      row.expires_at instanceof Date
        ? row.expires_at.getTime()
        : row.expires_at
          ? Date.parse(row.expires_at)
          : Number.NaN;
    let accessToken: string | null =
      row.access_token &&
      Number.isFinite(expiresMs) &&
      expiresMs - Date.now() > ACCESS_TOKEN_SAFETY_MS
        ? await decryptSecret(row.access_token, key)
        : null;
    if (!accessToken && row.refresh_token && deps.googleCalendar) {
      const refreshed = await refreshGoogleAccessToken(deps.fetchImpl, {
        clientId: deps.googleCalendar.clientId,
        clientSecret: deps.googleCalendar.clientSecret,
        refreshToken: await decryptSecret(row.refresh_token, key),
        signal: AbortSignal.timeout(DISCONNECT_GOOGLE_TIMEOUT_MS),
      });
      accessToken = refreshed.ok ? refreshed.grant.accessToken : null;
    }
    if (!accessToken) {
      deps.logger.warn("adapter_disconnect_channel_not_stopped", {
        ...context,
        reason: "no_token",
      });
      return;
    }
    await stopChannelBestEffort(
      deps.fetchImpl,
      accessToken,
      { channelId: row.watch_channel_id, resourceId: row.watch_resource_id },
      deps.logger,
      context,
      DISCONNECT_GOOGLE_TIMEOUT_MS,
    );
  } catch (err) {
    deps.logger.warn("adapter_disconnect_channel_not_stopped", {
      ...context,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

function notConfigured(deps: AdapterConnectDeps, provider: string): AdapterConnectResult {
  deps.logger.error("adapter_connect_not_configured", { provider });
  return { ok: false, status: 503, error: "not_configured" };
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
      const stateSecret = deps.stateSecret;
      const providerConfig = req.provider === "square" ? deps.square : deps.googleCalendar;
      if (!stateSecret || !providerConfig) return notConfigured(deps, req.provider);
      const state = await signOAuthState(stateSecret, {
        tenantId,
        provider: req.provider,
        nonce: deps.nonce(),
      });
      if (req.provider === "square") {
        const url = new URL("https://connect.squareup.com/oauth2/authorize");
        url.searchParams.set("client_id", providerConfig.clientId);
        url.searchParams.set(
          "scope",
          "APPOINTMENTS_ALL_READ APPOINTMENTS_ALL_WRITE MERCHANT_PROFILE_READ",
        );
        url.searchParams.set("session", "false");
        url.searchParams.set("state", state);
        return { ok: true, status: 200, body: { authorize_url: url.toString(), state } };
      }
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", providerConfig.clientId);
      url.searchParams.set("redirect_uri", providerConfig.redirectUri);
      url.searchParams.set("response_type", "code");
      // CAL-1: the two narrow scopes Heyloo uses (busy times + its own
      // booking events), not the broad `auth/calendar`.
      url.searchParams.set("scope", GOOGLE_CALENDAR_OAUTH_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      return { ok: true, status: 200, body: { authorize_url: url.toString(), state } };
    }

    case "callback": {
      const stateSecret = deps.stateSecret;
      const tokenEncryptionKey = deps.tokenEncryptionKey;
      const providerConfig = req.provider === "square" ? deps.square : deps.googleCalendar;
      if (
        !stateSecret ||
        !providerConfig ||
        !tokenEncryptionKey ||
        checkEncryptionKey(tokenEncryptionKey) !== null
      ) {
        return notConfigured(deps, req.provider);
      }
      const verification = await verifyOAuthState(stateSecret, req.state);
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
            client_id: providerConfig.clientId,
            client_secret: providerConfig.clientSecret,
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
          tokenEncryptionKey,
        });
        return { ok: true, status: 200, body: { connected: true, provider: "square" } };
      }

      // CAL-1: the token answer is Zod-validated in the provider module.
      const exchanged = await exchangeGoogleAuthCode(deps.fetchImpl, {
        clientId: providerConfig.clientId,
        clientSecret: providerConfig.clientSecret,
        redirectUri: providerConfig.redirectUri,
        code: req.code,
      });
      if (!exchanged.ok) {
        deps.logger.warn("adapter_connect_google_token_exchange_failed", {
          failure: exchanged.failure,
          status: exchanged.status,
        });
        return { ok: false, status: 502, error: "google_token_exchange_failed" };
      }
      const grant = exchanged.grant;
      // Google lets the owner untick a permission on the consent screen.
      // Without busy times the AI cannot avoid their appointments, and
      // without events the booking push would fail and break the connection,
      // so a partial grant is refused (nothing stored) and they are asked to
      // connect again. No `scope` field at all is accepted (logged).
      if (grant.grantedScopes === null) {
        deps.logger.warn("adapter_connect_google_scope_unreported", {});
      } else {
        const missing = missingGoogleCalendarPermissions(grant.grantedScopes);
        if (missing.length > 0) {
          deps.logger.warn("adapter_connect_google_scopes_missing", { missing });
          return { ok: false, status: 400, error: "google_scopes_not_granted" };
        }
      }

      await upsertConnection(sql, {
        tenantId,
        provider: "google_calendar",
        authMode: "oauth2_authorization_code",
        accessToken: grant.accessToken,
        refreshToken: grant.refreshToken,
        expiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000).toISOString(),
        metadata: { calendarId: "primary" },
        connectedBy: userId,
        tokenEncryptionKey,
        requestCalendarSync: true,
      });
      return { ok: true, status: 200, body: { connected: true, provider: "google_calendar" } };
    }

    case "paste_key": {
      // CONNECT-SAFE-1: ezyVet is not connectable. Its client-credentials
      // mint sends OUR partner client_secret to the tenant-supplied base URL
      // (docs/VERIFY.md SSRF-1), and the per-practice authorization flow is
      // unconfirmed, so it is refused before any secret or network call. The
      // dashboard lists ezyVet as "Coming soon"; disconnect still works.
      if (req.provider === "ezyvet") {
        deps.logger.warn("adapter_connect_provider_unavailable", { provider: req.provider });
        return { ok: false, status: 409, error: "provider_unavailable" };
      }
      const tokenEncryptionKey = deps.tokenEncryptionKey;
      if (!tokenEncryptionKey || checkEncryptionKey(tokenEncryptionKey) !== null) {
        return notConfigured(deps, req.provider);
      }
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
        tokenEncryptionKey,
      });
      return { ok: true, status: 200, body: { connected: true, provider: "shopmonkey" } };
    }

    case "disconnect": {
      // CAL-1: the owner turned the calendar off, so Heyloo stops using what
      // it read from it — its busy blocks go in the same statement. CAL-1b:
      // its push channel is forgotten in that statement too (a notification
      // for it is then refused as an unknown channel) and stopped at Google
      // afterwards, best effort.
      const rows = await sql<DisconnectedChannelRow>`
        with previous as (
          select id, tenant_id, watch_channel_id, watch_resource_id,
            access_token, refresh_token, expires_at
          from public.adapter_connections
          where tenant_id = ${tenantId} and provider = ${req.provider}
          for update
        ), disconnected as (
          update public.adapter_connections a
          set status = 'disconnected', disconnected_at = now(), last_error = 'tenant-initiated disconnect',
              watch_channel_id = null, watch_resource_id = null, watch_token_hash = null,
              watch_expires_at = null
          from previous p
          where a.id = p.id and a.tenant_id = p.tenant_id
          returning a.id, a.tenant_id
        ), removed as (
          delete from public.external_busy_blocks x
          using disconnected d
          where x.connection_id = d.id and x.tenant_id = d.tenant_id
          returning 1
        )
        select p.watch_channel_id, p.watch_resource_id, p.access_token, p.refresh_token,
          p.expires_at, (select count(*) from removed)::int as blocks_removed
        from previous p
      `;
      const previous = rows[0];
      if (
        req.provider === "google_calendar" &&
        previous?.watch_channel_id &&
        previous.watch_resource_id
      ) {
        await stopDisconnectedChannel(deps, tenantId, {
          ...previous,
          watch_channel_id: previous.watch_channel_id,
          watch_resource_id: previous.watch_resource_id,
        });
      }
      return { ok: true, status: 200, body: { disconnected: true, provider: req.provider } };
    }
  }
}
