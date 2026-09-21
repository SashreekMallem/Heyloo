-- NIGHTLY-1 (docs/BUILD_PLAN.md): nightly regression of the Retell
-- batch-test suites (`api-admin-run-agent-tests`, CALL-1/CALL-8/CALL-9)
-- against every `test-*` tenant, so an agent-behavior regression surfaces
-- automatically instead of only being noticed the next time a human runs a
-- suite by hand. One row per tenant per nightly run.
--
-- Deliberately its own table rather than reusing `provisioning_runs` or
-- `alerts`: this needs to keep FULL per-run history (14+ days, per the
-- admin visibility deliverable) with structured pass/fail counts and a
-- field-capture flag queryable per-vertical, which `alerts` (fired-instance
-- rows only, existing table) has no columns for. A regression run that
-- trips a threshold still ALSO writes an `alerts` row (existing table,
-- existing admin-cockpit surface) so it shows up on the alerts feed the
-- same way every other alert rule does — this table is the durable,
-- structured record; `alerts` is the notification.
create table public.agent_regression_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  vertical text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  scenarios_total integer,
  scenarios_passed integer,
  field_capture_ok boolean,
  failures jsonb not null default '[]'::jsonb,
  retell_batch_test_id text,
  -- 'running': kicked off, not yet settled/finalized this invocation.
  -- 'complete': settled within budget — scenarios_total/scenarios_passed/
  --   field_capture_ok/failures are final for this run.
  -- 'timeout': `job-agent-regression`'s own polling budget (per tenant,
  --   inside its `EdgeRuntime.waitUntil` background window — see that
  --   function's own header comment) ran out before Retell's batch job
  --   settled; scenarios_total/scenarios_passed reflect whatever HAD
  --   settled at that point, `resume_state` carries what a follow-up
  --   invocation would need to keep polling the same Retell batch job
  --   rather than starting a new one.
  -- 'error': the run never got a usable batch job at all (tenant not
  --   found, tenant has no compiled agent, the internal call to
  --   `api-admin-run-agent-tests` failed) — no scenario counts to report.
  status text not null default 'running'
    check (status in ('running', 'complete', 'timeout', 'error')),
  -- Only populated on 'timeout': `{batch_job_id, case_definitions,
  -- started_at}, the exact `resume` shape `api-admin-run-agent-tests`
  -- itself accepts back on a follow-up call (see that function's own
  -- `RunAgentTestsRequest.resume`). Never read automatically today — kept
  -- so a manual re-run/future scheduled follow-up can resume the SAME
  -- Retell batch job instead of starting a new one and losing whatever had
  -- already progressed.
  resume_state jsonb,
  created_at timestamptz not null default now()
);

create index idx_agent_regression_runs_tenant_started
  on public.agent_regression_runs (tenant_id, started_at desc);
create index idx_agent_regression_runs_started
  on public.agent_regression_runs (started_at desc);
create index idx_agent_regression_runs_vertical_started
  on public.agent_regression_runs (vertical, started_at desc);

comment on table public.agent_regression_runs is
  'NIGHTLY-1: one row per test-* tenant per nightly `job-agent-regression` run — durable pass/fail + field-capture history for the agent-behavior regression suite. Written by service_role only (job-agent-regression); platform-admin read only, no tenant access at all (a test tenant is not a real customer and these results are an internal QA signal, not tenant-facing data).';

-- RLS (CLAUDE.md Rule 2 — every table): platform-admin read only. No
-- tenant-scoped policy at all (unlike most tenant_id-keyed tables here) —
-- these rows describe internal QA runs against seeded test tenants, never
-- something a real tenant's own owner/admin should see via their own JWT.
-- No client insert/update/delete policy either: RLS-enabled + zero
-- matching permissive policy for authenticated/anon = default deny for
-- every role except service_role (BYPASSRLS) per this migration file's own
-- house convention (see 20260907131500_rls.sql's header comment).
alter table public.agent_regression_runs enable row level security;

create policy agent_regression_runs_select on public.agent_regression_runs
  for select using (public.fn_jwt_is_platform_admin());

-- Cron scheduling deliberately lives in its own follow-up migration
-- (20260921120100_agent_regression_cron_schedule.sql), not this file:
-- `scripts/ci/cron-queues-check.ts` re-applies every vault-gated
-- cron-scheduling migration wholesale after inserting CI-only dummy Vault
-- secrets (see that script's own header comment), and re-running a
-- `create table`/`create policy` statement a second time in the same CI
-- run would fail with "already exists" — unlike `fn_cron_upsert` (upserts
-- by job name) or `create or replace function`, `create table` has no
-- built-in idempotent form used elsewhere in this migration family.
-- Splitting keeps this file safe to apply exactly once while keeping the
-- cron file safe to re-apply, matching how
-- `20260910093000_queues_and_scheduled_jobs.sql` itself only ever
-- `create or replace`s functions (never `create table`) in the part that's
-- listed in `CRON_MIGRATIONS`.
