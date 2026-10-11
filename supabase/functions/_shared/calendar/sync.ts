import { decryptSecret, encryptSecret } from "../crypto.ts";
import { enqueueOwnerAlert } from "../owner-alerts.ts";
import {
  type FreeBusyResult,
  freeBusyQuery,
  type GoogleBusyInterval,
  type GoogleCalendarFetch,
  refreshGoogleAccessToken,
  watchCalendarEvents,
} from "../providers/google-calendar.ts";
import type { Logger, SqlClient } from "../types.ts";
import {
  blocksFromBusy,
  buildCalendarPlan,
  type CalendarBlock,
  chunkTimeRange,
  planCalendarIds,
} from "./busy.ts";
import {
  CALENDAR_WATCH_RENEW_BEFORE_HOURS,
  CALENDAR_WATCH_RENEW_MIN_INTERVAL_MINUTES,
  CALENDAR_WATCH_TTL_SECONDS,
  newWatchChannel,
  type StopChannelOutcome,
  stopChannelBestEffort,
} from "./watch.ts";

/**
 * CAL-1 / CAL-1b busy-time sync — the worker-tick `calendar_busy_sync` leg.
 * worker-tick runs every minute, but checking our own database is not a
 * Google call: Google is called ONLY when (a) the owner connected or
 * reconnected, (b) a verified push notification (webhooks-pos) said the
 * calendar changed, (c) the push channel has to be registered or renewed
 * (renewal reads once, so a quiet calendar is read about every 6 days),
 * (d) a FAILED read is retried with backoff (1, 5, 15, 60 minutes, then
 * hourly while it is still due), or (e) the last read no longer reaches the
 * end of the booking horizon (normally never: each read covers the horizon
 * plus `CALENDAR_SYNC_COVERAGE_SLACK_DAYS`, more than the gap between
 * renewals; only when renewals keep failing or the owner lengthened the
 * horizon). A healthy calendar with no changes is never re-read on a timer.
 * (The create_booking live re-check, `live-check.ts`, is separate and
 * unchanged.)
 *
 * Per run:
 *  1. Sweep: busy blocks of a connection that is no longer connected are
 *     deleted — at once when the owner turned it off, else once its last
 *     successful read (`busy_synced_at`) is `CALENDAR_STALE_BLOCKS_HOURS`
 *     old (a broken connection keeps blocking the times it last saw for a
 *     day, then stops).
 *  2. Owner alerts (`alertBrokenConnections`): one `calendar_disconnected`
 *     alert per break, whoever found it — this sync, the booking push
 *     (worker-adapter-push also disconnects google_calendar rows), or reads
 *     that have kept failing for `CALENDAR_READ_FAILING_ALERT_HOURS`.
 *  3. `CALENDAR_SYNC_CONCURRENCY` lanes each claim one DUE connection at a
 *     time (an UPDATE ... FROM a `for update of c skip locked` pick, so lanes
 *     and overlapping ticks never claim the same connection; the tenant's
 *     booking horizon and resource calendar mappings come back in the same
 *     statement) and claim the next while the run is younger than
 *     `CALENDAR_SYNC_CLAIM_BUDGET_MS`. Due = connected, not leased
 *     (`CALENDAR_SYNC_LEASE_SECONDS`), past its read-retry backoff, and
 *     either a read is due (`busy_sync_requested_at` newer than
 *     `busy_synced_at`, or `busy_synced_until` short of the horizon) or its
 *     push channel is missing / expiring within
 *     `CALENDAR_WATCH_RENEW_BEFORE_HOURS` and `watch_retry_at` has passed.
 *  4. Per connection: refresh the access token when it expires within
 *     `CALENDAR_TOKEN_REFRESH_MARGIN_MS`; if the channel is due, register a
 *     new one (`events.watch`, new id, new random token whose SHA-256 hex is
 *     stored), store it, request a read, and stop the old channel
 *     (`channels.stop`, best effort); then, if a read is due, read freeBusy
 *     for now -> now + horizon + slack (chunked, in parallel) and REPLACE the
 *     connection's rows in ONE statement whose first step is the locking
 *     update (`busy_synced_at = <claim time>`, so a notification that lands
 *     during the read keeps the request due and is read next tick;
 *     `busy_synced_until = <window end>`).
 *
 * Every write of a run is guarded on the claim it made
 * (`busy_sync_attempted_at`): an owner reconnect resets the claim, so an
 * older run still holding the revoked tokens can never mark the new
 * connection broken, overwrite its token or channel, or write what the old
 * account saw. A channel registered by a run that lost its claim is stopped.
 *
 * Failure handling:
 *  - channel registration failed (any kind, a 401/403 included — Google can
 *    answer that about the webhook address, not the grant): counted apart
 *    (`watch_failures`, retried after `watch_retry_at`), never in the read
 *    bookkeeping, so a renewal that keeps failing never delays the reads the
 *    still-live old channel asks for and never tells the owner reads fail.
 *    With no live channel (nothing would ever ask for a read) or a refused
 *    token, the same attempt reads the calendar too: a broken channel
 *    degrades to backed-off reads, and the read decides whether the grant
 *    is really gone;
 *  - read failed, transient (5xx, 429/usage limits, timeout, network,
 *    per-calendar `errors[]`, an unexpected body, our own client
 *    misconfigured, a token we cannot decrypt): keep the existing blocks,
 *    record `last_error`, `busy_sync_failing_since` and one more
 *    `busy_sync_failures` (the backoff), retry later (the owner is alerted
 *    once it has lasted `CALENDAR_READ_FAILING_ALERT_HOURS`);
 *  - auth (401 or a non-usage 403 on the READ, `invalid_grant`, no refresh
 *    token): mark the connection `disconnected` with the reason (the
 *    dashboard then shows "Needs reconnect"), clear its channel (stopped
 *    first, best effort, while the stored access token is still good), and
 *    delete its blocks only if they are already stale; the alert step of
 *    the next run tells the owner.
 *
 * Heyloo's own bookings: the booking push writes every booking to the
 * connection's calendar, so freeBusy reports them as busy too. Unless taken
 * out, one booking on one resource would block every resource at that time.
 * The replace statement subtracts the tenant's Google-pushed, not-cancelled
 * bookings (`adapter_sync_state`) from the connection-calendar intervals.
 * (Each push also triggers a notification and so one read — the price of
 * push-only freshness.)
 */

/** Connections synced at the same time (one claim per lane). */
export const CALENDAR_SYNC_CONCURRENCY = 10;
/** Lanes claim another connection only while the run is younger than this. */
export const CALENDAR_SYNC_CLAIM_BUDGET_MS = 5_000;
/** Safety cap on connections claimed by one run. */
export const CALENDAR_SYNC_MAX_PER_RUN = 300;
/** A claimed connection is not claimed again for this long (a run ends well
 * inside it; a run that died mid-way is retried on the next tick). */
export const CALENDAR_SYNC_LEASE_SECONDS = 45;
/** Retry backoff after 1, 2, 3, 4+ consecutive failures: 1, 5, 15, then 60
 * minutes (hourly while still due). Used for failed reads
 * (`busy_sync_failures`, gating the claim) and, separately, failed channel
 * registrations (`watch_failures` -> `watch_retry_at`). Inlined in those
 * statements as `array[1, 5, 15, 60]`. */
export const CALENDAR_SYNC_BACKOFF_MINUTES = [1, 5, 15, 60] as const;
export const CALENDAR_SYNC_REQUEST_TIMEOUT_MS = 4_000;
export const CALENDAR_TOKEN_REFRESH_MARGIN_MS = 10 * 60_000;
/** A broken connection keeps blocking the times it last saw for this long. */
export const CALENDAR_STALE_BLOCKS_HOURS = 24;
/** `tenants_booking_horizon_days_check` allows up to 365 days, plus one. */
export const CALENDAR_SYNC_MAX_HORIZON_DAYS = 366;
/** Each read covers this many days past the horizon: a quiet calendar is
 * read again only when its channel is renewed (about 6 days after it was
 * registered, always within its 7-day lifetime), so the 7 days plus one keep
 * the far end of the horizon covered until then. If renewals keep failing,
 * the claim's coverage check (`busy_synced_until`) reads it anyway once the
 * window no longer reaches the horizon. */
export const CALENDAR_SYNC_COVERAGE_SLACK_DAYS = Math.ceil(CALENDAR_WATCH_TTL_SECONDS / 86_400) + 1;
/** Reads failing this long (connection still connected) alert the owner once. */
export const CALENDAR_READ_FAILING_ALERT_HOURS = 3;
/** Owner alerts claimed per run. */
export const CALENDAR_ALERT_BATCH_SIZE = 25;
/** `adapter_connections.last_error` of an owner-initiated disconnect
 * (api-adapter-connect; mirrored by the web's `TENANT_DISCONNECT_SENTINEL`). */
export const TENANT_DISCONNECT_REASON = "tenant-initiated disconnect";
/** `adapter_connections.last_error` prefix of a failed sync attempt on a
 * still-connected calendar (mirrored by the web's `CALENDAR_SYNC_ERROR_PREFIX`:
 * the dashboard says Heyloo is having trouble and keeps trying). */
export const CALENDAR_SYNC_ERROR_PREFIX = "calendar busy sync: ";
/** Vertical defaults of `fn_regenerate_availability_slots` when the owner set none. */
const DEFAULT_HORIZON_DAYS = 21;
/** A connection that has not started its next Google call (watch or
 * freeBusy) this long after the leg began is handed back (claim released)
 * instead: one more request plus its DB writes still ends inside
 * worker-tick's 12 s per-leg deadline. */
export const CALENDAR_SYNC_START_DEADLINE_MS = 7_000;

const DAY_MS = 86_400_000;

export interface CalendarBusySyncDeps {
  /** Transport for Google (the worker passes its SSRF-safe adapter fetch). */
  fetchImpl: GoogleCalendarFetch;
  /** `ADAPTER_TOKEN_ENCRYPTION_KEY` (tokens are AES-GCM at rest). */
  tokenEncryptionKey: string;
  google: { clientId: string; clientSecret: string };
  /** HTTPS address Google delivers push notifications to (webhooks-pos,
   * `googleCalendarWebhookAddress`). Null (no HTTPS project URL, e.g. local
   * dev): no channel is registered and only requested reads run. */
  webhookAddress: string | null;
  logger: Logger;
  /** Epoch-ms clock (tests). */
  now?: () => number;
  /** Lanes (tests). */
  concurrency?: number;
  requestTimeoutMs?: number;
}

export interface RunCalendarBusySyncResult {
  claimed: number;
  synced: number;
  /** Transient failure: old blocks kept, `last_error` set, retried after backoff. */
  failed: number;
  /** Auth failure: connection marked disconnected ("Needs reconnect"). */
  needs_reconnect: number;
  /** Claim released because the leg's time budget ran out. */
  deferred: number;
  /** The connection was disconnected or reconnected while this run held it:
   * nothing written. */
  superseded: number;
  /** Blocks deleted by the stale sweep (disconnected connections). */
  stale_blocks_removed: number;
  /** `calendar_disconnected` owner alerts queued this run. */
  owner_alerts: number;
  /** Push channels registered (first channel or renewal). */
  channels_registered: number;
  /** Channel registrations that failed (retried after `watch_retry_at`; the
   * read bookkeeping is untouched). */
  channels_failed: number;
  /** Replaced (or orphaned) channels stopped at Google. */
  channels_stopped: number;
}

interface ClaimedConnection {
  id: string;
  tenant_id: string;
  /** This run's claim (`busy_sync_attempted_at` as text, microseconds and
   * offset intact). Compared as `${claimed_at}::text::timestamptz`: bound as
   * `::timestamptz`, postgres.js would serialize it through a JS Date, drop
   * the microseconds, and the equality guard on every later write would
   * never match (same rule as `_shared/outbound/delivery.ts`). */
  claimed_at: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | Date | null;
  metadata: unknown;
  busy_synced_at: string | Date | null;
  /** The current push channel (null before the first registration). */
  watch_channel_id: string | null;
  watch_resource_id: string | null;
  /** A read was requested and not done since, or the last read's window
   * (`busy_synced_until`) no longer reaches the end of the horizon. */
  read_due: boolean;
  /** The channel is missing or expires within a day and its retry time
   * (`watch_retry_at`) has passed (only when channels are enabled). */
  channel_due: boolean;
  /** A stored channel that has not expired yet (it still delivers). */
  channel_live: boolean;
  horizon_days: number | null;
  resource_calendars: unknown;
}

type SyncOutcome = "synced" | "failed" | "needs_reconnect" | "deferred" | "superseded";

interface ConnectionResult {
  /** Null: only channel work was due, and it failed (`channelFailed`). */
  outcome: SyncOutcome | null;
  registered: boolean;
  channelFailed: boolean;
  stopped: number;
}

function toMs(value: string | Date | null): number | null {
  if (value === null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Days that must be covered: the owner's booking horizon (else the
 * vertical default) plus one day for the tenant's local-date edge — every
 * day the AI can offer — capped at `CALENDAR_SYNC_MAX_HORIZON_DAYS`. Mirrored
 * by the claim's coverage check (`least(greatest(h, 1) + 1, max)`, never
 * more than this). */
export function syncHorizonDays(horizonDays: number | null): number {
  const base =
    typeof horizonDays === "number" && Number.isFinite(horizonDays) && horizonDays >= 1
      ? Math.floor(horizonDays)
      : DEFAULT_HORIZON_DAYS;
  return Math.min(base + 1, CALENDAR_SYNC_MAX_HORIZON_DAYS);
}

/** Days one read covers: `syncHorizonDays` plus the coverage slack, so the
 * horizon is still covered when the calendar is next read (renewal). */
export function syncReadDays(horizonDays: number | null): number {
  return syncHorizonDays(horizonDays) + CALENDAR_SYNC_COVERAGE_SLACK_DAYS;
}

/** Blocks of a connection that is no longer connected: gone at once when the
 * owner turned it off (also catches a sync replace that committed just
 * before the owner's disconnect), else once its last good read is 24 h old. */
export async function sweepStaleBlocks(sql: SqlClient): Promise<number> {
  const rows = await sql<{ removed: number }>`
    /* calendar_busy_sync:sweep */
    with removed as (
      delete from public.external_busy_blocks x
      using public.adapter_connections c
      where c.id = x.connection_id and c.tenant_id = x.tenant_id
        and c.status <> 'connected'
        and (c.last_error is not distinct from ${TENANT_DISCONNECT_REASON}
             or c.busy_synced_at is null
             or c.busy_synced_at < now() - make_interval(hours => ${CALENDAR_STALE_BLOCKS_HOURS}))
      returning 1
    )
    select count(*)::int as removed from removed
  `;
  return rows[0]?.removed ?? 0;
}

interface AlertClaim {
  id: string;
  tenant_id: string;
  status: string;
  /** `owner_alerted_at` before this claim (text, offset intact), or null. */
  previous_alerted_at: string | null;
  /** The value this claim wrote, as text. */
  claimed_alerted_at: string;
}

/**
 * Queues one `calendar_disconnected` owner alert per broken Google
 * connection, whoever broke it: a connection `disconnected` by any worker
 * (not by the owner) since its last alert, or a connected one whose reads
 * have been failing for `CALENDAR_READ_FAILING_ALERT_HOURS` since its last
 * alert. The alert is claimed first (`owner_alerted_at = now()`, one
 * skip-locked UPDATE, so two runs never both alert); one that cannot be
 * queued is given back so the next run retries it, unless a newer claim has
 * replaced it since. Same pattern as the outbound-webhook alert
 * (`_shared/outbound/delivery.ts`). Never throws.
 */
export async function alertBrokenConnections(sql: SqlClient, logger: Logger): Promise<number> {
  let claims: AlertClaim[];
  try {
    claims = await sql<AlertClaim>`
      /* calendar_busy_sync:alert_claim */
      with due as (
        select c.id, c.owner_alerted_at::text as previous_alerted_at
        from public.adapter_connections c
        where c.provider = 'google_calendar'
          and (
            (c.status = 'disconnected' and c.disconnected_at is not null
              and c.last_error is distinct from ${TENANT_DISCONNECT_REASON}
              and (c.owner_alerted_at is null or c.owner_alerted_at < c.disconnected_at))
            or (c.status = 'connected'
              and c.busy_sync_failing_since < now() - make_interval(hours => ${CALENDAR_READ_FAILING_ALERT_HOURS})
              and (c.owner_alerted_at is null or c.owner_alerted_at < c.busy_sync_failing_since))
          )
        limit ${CALENDAR_ALERT_BATCH_SIZE}
        for update skip locked
      )
      update public.adapter_connections a
      set owner_alerted_at = now()
      from due
      where a.id = due.id
      returning a.id, a.tenant_id, a.status, due.previous_alerted_at,
        a.owner_alerted_at::text as claimed_alerted_at
    `;
  } catch (err) {
    logger.error("calendar_busy_sync_alert_claim_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
  let queued = 0;
  for (const claim of claims) {
    try {
      const id = await enqueueOwnerAlert(sql, {
        tenantId: claim.tenant_id,
        kind: "calendar_disconnected",
        payload: {
          provider_name: "Google Calendar",
          reason: claim.status === "connected" ? "read_failing" : "disconnected",
        },
      });
      if (id) queued += 1;
    } catch (err) {
      logger.error("calendar_busy_sync_alert_failed", {
        tenant_id: claim.tenant_id,
        connection_id: claim.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await sql`
        /* calendar_busy_sync:alert_release */
        update public.adapter_connections
        set owner_alerted_at = ${claim.previous_alerted_at}::text::timestamptz
        where id = ${claim.id} and tenant_id = ${claim.tenant_id}
          and owner_alerted_at = ${claim.claimed_alerted_at}::text::timestamptz
      `.catch(() => undefined);
    }
  }
  return queued;
}

/**
 * Claims up to `limit` DUE connections (see the module doc). `channelsEnabled`
 * false (no HTTPS webhook address) leaves channel work out entirely, so only
 * due reads are claimed. Every condition is a qual on the locked row itself
 * (Postgres re-checks it against a concurrent claim, disconnect or request
 * that commits first), and what was due comes back as `read_due` /
 * `channel_due` (with `channel_live`). The read backoff gates every claim: a
 * failing token refresh (a read failure) never turns channel work into a
 * call every minute.
 */
export async function claimConnections(
  sql: SqlClient,
  limit: number,
  channelsEnabled: boolean,
): Promise<ClaimedConnection[]> {
  return sql<ClaimedConnection>`
    /* calendar_busy_sync:claim */
    with picked as (
      select c.id, h.horizon_days,
        ((c.busy_sync_requested_at is not null
            and (c.busy_synced_at is null or c.busy_synced_at < c.busy_sync_requested_at))
          or c.busy_synced_until is null
          or c.busy_synced_until < now() + make_interval(
               days => least(greatest(h.horizon_days, 1) + 1, ${CALENDAR_SYNC_MAX_HORIZON_DAYS}))
        ) as read_due,
        (${channelsEnabled}::boolean
          and (c.watch_channel_id is null or c.watch_expires_at is null
               or c.watch_expires_at < now() + make_interval(hours => ${CALENDAR_WATCH_RENEW_BEFORE_HOURS}))
          and (c.watch_retry_at is null or c.watch_retry_at <= now())
        ) as channel_due,
        coalesce(c.watch_channel_id is not null and c.watch_resource_id is not null
          and c.watch_expires_at > now(), false) as channel_live
      from public.adapter_connections c
      cross join lateral (
        select coalesce((
          select coalesce((to_jsonb(t) ->> 'booking_horizon_days')::int,
            case when t.vertical = 'motel' then 30 else 21 end)
          from public.tenants t where t.id = c.tenant_id), ${DEFAULT_HORIZON_DAYS}) as horizon_days
      ) h
      where c.provider = 'google_calendar' and c.status = 'connected'
        and (
          (c.busy_sync_requested_at is not null
            and (c.busy_synced_at is null or c.busy_synced_at < c.busy_sync_requested_at))
          or c.busy_synced_until is null
          or c.busy_synced_until < now() + make_interval(
               days => least(greatest(h.horizon_days, 1) + 1, ${CALENDAR_SYNC_MAX_HORIZON_DAYS}))
          or (${channelsEnabled}::boolean
            and (c.watch_channel_id is null or c.watch_expires_at is null
                 or c.watch_expires_at < now() + make_interval(hours => ${CALENDAR_WATCH_RENEW_BEFORE_HOURS}))
            and (c.watch_retry_at is null or c.watch_retry_at <= now()))
        )
        and (c.busy_sync_attempted_at is null
             or c.busy_sync_attempted_at < now() - make_interval(secs => ${CALENDAR_SYNC_LEASE_SECONDS}))
        and (c.busy_sync_failures = 0
             or c.busy_sync_attempted_at is null
             or c.busy_sync_attempted_at < now() - make_interval(
                  mins => (array[1, 5, 15, 60])[least(c.busy_sync_failures, 4)]))
      order by c.busy_sync_attempted_at asc nulls first
      limit ${limit}
      for update of c skip locked
    )
    update public.adapter_connections c
    set busy_sync_attempted_at = now()
    from picked
    where c.id = picked.id
    returning c.id, c.tenant_id, c.busy_sync_attempted_at::text as claimed_at,
      c.access_token, c.refresh_token, c.expires_at, c.metadata,
      c.busy_synced_at, c.watch_channel_id, c.watch_resource_id,
      picked.read_due, picked.channel_due, picked.channel_live, picked.horizon_days,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'resource_id', r.id,
          'calendar_id', r.metadata -> 'adapter_external_id' ->> 'google_calendar'))
        from public.resources r
        where r.tenant_id = c.tenant_id and r.active
          and coalesce(r.metadata -> 'adapter_external_id' ->> 'google_calendar', '') <> ''
      ), '[]'::jsonb) as resource_calendars
  `;
}

/**
 * Replaces the connection's blocks with `blocks` in ONE statement. Its first
 * step is the locking UPDATE that marks the read (`busy_synced_at = <this
 * run's claim time>`, which answers every request made before the claim and
 * leaves a newer one due; `busy_synced_until = <window end>`, what it
 * covered) and clears the read-failure bookkeeping; it only matches while
 * the connection is still connected AND still held by this run's claim:
 * Postgres re-checks those conditions against a disconnect or reconnect that
 * commits while the statement runs, and then nothing is deleted, inserted or
 * marked. Heyloo's own Google-pushed bookings are subtracted from the
 * connection-calendar intervals; a resource id that is not this tenant's is
 * never written. Returns `synced: false` when the connection was no longer
 * this run's to write.
 */
export async function replaceBusyBlocks(
  sql: SqlClient,
  connection: { id: string; tenant_id: string; claimed_at: string },
  window: { timeMin: string; timeMax: string },
  blocks: readonly CalendarBlock[],
): Promise<{ synced: boolean; removed: number; added: number }> {
  const payload = {
    blocks: blocks.map((b) => ({
      calendar_id: b.calendarId,
      resource_id: b.resourceId,
      subtract_own: b.subtractOwnBookings,
      starts: b.start,
      ends: b.end,
    })),
  };
  const rows = await sql<{ synced: boolean; removed: number; added: number }>`
    /* calendar_busy_sync:replace */
    with conn as (
      update public.adapter_connections a
      set busy_synced_at = ${connection.claimed_at}::text::timestamptz,
          busy_synced_until = ${window.timeMax}::timestamptz,
          last_error = null,
          busy_sync_failing_since = null,
          busy_sync_failures = 0
      where a.id = ${connection.id} and a.tenant_id = ${connection.tenant_id}
        and a.provider = 'google_calendar' and a.status = 'connected'
        and a.busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
      returning a.id, a.tenant_id
    ), own as (
      select coalesce(range_agg(b.during), '{}'::tstzmultirange) as mr
      from public.bookings b
      where b.tenant_id = ${connection.tenant_id} and b.status <> 'cancelled'
        and b.start_at < ${window.timeMax}::timestamptz
        and b.end_at > ${window.timeMin}::timestamptz
        and b.start_at > ${window.timeMin}::timestamptz - interval '31 days'
        and exists (
          select 1 from public.adapter_sync_state s
          where s.tenant_id = b.tenant_id and s.provider = 'google_calendar'
            and s.entity_type = 'booking' and s.entity_id = b.id and s.external_id is not null
        )
    ), incoming as (
      select r.calendar_id, r.resource_id, r.subtract_own,
        tstzrange(r.starts, r.ends, '[)') as busy
      from jsonb_to_recordset(${payload}::jsonb -> 'blocks')
        as r(calendar_id text, resource_id uuid, subtract_own boolean, starts timestamptz, ends timestamptz)
      where r.starts < r.ends
        and (r.resource_id is null or exists (
          select 1 from public.resources rs
          where rs.id = r.resource_id and rs.tenant_id = ${connection.tenant_id}
        ))
    ), pieces as (
      select i.calendar_id, i.resource_id, p.busy
      from incoming i
      cross join lateral unnest(
        case when i.subtract_own
          then tstzmultirange(i.busy) - (select mr from own)
          else tstzmultirange(i.busy)
        end
      ) as p(busy)
    ), removed as (
      delete from public.external_busy_blocks x
      using conn
      where x.connection_id = conn.id and x.tenant_id = conn.tenant_id
      returning 1
    ), added as (
      insert into public.external_busy_blocks (tenant_id, connection_id, calendar_id, resource_id, busy)
      select c.tenant_id, c.id, p.calendar_id, p.resource_id, p.busy
      from pieces p cross join conn c
      where not isempty(p.busy)
      returning 1
    )
    select exists (select 1 from conn) as synced,
      (select count(*) from removed)::int as removed,
      (select count(*) from added)::int as added
  `;
  const row = rows[0];
  return { synced: row?.synced === true, removed: row?.removed ?? 0, added: row?.added ?? 0 };
}

/** A read (or the token refresh / decrypt it needs) failed transiently:
 * `last_error` (the dashboard's "having trouble" note), the failing-since
 * window (owner alert) and one more consecutive failure (the claim's
 * backoff). */
async function recordTransientFailure(
  sql: SqlClient,
  connection: ClaimedConnection,
  reason: string,
): Promise<void> {
  await sql`
    /* calendar_busy_sync:transient */
    update public.adapter_connections
    set last_error = ${`${CALENDAR_SYNC_ERROR_PREFIX}${reason}`},
        busy_sync_failing_since = coalesce(busy_sync_failing_since, now()),
        busy_sync_failures = busy_sync_failures + 1
    where id = ${connection.id} and tenant_id = ${connection.tenant_id} and status = 'connected'
      and busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
  `;
}

/** Marks the connection needing a reconnect (once, and only while this run
 * still holds it), forgets its push channel (notifications for it are then
 * refused as an unknown channel) and drops its blocks only if already
 * stale. The owner is told by the next run's `alertBrokenConnections`. */
async function recordAuthFailure(
  sql: SqlClient,
  connection: ClaimedConnection,
  reason: string,
): Promise<void> {
  await sql`
    /* calendar_busy_sync:auth_failure */
    with marked as (
      update public.adapter_connections
      set status = 'disconnected', disconnected_at = now(), last_error = ${reason},
          watch_channel_id = null, watch_resource_id = null, watch_token_hash = null,
          watch_expires_at = null
      where id = ${connection.id} and tenant_id = ${connection.tenant_id} and status = 'connected'
        and busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
      returning id, tenant_id, busy_synced_at
    ), cleared as (
      delete from public.external_busy_blocks x
      using marked m
      where x.connection_id = m.id and x.tenant_id = m.tenant_id
        and (m.busy_synced_at is null
             or m.busy_synced_at < now() - make_interval(hours => ${CALENDAR_STALE_BLOCKS_HOURS}))
      returning 1
    )
    select (select count(*) from marked)::int as marked, (select count(*) from cleared)::int as cleared
  `;
}

/** A channel registration failed: counted apart from the reads
 * (`watch_failures`), and the next attempt waits 1, 5, 15, then 60 minutes
 * (`watch_retry_at`). `last_error` and the read backoff are untouched: the
 * reads still work (or are judged on their own). */
async function recordChannelFailure(sql: SqlClient, connection: ClaimedConnection): Promise<void> {
  await sql`
    /* calendar_busy_sync:watch_failure */
    update public.adapter_connections
    set watch_failures = watch_failures + 1,
        watch_retry_at = now() + make_interval(
          mins => (array[1, 5, 15, 60])[least(watch_failures + 1, 4)])
    where id = ${connection.id} and tenant_id = ${connection.tenant_id}
      and provider = 'google_calendar' and status = 'connected'
      and busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
  `;
}

async function releaseClaim(sql: SqlClient, connection: ClaimedConnection): Promise<void> {
  await sql`
    /* calendar_busy_sync:release */
    update public.adapter_connections
    set busy_sync_attempted_at = null
    where id = ${connection.id} and tenant_id = ${connection.tenant_id}
      and busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
  `;
}

/** Stores the refreshed token; false when this run no longer holds the
 * connection (reconnected or disconnected meanwhile) and nothing was stored. */
async function persistRefreshedToken(
  sql: SqlClient,
  connection: ClaimedConnection,
  grant: { accessToken: string; refreshToken?: string; expiresAt: string },
  key: string,
): Promise<boolean> {
  const accessToken = await encryptSecret(grant.accessToken, key);
  const refreshToken = grant.refreshToken ? await encryptSecret(grant.refreshToken, key) : null;
  const rows = await sql<{ id: string }>`
    /* calendar_busy_sync:token */
    update public.adapter_connections
    set access_token = ${accessToken},
        refresh_token = coalesce(${refreshToken}, refresh_token),
        expires_at = ${grant.expiresAt},
        last_refreshed_at = now()
    where id = ${connection.id} and tenant_id = ${connection.tenant_id} and status = 'connected'
      and busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
    returning id
  `;
  return rows.length > 0;
}

/** Stores a newly registered channel (replacing the previous one), clears
 * the channel failure count, holds off the next registration for
 * `CALENDAR_WATCH_RENEW_MIN_INTERVAL_MINUTES`, and requests a read as of this
 * run's claim, so the read that follows answers it and a failed one is
 * retried. False when this run no longer holds the connection: nothing
 * stored. */
async function persistChannel(
  sql: SqlClient,
  connection: ClaimedConnection,
  channel: { channelId: string; resourceId: string; tokenHash: string; expiresAt: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    /* calendar_busy_sync:watch_store */
    update public.adapter_connections
    set watch_channel_id = ${channel.channelId},
        watch_resource_id = ${channel.resourceId},
        watch_token_hash = ${channel.tokenHash},
        watch_expires_at = ${channel.expiresAt}::timestamptz,
        watch_failures = 0,
        watch_retry_at = now() + make_interval(mins => ${CALENDAR_WATCH_RENEW_MIN_INTERVAL_MINUTES}),
        busy_sync_requested_at =
          greatest(busy_sync_requested_at, ${connection.claimed_at}::text::timestamptz)
    where id = ${connection.id} and tenant_id = ${connection.tenant_id}
      and provider = 'google_calendar' and status = 'connected'
      and busy_sync_attempted_at = ${connection.claimed_at}::text::timestamptz
    returning id
  `;
  return rows.length > 0;
}

function mergeChunks(results: readonly FreeBusyResult[]): Record<string, GoogleBusyInterval[]> {
  const merged: Record<string, GoogleBusyInterval[]> = {};
  for (const result of results) {
    if (!result.ok) continue;
    for (const [calendarId, intervals] of Object.entries(result.calendars)) {
      const list = merged[calendarId] ?? [];
      list.push(...intervals);
      merged[calendarId] = list;
    }
  }
  return merged;
}

async function syncConnection(
  sql: SqlClient,
  connection: ClaimedConnection,
  deps: CalendarBusySyncDeps,
  legStartedAt: number,
): Promise<ConnectionResult> {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.requestTimeoutMs ?? CALENDAR_SYNC_REQUEST_TIMEOUT_MS;
  const context = { tenant_id: connection.tenant_id, connection_id: connection.id };
  const log = (event: string, fields: Record<string, unknown>) =>
    deps.logger.warn(event, { ...context, ...fields });
  const deadlinePassed = () => now() - legStartedAt > CALENDAR_SYNC_START_DEADLINE_MS;
  let channelFailed = false;
  const done = (
    outcome: SyncOutcome | null,
    registered = false,
    stopped = 0,
  ): ConnectionResult => ({ outcome, registered, channelFailed, stopped });

  let accessToken: string | null;
  let refreshToken: string | null;
  try {
    accessToken = connection.access_token
      ? await decryptSecret(connection.access_token, deps.tokenEncryptionKey)
      : null;
    refreshToken = connection.refresh_token
      ? await decryptSecret(connection.refresh_token, deps.tokenEncryptionKey)
      : null;
  } catch (err) {
    // Our key, not the tenant's connection: never marked broken for it.
    deps.logger.error("calendar_busy_sync_decrypt_failed", {
      ...context,
      error: err instanceof Error ? err.message : String(err),
    });
    await recordTransientFailure(sql, connection, "stored token could not be decrypted");
    return done("failed");
  }

  const currentChannel =
    connection.watch_channel_id && connection.watch_resource_id
      ? { channelId: connection.watch_channel_id, resourceId: connection.watch_resource_id }
      : null;
  const expiresAt = toMs(connection.expires_at);

  /** Auth failure: needs reconnect. The current channel is stopped first
   * when the stored access token is still good (a revoked refresh token
   * leaves it valid for up to an hour); a token Google just refused is not
   * tried again. */
  const authFailure = async (
    reason: string,
    tokenStillGood: boolean,
  ): Promise<ConnectionResult> => {
    let stopped = 0;
    if (currentChannel && accessToken && tokenStillGood && !deadlinePassed()) {
      const outcome = await stopChannelBestEffort(
        deps.fetchImpl,
        accessToken,
        currentChannel,
        deps.logger,
        context,
        timeoutMs,
      );
      if (outcome === "stopped" || outcome === "already_gone") stopped = 1;
    }
    await recordAuthFailure(sql, connection, reason);
    return done("needs_reconnect", false, stopped);
  };

  if (!accessToken || expiresAt === null || expiresAt - now() < CALENDAR_TOKEN_REFRESH_MARGIN_MS) {
    const storedTokenGood =
      accessToken !== null && expiresAt !== null && expiresAt - now() > 30_000;
    if (!refreshToken) {
      return authFailure(
        "google_calendar refresh token missing — reconnect needed",
        storedTokenGood,
      );
    }
    const refreshed = await refreshGoogleAccessToken(deps.fetchImpl, {
      clientId: deps.google.clientId,
      clientSecret: deps.google.clientSecret,
      refreshToken,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!refreshed.ok) {
      if (refreshed.failure === "invalid_grant") {
        return authFailure("google_calendar refresh_token invalid/revoked", storedTokenGood);
      }
      if (refreshed.failure === "client_config") {
        deps.logger.error("calendar_busy_sync_client_config", {
          tenant_id: connection.tenant_id,
          detail: refreshed.detail,
        });
      } else {
        log("calendar_busy_sync_refresh_failed", { detail: refreshed.detail });
      }
      await recordTransientFailure(sql, connection, `token refresh failed (${refreshed.detail})`);
      return done("failed");
    }
    accessToken = refreshed.grant.accessToken;
    const stored = await persistRefreshedToken(
      sql,
      connection,
      {
        accessToken,
        ...(refreshed.grant.refreshToken ? { refreshToken: refreshed.grant.refreshToken } : {}),
        expiresAt: new Date(now() + refreshed.grant.expiresInSeconds * 1000).toISOString(),
      },
      deps.tokenEncryptionKey,
    );
    if (!stored) {
      log("calendar_busy_sync_superseded", { step: "token" });
      return done("superseded");
    }
  }
  const token = accessToken;
  const plan = buildCalendarPlan(connection.metadata, connection.resource_calendars);
  let registered = false;
  let readDue = connection.read_due === true;
  let oldChannelStop: Promise<StopChannelOutcome> | null = null;
  const stoppedCount = async (): Promise<number> => {
    if (!oldChannelStop) return 0;
    const outcome = await oldChannelStop;
    return outcome === "stopped" || outcome === "already_gone" ? 1 : 0;
  };

  // --- push channel: first registration, or renewal before it expires ---
  if (connection.channel_due === true && deps.webhookAddress) {
    if (deadlinePassed()) {
      await releaseClaim(sql, connection);
      return done("deferred");
    }
    const channel = await newWatchChannel();
    const watched = await watchCalendarEvents(deps.fetchImpl, token, {
      calendarId: plan.connectionCalendarId,
      channelId: channel.channelId,
      address: deps.webhookAddress,
      token: channel.token,
      ttlSeconds: CALENDAR_WATCH_TTL_SECONDS,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!watched.ok) {
      // Never an auth failure on its own: Google can refuse the webhook
      // address with a 401/403 as well. Counted apart from the reads (the
      // still-live old channel keeps asking for them, undelayed).
      channelFailed = true;
      const fields = {
        ...context,
        failure: watched.failure,
        status: watched.status,
        detail: watched.detail,
        channel_live: connection.channel_live === true,
      };
      // Not something a retry fixes on its own: our address/config, or the grant.
      if (
        watched.failure === "auth" ||
        watched.failure === "request_rejected" ||
        watched.failure === "invalid_response"
      ) {
        deps.logger.error("calendar_watch_register_failed", fields);
      } else {
        deps.logger.warn("calendar_watch_register_failed", fields);
      }
      await recordChannelFailure(sql, connection);
      // With no live channel nothing will ever ask for a read, so this
      // attempt reads (a broken channel degrades to backed-off reads, never
      // to none); a refused token is tested on the read, which alone decides
      // whether the grant is gone.
      if (connection.channel_live !== true || watched.failure === "auth") readDue = true;
    } else {
      const stored = await persistChannel(sql, connection, {
        channelId: watched.channel.channelId,
        resourceId: watched.channel.resourceId,
        tokenHash: channel.tokenHash,
        expiresAt:
          watched.channel.expiresAt ??
          new Date(now() + CALENDAR_WATCH_TTL_SECONDS * 1000).toISOString(),
      });
      if (!stored) {
        // Reconnected or disconnected meanwhile: this channel is nobody's.
        const outcome = await stopChannelBestEffort(
          deps.fetchImpl,
          token,
          { channelId: watched.channel.channelId, resourceId: watched.channel.resourceId },
          deps.logger,
          context,
          timeoutMs,
        );
        log("calendar_busy_sync_superseded", { step: "watch" });
        return done("superseded", false, outcome === "stopped" ? 1 : 0);
      }
      registered = true;
      // A new channel is followed by one read (changes made before it was
      // active are not lost). The replaced channel is stopped meanwhile.
      readDue = true;
      if (currentChannel && currentChannel.channelId !== watched.channel.channelId) {
        oldChannelStop = stopChannelBestEffort(
          deps.fetchImpl,
          token,
          currentChannel,
          deps.logger,
          context,
          timeoutMs,
        );
      }
    }
  }

  // --- the due read ---
  if (readDue) {
    if (deadlinePassed()) {
      // A requested read stays due (`busy_sync_requested_at`): the next tick reads.
      const stopped = await stoppedCount();
      await releaseClaim(sql, connection);
      return done("deferred", registered, stopped);
    }
    // The horizon plus the slack that keeps it covered until the next read.
    const windowStart = Math.floor(now() / 60_000) * 60_000;
    const windowEnd = windowStart + syncReadDays(connection.horizon_days) * DAY_MS;
    const items = planCalendarIds(plan);
    const results = await Promise.all(
      chunkTimeRange(windowStart, windowEnd).map((chunk) =>
        freeBusyQuery(deps.fetchImpl, token, {
          items,
          ...chunk,
          signal: AbortSignal.timeout(timeoutMs),
        }),
      ),
    );
    const failure = results.find((r) => !r.ok);
    if (failure && !failure.ok) {
      if (failure.failure === "auth") {
        const stopped = await stoppedCount();
        const result = await authFailure(
          failure.status
            ? `google_calendar ${failure.status} on busy-time read`
            : "google_calendar auth failure on busy-time read",
          false,
        );
        return { ...result, registered, stopped: result.stopped + stopped };
      }
      log("calendar_busy_sync_read_failed", { failure: failure.failure, detail: failure.detail });
      const stopped = await stoppedCount();
      await recordTransientFailure(sql, connection, `${failure.failure} (${failure.detail})`);
      return done("failed", registered, stopped);
    }
    const replaced = await replaceBusyBlocks(
      sql,
      connection,
      {
        timeMin: new Date(windowStart).toISOString(),
        timeMax: new Date(windowEnd).toISOString(),
      },
      blocksFromBusy(plan, mergeChunks(results)),
    );
    const stopped = await stoppedCount();
    if (!replaced.synced) {
      log("calendar_busy_sync_superseded", { step: "replace" });
      return done("superseded", registered, stopped);
    }
    return done("synced", registered, stopped);
  }

  // Only channel work was due and it failed: the claim stays (its retry
  // waits for `watch_retry_at`), nothing else to report.
  if (channelFailed) return done(null);
  // Nothing was due after all (channels disabled since the claim): hand it back.
  await releaseClaim(sql, connection);
  return done("deferred");
}

export async function runCalendarBusySync(
  sql: SqlClient,
  deps: CalendarBusySyncDeps,
): Promise<RunCalendarBusySyncResult> {
  const now = deps.now ?? Date.now;
  const legStartedAt = now();
  const result: RunCalendarBusySyncResult = {
    claimed: 0,
    synced: 0,
    failed: 0,
    needs_reconnect: 0,
    deferred: 0,
    superseded: 0,
    stale_blocks_removed: 0,
    owner_alerts: 0,
    channels_registered: 0,
    channels_failed: 0,
    channels_stopped: 0,
  };
  result.stale_blocks_removed = await sweepStaleBlocks(sql);
  result.owner_alerts = await alertBrokenConnections(sql, deps.logger);

  const channelsEnabled = deps.webhookAddress !== null;
  let reserved = 0;
  const lane = async (): Promise<void> => {
    while (now() - legStartedAt < CALENDAR_SYNC_CLAIM_BUDGET_MS) {
      if (reserved >= CALENDAR_SYNC_MAX_PER_RUN) return;
      reserved += 1;
      const [connection] = await claimConnections(sql, 1, channelsEnabled);
      if (!connection) {
        reserved -= 1;
        return; // nothing else is due
      }
      result.claimed += 1;
      const outcome = await syncConnection(sql, connection, deps, legStartedAt).catch(
        async (err: unknown): Promise<ConnectionResult> => {
          deps.logger.error("calendar_busy_sync_failed", {
            tenant_id: connection.tenant_id,
            connection_id: connection.id,
            error: err instanceof Error ? err.message : String(err),
          });
          await recordTransientFailure(sql, connection, "unexpected error").catch(() => undefined);
          return { outcome: "failed", registered: false, channelFailed: false, stopped: 0 };
        },
      );
      if (outcome.outcome) result[outcome.outcome] += 1;
      if (outcome.registered) result.channels_registered += 1;
      if (outcome.channelFailed) result.channels_failed += 1;
      result.channels_stopped += outcome.stopped;
    }
  };
  const lanes = Math.max(1, deps.concurrency ?? CALENDAR_SYNC_CONCURRENCY);
  await Promise.all(Array.from({ length: lanes }, lane));
  return result;
}
