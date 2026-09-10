-- Queues + scheduled jobs — docs/audit/DB_AUDIT.md DB-B2, DB-B3, DB-M1.
-- Additive only (CLAUDE.md Rule 2): idempotent pgmq.create/cron.schedule
-- calls, safe to re-run, reproducible from zero.
--
-- Both `pg_cron`/`pgmq`/`pg_net` themselves and Supabase Vault
-- (`supabase_vault`) ship pre-installed on Supabase-hosted Postgres but do
-- NOT exist on a plain local Postgres (docs/BUILD_NOTES.md's own
-- LIVE-MINE-FIXES verification approach explicitly skips them there) — every
-- block below is guarded by an extension/schema existence check so this
-- migration still applies cleanly, as a no-op for these blocks, in that kind
-- of harness, and so a real deploy that runs `supabase db push` before
-- inserting the two Vault secrets (see docs/DEPLOY.md §3.6) degrades to
-- "queues created, DB-internal jobs scheduled, HTTP-calling jobs skipped
-- with a NOTICE" rather than failing the whole migration — re-running this
-- same migration file's statements (`supabase db push` again, or by hand)
-- after the secrets exist picks up the HTTP-calling jobs with no other
-- change needed, since every `cron.schedule` call here is by name (upsert)
-- and every `pgmq.create` call is skipped once the queue already exists.
--
-- pgmq/pg_cron/pg_net/vault function signatures below were confirmed
-- against each extension's own current GitHub source (supabase.com/docs
-- itself returned EGRESS_BLOCKED from this build environment — CLAUDE.md
-- Rule 1 item 2's documented fallback, but note this is a *verified* shape
-- from the extensions' own authoritative source, not a guess):
--   - pgmq.list_queues() returns a `queue_name` column (pgmq's own docs.rs/
--     pgxn listing).
--   - net.http_post(url text, body jsonb default '{}', params jsonb
--     default '{}', headers jsonb default '{"Content-Type":...}',
--     timeout_milliseconds int default 5000) returns bigint — confirmed
--     verbatim against github.com/supabase/pg_net's own sql/pg_net.sql.
--   - vault.create_secret(new_secret text, name text default null,
--     description text default null) returns uuid, and
--     vault.decrypted_secrets(id, name, description, secret,
--     decrypted_secret, key_id, nonce, created_at, updated_at) — confirmed
--     verbatim against github.com/supabase/vault's own README.md.
--   - cron.schedule(job_name text, schedule text, command text) upserts by
--     job_name (confirmed current pg_cron behavior); this migration still
--     explicitly unschedules-if-exists first per this task's own
--     instruction, for defensiveness and an auditable single code path.

-- ===========================================================================
-- DB-B3 — the four documented pgmq queues + their dead-letter companions.
-- Naming/DLQ-suffix convention matches the ACTUAL worker code
-- (supabase/functions/_shared/queue.ts's QUEUE_NAMES + `${queue}_dlq`
-- deadLetter helper), not BACKEND_SPEC §9's prose table (which uses a
-- shorter, inconsistent dlq name) — verified by reading queue.ts directly.
-- ===========================================================================

do $$
declare
  v_queue text;
  v_existing text[];
begin
  if not exists (select 1 from pg_extension where extname = 'pgmq') then
    raise notice 'pgmq extension not installed — skipping queue creation (expected outside a Supabase-hosted Postgres)';
  else
    select coalesce(array_agg(queue_name), array[]::text[])
      into v_existing
    from pgmq.list_queues();

    foreach v_queue in array array[
      'messages_outbound_queue', 'recording_fetch_queue',
      'adapter_push_queue', 'outreach_send_queue',
      'messages_outbound_queue_dlq', 'recording_fetch_queue_dlq',
      'adapter_push_queue_dlq', 'outreach_send_queue_dlq'
    ] loop
      if not (v_queue = any(v_existing)) then
        perform pgmq.create(v_queue);
      end if;
    end loop;
  end if;
end;
$$;

-- ===========================================================================
-- DB-internal jobs (BACKEND_SPEC §8: "DB-internal jobs (rollups,
-- availability roll-forward) run as plain SQL/PLpgSQL") — pure-SQL wrapper
-- functions over the existing per-resource/per-tenant functions, so these
-- need only pg_cron, no pg_net/vault/edge-function round trip at all.
-- Concretely closes two of DB-B2's named live consequences: "availability
-- roll-forward" and "nightly usage rollup" never running.
-- ===========================================================================

create or replace function public.fn_cron_availability_rollforward()
returns void language plpgsql as $$
declare
  r record;
begin
  for r in select tenant_id, id as resource_id from public.resources where active loop
    perform public.fn_regenerate_availability_slots(r.tenant_id, r.resource_id, null);
  end loop;
end;
$$;

comment on function public.fn_cron_availability_rollforward() is
  'Scheduled 04:00 UTC daily (BACKEND_SPEC §8 "Availability window roll-forward") — re-derives every active resource''s materialized availability window one day further out, keeping the rolling 14-30 day window full.';

create or replace function public.fn_cron_usage_rollup()
returns void language plpgsql as $$
declare
  t record;
begin
  for t in select id, timezone from public.tenants where deleted_at is null loop
    perform public.fn_upsert_usage_daily(t.id, ((now() at time zone t.timezone)::date - 1));
  end loop;
end;
$$;

comment on function public.fn_cron_usage_rollup() is
  'Scheduled 00:10 UTC daily (BACKEND_SPEC §8 "Usage rollup") — rolls up the prior day per tenant using that tenant''s own timezone (BACKEND_SPEC §8''s own DECIDE note: "recommend rolling up per tenant using that tenant''s local previous day rather than a single UTC cutoff"), feeding billing + the usage-alert UI.';

create or replace function public.fn_cron_internal_retention_sweep()
returns void language plpgsql as $$
begin
  -- DB_AUDIT.md DB-M1: neither webhook_events (one row per webhook delivery,
  -- every provider, forever) nor tool_health (one row per /voice/tools call,
  -- the highest-write-volume table by design) had any pruning strategy.
  -- tool_health is only ever queried over trailing-minutes windows
  -- (job-alert-evaluation's tool_failure_spike rule reads the last 5
  -- minutes) so 14 days leaves enormous headroom for ad hoc debugging;
  -- webhook_events is kept longer (90 days) since it doubles as an audit
  -- trail for support/compliance investigation of a specific delivery.
  -- This is a platform-wide window (not per-tenant, unlike
  -- tenants.retention_days, which governs Storage recordings — a distinct,
  -- separately-tracked gap, see this migration's header re: cluster F).
  delete from public.webhook_events where created_at < now() - interval '90 days';
  delete from public.tool_health where occurred_at < now() - interval '14 days';
end;
$$;

comment on function public.fn_cron_internal_retention_sweep() is
  'Scheduled 05:30 UTC daily — DB_AUDIT.md DB-M1''s retention fix for webhook_events/tool_health specifically (distinct from BACKEND_SPEC §8''s Storage-recording "Retention sweep" job, which needs the Storage API and therefore an edge function — tracked separately in docs/audit/FIX_REQUESTS.md for cluster F, not scheduled here).';

-- Small idempotent upsert helper used only by this migration's own DO block
-- below, so every job is unscheduled-then-rescheduled through one code path
-- rather than fifteen hand-repeated if/perform pairs.
create or replace function public.fn_cron_upsert(p_name text, p_schedule text, p_command text)
returns void language plpgsql as $$
begin
  if exists (select 1 from cron.job where jobname = p_name) then
    perform cron.unschedule(p_name);
  end if;
  perform cron.schedule(p_name, p_schedule, p_command);
end;
$$;

comment on function public.fn_cron_upsert(text, text, text) is
  'Migration-internal helper (docs/DEPLOY.md §3.6 was folded into this migration per DB_AUDIT.md DB-B2''s recommended fix) — never called outside this file''s own DO block. References cron.* directly, which is safe even where pg_cron is absent (PL/pgSQL bodies are not planned/validated against schema objects at CREATE FUNCTION time, only at first execution) since callers always check pg_cron''s presence first.';

do $$
declare
  v_pg_cron_ok boolean;
  v_pg_net_ok boolean;
  v_vault_ok boolean;
  v_base_url text;
  v_secret text;
begin
  v_pg_cron_ok := exists (select 1 from pg_extension where extname = 'pg_cron');

  if not v_pg_cron_ok then
    raise notice 'pg_cron extension not installed — skipping all cron.schedule calls (expected outside a Supabase-hosted Postgres)';
    return;
  end if;

  -- ---------------------------------------------------------------------
  -- DB-internal jobs: only need pg_cron, never blocked on Vault/pg_net.
  -- ---------------------------------------------------------------------
  perform public.fn_cron_upsert('job-internal-availability-rollforward', '0 4 * * *',
    $sql$select public.fn_cron_availability_rollforward();$sql$);
  perform public.fn_cron_upsert('job-internal-usage-rollup', '10 0 * * *',
    $sql$select public.fn_cron_usage_rollup();$sql$);
  perform public.fn_cron_upsert('job-internal-retention-sweep', '30 5 * * *',
    $sql$select public.fn_cron_internal_retention_sweep();$sql$);
  perform public.fn_cron_upsert('job-internal-referral-qualification', '0 7 * * *',
    $sql$select public.fn_check_referral_qualification();$sql$);

  -- ---------------------------------------------------------------------
  -- DB-B2 — HTTP-calling jobs (pg_net -> the deployed edge function),
  -- BACKEND_SPEC §8 cadences, using this task's Vault-secret convention
  -- (URL base + shared invoke secret) rather than the literal hardcoded
  -- project-ref/secret DEPLOY.md previously documented as a manual SQL
  -- Editor step — see this migration's header + docs/DEPLOY.md §3.6.
  -- ---------------------------------------------------------------------
  v_pg_net_ok := exists (select 1 from pg_extension where extname = 'pg_net');
  v_vault_ok := exists (select 1 from pg_extension where extname = 'supabase_vault');

  if not v_pg_net_ok then
    raise notice 'pg_net extension not installed — skipping every HTTP-calling cron job (expected outside a Supabase-hosted Postgres)';
    return;
  end if;
  if not v_vault_ok then
    raise notice 'supabase_vault extension not installed — skipping every HTTP-calling cron job until the deploy step inserts cron_functions_base_url/cron_invoke_secret (docs/DEPLOY.md §3.6)';
    return;
  end if;

  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'cron_functions_base_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_invoke_secret';

  if v_base_url is null or v_secret is null then
    raise notice 'cron_functions_base_url/cron_invoke_secret not yet present in Vault — skipping every HTTP-calling cron job until docs/DEPLOY.md §3.6''s vault.create_secret step runs (re-run this migration''s statements afterward, or push again — every call here is idempotent by job name)';
    return;
  end if;

  -- Queue workers (BACKEND_SPEC §8 "Queue worker poll", every minute).
  perform public.fn_cron_upsert('worker-messages-outbound', '* * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 15000);$fmt$,
    v_base_url || '/worker-messages-outbound', v_secret));
  perform public.fn_cron_upsert('worker-recording-fetch', '* * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 15000);$fmt$,
    v_base_url || '/worker-recording-fetch', v_secret));
  perform public.fn_cron_upsert('worker-adapter-push', '* * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 15000);$fmt$,
    v_base_url || '/worker-adapter-push', v_secret));

  -- Jobs (BACKEND_SPEC §8 cadences, DEPLOY.md §3.6's previous manual list).
  perform public.fn_cron_upsert('job-retell-health-failover', '*/2 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 15000);$fmt$,
    v_base_url || '/job-retell-health-failover', v_secret));
  perform public.fn_cron_upsert('job-alert-evaluation', '*/5 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 20000);$fmt$,
    v_base_url || '/job-alert-evaluation', v_secret));
  perform public.fn_cron_upsert('job-reminder-scheduler', '0 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-reminder-scheduler', v_secret));
  perform public.fn_cron_upsert('job-review-request', '0 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-review-request', v_secret));
  perform public.fn_cron_upsert('job-billing-cycle', '0 1 * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-billing-cycle', v_secret));
  perform public.fn_cron_upsert('job-reconciliation', '0 3 * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 60000);$fmt$,
    v_base_url || '/job-reconciliation', v_secret));
  perform public.fn_cron_upsert('job-referral-payouts', '0 8 1 * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-referral-payouts', v_secret));

  -- Outreach personalize pipeline (supabase/functions/job-outreach-
  -- personalize{,-collect}/index.ts's own cadence comments: submit every 15
  -- minutes, collect every 15 minutes offset — both exist as deployed edge
  -- functions with verify_jwt=false + CRON_INVOKE_SECRET already wired in
  -- supabase/config.toml, but were never scheduled anywhere; same DB-B2
  -- root cause, added here since these functions already exist).
  perform public.fn_cron_upsert('job-outreach-personalize', '*/15 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-outreach-personalize', v_secret));
  perform public.fn_cron_upsert('job-outreach-personalize-collect', '7,22,37,52 * * * *', format(
    $fmt$select net.http_post(url := %L, headers := jsonb_build_object('x-cron-secret', %L), timeout_milliseconds := 30000);$fmt$,
    v_base_url || '/job-outreach-personalize-collect', v_secret));
end;
$$;
