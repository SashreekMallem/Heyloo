-- T7 deep-integration adapters (docs/BUILD_NOTES.md T7 entry): no table for
-- per-tenant adapter connection state existed anywhere in T1's migrations —
-- BACKEND_SPEC §7.6 describes `IntegrationAdapter.refreshAuth`/`auth_revoked`
-- handling and MASTER_SPEC's build directive tells T7 to "check T1's
-- migrations for the actual table [and] if none exists for
-- adapter_connections, add ONE migration for it." This is that migration —
-- additive only, two new tables, following the `airtable_sync_state`
-- table's own established shape/RLS posture (20260907131200_supporting_
-- tables.sql / 20260907131500_rls.sql) generalized to every T7 adapter
-- rather than just Airtable.

-- `adapter_connections`: one row per tenant-per-provider OAuth/paste-key
-- connection. Two auth shapes coexist (API_AND_FLOWS.md A.6 preamble):
-- OAuth2 (Google Calendar, Square) and self-generated paste-key (Shopmonkey,
-- ezyVet's partner-credential variant per this build's resolved auth model —
-- see packages/adapters/{shopmonkey,ezyvet} docstrings). `access_token`/
-- `refresh_token` are stored as plaintext `text` here — this is a KNOWN GAP,
-- not an oversight: encrypting these at rest (pgsodium/Vault, or an
-- application-layer envelope) needs a decision this task cannot make blind
-- (which KMS, key rotation story) and is flagged in docs/VERIFY.md rather
-- than half-built. `api-adapter-connect` is the only writer; every adapter
-- push/pull reads through it via `service_role`'s direct DB connection
-- (bypasses RLS by platform design, same as every other edge function in
-- this codebase), so the RLS policy below is read-only defense-in-depth for
-- the tenant dashboard's own connection-status card, not the write path.
create table public.adapter_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  provider text not null
    check (provider in ('shopmonkey', 'ezyvet', 'google_calendar', 'square')),
  status text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  auth_mode text not null
    check (auth_mode in ('oauth2_authorization_code', 'oauth2_client_credentials', 'api_key')),
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  provider_account_id text,
  -- Provider-specific extras every adapter package's `AdapterConnectionCredentials.metadata`
  -- expects (Square's `locationId`/`defaultTeamMemberId`, ezyVet's practice
  -- `baseUrl`, Google Calendar's `calendarId` + push-channel `channelId`/
  -- `clientState`) PLUS `pull_cursor` (the poll-based two-way sync's opaque
  -- cursor from the adapter's last successful `pullChanges` call — one
  -- cursor per tenant+provider, not per-entity, since a poll pulls every
  -- change since the cursor in one call; worker-adapter-push's poller
  -- reads/writes this key).
  metadata jsonb not null default '{}'::jsonb,
  last_refreshed_at timestamptz,
  last_error text,
  disconnected_at timestamptz,
  connected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint adapter_connections_tenant_provider_unique unique (tenant_id, provider)
);

create index idx_adapter_connections_tenant on public.adapter_connections (tenant_id);
create index idx_adapter_connections_status on public.adapter_connections (status)
  where status <> 'connected';

create trigger trg_adapter_connections_updated_at
  before update on public.adapter_connections
  for each row execute function public.fn_set_updated_at();

comment on table public.adapter_connections is
  'Per-tenant deep-integration connection state (BACKEND_SPEC §7.6, T7). auth_revoked webhook/refreshAuth failure -> status=disconnected + disconnected_at set + dashboard banner (salvaged pattern, SYSTEM_DESIGN §14). access_token/refresh_token are plaintext pending an encryption-at-rest decision — see docs/VERIFY.md.';

-- `adapter_sync_state`: generalizes `airtable_sync_state`'s one-way-push
-- conflict-tracking shape (20260907131200_supporting_tables.sql) to every
-- T7 adapter — `external_id`/`last_synced_at` record our own push per
-- entity; the poll-based two-way sync pull-back (G11) resolves a pulled
-- change's `external_id` against this table's reverse index to detect a
-- staff-made external edit (`idx_adapter_sync_state_external`, below) and
-- reads/writes its own cursor on `adapter_connections.metadata.pull_cursor`
-- (one cursor per tenant+provider, not per-entity — see that column's
-- comment).
create table public.adapter_sync_state (
  tenant_id uuid not null references public.tenants(id),
  provider text not null
    check (provider in ('shopmonkey', 'ezyvet', 'google_calendar', 'square')),
  entity_type text not null check (entity_type in ('booking', 'order')),
  entity_id uuid not null,
  external_id text,
  last_synced_at timestamptz,
  content_hash text,
  sync_conflict boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, provider, entity_type, entity_id)
);

create index idx_adapter_sync_state_conflict on public.adapter_sync_state (tenant_id)
  where sync_conflict;
-- Reverse lookup used by both the webhook path (map a provider's changed-
-- object id back to the Heyloo row that pushed it) and the poller (same
-- lookup per pulled change) — BACKEND_SPEC §7.6's conflict-detection path.
create index idx_adapter_sync_state_external on public.adapter_sync_state (provider, external_id)
  where external_id is not null;

create trigger trg_adapter_sync_state_updated_at
  before update on public.adapter_sync_state
  for each row execute function public.fn_set_updated_at();

comment on table public.adapter_sync_state is
  'Per-entity adapter push/pull bookkeeping (BACKEND_SPEC §7.6 idempotency + G11 two-way sync), generalized across every T7 adapter from the airtable_sync_state precedent. sync_conflict mirrors the Airtable one-way-push pattern: a staff-made external edit detected after our own push flags this instead of silently overwriting.';

-- RLS (BACKEND_SPEC §5 posture, CLAUDE.md Rule 2): tenant members read their
-- own connection/sync state (dashboard banner + a future sync-log viewer);
-- platform admins read every tenant's; no authenticated/anon write policy
-- on either table — writes are `service_role`-only (api-adapter-connect,
-- worker-adapter-push), matching every other adapter-state table in this
-- schema (airtable_sync_state, tool_health).
alter table public.adapter_connections enable row level security;
create policy adapter_connections_select on public.adapter_connections for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());

alter table public.adapter_sync_state enable row level security;
create policy adapter_sync_state_select on public.adapter_sync_state for select
  using (tenant_id = public.fn_jwt_tenant_id() or public.fn_jwt_is_platform_admin());
