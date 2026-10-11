-- CAL-1: the AI never offers or books a time the owner already filled in
-- their Google Calendar. Additive only.
--
-- 1. external_busy_blocks: the busy times read from a tenant's connected
--    Google Calendar (freeBusy), one row per busy interval. Written ONLY by
--    the worker-tick `calendar_busy_sync` leg (supabase/functions/_shared/
--    calendar/sync.ts), which replaces a connection's rows in one statement
--    whenever a read was requested (CAL-1b, push-only: on connect, on a
--    Google push notification, on a watch-channel renewal, and retries of a
--    failed requested read with backoff — never a periodic re-read). The
--    voice tools filter every slot they offer or accept with a NOT EXISTS
--    against this table inside their existing statements (no extra round
--    trip on the hot path); the waitlist auto-book does too.
--    `resource_id` null = the block applies to every resource of the tenant
--    (the connection's own calendar); a calendar mapped to one resource
--    (`resources.metadata.adapter_external_id.google_calendar`) blocks only
--    that resource.
-- 2. adapter_connections sync bookkeeping:
--    busy_sync_requested_at: a read is wanted (set by connect, by a verified
--      push notification in webhooks-pos, by a channel registration/renewal);
--      the read is due while busy_synced_at is older than it.
--    busy_synced_at: the claim time of the last successful read (dashboard
--      "Last updated", 24 h staleness rule). It is the CLAIM time, taken
--      before Google is asked, so a notification that lands while a read is
--      running leaves the request due and is read again.
--    busy_synced_until: the end of the window that read covered: the
--      booking horizon (+1 day) plus 8 days — the 7-day channel lifetime
--      bounds the gap between reads of a quiet calendar (renewal reads it),
--      plus one — so the far end of the horizon stays covered between reads.
--      A read is also due once this no longer reaches the horizon: normally
--      never; only when renewals keep failing or the owner lengthened the
--      horizon.
--    busy_sync_attempted_at: the last claim by the sync leg (lease, retry
--      backoff anchor, and the guard every write of a run checks).
--    busy_sync_failures: consecutive failed busy-time reads (or the token
--      refresh a read needs): retry backoff 1, 5, 15, 60 minutes, then hourly
--      while the read is still due. A failed channel registration never
--      counts here (watch_failures), so it never delays a requested read.
--    busy_sync_failing_since / owner_alerted_at: when busy-time reads started
--      failing (cleared by the next good read), and the last owner alert about
--      this connection — so a calendar that breaks anywhere (the sync, the
--      booking push, a read that keeps failing) alerts the owner exactly once.
--    watch_channel_id / watch_resource_id / watch_token_hash /
--      watch_expires_at: the Google push-notification channel
--      (events.watch) of the connection's calendar. The per-channel token is
--      random and only its SHA-256 hex is stored; webhooks-pos verifies a
--      notification's channel id, token and resource id against these and
--      fails closed. Renewed (new channel, old one stopped) a day before it
--      expires. Never readable by browser roles.
--    watch_failures / watch_retry_at: consecutive failed channel
--      registrations and the earliest next attempt (backoff 1, 5, 15, 60
--      minutes, then hourly; one hour after a successful registration), kept
--      apart from the read bookkeeping.
--
-- RLS: tenant members and platform admins may read their own tenant's
-- blocks; nobody but the service role writes them.

-- ---------------------------------------------------------------------
-- 1. external_busy_blocks
-- ---------------------------------------------------------------------
create table public.external_busy_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid not null references public.adapter_connections(id) on delete cascade,
  calendar_id text not null,
  resource_id uuid references public.resources(id) on delete cascade,
  busy tstzrange not null,
  synced_at timestamptz not null default now(),
  constraint external_busy_blocks_busy_not_empty check (not isempty(busy)),
  constraint external_busy_blocks_busy_bounded check (not lower_inf(busy) and not upper_inf(busy)),
  constraint external_busy_blocks_calendar_id_length check (char_length(calendar_id) between 1 and 1024)
);

-- The hot-path filter: `x.tenant_id = <slot tenant> and x.busy && <slot range>`
-- (btree_gist is installed by 20260907130000_extensions_and_helpers.sql).
create index idx_external_busy_blocks_tenant_busy on public.external_busy_blocks
  using gist (tenant_id, busy);
-- The sync's replace (delete by connection) and the FK cascade.
create index idx_external_busy_blocks_connection on public.external_busy_blocks (connection_id);

comment on table public.external_busy_blocks is
  'CAL-1: busy intervals read from a tenant''s connected Google Calendar (freeBusy). Written only by the worker-tick calendar_busy_sync leg (replace per connection, only when a read was requested: connect, Google push notification, channel renewal, retries of a failed read); read by check_availability / create_booking / update_booking and the waitlist auto-book as a NOT EXISTS filter. Heyloo''s own bookings pushed to the calendar are subtracted at sync time so they never block other resources.';
comment on column public.external_busy_blocks.resource_id is
  'NULL = blocks every resource of the tenant (the connection''s own calendar). Set = a calendar mapped to that one resource via resources.metadata.adapter_external_id.google_calendar.';
comment on column public.external_busy_blocks.calendar_id is
  'The Google calendar id the interval was read from (metadata.calendarId, default ''primary'', or a resource-mapped calendar id).';
comment on column public.external_busy_blocks.busy is
  'Busy interval, [start, end) as returned by Google (start inclusive, end exclusive), stored as UTC instants.';

alter table public.external_busy_blocks enable row level security;

create policy external_busy_blocks_select on public.external_busy_blocks for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

-- No client insert/update/delete policy: the sync leg writes with the secret
-- key. Table privileges are revoked too (defense in depth).
revoke insert, update, delete, truncate on public.external_busy_blocks from authenticated, anon;
revoke select on public.external_busy_blocks from anon;

-- ---------------------------------------------------------------------
-- 2. adapter_connections sync bookkeeping
-- ---------------------------------------------------------------------
alter table public.adapter_connections
  add column busy_sync_requested_at timestamptz,
  add column busy_synced_at timestamptz,
  add column busy_synced_until timestamptz,
  add column busy_sync_attempted_at timestamptz,
  add column busy_sync_failures integer not null default 0,
  add column busy_sync_failing_since timestamptz,
  add column owner_alerted_at timestamptz,
  add column watch_channel_id text,
  add column watch_resource_id text,
  add column watch_token_hash text,
  add column watch_expires_at timestamptz,
  add column watch_failures integer not null default 0,
  add column watch_retry_at timestamptz,
  add constraint adapter_connections_busy_sync_failures_nonneg check (busy_sync_failures >= 0),
  add constraint adapter_connections_watch_failures_nonneg check (watch_failures >= 0),
  add constraint adapter_connections_watch_channel_id_length
    check (watch_channel_id is null or char_length(watch_channel_id) between 1 and 64),
  add constraint adapter_connections_watch_token_hash_format
    check (watch_token_hash is null or watch_token_hash ~ '^[0-9a-f]{64}$');

comment on column public.adapter_connections.busy_sync_requested_at is
  'CAL-1b: when a busy-time read of this (google_calendar) connection was last requested (connect, a verified Google push notification, a watch-channel registration or renewal). The read is due while busy_synced_at is null or older than this. Google is never read on a timer.';
comment on column public.adapter_connections.busy_synced_at is
  'CAL-1: the claim time of the last successful busy-time read of this (google_calendar) connection (taken before Google was asked, so a change notified during the read is read again). Shown on the dashboard as "Last updated"; a needs-reconnect connection keeps its blocks until this is 24 h old.';
comment on column public.adapter_connections.busy_synced_until is
  'CAL-1b: end of the window the last successful busy-time read covered (booking horizon + 1 day, plus 8 days: the 7-day channel lifetime that bounds the gap between reads of a quiet calendar, plus one). A read is due once this no longer reaches the booking horizon, so the far end of the horizon is never read as free for lack of a read.';
comment on column public.adapter_connections.busy_sync_attempted_at is
  'CAL-1: when the worker-tick calendar_busy_sync leg last claimed this connection (success or not): its short lease, the retry-backoff anchor, and the value every write of that run is guarded on, so a run whose claim was reset (owner reconnect) changes nothing.';
comment on column public.adapter_connections.busy_sync_failures is
  'CAL-1b: consecutive failed busy-time reads (or the token refresh a read needs). Retry backoff after 1, 5, 15, 60 minutes, then hourly; reset by a successful read or a reconnect. Watch-channel failures are counted in watch_failures instead.';
comment on column public.adapter_connections.busy_sync_failing_since is
  'CAL-1: when busy-time reads of this (google_calendar) connection started failing; NULL after a good read or a reconnect. The owner is alerted once it is a few hours old.';
comment on column public.adapter_connections.owner_alerted_at is
  'CAL-1: when the owner was last alerted that this (google_calendar) connection broke (disconnected by any worker, or busy-time reads failing for hours). An alert is due when this is older than disconnected_at / busy_sync_failing_since.';
comment on column public.adapter_connections.watch_channel_id is
  'CAL-1b: id of the Google Calendar push-notification channel (events.watch) for this connection''s calendar; webhooks-pos looks a notification up by its X-Goog-Channel-ID. Cleared on disconnect.';
comment on column public.adapter_connections.watch_resource_id is
  'CAL-1b: the opaque watched-resource id Google returned for the channel; a notification''s X-Goog-Resource-ID must match it. Needed with the channel id to stop the channel.';
comment on column public.adapter_connections.watch_token_hash is
  'CAL-1b: SHA-256 hex of the random per-channel token Google echoes as X-Goog-Channel-Token. The plaintext token is never stored.';
comment on column public.adapter_connections.watch_expires_at is
  'CAL-1b: when Google expires the channel. The sync leg registers a new channel (new id) and stops the old one once this is within a day; NULL forces a new channel (set by a reconnect).';
comment on column public.adapter_connections.watch_failures is
  'CAL-1b: consecutive failed watch-channel registrations (events.watch). Backoff 1, 5, 15, 60 minutes, then hourly (watch_retry_at); reset by a successful registration or a reconnect. Never delays a busy-time read: with no live channel, each attempt reads the calendar too.';
comment on column public.adapter_connections.watch_retry_at is
  'CAL-1b: no channel registration is attempted before this (failure backoff, or one hour after a successful registration so a short Google expiry never causes a call every minute). NULL = now (set by a reconnect).';

-- Connections that were already broken before this migration were never
-- alerted by this mechanism; mark them as alerted so deploying it does not
-- send a burst of alerts for old disconnects.
update public.adapter_connections
set owner_alerted_at = coalesce(disconnected_at, now())
where provider = 'google_calendar' and status <> 'connected';

-- Existing connected Google connections get one initial read (the
-- registration of their push channel reads again right after).
update public.adapter_connections
set busy_sync_requested_at = now()
where provider = 'google_calendar' and status = 'connected';

-- adapter_connections uses per-column SELECT grants for authenticated (QA-1
-- SEC-13, 20260930200600_qa1_backend_hardening.sql); a new column is not
-- readable by browser roles unless granted. Only busy_synced_at is: the
-- dashboard's RLS-scoped read shows "Last updated". The watch_* columns
-- (channel id, resource id, token hash) and the sync bookkeeping stay
-- service-role only.
grant select (busy_synced_at) on public.adapter_connections to authenticated;

-- The sync leg's claim: connected Google connections.
create index idx_adapter_connections_busy_sync on public.adapter_connections
  (busy_sync_attempted_at nulls first)
  where provider = 'google_calendar' and status = 'connected';

-- webhooks-pos resolves a Google push notification by its channel id; one
-- channel belongs to at most one connection.
create unique index uq_adapter_connections_watch_channel on public.adapter_connections
  (watch_channel_id)
  where watch_channel_id is not null;
