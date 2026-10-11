import { decryptSecret } from "../crypto.ts";
import {
  freeBusyQuery,
  type GoogleCalendarFetch,
  refreshGoogleAccessToken,
} from "../providers/google-calendar.ts";
import type { SqlClient } from "../types.ts";
import {
  blocksFromBusy,
  buildCalendarPlan,
  type CalendarBusyCheck,
  type CalendarPlan,
  type LiveBusyVerdict,
  planCalendarIds,
} from "./busy.ts";

/**
 * CAL-1 live re-check for `create_booking`: right before a booking is
 * written, ask Google whether the owner filled that exact time since the
 * last background read (`sync.ts`; CAL-1b push-only: a change reaches the
 * synced table about a minute after Google notifies Heyloo, so this covers
 * that window). Because the sync no longer refreshes tokens on a timer, the
 * stored access token is usually stale (Google access tokens last about an
 * hour), so this check refreshes it itself, inside the same deadline, and
 * keeps the fresh token in a per-isolate cache — never written back on the
 * hot path (the sync stores its own refreshes).
 *
 * Hot-path rules (SYSTEM_DESIGN §5):
 *  - runs IN PARALLEL with create_booking's preflight and is hard-capped at
 *    `LIVE_CHECK_TIMEOUT_MS` (`startLiveCalendarCheck`); a timeout, an
 *    expired token, or any Google/DB error reads `unknown` and the booking
 *    proceeds on the synced table — the check can never fail a booking;
 *  - an access token within `TOKEN_EXPIRY_SAFETY_MS` of expiry is refreshed
 *    (one token-endpoint call, still under the deadline; refused or failed
 *    refresh reads `unknown`). Without the Google client credentials it
 *    reads `unknown` as before;
 *  - the connection lookup (one indexed read on adapter_connections' unique
 *    (tenant_id, provider), plus the tenant's resource calendar mappings) is
 *    cached per isolate: a connection for `LIVE_CHECK_CACHE_TTL_MS`, "no
 *    connection" for `LIVE_CHECK_NEGATIVE_CACHE_TTL_MS`, so a tenant without
 *    Google pays this third statement at most once per isolate per 10
 *    minutes. create_booking starts the check only after its preflight
 *    statement is queued, so on the single hot-path connection the lookup
 *    (and a first-use describe of it) waits behind the preflight, never the
 *    other way round;
 *  - the Google host is fixed (`GOOGLE_CALENDAR_BASE_URL`); calendar ids
 *    travel in the JSON body, never in the URL.
 */

export const LIVE_CHECK_TIMEOUT_MS = 800;
export const LIVE_CHECK_CACHE_TTL_MS = 60_000;
/** "No connected calendar" is cached longer: a new connection is read by the
 * sync within a minute either way (a connect resets its claim). */
export const LIVE_CHECK_NEGATIVE_CACHE_TTL_MS = 10 * 60_000;
const LIVE_CHECK_CACHE_MAX_ENTRIES = 500;
/** An access token this close to expiry is refreshed before use. */
export const TOKEN_EXPIRY_SAFETY_MS = 30_000;

interface LiveConnection {
  accessToken: string;
  expiresAt: number | null;
  refreshToken: string | null;
  plan: CalendarPlan;
}

interface FreshToken {
  accessToken: string;
  expiresAt: number;
}

/** Per-isolate cache of each tenant's connection lookup (null = none), plus
 * access tokens this isolate refreshed itself (they outlive a connection
 * reload, so a busy tenant refreshes at most about once an hour per isolate). */
export class LiveConnectionCache {
  private readonly entries = new Map<string, { at: number; value: LiveConnection | null }>();
  private readonly freshTokens = new Map<string, FreshToken>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly negativeTtlMs: number;

  constructor(
    ttlMs: number = LIVE_CHECK_CACHE_TTL_MS,
    maxEntries: number = LIVE_CHECK_CACHE_MAX_ENTRIES,
    negativeTtlMs: number = LIVE_CHECK_NEGATIVE_CACHE_TTL_MS,
  ) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.negativeTtlMs = negativeTtlMs;
  }

  get(tenantId: string, now: number): { value: LiveConnection | null } | undefined {
    const entry = this.entries.get(tenantId);
    if (!entry) return undefined;
    if (now - entry.at > (entry.value === null ? this.negativeTtlMs : this.ttlMs)) {
      this.entries.delete(tenantId);
      return undefined;
    }
    return { value: entry.value };
  }

  set(tenantId: string, value: LiveConnection | null, now: number): void {
    this.entries.delete(tenantId);
    this.entries.set(tenantId, { at: now, value });
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  delete(tenantId: string): void {
    this.entries.delete(tenantId);
    this.freshTokens.delete(tenantId);
  }

  freshToken(tenantId: string): FreshToken | undefined {
    return this.freshTokens.get(tenantId);
  }

  setFreshToken(tenantId: string, token: FreshToken): void {
    this.freshTokens.delete(tenantId);
    this.freshTokens.set(tenantId, token);
    if (this.freshTokens.size > this.maxEntries) {
      const oldest = this.freshTokens.keys().next().value;
      if (oldest !== undefined) this.freshTokens.delete(oldest);
    }
  }
}

export interface CalendarLiveCheckConfig {
  /** Plain `fetch` is fine: the host is a fixed Google API host. */
  fetchImpl: GoogleCalendarFetch;
  /** `ADAPTER_TOKEN_ENCRYPTION_KEY`. */
  tokenEncryptionKey: string;
  /** Module-scope in voice-tools/index.ts, so it survives warm invocations. */
  cache: LiveConnectionCache;
  /** `GOOGLE_CALENDAR_CLIENT_ID` / `_SECRET`; without them an expired token
   * reads `unknown` (no refresh). */
  googleClient?: { clientId: string; clientSecret: string };
  /** Epoch-ms clock (tests). */
  now?: () => number;
}

interface LiveConnectionRow {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | Date | null;
  metadata: unknown;
  resource_calendars: unknown;
}

async function loadLiveConnection(
  sql: SqlClient,
  tenantId: string,
  config: CalendarLiveCheckConfig,
  now: number,
): Promise<LiveConnection | null> {
  const cached = config.cache.get(tenantId, now);
  if (cached) return cached.value;
  const rows = await sql<LiveConnectionRow>`
    /* calendar_live_check:connection */
    select c.access_token, c.refresh_token, c.expires_at, c.metadata,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'resource_id', r.id,
          'calendar_id', r.metadata -> 'adapter_external_id' ->> 'google_calendar'))
        from public.resources r
        where r.tenant_id = c.tenant_id and r.active
          and coalesce(r.metadata -> 'adapter_external_id' ->> 'google_calendar', '') <> ''
      ), '[]'::jsonb) as resource_calendars
    from public.adapter_connections c
    where c.tenant_id = ${tenantId} and c.provider = 'google_calendar' and c.status = 'connected'
    limit 1
  `;
  const row = rows[0];
  let value: LiveConnection | null = null;
  if (row?.access_token) {
    const expiresAt =
      row.expires_at === null
        ? null
        : row.expires_at instanceof Date
          ? row.expires_at.getTime()
          : Date.parse(row.expires_at);
    value = {
      accessToken: await decryptSecret(row.access_token, config.tokenEncryptionKey),
      expiresAt: expiresAt !== null && Number.isFinite(expiresAt) ? expiresAt : null,
      refreshToken: row.refresh_token
        ? await decryptSecret(row.refresh_token, config.tokenEncryptionKey)
        : null,
      plan: buildCalendarPlan(row.metadata, row.resource_calendars),
    };
  }
  config.cache.set(tenantId, value, now);
  return value;
}

/** Builds the create_booking `calendarBusy` dependency for one request's `sql`. */
export function makeCalendarLiveCheck(
  sql: SqlClient,
  config: CalendarLiveCheckConfig,
): CalendarBusyCheck {
  const clock = config.now ?? Date.now;
  return async (tenantId, range, signal): Promise<LiveBusyVerdict> => {
    try {
      const connection = await loadLiveConnection(sql, tenantId, config, clock());
      if (!connection) return { status: "skipped" };
      if (signal.aborted) return { status: "unknown", reason: "timeout" };
      const accessToken = await usableAccessToken(tenantId, connection, config, clock, signal);
      if (typeof accessToken !== "string") return accessToken;
      if (signal.aborted) return { status: "unknown", reason: "timeout" };
      const result = await freeBusyQuery(config.fetchImpl, accessToken, {
        items: planCalendarIds(connection.plan),
        timeMin: range.start,
        timeMax: range.end,
        signal,
      });
      if (!result.ok) {
        // A rejected token is the sync's to handle; forget it here so the
        // next booking re-reads whatever the sync stored.
        if (result.failure === "auth") config.cache.delete(tenantId);
        return { status: "unknown", reason: signal.aborted ? "timeout" : result.failure };
      }
      return { status: "checked", blocks: blocksFromBusy(connection.plan, result.calendars) };
    } catch {
      return { status: "unknown", reason: signal.aborted ? "timeout" : "error" };
    }
  };
}

/** The stored token if it is still good, else this isolate's own fresher
 * token, else one refresh under the caller's deadline (kept in the cache,
 * never written back). Returns the verdict to give up with otherwise. */
async function usableAccessToken(
  tenantId: string,
  connection: LiveConnection,
  config: CalendarLiveCheckConfig,
  clock: () => number,
  signal: AbortSignal,
): Promise<string | LiveBusyVerdict> {
  const goodUntil = (expiresAt: number | null) =>
    expiresAt !== null && expiresAt - clock() >= TOKEN_EXPIRY_SAFETY_MS;
  if (goodUntil(connection.expiresAt)) return connection.accessToken;
  const fresh = config.cache.freshToken(tenantId);
  if (fresh && goodUntil(fresh.expiresAt)) return fresh.accessToken;
  if (!config.googleClient || !connection.refreshToken) {
    return { status: "unknown", reason: "token_expired" };
  }
  const refreshed = await refreshGoogleAccessToken(config.fetchImpl, {
    clientId: config.googleClient.clientId,
    clientSecret: config.googleClient.clientSecret,
    refreshToken: connection.refreshToken,
    signal,
  });
  if (!refreshed.ok) {
    // A refused refresh token is the sync's to handle (it disconnects and
    // alerts); forget this tenant here so the next booking re-reads.
    if (refreshed.failure === "invalid_grant") config.cache.delete(tenantId);
    return { status: "unknown", reason: signal.aborted ? "timeout" : "token_refresh_failed" };
  }
  config.cache.setFreshToken(tenantId, {
    accessToken: refreshed.grant.accessToken,
    expiresAt: clock() + refreshed.grant.expiresInSeconds * 1000,
  });
  return refreshed.grant.accessToken;
}

/**
 * Starts `check` now with a hard deadline: `verdict` settles by `timeoutMs`
 * at the latest (`unknown`/`timeout`, and the request is aborted), never
 * rejects, and leaves no timer behind. `cancel()` aborts an in-flight check
 * whose answer is no longer needed (an idempotent replay, an early refusal).
 */
export function startLiveCalendarCheck(
  check: CalendarBusyCheck,
  tenantId: string,
  range: { start: string; end: string },
  timeoutMs: number = LIVE_CHECK_TIMEOUT_MS,
): { verdict: Promise<LiveBusyVerdict>; cancel: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<LiveBusyVerdict>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ status: "unknown", reason: "timeout" });
    }, timeoutMs);
  });
  const work = check(tenantId, range, controller.signal).catch(
    (): LiveBusyVerdict => ({ status: "unknown", reason: "error" }),
  );
  const verdict = Promise.race([work, deadline]).finally(() => clearTimeout(timer));
  return {
    verdict,
    cancel: () => {
      clearTimeout(timer);
      controller.abort();
    },
  };
}
